// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AiTraceRootBadgeBase} from "./AiTraceRootBadgeBase.sol";

contract AiTraceRootBuilderBadge is AiTraceRootBadgeBase {
    function initialize(
        address initialOwner,
        address initialOperator,
        string memory baseURI,
        uint256 initialMaxSupply,
        string memory badgeType_,
        string memory collectionName,
        string memory collectionSymbol
    ) external initializer {
        __AiTraceRootBadgeBase_init(
            collectionName,
            collectionSymbol,
            badgeType_,
            initialOwner,
            initialOperator,
            baseURI,
            initialMaxSupply
        );
    }

    uint256[50] private __gap;
}
