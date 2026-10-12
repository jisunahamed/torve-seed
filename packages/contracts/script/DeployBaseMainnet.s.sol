// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";

import {ISetRegistry, ISetWriter} from "../interfaces/ITorveWiring.sol";
import {TorveRegistry} from "../core/TorveRegistry.sol";

/**
 * @title DeployBaseMainnet
 * @notice Deploys Torve protocol to Base mainnet.
 *         Uses real USDC (Circle) and real ERC-8004 IdentityRegistry.
 *         Skips TorveSlashing (not needed for v1).
 *
 * Usage:
 *   cd packages/contracts
 *   source .env
 *   forge script script/DeployBaseMainnet.s.sol \
 *     --rpc-url $BASE_MAINNET_RPC_URL \
 *     --broadcast \
 *     --verify \
 *     --etherscan-api-key $BASESCAN_API_KEY \
 *     --via-ir
 */
contract DeployBaseMainnet is Script {
    // Real USDC on Base mainnet (Circle)
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // ERC-8004 IdentityRegistry on Base mainnet
    address constant IDENTITY_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address protocolReserve = vm.envAddress("PROTOCOL_RESERVE");
        address teamWallet = vm.envAddress("TEAM_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        console.log("=== Base Mainnet Deployment ===");
        console.log("");
        console.log("Deployer:             ", deployer);
        console.log("Protocol Reserve:     ", protocolReserve);
        console.log("Team Wallet:          ", teamWallet);
        console.log("USDC (Circle):        ", USDC);
        console.log("ERC-8004 Registry:    ", IDENTITY_REGISTRY);
        console.log("");

        // 1. ANTSToken
        bytes memory tokenBytecode = vm.getCode("ANTSToken.sol:ANTSToken");
        address antsToken;
        assembly { antsToken := create(0, add(tokenBytecode, 0x20), mload(tokenBytecode)) }
        require(antsToken != address(0), "ANTSToken deploy failed");
        console.log("ANTSToken:            ", antsToken);

        // 2. TorveRegistry (central address book)
        TorveRegistry torveRegistry = new TorveRegistry();
        console.log("TorveRegistry:      ", address(torveRegistry));

        // 3. TorveStaking(usdc, registry)
        bytes memory stakingBytecode = abi.encodePacked(
            vm.getCode("TorveStaking.sol:TorveStaking"),
            abi.encode(USDC, address(torveRegistry))
        );
        address staking;
        assembly { staking := create(0, add(stakingBytecode, 0x20), mload(stakingBytecode)) }
        require(staking != address(0), "Staking deploy failed");
        console.log("TorveStaking:       ", staking);

        // 4. TorveDeposits(usdc)
        bytes memory depositsBytecode = abi.encodePacked(
            vm.getCode("TorveDeposits.sol:TorveDeposits"),
            abi.encode(USDC)
        );
        address deposits;
        assembly { deposits := create(0, add(depositsBytecode, 0x20), mload(depositsBytecode)) }
        require(deposits != address(0), "Deposits deploy failed");
        console.log("TorveDeposits:      ", deposits);

        // 5. TorveChannels(registry)
        bytes memory channelsBytecode = abi.encodePacked(
            vm.getCode("TorveChannels.sol:TorveChannels"),
            abi.encode(address(torveRegistry))
        );
        address channels;
        assembly { channels := create(0, add(channelsBytecode, 0x20), mload(channelsBytecode)) }
        require(channels != address(0), "Channels deploy failed");
        console.log("TorveChannels:      ", channels);

        // 6. TorveStats
        bytes memory statsBytecode = vm.getCode("TorveStats.sol:TorveStats");
        address stats;
        assembly { stats := create(0, add(statsBytecode, 0x20), mload(statsBytecode)) }
        require(stats != address(0), "Stats deploy failed");
        console.log("TorveStats:         ", stats);

        // 7. TorveEmissions(registry, initialEmission, epochDuration)
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
        console.log("=== Base Mainnet deployment complete ===");
        console.log("");
        console.log("Add to chain-config.ts (base-mainnet):");
        console.log("  usdcContractAddress:      ", USDC);
        console.log("  depositsContractAddress:   ", deposits);
        console.log("  channelsContractAddress:   ", channels);
        console.log("  stakingContractAddress:    ", staking);
        console.log("  emissionsContractAddress:  ", emissions);
        console.log("  identityRegistryAddress:   ", IDENTITY_REGISTRY);
    }
}
