import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

const MONTH = 30 * 24 * 60 * 60;

async function deployVestingFixture() {
  const [owner, timelock, beneficiary, secondBeneficiary, stranger, thirdBeneficiary] = await ethers.getSigners();
  const tokenFactory = await ethers.getContractFactory("AiTraceRootToken");
  const token = await tokenFactory.deploy(owner.address);
  await token.waitForDeployment();

  const latest = await time.latest();
  const vestingStart = latest + 100;
  const maxVestTotal = ethers.parseUnits("500000000", 18);
  const vestingFactory = await ethers.getContractFactory("AiTraceRootVesting");
  const vesting = await vestingFactory.deploy(
    await token.getAddress(),
    owner.address,
    timelock.address,
    vestingStart,
    maxVestTotal
  );
  await vesting.waitForDeployment();

  return {
    token,
    vesting,
    owner,
    timelock,
    beneficiary,
    secondBeneficiary,
    stranger,
    thirdBeneficiary,
    vestingStart,
    maxVestTotal
  };
}

async function fundVesting(token: any, vesting: any, owner: any, amount: bigint) {
  await token.connect(owner).approve(await vesting.getAddress(), amount);
  await expect(vesting.connect(owner).fund(amount))
    .to.emit(vesting, "VestingFunded")
    .withArgs(owner.address, amount);
}

