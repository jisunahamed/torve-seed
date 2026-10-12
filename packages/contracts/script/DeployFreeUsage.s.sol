// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";

import { TorveFreeUsage } from "../payments/TorveFreeUsage.sol";
import { ITorveRegistry } from "../interfaces/ITorveRegistry.sol";
import { ISetWriter } from "../interfaces/ITorveWiring.sol";

/**
 * @title DeployFreeUsage
 * @notice Deploys only TorveFreeUsage against an existing Torve registry.
 *
 * Required env:
 *   DEPLOYER_PRIVATE_KEY   Broadcaster private key.
 *   TORVE_REGISTRY       Deployed TorveRegistry address.
 *
 * Optional env:
 *   FREE_USAGE_AUTHORIZE_STATS  Defaults to true. Grants the deployed
 *                               FreeUsage contract writer access on the
 *                               registry's TorveStats contract.
 *
 * Usage:
 *   cd packages/contracts
 *   source .env
 *   forge script script/DeployFreeUsage.s.sol \
 *     --rpc-url $BASE_MAINNET_RPC_URL \
 *     --broadcast \
 *     --verify \
 *     --etherscan-api-key $BASESCAN_API_KEY \
 *     --via-ir
 */
contract DeployFreeUsage is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address registryAddress = vm.envAddress("TORVE_REGISTRY");
        bool authorizeStats = vm.envOr("FREE_USAGE_AUTHORIZE_STATS", true);

        ITorveRegistry registry = ITorveRegistry(registryAddress);
        address staking = registry.staking();
        address stats = registry.stats();

        require(staking != address(0), "registry staking not set");

        vm.startBroadcast(deployerPrivateKey);

        console.log("=== TorveFreeUsage Deployment ===");
        console.log("Deployer:             ", deployer);
        console.log("TorveRegistry:      ", registryAddress);
        console.log("TorveStaking:       ", staking);
        console.log("TorveStats:         ", stats);
        console.log("");

        TorveFreeUsage freeUsage = new TorveFreeUsage(registryAddress);
        console.log("TorveFreeUsage:     ", address(freeUsage));

        if (authorizeStats && stats != address(0)) {
            ISetWriter(stats).setWriter(address(freeUsage), true);
            console.log("Stats writer granted: ", true);
        } else {
            console.log("Stats writer granted: ", false);
        }

        vm.stopBroadcast();

        console.log("");
        console.log("=== TorveFreeUsage deployment complete ===");
        console.log("Update chain config:");
        console.log("  freeUsageContractAddress:", address(freeUsage));
    }
}
