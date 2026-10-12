// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";

import {ISetRegistry, ISetWriter} from "../interfaces/ITorveWiring.sol";
import {TorveRegistry} from "../core/TorveRegistry.sol";

/**
 * @title Deploy
 * @notice Deploys the full Torve protocol to a local anvil chain.
 *         Uses MockERC8004Registry for local testing (on mainnet, use the real ERC-8004).
 *
 * Usage:
 *   anvil &
 *   forge script contracts/script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
 */
contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr(
            "DEPLOYER_PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80) // anvil account 0
        );

        address protocolReserve = vm.envOr("PROTOCOL_RESERVE", vm.addr(deployerPrivateKey));

        // Read bytecodes from compiled artifacts
        bytes memory usdcBytecode = vm.getCode("MockUSDC.sol:MockUSDC");
        bytes memory tokenBytecode = vm.getCode("ANTSToken.sol:ANTSToken");

        vm.startBroadcast(deployerPrivateKey);

        // 1. MockUSDC
        address usdc;
        assembly { usdc := create(0, add(usdcBytecode, 0x20), mload(usdcBytecode)) }
        require(usdc != address(0), "MockUSDC deploy failed");
        console.log("MockUSDC:             ", usdc);

        // 2. MockERC8004Registry (local testing; on mainnet use 0x8004A169...)
        bytes memory registryBytecode = vm.getCode("MockERC8004Registry.sol:MockERC8004Registry");
        address identityRegistry;
        assembly { identityRegistry := create(0, add(registryBytecode, 0x20), mload(registryBytecode)) }
        require(identityRegistry != address(0), "MockERC8004Registry deploy failed");
        console.log("MockERC8004Registry:  ", identityRegistry);

        // 3. ANTSToken
        address antsToken;
        assembly { antsToken := create(0, add(tokenBytecode, 0x20), mload(tokenBytecode)) }
        require(antsToken != address(0), "ANTSToken deploy failed");
        console.log("ANTSToken:            ", antsToken);

        // 4. TorveRegistry (central address book)
        TorveRegistry torveRegistry = new TorveRegistry();
        console.log("TorveRegistry:      ", address(torveRegistry));

        // 5. TorveStaking(usdc, registry)
        bytes memory stakingBytecode = abi.encodePacked(
            vm.getCode("TorveStaking.sol:TorveStaking"),
            abi.encode(usdc, address(torveRegistry))
        );
        address staking;
        assembly { staking := create(0, add(stakingBytecode, 0x20), mload(stakingBytecode)) }
        require(staking != address(0), "Staking deploy failed");
        console.log("TorveStaking:       ", staking);

        // 6. TorveDeposits(usdc)
        bytes memory depositsBytecode = abi.encodePacked(
            vm.getCode("TorveDeposits.sol:TorveDeposits"),
            abi.encode(usdc)
        );
        address deposits;
        assembly { deposits := create(0, add(depositsBytecode, 0x20), mload(depositsBytecode)) }
        require(deposits != address(0), "Deposits deploy failed");
        console.log("TorveDeposits:      ", deposits);

        // 7. TorveChannels(registry)
        bytes memory channelsBytecode = abi.encodePacked(
            vm.getCode("TorveChannels.sol:TorveChannels"),
            abi.encode(address(torveRegistry))
        );
        address channels;
        assembly { channels := create(0, add(channelsBytecode, 0x20), mload(channelsBytecode)) }
        require(channels != address(0), "Channels deploy failed");
        console.log("TorveChannels:      ", channels);

        // 8. TorveStats
        bytes memory statsBytecode = vm.getCode("TorveStats.sol:TorveStats");
        address stats;
        assembly { stats := create(0, add(statsBytecode, 0x20), mload(statsBytecode)) }
        require(stats != address(0), "Stats deploy failed");
        console.log("TorveStats:         ", stats);

        // 9. TorveEmissions(registry, initialEmission, epochDuration)
        bytes memory emissionsBytecode = abi.encodePacked(
            vm.getCode("TorveEmissions.sol:TorveEmissions"),
            abi.encode(address(torveRegistry), uint256(5_000_000e18), uint256(7 days))
        );
        address emissions;
        assembly { emissions := create(0, add(emissionsBytecode, 0x20), mload(emissionsBytecode)) }
        require(emissions != address(0), "Emissions deploy failed");
        console.log("TorveEmissions:     ", emissions);

        // 10. TorveDepositRelay(usdc, deposits, FEE)
        //     Keep this LAST among contract creations — the deterministic anvil
        //     addresses of everything above (nonces 0-8) are hardcoded in
        //     scripts/setup-local-test.sh and chain-config base-local.
        bytes memory relayBytecode = abi.encodePacked(
            vm.getCode("TorveDepositRelay.sol:TorveDepositRelay"),
            abi.encode(usdc, deposits, uint256(50_000)) // fixed fee: $0.05
        );
        address depositRelay;
        assembly { depositRelay := create(0, add(relayBytecode, 0x20), mload(relayBytecode)) }
        require(depositRelay != address(0), "DepositRelay deploy failed");
        console.log("TorveDepositRelay:  ", depositRelay);

        // ---- Wire registry ----
        torveRegistry.setChannels(channels);
        torveRegistry.setStats(stats);
        torveRegistry.setDeposits(deposits);
        torveRegistry.setStaking(staking);
        torveRegistry.setEmissions(emissions);
        torveRegistry.setAntsToken(antsToken);
        torveRegistry.setIdentityRegistry(identityRegistry);
        torveRegistry.setProtocolReserve(protocolReserve);

        // ---- Point each contract at the registry ----
        // Channels and Staking already received the registry in their constructors,
        // but we include them here for uniformity so the pattern is obvious in upgrades.
        ISetRegistry(channels).setRegistry(address(torveRegistry));
        ISetRegistry(deposits).setRegistry(address(torveRegistry));
        ISetRegistry(staking).setRegistry(address(torveRegistry));
        ISetRegistry(emissions).setRegistry(address(torveRegistry));
        ISetRegistry(antsToken).setRegistry(address(torveRegistry));

        // ---- Authorize Channels as Stats writer ----
        ISetWriter(stats).setWriter(channels, true);

        vm.stopBroadcast();

        console.log("");
        console.log("--- Protocol fully deployed and wired ---");
    }
}