describe("AiTraceRootVesting", () => {
  it("creates funded grants with hardcoded schedule configs", async () => {
    const { token, vesting, owner, timelock, beneficiary, secondBeneficiary, stranger, vestingStart, maxVestTotal } =
      await deployVestingFixture();
    const amount = ethers.parseUnits("120000000", 18);
    const secondAmount = ethers.parseUnits("40000000", 18);
    const totalAmount = amount + secondAmount;

    expect(await vesting.artToken()).to.equal(await token.getAddress());
    expect(await vesting.timelock()).to.equal(timelock.address);
    expect(await vesting.maxVestTotal()).to.equal(maxVestTotal);

    await fundVesting(token, vesting, owner, totalAmount);
    expect(await vesting.unallocatedBalance()).to.equal(totalAmount);

    await expect(vesting.connect(stranger).createGrant(beneficiary.address, amount, 0))
      .to.be.revertedWith("Ownable: caller is not the owner");

    await expect(vesting.createGrant(beneficiary.address, amount, 0))
      .to.emit(vesting, "GrantCreated")
      .withArgs(1, beneficiary.address, amount, 0, anyValue);

    await vesting.createGrant(secondBeneficiary.address, secondAmount, 1);

    const firstGrant = await vesting.grants(1);
    expect(firstGrant.beneficiary).to.equal(beneficiary.address);
    expect(firstGrant.amount).to.equal(amount);
    expect(firstGrant.released).to.equal(0);
    expect(firstGrant.createdAt).to.be.greaterThan(0);
    expect(firstGrant.scheduleType).to.equal(0);

    expect(await vesting.totalAllocated()).to.equal(totalAmount);
    expect(await vesting.outstandingAllocatedBalance()).to.equal(totalAmount);
    expect(await vesting.unallocatedBalance()).to.equal(0);

    expect(await vesting.vestingStart()).to.equal(vestingStart);
    expect(await vesting.MONTH()).to.equal(MONTH);
    expect(await vesting.scheduleConfig(0)).to.deep.equal([3n, 12n]);
    expect(await vesting.scheduleConfig(1)).to.deep.equal([12n, 24n]);
    expect(await vesting.scheduleConfig(2)).to.deep.equal([0n, 48n]);
    expect(await vesting.scheduleConfig(3)).to.deep.equal([12n, 36n]);
  });

  it("rejects unfunded grants and invalid parameters", async () => {
    const { token, vesting, owner, timelock, beneficiary } = await deployVestingFixture();
    const amount = ethers.parseUnits("1", 18);

    await expect(vesting.createGrant(beneficiary.address, amount, 0))
      .to.be.revertedWithCustomError(vesting, "InsufficientUnallocatedBalance");
    await expect(vesting.fund(0))
      .to.be.revertedWithCustomError(vesting, "InvalidAmount");

    await fundVesting(token, vesting, owner, amount + 1n);

    await expect(vesting.createGrant(ethers.ZeroAddress, amount, 0))
      .to.be.revertedWithCustomError(vesting, "ZeroAddress");
    await expect(vesting.createGrant(beneficiary.address, 0, 0))
      .to.be.revertedWithCustomError(vesting, "InvalidAmount");
    await expect(vesting.createGrant(beneficiary.address, amount, 4))
      .to.be.reverted;

    const vestingFactory = await ethers.getContractFactory("AiTraceRootVesting");
    await expect(vestingFactory.deploy(ethers.ZeroAddress, owner.address, timelock.address, 1, amount))
      .to.be.revertedWithCustomError(vesting, "ZeroAddress");
    await expect(vestingFactory.deploy(await token.getAddress(), ethers.ZeroAddress, timelock.address, 1, amount))
      .to.be.revertedWithCustomError(vesting, "ZeroAddress");
    await expect(vestingFactory.deploy(await token.getAddress(), owner.address, ethers.ZeroAddress, 1, amount))
      .to.be.revertedWithCustomError(vesting, "ZeroAddress");
    await expect(vestingFactory.deploy(await token.getAddress(), owner.address, timelock.address, 0, amount))
      .to.be.revertedWithCustomError(vesting, "InvalidAmount");
    await expect(vestingFactory.deploy(await token.getAddress(), owner.address, timelock.address, 1, 0))
      .to.be.revertedWithCustomError(vesting, "InvalidAmount");
  });

  it("enforces maxVestTotal when creating grants", async () => {
    const { token, owner, timelock, beneficiary, secondBeneficiary, vestingStart } = await deployVestingFixture();
    const amount = ethers.parseUnits("1000", 18);
    const vestingFactory = await ethers.getContractFactory("AiTraceRootVesting");
    const cappedVesting = await vestingFactory.deploy(
      await token.getAddress(),
      owner.address,
      timelock.address,
      vestingStart,
      amount
    );
    await cappedVesting.waitForDeployment();

    await fundVesting(token, cappedVesting, owner, amount + 1n);
    await cappedVesting.createGrant(beneficiary.address, amount, 0);
    await expect(cappedVesting.createGrant(secondBeneficiary.address, 1, 0))
      .to.be.revertedWithCustomError(cappedVesting, "MaxVestingTotalExceeded");
  });

  it("tracks direct ART transfers as unallocated balance without changing allocations", async () => {
    const { token, vesting, owner } = await deployVestingFixture();
    const directAmount = ethers.parseUnits("100", 18);

    await token.connect(owner).transfer(await vesting.getAddress(), directAmount);

    expect(await vesting.unallocatedBalance()).to.equal(directAmount);
    expect(await vesting.totalAllocated()).to.equal(0);
    expect(await vesting.outstandingAllocatedBalance()).to.equal(0);
  });

  it("rejects invalid grant lookups and oversized batches", async () => {
    const { vesting, timelock, beneficiary } = await deployVestingFixture();
    const beneficiaries = Array.from({ length: 51 }, () => beneficiary.address);
    const amounts = Array.from({ length: 51 }, () => 1n);
    const scheduleTypes = Array.from({ length: 51 }, () => 0);

    await expect(vesting.releasableAmount(999))
      .to.be.revertedWithCustomError(vesting, "InvalidGrant");
    await expect(vesting.lockedAmount(999))
      .to.be.revertedWithCustomError(vesting, "InvalidGrant");
    await expect(vesting.nextUnlockTime(999))
      .to.be.revertedWithCustomError(vesting, "InvalidGrant");
    await expect(vesting.connect(timelock).batchCreateGrants(beneficiaries, amounts, scheduleTypes))
      .to.be.revertedWithCustomError(vesting, "InvalidBatchLength");
  });

  it("vests private-sale grants after a 3-month cliff over 12 monthly releases", async () => {
    const { token, vesting, owner, beneficiary, stranger, vestingStart } = await deployVestingFixture();
    const amount = ethers.parseUnits("120000000", 18);
    const monthly = amount / 12n;

    await fundVesting(token, vesting, owner, amount);
    await vesting.createGrant(beneficiary.address, amount, 0);

    expect(await vesting.isCliffPassed(1)).to.equal(false);
    expect(await vesting.isGrantFullyUnlocked(1)).to.equal(false);

    await time.increaseTo(vestingStart + 3 * MONTH);
    expect(await vesting.isCliffPassed(1)).to.equal(true);
    expect(await vesting.vestedAmount(1, vestingStart + 3 * MONTH)).to.equal(0);
    expect(await vesting.releasableAmount(1)).to.equal(0);
    expect(await vesting.lockedAmount(1)).to.equal(amount);
    expect(await vesting.nextUnlockTime(1)).to.equal(vestingStart + 4 * MONTH);

    await expect(vesting.connect(beneficiary).claim(1))
      .to.be.revertedWithCustomError(vesting, "NothingToClaim");
    await expect(vesting.connect(stranger).claim(1))
      .to.be.revertedWithCustomError(vesting, "UnauthorizedBeneficiary");

    await time.increaseTo(vestingStart + 4 * MONTH);
    expect(await vesting.releasableAmount(1)).to.equal(monthly);
    expect(await vesting.lockedAmount(1)).to.equal(amount - monthly);
    expect(await vesting.nextUnlockTime(1)).to.equal(vestingStart + 5 * MONTH);

    await expect(vesting.connect(beneficiary).claim(1))
      .to.emit(vesting, "Released")
      .withArgs(1, beneficiary.address, monthly, monthly);

    expect(await token.balanceOf(beneficiary.address)).to.equal(monthly);
    expect(await vesting.totalReleased()).to.equal(monthly);
    expect(await vesting.outstandingAllocatedBalance()).to.equal(amount - monthly);

    await time.increaseTo(vestingStart + 15 * MONTH);
    expect(await vesting.isGrantFullyUnlocked(1)).to.equal(true);
    expect(await vesting.releasableAmount(1)).to.equal(amount - monthly);
    await vesting.connect(beneficiary).claim(1);

    expect(await token.balanceOf(beneficiary.address)).to.equal(amount);
    expect(await vesting.lockedAmount(1)).to.equal(0);
    expect(await vesting.nextUnlockTime(1)).to.equal(0);
  });

  it("uses separate hardcoded monthly rules for team, ecosystem, and treasury grants", async () => {
    const { token, vesting, owner, beneficiary, secondBeneficiary, vestingStart } = await deployVestingFixture();
    const teamAmount = ethers.parseUnits("24000000", 18);
    const ecosystemAmount = ethers.parseUnits("48000000", 18);
    const treasuryAmount = ethers.parseUnits("36000000", 18);

    await fundVesting(token, vesting, owner, teamAmount + ecosystemAmount + treasuryAmount);
    await vesting.createGrant(beneficiary.address, teamAmount, 1);
    await vesting.createGrant(secondBeneficiary.address, ecosystemAmount, 2);
    await vesting.createGrant(beneficiary.address, treasuryAmount, 3);

    expect(await vesting.isCliffPassed(2)).to.equal(false);

    await time.increaseTo(vestingStart + 1 * MONTH);
    expect(await vesting.releasableAmount(1)).to.equal(0);
    expect(await vesting.releasableAmount(2)).to.equal(ecosystemAmount / 48n);
    expect(await vesting.releasableAmount(3)).to.equal(0);

    await time.increaseTo(vestingStart + 12 * MONTH);
    expect(await vesting.releasableAmount(1)).to.equal(0);
    expect(await vesting.releasableAmount(2)).to.equal((ecosystemAmount * 12n) / 48n);
    expect(await vesting.releasableAmount(3)).to.equal(0);

    await time.increaseTo(vestingStart + 13 * MONTH);
    expect(await vesting.releasableAmount(1)).to.equal(teamAmount / 24n);
    expect(await vesting.releasableAmount(3)).to.equal(treasuryAmount / 36n);

    await time.increaseTo(vestingStart + 48 * MONTH);
    expect(await vesting.vestedAmount(1, vestingStart + 48 * MONTH)).to.equal(teamAmount);
    expect(await vesting.vestedAmount(2, vestingStart + 48 * MONTH)).to.equal(ecosystemAmount);
    expect(await vesting.vestedAmount(3, vestingStart + 48 * MONTH)).to.equal(treasuryAmount);
  });

  it("allows timelock batch grant creation with a capped batch size", async () => {
    const { token, vesting, owner, timelock, beneficiary, secondBeneficiary, stranger } = await deployVestingFixture();
    const amount = ethers.parseUnits("1000", 18);
    const secondAmount = ethers.parseUnits("2000", 18);

    await fundVesting(token, vesting, owner, amount + secondAmount);

    await expect(
      vesting.connect(stranger).batchCreateGrants([beneficiary.address], [amount], [0])
    ).to.be.revertedWith("Only timelock");
    await expect(
      vesting.connect(timelock).batchCreateGrants([beneficiary.address], [amount, secondAmount], [0])
    ).to.be.revertedWithCustomError(vesting, "InvalidBatchLength");

    await vesting.connect(timelock).batchCreateGrants(
      [beneficiary.address, secondBeneficiary.address],
      [amount, secondAmount],
      [0, 1]
    );

    expect((await vesting.grants(1)).beneficiary).to.equal(beneficiary.address);
    expect((await vesting.grants(2)).beneficiary).to.equal(secondBeneficiary.address);
    expect(await vesting.totalAllocated()).to.equal(amount + secondAmount);
  });

  it("enforces batch grant max total and unallocated balance checks before writing grants", async () => {
    const { token, owner, timelock, beneficiary, secondBeneficiary, vestingStart } = await deployVestingFixture();
    const vestingFactory = await ethers.getContractFactory("AiTraceRootVesting");
    const amount = ethers.parseUnits("1000", 18);

    const cappedVesting = await vestingFactory.deploy(
      await token.getAddress(),
      owner.address,
      timelock.address,
      vestingStart,
      amount
    );
    await cappedVesting.waitForDeployment();
    await fundVesting(token, cappedVesting, owner, amount * 2n);
    await expect(
      cappedVesting.connect(timelock).batchCreateGrants(
        [beneficiary.address, secondBeneficiary.address],
        [amount, 1n],
        [0, 1]
      )
    ).to.be.revertedWithCustomError(cappedVesting, "MaxVestingTotalExceeded");
    expect(await cappedVesting.nextGrantId()).to.equal(1);

    const underfundedVesting = await vestingFactory.deploy(
      await token.getAddress(),
      owner.address,
      timelock.address,
      vestingStart,
      amount * 2n
    );
    await underfundedVesting.waitForDeployment();
    await fundVesting(token, underfundedVesting, owner, amount);
    await expect(
      underfundedVesting.connect(timelock).batchCreateGrants(
        [beneficiary.address, secondBeneficiary.address],
        [amount, 1n],
        [0, 1]
      )
    ).to.be.revertedWithCustomError(underfundedVesting, "InsufficientUnallocatedBalance");
    expect(await underfundedVesting.nextGrantId()).to.equal(1);
  });

  it("allows two-step beneficiary changes without changing grant economics", async () => {
    const { token, vesting, owner, beneficiary, secondBeneficiary, stranger, vestingStart } =
      await deployVestingFixture();
    const amount = ethers.parseUnits("120000000", 18);
    const monthly = amount / 12n;

    await fundVesting(token, vesting, owner, amount);
    await vesting.createGrant(beneficiary.address, amount, 0);

    await expect(vesting.connect(stranger).requestBeneficiaryChange(1, secondBeneficiary.address))
      .to.be.revertedWithCustomError(vesting, "UnauthorizedBeneficiary");
    await expect(vesting.connect(beneficiary).requestBeneficiaryChange(1, ethers.ZeroAddress))
      .to.be.revertedWithCustomError(vesting, "ZeroAddress");
    await expect(vesting.connect(beneficiary).requestBeneficiaryChange(1, beneficiary.address))
      .to.be.revertedWithCustomError(vesting, "SameBeneficiary");

    await expect(vesting.connect(beneficiary).requestBeneficiaryChange(1, secondBeneficiary.address))
      .to.emit(vesting, "RequestBeneficiaryChange")
      .withArgs(1, beneficiary.address, secondBeneficiary.address);
    expect(await vesting.pendingBeneficiaries(1)).to.equal(secondBeneficiary.address);

    await expect(vesting.connect(stranger).acceptBeneficiaryChange(1))
      .to.be.revertedWithCustomError(vesting, "UnauthorizedPendingBeneficiary");

    await expect(vesting.connect(secondBeneficiary).acceptBeneficiaryChange(1))
      .to.emit(vesting, "AcceptBeneficiaryChange")
      .withArgs(1, beneficiary.address, secondBeneficiary.address);
    expect(await vesting.pendingBeneficiaries(1)).to.equal(ethers.ZeroAddress);

    const grantAfterChange = await vesting.grants(1);
    expect(grantAfterChange.beneficiary).to.equal(secondBeneficiary.address);
    expect(grantAfterChange.amount).to.equal(amount);
    expect(grantAfterChange.released).to.equal(0);
    expect(grantAfterChange.scheduleType).to.equal(0);

    await time.increaseTo(vestingStart + 4 * MONTH);
    await expect(vesting.connect(beneficiary).claim(1))
      .to.be.revertedWithCustomError(vesting, "UnauthorizedBeneficiary");

    await vesting.connect(secondBeneficiary).claim(1);
    expect(await token.balanceOf(secondBeneficiary.address)).to.equal(monthly);
  });

  it("preserves released amount and schedule after emergency beneficiary replacement", async () => {
    const { token, vesting, owner, timelock, beneficiary, secondBeneficiary, vestingStart } =
      await deployVestingFixture();
    const amount = ethers.parseUnits("1200000", 18);
    const monthly = amount / 12n;

    await fundVesting(token, vesting, owner, amount);
    await vesting.createGrant(beneficiary.address, amount, 0);

    await time.increaseTo(vestingStart + 4 * MONTH);
    await vesting.connect(beneficiary).claim(1);
    expect(await token.balanceOf(beneficiary.address)).to.equal(monthly);

    await vesting.connect(timelock).emergencyChangeBeneficiary(1, secondBeneficiary.address);
    const grantAfterChange = await vesting.grants(1);
    expect(grantAfterChange.beneficiary).to.equal(secondBeneficiary.address);
    expect(grantAfterChange.amount).to.equal(amount);
    expect(grantAfterChange.released).to.equal(monthly);
    expect(grantAfterChange.scheduleType).to.equal(0);

    await expect(vesting.connect(beneficiary).claim(1))
      .to.be.revertedWithCustomError(vesting, "UnauthorizedBeneficiary");

    await time.increaseTo(vestingStart + 5 * MONTH);
    await vesting.connect(secondBeneficiary).claim(1);
    expect(await token.balanceOf(secondBeneficiary.address)).to.equal(monthly);
    expect(await vesting.totalReleased()).to.equal(monthly * 2n);
  });

  it("allows beneficiary-change cancellation and timelock emergency beneficiary replacement", async () => {
    const { token, vesting, owner, timelock, beneficiary, secondBeneficiary, stranger, vestingStart } =
      await deployVestingFixture();
    const amount = ethers.parseUnits("24000000", 18);
    const monthly = amount / 24n;

    await fundVesting(token, vesting, owner, amount);
    await vesting.createGrant(beneficiary.address, amount, 1);

    await expect(vesting.connect(beneficiary).cancelBeneficiaryChange(1))
      .to.be.revertedWithCustomError(vesting, "NoPendingBeneficiary");
    await expect(vesting.connect(secondBeneficiary).acceptBeneficiaryChange(1))
      .to.be.revertedWithCustomError(vesting, "NoPendingBeneficiary");

    await vesting.connect(beneficiary).requestBeneficiaryChange(1, stranger.address);
    await expect(vesting.connect(stranger).cancelBeneficiaryChange(1))
      .to.be.revertedWithCustomError(vesting, "UnauthorizedBeneficiary");
    await expect(vesting.connect(beneficiary).cancelBeneficiaryChange(1))
      .to.emit(vesting, "CancelBeneficiaryChange")
      .withArgs(1);
    expect(await vesting.pendingBeneficiaries(1)).to.equal(ethers.ZeroAddress);

    await expect(vesting.connect(stranger).emergencyChangeBeneficiary(1, secondBeneficiary.address))
      .to.be.revertedWith("Only timelock");
    await expect(vesting.connect(owner).emergencyChangeBeneficiary(1, secondBeneficiary.address))
      .to.be.revertedWith("Only timelock");
    await expect(vesting.connect(timelock).emergencyChangeBeneficiary(1, ethers.ZeroAddress))
      .to.be.revertedWithCustomError(vesting, "ZeroAddress");
    await expect(vesting.connect(timelock).emergencyChangeBeneficiary(1, beneficiary.address))
      .to.be.revertedWithCustomError(vesting, "SameBeneficiary");

    await vesting.connect(beneficiary).requestBeneficiaryChange(1, stranger.address);
    await expect(vesting.connect(timelock).emergencyChangeBeneficiary(1, secondBeneficiary.address))
      .to.emit(vesting, "EmergencyChangeBeneficiary")
      .withArgs(1, beneficiary.address, secondBeneficiary.address);
    expect(await vesting.pendingBeneficiaries(1)).to.equal(ethers.ZeroAddress);

    const grantAfterEmergencyChange = await vesting.grants(1);
    expect(grantAfterEmergencyChange.beneficiary).to.equal(secondBeneficiary.address);
    expect(grantAfterEmergencyChange.amount).to.equal(amount);
    expect(grantAfterEmergencyChange.released).to.equal(0);
    expect(grantAfterEmergencyChange.scheduleType).to.equal(1);

    await time.increaseTo(vestingStart + 13 * MONTH);
    await vesting.connect(secondBeneficiary).claim(1);
    expect(await token.balanceOf(secondBeneficiary.address)).to.equal(monthly);
  });

  it("allows timelock to reclaim long-unclaimed fully unlocked grants", async () => {
    const { token, vesting, owner, timelock, beneficiary, stranger, vestingStart } = await deployVestingFixture();
    const amount = ethers.parseUnits("120000000", 18);

    await fundVesting(token, vesting, owner, amount);
    await vesting.createGrant(beneficiary.address, amount, 0);

    await expect(vesting.connect(stranger).reclaimExpiredGrant(1)).to.be.revertedWith("Only timelock");
    await expect(vesting.connect(timelock).reclaimExpiredGrant(1))
      .to.be.revertedWithCustomError(vesting, "GrantNotFullyUnlocked");

    await time.increaseTo(vestingStart + 15 * MONTH);
    await expect(vesting.connect(timelock).reclaimExpiredGrant(1))
      .to.be.revertedWithCustomError(vesting, "ReclaimDelayNotPassed");

    await time.increaseTo(vestingStart + 15 * MONTH + 180 * 24 * 60 * 60);
    await expect(vesting.connect(timelock).reclaimExpiredGrant(1))
      .to.emit(vesting, "GrantReclaimed")
      .withArgs(1, beneficiary.address, amount, anyValue);

    const grantAfterReclaim = await vesting.grants(1);
    expect(grantAfterReclaim.amount).to.equal(0);
    expect(await vesting.totalAllocated()).to.equal(0);
    expect(await vesting.outstandingAllocatedBalance()).to.equal(0);
    expect(await vesting.unallocatedBalance()).to.equal(amount);
    await expect(vesting.connect(beneficiary).claim(1))
      .to.be.revertedWithCustomError(vesting, "NothingToClaim");
  });

  it("reclaims only the unclaimed portion after partial release and never transfers it to timelock", async () => {
    const { token, vesting, owner, timelock, beneficiary, vestingStart } = await deployVestingFixture();
    const amount = ethers.parseUnits("120000000", 18);
    const monthly = amount / 12n;
    const timelockBalanceBefore = await token.balanceOf(timelock.address);

    await fundVesting(token, vesting, owner, amount);
    await vesting.createGrant(beneficiary.address, amount, 0);

    await time.increaseTo(vestingStart + 4 * MONTH);
    await vesting.connect(beneficiary).claim(1);

    await time.increaseTo(vestingStart + 15 * MONTH + 180 * 24 * 60 * 60);
    await expect(vesting.connect(timelock).reclaimExpiredGrant(1))
      .to.emit(vesting, "GrantReclaimed")
      .withArgs(1, beneficiary.address, amount - monthly, anyValue);

    const grantAfterReclaim = await vesting.grants(1);
    expect(grantAfterReclaim.amount).to.equal(monthly);
    expect(grantAfterReclaim.released).to.equal(monthly);
    expect(await token.balanceOf(timelock.address)).to.equal(timelockBalanceBefore);
    expect(await vesting.totalAllocated()).to.equal(monthly);
    expect(await vesting.outstandingAllocatedBalance()).to.equal(0);
    expect(await vesting.unallocatedBalance()).to.equal(amount - monthly);
  });

  it("rejects reclaiming a fully claimed grant", async () => {
    const { token, vesting, owner, timelock, beneficiary, vestingStart } = await deployVestingFixture();
    const amount = ethers.parseUnits("120000000", 18);

    await fundVesting(token, vesting, owner, amount);
    await vesting.createGrant(beneficiary.address, amount, 0);

    await time.increaseTo(vestingStart + 15 * MONTH);
    await vesting.connect(beneficiary).claim(1);
    expect(await token.balanceOf(beneficiary.address)).to.equal(amount);

    await time.increaseTo(vestingStart + 15 * MONTH + 180 * 24 * 60 * 60);
    await expect(vesting.connect(timelock).reclaimExpiredGrant(1))
      .to.be.revertedWithCustomError(vesting, "NothingToReclaim");
  });

  it("uses two-step vesting ownership transfer for future owner-created grants", async () => {
    const { token, vesting, owner, beneficiary, secondBeneficiary, stranger } = await deployVestingFixture();
    const amount = ethers.parseUnits("1000", 18);

    await fundVesting(token, vesting, owner, amount);
    await expect(vesting.connect(stranger).transferOwnership2Step(secondBeneficiary.address))
      .to.be.revertedWith("Ownable: caller is not the owner");
    await vesting.transferOwnership2Step(secondBeneficiary.address);
    await vesting.connect(secondBeneficiary).acceptOwnership();

    await expect(vesting.createGrant(beneficiary.address, amount, 0))
      .to.be.revertedWith("Ownable: caller is not the owner");
    await vesting.connect(secondBeneficiary).createGrant(beneficiary.address, amount, 0);
    expect((await vesting.grants(1)).beneficiary).to.equal(beneficiary.address);
  });

  it("does not expose admin withdrawal, pause, or proxy upgrade functions", async () => {
    const { vesting } = await deployVestingFixture();
    const functionNames = vesting.interface.fragments
      .filter((fragment) => fragment.type === "function")
      .map((fragment) => fragment.name);

    expect(functionNames).to.include.members([
      "createGrant",
      "batchCreateGrants",
      "fund",
      "claim",
      "reclaimExpiredGrant",
      "releasableAmount",
      "vestedAmount",
      "lockedAmount",
      "nextUnlockTime",
      "isGrantFullyUnlocked",
      "isCliffPassed",
      "scheduleConfig",
      "unallocatedBalance",
      "outstandingAllocatedBalance",
      "requestBeneficiaryChange",
      "cancelBeneficiaryChange",
      "acceptBeneficiaryChange",
      "emergencyChangeBeneficiary",
      "transferOwnership2Step",
      "renounceOwnership"
    ]);
    expect(functionNames).to.not.include.members([
      "withdraw",
      "emergencyWithdraw",
      "recover",
      "recoverToken",
      "sweep",
      "setBeneficiary",
      "pause",
      "unpause",
      "upgradeTo",
      "upgradeToAndCall"
    ]);
  });
});
