// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITorveSellerUnlockPolicy {
    function canClaimSellerUnlocked(address seller) external view returns (bool);
}
