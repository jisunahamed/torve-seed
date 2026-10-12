// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";

import {ISetRegistry, ISetWriter} from "../interfaces/ITorveWiring.sol";
import {TorveRegistry} from "../core/TorveRegistry.sol";

/**
 * @title DeployBaseSepolia
 * @notice Deploys Torve protocol to Base Sepolia testnet.
 *         Uses real USDC (Circle testnet) and real ERC-8004 IdentityRegistry.
 *         Skips TorveSlashing (not needed for v1).
 *
 * Usage:
 *   cd packages/contracts
 *   source .env
 *   forge script script/DeployBaseSepolia.s.sol \
 *     --rpc-url $BASE_SEPOLIA_RPC_URL \
 *     --broadcast \
 *     --verify \
 *     --etherscan-api-key $BASESCAN_API_KEY \
 *     --via-ir
 */
contract DeployBaseSepolia is Script {
    // ERC-8004 IdentityRegistry on Base Sepolia
    address constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address protocolReserve = vm.envAddress("PROTOCOL_RESERVE");
        address teamWallet = vm.envAddress("TEAM_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        // 1. MockUSDC (permissionless mint for testnet)
        bytes memory usdcBytecode = vm.getCode("MockUSDC.sol:MockUSDC");
        address usdc;
        assembly { usdc := create(0, add(usdcBytecode, 0x20), mload(usdcBytecode)) }
        require(usdc != address(0), "MockUSDC deploy failed");

        console.log("Deployer:             ", deployer);
        console.log("Protocol Reserve:     ", protocolReserve);
        console.log("Team Wallet:          ", teamWallet);
        console.log("MockUSDC:             ", usdc);
        console.log("ERC-8004 Registry:    ", IDENTITY_REGISTRY);
        console.log("");

        // 2. ANTSToken
        bytes memory tokenBytecode = vm.getCode("ANTSToken.sol:ANTSToken");
        address antsToken;
        assembly { antsToken := create(0, add(tokenBytecode, 0x20), mload(tokenBytecode)) }
        require(antsToken != address(0), "ANTSToken deploy failed");
        console.log("ANTSToken:            ", antsToken);

        // 3. TorveRegistry (central address book)
        TorveRegistry torveRegistry = new TorveRegistry();
        console.log("TorveRegistry:      ", address(torveRegistry));

        // 4. TorveStaking(usdc, registry)
        bytes memory stakingBytecode = abi.encodePacked(
            vm.getCode("TorveStaking.sol:TorveStaking"),
            abi.encode(usdc, address(torveRegistry))
        );
        address staking;
        assembly { staking := create(0, add(stakingBytecode, 0x20), mload(stakingBytecode)) }
        require(staking != address(0), "Staking deploy failed");
        console.log("TorveStaking:       ", staking);

        // 5. TorveDeposits(usdc)
        bytes memory depositsBytecode = abi.encodePacked(
            vm.getCode("TorveDeposits.sol:TorveDeposits"),
            abi.encode(usdc)
        );
        address deposits;
        assembly { deposits := create(0, add(depositsBytecode, 0x20), mload(depositsBytecode)) }
        require(deposits != address(0), "Deposits deploy failed");
        console.log("TorveDeposits:      ", deposits);

        // 6. TorveChannels(registry)
        bytes memory channelsBytecode = abi.encodePacked(
            vm.getCode("TorveChannels.sol:TorveChannels"),
            abi.encode(address(torveRegistry))
        );
        address channels;
        assembly { channels := create(0, add(channelsBytecode, 0x20), mload(channelsBytecode)) }
        require(channels != address(0), "Channels deploy failed");
        console.log("TorveChannels:      ", channels);

        // 7. TorveStats
        bytes memory statsBytecode = vm.getCode("TorveStats.sol:TorveStats");
        address stats;
        assembly { stats := create(0, add(statsBytecode, 0x20), mload(statsBytecode)) }
        require(stats != address(0), "Stats deploy failed");
        console.log("TorveStats:         ", stats);

        // 8. TorveEmissions(registry, initialEmission, epochDuration)
        bytes memory emissionsBytecode = abi.encodePacked(
            vm.getCode("TorveEmissions.sol:TorveEmissions"),
            abi.encode(address(torveRegistry), uint256(5_000_000e18), uint256(7 days))
        );
        address emissions;
        assembly { emissions := create(0, add(emissionsBytecode, 0x20), mload(emissionsBytecode)) }
        require(emissions != address(0), "Emissions deploy failed");
        console.log("TorveEmissions:     ", emissions);

        // ---- Wire registry ----
        torveRegistry.setChannels(channels);
        torveRegistry.setStats(stats);
        torveRegistry.setDeposits(deposits);
        torveRegistry.setStaking(staking);
        torveRegistry.setEmissions(emissions);
        torveRegistry.setAntsToken(antsToken);
        torveRegistry.setIdentityRegistry(IDENTITY_REGISTRY);
        torveRegistry.setProtocolReserve(protocolReserve);
        torveRegistry.setTeamWallet(teamWallet);

        // ---- Point each contract at the registry ----
        ISetRegistry(channels).setRegistry(address(torveRegistry));
        ISetRegistry(deposits).setRegistry(address(torveRegistry));
        ISetRegistry(staking).setRegistry(address(torveRegistry));
        ISetRegistry(emissions).setRegistry(address(torveRegistry));
        ISetRegistry(antsToken).setRegistry(address(torveRegistry));

        // ---- Authorize Channels as Stats writer ----
        ISetWriter(stats).setWriter(channels, true);

        vm.stopBroadcast();

        console.log("");
        console.log("--- Base Sepolia deployment complete ---");
        console.log("");
        console.log("Add to chain-config.ts:");
        console.log("  usdcContractAddress:    ", usdc);
        console.log("  depositsContractAddress:", deposits);
        console.log("  channelsContractAddress:", channels);
        console.log("  stakingContractAddress: ", staking);
        console.log("  emissionsContractAddress:", emissions);
        console.log("  identityRegistryAddress:", IDENTITY_REGISTRY);
    }
}
