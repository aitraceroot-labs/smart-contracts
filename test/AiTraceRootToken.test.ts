import { expect } from "chai";
import { ethers } from "hardhat";

async function deployTokenFixture() {
  const [owner, timelock, user, recipient, spender, stranger] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("AiTraceRootToken");
  const token = await factory.deploy(owner.address);
  await token.waitForDeployment();

  return { token, owner, timelock, user, recipient, spender, stranger };
}

describe("AiTraceRootToken", () => {
  it("sets fixed BEP20 metadata and assigns the full supply to the initial owner", async () => {
    const { token, owner } = await deployTokenFixture();
    const supply = ethers.parseUnits("1000000000", 18);

    expect(await token.name()).to.equal("AiTraceRoot");
    expect(await token.symbol()).to.equal("ART");
    expect(await token.decimals()).to.equal(18);
    expect(await token.totalSupply()).to.equal(supply);
    expect(await token.INITIAL_SUPPLY()).to.equal(supply);
    expect(await token.balanceOf(owner.address)).to.equal(supply);
    expect(await token.owner()).to.equal(owner.address);
    expect(await token.getOwner()).to.equal(owner.address);
  });

  it("rejects invalid constructor addresses", async () => {
    const factory = await ethers.getContractFactory("AiTraceRootToken");

    await expect(factory.deploy(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(factory, "ZeroAddress");
  });

  it("transfers and transferFrom without any fee or hidden deduction", async () => {
    const { token, owner, user, recipient, spender } = await deployTokenFixture();
    const transferAmount = ethers.parseUnits("1000", 18);
    const spendAmount = ethers.parseUnits("250", 18);

    await expect(token.transfer(user.address, transferAmount))
      .to.emit(token, "Transfer")
      .withArgs(owner.address, user.address, transferAmount);

    expect(await token.balanceOf(user.address)).to.equal(transferAmount);

    await expect(token.connect(user).approve(spender.address, spendAmount))
      .to.emit(token, "Approval")
      .withArgs(user.address, spender.address, spendAmount);
    expect(await token.allowance(user.address, spender.address)).to.equal(spendAmount);

    await token.connect(spender).transferFrom(user.address, recipient.address, spendAmount);

    expect(await token.balanceOf(recipient.address)).to.equal(spendAmount);
    expect(await token.balanceOf(user.address)).to.equal(transferAmount - spendAmount);
    expect(await token.allowance(user.address, spender.address)).to.equal(0);
  });

  it("supports burn and burnFrom with explicit business events", async () => {
    const { token, owner, user, spender } = await deployTokenFixture();
    const userAmount = ethers.parseUnits("1000", 18);
    const burnAmount = ethers.parseUnits("100", 18);
    const burnFromAmount = ethers.parseUnits("200", 18);
    const initialSupply = await token.totalSupply();

    await token.transfer(user.address, userAmount);
    await expect(token.connect(user).burn(burnAmount))
      .to.emit(token, "Burn")
      .withArgs(user.address, burnAmount);

    expect(await token.balanceOf(user.address)).to.equal(userAmount - burnAmount);
    expect(await token.totalSupply()).to.equal(initialSupply - burnAmount);

    await token.connect(user).approve(spender.address, burnFromAmount);
    await expect(token.connect(spender).burnFrom(user.address, burnFromAmount))
      .to.emit(token, "Burn")
      .withArgs(user.address, burnFromAmount);

    expect(await token.balanceOf(user.address)).to.equal(userAmount - burnAmount - burnFromAmount);
    expect(await token.totalSupply()).to.equal(initialSupply - burnAmount - burnFromAmount);
    expect(await token.balanceOf(owner.address)).to.equal(initialSupply - userAmount);
  });

  it("enforces standard ERC20 failure paths without fees or admin bypasses", async () => {
    const { token, owner, user, recipient, spender } = await deployTokenFixture();
    const amount = ethers.parseUnits("10", 18);

    await expect(token.connect(user).transfer(recipient.address, 1))
      .to.be.revertedWith("ERC20: transfer amount exceeds balance");
    await expect(token.transfer(ethers.ZeroAddress, amount))
      .to.be.revertedWith("ERC20: transfer to the zero address");
    await expect(token.connect(user).approve(ethers.ZeroAddress, amount))
      .to.be.revertedWith("ERC20: approve to the zero address");
    await expect(token.connect(spender).burnFrom(owner.address, amount))
      .to.be.revertedWith("ERC20: insufficient allowance");
  });

  it("uses two-step ownership transfer and supports ownership renounce", async () => {
    const { token, owner, user, stranger } = await deployTokenFixture();

    await expect(token.connect(stranger).transferOwnership2Step(user.address))
      .to.be.revertedWith("Ownable: caller is not the owner");

    await token.transferOwnership2Step(user.address);
    expect(await token.owner()).to.equal(owner.address);
    expect(await token.pendingOwner()).to.equal(user.address);
    await token.transferOwnership2Step(ethers.ZeroAddress);
    expect(await token.owner()).to.equal(owner.address);
    expect(await token.pendingOwner()).to.equal(ethers.ZeroAddress);
    await expect(token.connect(user).acceptOwnership())
      .to.be.revertedWith("Ownable2Step: caller is not the new owner");

    await token.transferOwnership2Step(user.address);
    await expect(token.connect(stranger).acceptOwnership())
      .to.be.revertedWith("Ownable2Step: caller is not the new owner");
    await token.connect(user).acceptOwnership();
    expect(await token.owner()).to.equal(user.address);

    await token.connect(user).renounceOwnership();
    expect(await token.owner()).to.equal(ethers.ZeroAddress);
  });

  it("does not expose minting, tax, pause, blacklist, or proxy upgrade functions", async () => {
    const { token } = await deployTokenFixture();
    const functionNames = token.interface.fragments
      .filter((fragment) => fragment.type === "function")
      .map((fragment) => fragment.name);

    expect(functionNames).to.include.members([
      "totalSupply",
      "balanceOf",
      "transfer",
      "transferFrom",
      "approve",
      "allowance",
      "burn",
      "burnFrom",
      "renounceOwnership",
      "transferOwnership",
      "transferOwnership2Step",
      "acceptOwnership"
    ]);
    expect(functionNames).to.not.include.members([
      "mint",
      "pause",
      "unpause",
      "setTax",
      "setFee",
      "setFees",
      "setMaxTx",
      "setMaxWallet",
      "addBlacklist",
      "removeBlacklist",
      "isBlacklisted",
      "blacklistTime",
      "setBlacklisted",
      "batchBlacklist",
      "blacklistMany",
      "upgradeTo",
      "upgradeToAndCall"
    ]);
  });
});
