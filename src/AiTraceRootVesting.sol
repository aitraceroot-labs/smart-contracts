// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract AiTraceRootVesting is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error InvalidAmount();
    error InvalidSchedule();
    error InsufficientUnallocatedBalance();
    error MaxVestingTotalExceeded();
    error InvalidGrant();
    error UnauthorizedBeneficiary();
    error UnauthorizedPendingBeneficiary();
    error NoPendingBeneficiary();
    error SameBeneficiary();
    error NothingToClaim();
    error InvalidBatchLength();
    error GrantNotFullyUnlocked();
    error ReclaimDelayNotPassed();
    error NothingToReclaim();

    enum ScheduleType {
        PrivateSale,
        TeamAndAdvisors,
        EcosystemAndNodeRewards,
        TreasuryReserve
    }

    struct Grant {
        address beneficiary;
        uint256 amount;
        uint256 released;
        uint256 createdAt;
        ScheduleType scheduleType;
        bool exists;
    }

    event GrantCreated(
        uint256 indexed grantId,
        address beneficiary,
        uint256 amount,
        ScheduleType schedule,
        uint256 createTime
    );
    event Released(uint256 indexed grantId, address caller, uint256 releaseAmount, uint256 totalReleased);
    event RequestBeneficiaryChange(
        uint256 indexed grantId,
        address oldBen,
        address newBen
    );
    event AcceptBeneficiaryChange(uint256 indexed grantId, address oldBen, address newBen);
    event CancelBeneficiaryChange(uint256 indexed grantId);
    event EmergencyChangeBeneficiary(uint256 indexed grantId, address oldBen, address newBen);
    event GrantReclaimed(
        uint256 indexed grantId,
        address beneficiary,
        uint256 reclaimedAmount,
        uint256 reclaimTime
    );
    event VestingFunded(address indexed from, uint256 amount);

    uint256 public constant MONTH = 30 days;
    uint256 public constant RECLAIM_DELAY = 180 days;
    uint256 public constant MAX_BATCH_GRANTS = 50;

    IERC20 public immutable artToken;
    address public immutable timelock;
    uint256 public immutable vestingStart;
    uint256 public immutable maxVestTotal;

    uint256 public nextGrantId = 1;
    uint256 public totalAllocated;
    uint256 public totalReleased;

    mapping(uint256 => Grant) public grants;
    mapping(uint256 => address) public pendingBeneficiaries;

    constructor(IERC20 artToken_, address initialOwner, address timelock_, uint256 vestingStart_, uint256 maxVestTotal_) {
        if (address(artToken_) == address(0) || initialOwner == address(0) || timelock_ == address(0)) {
            revert ZeroAddress();
        }
        if (vestingStart_ == 0 || maxVestTotal_ == 0) {
            revert InvalidAmount();
        }

        artToken = artToken_;
        timelock = timelock_;
        vestingStart = vestingStart_;
        maxVestTotal = maxVestTotal_;
        _transferOwnership(initialOwner);
    }

    function createGrant(address beneficiary, uint256 amount, ScheduleType scheduleType)
        external
        onlyOwner
        returns (uint256 grantId)
    {
        grantId = _createGrant(beneficiary, amount, scheduleType);
    }

    function batchCreateGrants(
        address[] calldata beneficiaries,
        uint256[] calldata amounts,
        ScheduleType[] calldata scheduleTypes
    ) external returns (uint256[] memory grantIds) {
        require(msg.sender == timelock, "Only timelock");
        uint256 length = beneficiaries.length;
        if (length == 0 || length > MAX_BATCH_GRANTS || amounts.length != length || scheduleTypes.length != length) {
            revert InvalidBatchLength();
        }

        uint256 totalBatchAmount = 0;
        for (uint256 i = 0; i < length; i += 1) {
            _validateGrantInput(beneficiaries[i], amounts[i], scheduleTypes[i]);
            totalBatchAmount += amounts[i];
        }
        if (totalAllocated + totalBatchAmount > maxVestTotal) {
            revert MaxVestingTotalExceeded();
        }
        if (totalBatchAmount > unallocatedBalance()) {
            revert InsufficientUnallocatedBalance();
        }

        grantIds = new uint256[](length);
        for (uint256 i = 0; i < length; i += 1) {
            grantIds[i] = _storeGrant(beneficiaries[i], amounts[i], scheduleTypes[i]);
        }
    }

    function fund(uint256 amount) external nonReentrant {
        if (amount == 0) {
            revert InvalidAmount();
        }

        IERC20(address(artToken)).safeTransferFrom(msg.sender, address(this), amount);
        emit VestingFunded(msg.sender, amount);
    }

    function claim(uint256 grantId) external nonReentrant returns (uint256 amount) {
        Grant storage grant = _grantOf(grantId);
        if (msg.sender != grant.beneficiary) {
            revert UnauthorizedBeneficiary();
        }

        amount = releasableAmount(grantId);
        if (amount < 1) {
            revert NothingToClaim();
        }

        grant.released += amount;
        totalReleased += amount;
        IERC20(address(artToken)).safeTransfer(grant.beneficiary, amount);

        emit Released(grantId, msg.sender, amount, grant.released);
    }

    function requestBeneficiaryChange(uint256 grantId, address newBeneficiary) external {
        Grant storage grant = _grantOf(grantId);
        if (msg.sender != grant.beneficiary) {
            revert UnauthorizedBeneficiary();
        }
        if (newBeneficiary == address(0)) {
            revert ZeroAddress();
        }
        if (newBeneficiary == grant.beneficiary) {
            revert SameBeneficiary();
        }

        pendingBeneficiaries[grantId] = newBeneficiary;
        emit RequestBeneficiaryChange(grantId, grant.beneficiary, newBeneficiary);
    }

    function cancelBeneficiaryChange(uint256 grantId) external {
        Grant storage grant = _grantOf(grantId);
        if (msg.sender != grant.beneficiary) {
            revert UnauthorizedBeneficiary();
        }

        address pendingBeneficiary = pendingBeneficiaries[grantId];
        if (pendingBeneficiary == address(0)) {
            revert NoPendingBeneficiary();
        }

        delete pendingBeneficiaries[grantId];
        emit CancelBeneficiaryChange(grantId);
    }

    function acceptBeneficiaryChange(uint256 grantId) external {
        Grant storage grant = _grantOf(grantId);
        address pendingBeneficiary = pendingBeneficiaries[grantId];
        if (pendingBeneficiary == address(0)) {
            revert NoPendingBeneficiary();
        }
        if (msg.sender != pendingBeneficiary) {
            revert UnauthorizedPendingBeneficiary();
        }

        address previousBeneficiary = grant.beneficiary;
        grant.beneficiary = pendingBeneficiary;
        delete pendingBeneficiaries[grantId];

        emit AcceptBeneficiaryChange(grantId, previousBeneficiary, pendingBeneficiary);
    }

    function emergencyChangeBeneficiary(uint256 grantId, address newBeneficiary) external {
        require(msg.sender == timelock, "Only timelock");
        Grant storage grant = _grantOf(grantId);
        if (newBeneficiary == address(0)) {
            revert ZeroAddress();
        }
        if (newBeneficiary == grant.beneficiary) {
            revert SameBeneficiary();
        }

        address previousBeneficiary = grant.beneficiary;
        grant.beneficiary = newBeneficiary;
        delete pendingBeneficiaries[grantId];

        emit EmergencyChangeBeneficiary(grantId, previousBeneficiary, newBeneficiary);
    }

    function reclaimExpiredGrant(uint256 grantId) external nonReentrant {
        require(msg.sender == timelock, "Only timelock");
        Grant storage grant = _grantOf(grantId);
        if (vestedAmount(grantId, block.timestamp) < grant.amount) {
            revert GrantNotFullyUnlocked();
        }
        if (block.timestamp < grant.createdAt + RECLAIM_DELAY || block.timestamp < _fullUnlockTime(grant.scheduleType) + RECLAIM_DELAY) {
            revert ReclaimDelayNotPassed();
        }

        uint256 remaining = grant.amount - grant.released;
        if (remaining == 0) {
            revert NothingToReclaim();
        }

        grant.amount = grant.released;
        totalAllocated -= remaining;

        emit GrantReclaimed(grantId, grant.beneficiary, remaining, block.timestamp);
    }

    function releasableAmount(uint256 grantId) public view returns (uint256) {
        Grant storage grant = _grantOf(grantId);
        uint256 vested = vestedAmount(grantId, block.timestamp);
        if (vested <= grant.released) {
            return 0;
        }

        return vested - grant.released;
    }

    function vestedAmount(uint256 grantId, uint256 timestamp) public view returns (uint256) {
        Grant storage grant = _grantOf(grantId);
        (uint8 cliffMonths, uint8 releaseMonths) = _scheduleConfig(grant.scheduleType);

        if (timestamp < vestingStart + (uint256(cliffMonths) + 1) * MONTH) {
            return 0;
        }

        uint256 elapsedMonths = (timestamp - vestingStart) / MONTH;
        uint256 vestedMonths = elapsedMonths - cliffMonths;

        if (vestedMonths >= releaseMonths) {
            return grant.amount;
        }

        return (grant.amount * vestedMonths) / releaseMonths;
    }

    function lockedAmount(uint256 grantId) external view returns (uint256) {
        Grant storage grant = _grantOf(grantId);
        return grant.amount - vestedAmount(grantId, block.timestamp);
    }

    function nextUnlockTime(uint256 grantId) external view returns (uint256) {
        Grant storage grant = _grantOf(grantId);
        (uint8 cliffMonths, uint8 releaseMonths) = _scheduleConfig(grant.scheduleType);

        uint256 elapsedMonths = 0;
        if (block.timestamp > vestingStart) {
            elapsedMonths = (block.timestamp - vestingStart) / MONTH;
        }

        if (elapsedMonths >= uint256(cliffMonths) + releaseMonths) {
            return 0;
        }

        if (elapsedMonths <= cliffMonths) {
            return vestingStart + (uint256(cliffMonths) + 1) * MONTH;
        }

        return vestingStart + (elapsedMonths + 1) * MONTH;
    }

    function isGrantFullyUnlocked(uint256 grantId) external view returns (bool) {
        Grant storage grant = _grantOf(grantId);
        return vestedAmount(grantId, block.timestamp) >= grant.amount;
    }

    function isCliffPassed(uint256 grantId) external view returns (bool) {
        Grant storage grant = _grantOf(grantId);
        (uint8 cliffMonths,) = _scheduleConfig(grant.scheduleType);
        if (cliffMonths == 0) {
            return block.timestamp >= vestingStart;
        }

        return block.timestamp >= vestingStart + uint256(cliffMonths) * MONTH;
    }

    function scheduleConfig(ScheduleType scheduleType) external pure returns (uint8 cliffMonths, uint8 releaseMonths) {
        return _scheduleConfig(scheduleType);
    }

    function transferOwnership2Step(address newOwner) external onlyOwner {
        transferOwnership(newOwner);
    }

    function outstandingAllocatedBalance() public view returns (uint256) {
        return totalAllocated - totalReleased;
    }

    function unallocatedBalance() public view returns (uint256) {
        uint256 balance = artToken.balanceOf(address(this));
        uint256 outstanding = outstandingAllocatedBalance();
        if (balance <= outstanding) {
            return 0;
        }

        return balance - outstanding;
    }

    function _createGrant(address beneficiary, uint256 amount, ScheduleType scheduleType) private returns (uint256 grantId) {
        _validateGrantInput(beneficiary, amount, scheduleType);

        if (totalAllocated + amount > maxVestTotal) {
            revert MaxVestingTotalExceeded();
        }
        if (amount > unallocatedBalance()) {
            revert InsufficientUnallocatedBalance();
        }

        grantId = _storeGrant(beneficiary, amount, scheduleType);
    }

    function _validateGrantInput(address beneficiary, uint256 amount, ScheduleType scheduleType) private pure {
        if (beneficiary == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert InvalidAmount();
        }
        _scheduleConfig(scheduleType);
    }

    function _storeGrant(address beneficiary, uint256 amount, ScheduleType scheduleType) private returns (uint256 grantId) {
        grantId = nextGrantId;
        nextGrantId += 1;

        uint256 createTime = block.timestamp;
        grants[grantId] = Grant({
            beneficiary: beneficiary,
            amount: amount,
            released: 0,
            createdAt: createTime,
            scheduleType: scheduleType,
            exists: true
        });
        totalAllocated += amount;

        emit GrantCreated(grantId, beneficiary, amount, scheduleType, createTime);
    }

    function _grantOf(uint256 grantId) private view returns (Grant storage grant) {
        grant = grants[grantId];
        if (!grant.exists) {
            revert InvalidGrant();
        }
    }

    function _fullUnlockTime(ScheduleType scheduleType) private view returns (uint256) {
        (uint8 cliffMonths, uint8 releaseMonths) = _scheduleConfig(scheduleType);
        return vestingStart + (uint256(cliffMonths) + uint256(releaseMonths)) * MONTH;
    }

    function _scheduleConfig(ScheduleType scheduleType) private pure returns (uint8 cliffMonths, uint8 releaseMonths) {
        if (scheduleType == ScheduleType.PrivateSale) {
            return (3, 12);
        }
        if (scheduleType == ScheduleType.TeamAndAdvisors) {
            return (12, 24);
        }
        if (scheduleType == ScheduleType.EcosystemAndNodeRewards) {
            return (0, 48);
        }
        if (scheduleType == ScheduleType.TreasuryReserve) {
            return (12, 36);
        }

        revert InvalidSchedule();
    }
}
