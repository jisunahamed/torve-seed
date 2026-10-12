// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITorveSellerRewardsPool {
    function recordLockedReward(address seller, uint256 amount) external;
}
