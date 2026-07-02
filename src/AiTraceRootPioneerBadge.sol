// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {AiTraceRootBadgeBase} from "./AiTraceRootBadgeBase.sol";

contract AiTraceRootPioneerBadge is AiTraceRootBadgeBase, EIP712Upgradeable {
    error MintClosed();
    error MintNotStarted();
    error MintWindowEnded();
    error AuthorizationExpired();
    error InvalidMintSigner();
    error AuthorizationAlreadyUsed();

    event MintSignerUpdated(address indexed mintSigner);
    event MintWindowUpdated(uint256 mintStartTime, uint256 mintEndTime);
    event MintPermanentlyClosed(uint256 closedAt);

    bytes32 public constant MINT_AUTHORIZATION_TYPEHASH =
        keccak256("MintAuthorization(address wallet,uint256 nonce,uint256 deadline)");

    address public mintSigner;
    uint256 public mintStartTime;
    uint256 public mintEndTime;
    bool public mintClosed;

    mapping(bytes32 => bool) public usedAuthorizations;

    function initialize(
        address initialOwner,
        address initialOperator,
        address initialMintSigner,
        string memory baseURI,
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
            0
        );
        __EIP712_init(collectionName, "1");

        if (initialMintSigner == address(0)) {
            revert InvalidMintSigner();
        }

        mintSigner = initialMintSigner;
        mintStartTime = block.timestamp;
        mintEndTime = block.timestamp + 100 days;
    }

    function mint(uint256 nonce, uint256 deadline, bytes calldata signature)
        external
        whenNotPaused
        returns (uint256 tokenId)
    {
        if (mintClosed) {
            revert MintClosed();
        }
        if (block.timestamp < mintStartTime) {
            revert MintNotStarted();
        }
        if (block.timestamp > mintEndTime) {
            revert MintWindowEnded();
        }
        if (block.timestamp > deadline) {
            revert AuthorizationExpired();
        }

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(MINT_AUTHORIZATION_TYPEHASH, _msgSender(), nonce, deadline))
        );

        if (usedAuthorizations[digest]) {
            revert AuthorizationAlreadyUsed();
        }
        if (ECDSA.recover(digest, signature) != mintSigner) {
            revert InvalidMintSigner();
        }

        usedAuthorizations[digest] = true;
        tokenId = _mintOne(_msgSender());
    }

    function setMintSigner(address mintSigner_) external onlyOwner {
        if (mintSigner_ == address(0)) {
            revert InvalidMintSigner();
        }

        mintSigner = mintSigner_;
        emit MintSignerUpdated(mintSigner_);
    }

    function setMintWindow(uint256 mintStartTime_, uint256 mintEndTime_) external onlyOwner {
        if (mintEndTime_ <= mintStartTime_) {
            revert MintWindowEnded();
        }

        mintStartTime = mintStartTime_;
        mintEndTime = mintEndTime_;
        emit MintWindowUpdated(mintStartTime_, mintEndTime_);
    }

    function endMint() external onlyOwner {
        mintClosed = true;
        emit MintPermanentlyClosed(block.timestamp);
    }

    uint256[45] private __gap;
}
