// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";

import { TorveRegistry } from "../core/TorveRegistry.sol";
import { TorveEmissionsGate } from "../emissions/TorveEmissionsGate.sol";
import { TorveUsageAccounting } from "../emissions/TorveUsageAccounting.sol";
import { TorvePointsPolicyRegistry } from "../policies/TorvePointsPolicyRegistry.sol";
import { TorveWashTradingPointsPolicy } from "../policies/TorveWashTradingPointsPolicy.sol";
import { WashTradingStatusForPoints } from "./TorveWashTradingPointsPolicy.t.sol";
import { MockERC8004Registry } from "./mocks/MockERC8004Registry.sol";

contract RecognizedUsageLegacyEmissionsMarker { }

contract RecognizedUsageLegacyStakingMarker { }

contract RecognizedUsageFoundationTest is Test {
    uint256 private constant GENESIS = 1_775_728_461;
    address private constant ANTS_TOKEN = 0xa87EE81b2C0Bc659307ca2D9ffdC38514DD85263;
    bytes32 private constant VERIFICATION_MINTER_ID = keccak256("torve.emissions.verification.v1");

    function test_washPolicyPassesHonestUsageThroughBeforeBoundaryFlip() public {
        vm.warp(GENESIS + 8 days);

        TorveRegistry registry = new TorveRegistry();
        deployCodeTo("ANTSToken.sol:ANTSToken", ANTS_TOKEN);
        registry.setAntsToken(ANTS_TOKEN);
        registry.setIdentityRegistry(address(new MockERC8004Registry()));
        registry.setTeamWallet(address(0xA11CE));
        registry.setProtocolReserve(address(0xB0B));

        RecognizedUsageLegacyEmissionsMarker legacyEmissions = new RecognizedUsageLegacyEmissionsMarker();
        RecognizedUsageLegacyStakingMarker legacyStaking = new RecognizedUsageLegacyStakingMarker();
        registry.setEmissions(address(legacyEmissions));
        registry.setStaking(address(legacyStaking));

        TorveEmissionsGate gate = new TorveEmissionsGate(address(0xA11CE), address(0xB0B), 15_000, 15_000);
        TorveUsageAccounting usageAccounting = new TorveUsageAccounting(address(0), address(this), address(gate));
        TorvePointsPolicyRegistry pointsPolicyRegistry = new TorvePointsPolicyRegistry(address(this));
        WashTradingStatusForPoints washStatus = new WashTradingStatusForPoints();
        TorveWashTradingPointsPolicy washPolicy = new TorveWashTradingPointsPolicy(address(washStatus));
        pointsPolicyRegistry.registerPolicy(address(washPolicy));
        address verificationWallet = address(0xF1ED);

        usageAccounting.setPointsPolicy(address(pointsPolicyRegistry));
        gate.setMinter(VERIFICATION_MINTER_ID, verificationWallet, 10_000, true);

        assertEq(address(usageAccounting.pointsPolicy()), address(pointsPolicyRegistry));
        assertEq(pointsPolicyRegistry.policyCount(), 1);
        (uint256 sellerPoints, uint256 buyerPoints) =
            pointsPolicyRegistry.points(bytes32(0), address(0xB0B), address(0xCAFE), 1_000);
        assertEq(sellerPoints, 1_000);
        assertEq(buyerPoints, 1_000);

        (address controller, uint32 shareBps,) = gate.minters(VERIFICATION_MINTER_ID);
        assertEq(controller, verificationWallet);
        assertEq(shareBps, 10_000);
        assertEq(registry.emissions(), address(legacyEmissions));
        assertEq(registry.staking(), address(legacyStaking));

        vm.warp(GENESIS + gate.effectiveEpoch() * gate.EPOCH_DURATION() + 1);
        assertEq(registry.emissions(), address(legacyEmissions));
        assertEq(registry.staking(), address(legacyStaking));
    }
}
