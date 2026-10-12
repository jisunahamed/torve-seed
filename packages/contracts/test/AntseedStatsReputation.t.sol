// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../payments/TorveChannels.sol";
import "../staking/TorveStaking.sol";
import "../core/TorveRegistry.sol";
import "../payments/TorveDeposits.sol";
import "./mocks/MockERC8004Registry.sol";
import "./mocks/MockUSDC.sol";

/// @dev Tests for AgentStats tracking within TorveChannels.
///      Uses the Channels contract directly (stats are now inline).
contract TorveStatsReputationTest is Test {
    TorveChannels public channelsContract;
    TorveStaking public staking;
    TorveRegistry public torveRegistry;
    TorveDeposits public deposits;
    MockERC8004Registry public identityRegistry;
    MockUSDC public usdc;

    address public seller = address(0x1);
    address public buyer = address(0x2);
    address public reserve = address(0x4);
    uint256 public sellerAgentId;

    uint256 public constant STAKE_AMT = 10_000_000;
    uint128 public constant USDC_100 = 100_000_000;

    function setUp() public {
        usdc = new MockUSDC();
        identityRegistry = new MockERC8004Registry();

        torveRegistry = new TorveRegistry();
        deposits = new TorveDeposits(address(usdc));
        channelsContract = new TorveChannels(address(torveRegistry));
        staking = new TorveStaking(address(usdc), address(torveRegistry));

        torveRegistry.setChannels(address(channelsContract));
        torveRegistry.setDeposits(address(deposits));
        torveRegistry.setStaking(address(staking));
        torveRegistry.setIdentityRegistry(address(identityRegistry));
        torveRegistry.setProtocolReserve(reserve);

        // Register seller
        vm.prank(seller);
        sellerAgentId = identityRegistry.register();

        // Stake seller
        usdc.mint(seller, STAKE_AMT);
        vm.startPrank(seller);
        usdc.approve(address(staking), STAKE_AMT);
        staking.stake(sellerAgentId, STAKE_AMT);
        vm.stopPrank();
    }

    // ── getAgentStats ──

    function test_getAgentStats_empty() public view {
        TorveChannels.AgentStats memory s = channelsContract.getAgentStats(999);
        assertEq(s.channelCount, 0);
        assertEq(s.ghostCount, 0);
        assertEq(s.totalVolumeUsdc, 0);
        assertEq(s.lastSettledAt, 0);
        assertEq(s.lastSettledAt, 0);
    }
}
