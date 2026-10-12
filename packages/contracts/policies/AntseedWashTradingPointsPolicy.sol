pragma solidity ^0.8.24;

import { ITorvePointsModifier } from "../interfaces/ITorvePointsModifier.sol";
import { ITorveWashTradingStatus } from "../interfaces/ITorveWashTradingStatus.sol";

contract TorveWashTradingPointsPolicy is ITorvePointsModifier {
    ITorveWashTradingStatus public immutable washTradingRegistry;

    error InvalidAddress();

    constructor(address registry) {
        if (registry == address(0)) revert InvalidAddress();
        washTradingRegistry = ITorveWashTradingStatus(registry);
    }

    function points(bytes32, address, address seller, uint256 sellerPoints, uint256 buyerPoints)
        external
        view
        returns (uint256 adjustedSellerPoints, uint256 adjustedBuyerPoints)
    {
        if (washTradingRegistry.isProvenWashTrader(seller)) return (0, 0);
        return (sellerPoints, buyerPoints);
    }
}
