// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

abstract contract AiTraceRootBadgeBase is
    Initializable,
    ERC721Upgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    error InvalidAddress();
    error UnauthorizedOperator();
    error TransfersDisabled();
    error AlreadyClaimed();
    error RecipientAlreadyHoldsBadge();
    error MaxSupplyReached();
    error InvalidMaxSupply();

    event OperatorUpdated(address indexed operator, bool enabled);
    event TransfersEnabledUpdated(bool enabled);
    event BaseURIUpdated(string baseURI);
    event MaxSupplyUpdated(uint256 maxSupply);
    event BadgeMinted(address indexed recipient, uint256 indexed tokenId, string badgeType);
    event BadgeAirdropped(address indexed recipient, uint256 indexed tokenId, string badgeType);
    event BatchAirdropped(uint256 requestedCount, uint256 mintedCount, string badgeType);

    string public badgeType;
    uint256 public nextTokenId;
    uint256 public maxSupply;
    bool public transfersEnabled;

    mapping(address => bool) public operators;
    mapping(address => bool) public hasClaimed;

    string private tokenBaseURI;

    modifier onlyOwnerOrOperator() {
        if (owner() != _msgSender() && !operators[_msgSender()]) {
            revert UnauthorizedOperator();
        }
        _;
    }

    function __AiTraceRootBadgeBase_init(
        string memory name_,
        string memory symbol_,
        string memory badgeType_,
        address initialOwner_,
        address initialOperator_,
        string memory baseURI_,
        uint256 maxSupply_
    ) internal onlyInitializing {
        if (initialOwner_ == address(0)) {
            revert InvalidAddress();
        }

        __ERC721_init(name_, symbol_);
        __Ownable_init();
        __Pausable_init();
        _transferOwnership(initialOwner_);

        badgeType = badgeType_;
        nextTokenId = 1;
        tokenBaseURI = baseURI_;
        maxSupply = maxSupply_;

        if (initialOperator_ != address(0)) {
            operators[initialOperator_] = true;
            emit OperatorUpdated(initialOperator_, true);
        }
    }

    function setOperator(address operator, bool enabled) external onlyOwner {
        if (operator == address(0)) {
            revert InvalidAddress();
        }

        operators[operator] = enabled;
        emit OperatorUpdated(operator, enabled);
    }

    function setTransfersEnabled(bool enabled) external onlyOwner {
        transfersEnabled = enabled;
        emit TransfersEnabledUpdated(enabled);
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        tokenBaseURI = baseURI_;
        emit BaseURIUpdated(baseURI_);
    }

    function setMaxSupply(uint256 maxSupply_) external onlyOwner {
        if (maxSupply_ != 0 && maxSupply_ < totalMinted()) {
            revert InvalidMaxSupply();
        }

        maxSupply = maxSupply_;
        emit MaxSupplyUpdated(maxSupply_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function totalMinted() public view returns (uint256) {
        return nextTokenId - 1;
    }

    function airdrop(address recipient) external onlyOwnerOrOperator whenNotPaused returns (uint256 tokenId) {
        tokenId = _mintOne(recipient);
        emit BadgeAirdropped(recipient, tokenId, badgeType);
    }

    function batchAirdrop(address[] calldata recipients)
        external
        onlyOwnerOrOperator
        whenNotPaused
        returns (uint256[] memory tokenIds)
    {
        tokenIds = new uint256[](recipients.length);

        for (uint256 i = 0; i < recipients.length; i++) {
            uint256 tokenId = _mintOne(recipients[i]);
            tokenIds[i] = tokenId;
            emit BadgeAirdropped(recipients[i], tokenId, badgeType);
        }

        emit BatchAirdropped(recipients.length, recipients.length, badgeType);
    }

    function _mintOne(address recipient) internal returns (uint256 tokenId) {
        if (recipient == address(0)) {
            revert InvalidAddress();
        }
        if (hasClaimed[recipient]) {
            revert AlreadyClaimed();
        }
        if (balanceOf(recipient) != 0) {
            revert RecipientAlreadyHoldsBadge();
        }
        if (maxSupply != 0 && totalMinted() >= maxSupply) {
            revert MaxSupplyReached();
        }

        tokenId = nextTokenId;
        nextTokenId += 1;
        hasClaimed[recipient] = true;
        _mint(recipient, tokenId);

        emit BadgeMinted(recipient, tokenId, badgeType);
    }

    function _baseURI() internal view override returns (string memory) {
        return tokenBaseURI;
    }

    function _beforeTokenTransfer(address from, address to, uint256 tokenId, uint256 batchSize)
        internal
        override
    {
        _requireNotPaused();

        if (from != address(0) && to != address(0)) {
            if (!transfersEnabled) {
                revert TransfersDisabled();
            }
        }

        if (to != address(0)) {
            if (balanceOf(to) != 0) {
                revert RecipientAlreadyHoldsBadge();
            }
        }

        super._beforeTokenTransfer(from, to, tokenId, batchSize);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    uint256[40] private __gap;
}
