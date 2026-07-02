import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

async function deployPioneerFixture() {
  const [owner, operator, mintSigner, user, recipient, secondRecipient, stranger] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("AiTraceRootPioneerBadge");
  const badge = await factory.deploy();
  await badge.waitForDeployment();
  await badge.initialize(
    owner.address,
    operator.address,
    mintSigner.address,
    "ipfs://sandbox-alpha/",
    "alpha",
    "Sandbox Alpha Badge",
    "SB-ALPHA"
  );

  return { badge, owner, operator, mintSigner, user, recipient, secondRecipient, stranger };
}

async function signPioneerMintAuthorization(
  badge: Awaited<ReturnType<typeof deployPioneerFixture>>["badge"],
  mintSigner: Awaited<ReturnType<typeof deployPioneerFixture>>["mintSigner"],
  wallet: string,
  nonce: number,
  deadline: number
) {
  const chainId = await ethers.provider.getNetwork().then((network) => network.chainId);
  return mintSigner.signTypedData(
    {
      name: await badge.name(),
      version: "1",
      chainId,
      verifyingContract: await badge.getAddress()
    },
    {
      MintAuthorization: [
        { name: "wallet", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }
      ]
    },
    {
      wallet,
      nonce,
      deadline
    }
  );
}

describe("AiTraceRootPioneerBadge", () => {
  it("deploys behind a UUPS proxy and upgrades to a compatible implementation", async () => {
    const [owner, operator, mintSigner] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("AiTraceRootPioneerBadge");
    const proxy = await upgrades.deployProxy(
      factory,
      [
        owner.address,
        operator.address,
        mintSigner.address,
        "ipfs://sandbox-alpha/",
        "alpha",
        "Sandbox Alpha Badge",
        "SB-ALPHA"
      ],
      { kind: "uups" }
    );
    await proxy.waitForDeployment();

    expect(await proxy.owner()).to.equal(owner.address);
    expect(await proxy.badgeType()).to.equal("alpha");

    const v2Factory = await ethers.getContractFactory("AiTraceRootPioneerBadgeV2");
    const upgraded = await upgrades.upgradeProxy(await proxy.getAddress(), v2Factory, {
      unsafeAllow: ["missing-initializer-call"]
    });
    expect(await upgraded.versionMarker()).to.equal("v2");
  });

  it("mints once with a valid backend authorization", async () => {
    const { badge, mintSigner, user } = await deployPioneerFixture();
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const signature = await signPioneerMintAuthorization(badge, mintSigner, user.address, 1, deadline);

    await expect(badge.connect(user).mint(1, deadline, signature))
      .to.emit(badge, "BadgeMinted")
      .withArgs(user.address, 1, "alpha");

    expect(await badge.hasClaimed(user.address)).to.equal(true);
  });

  it("mints to a contract wallet without requiring ERC721Receiver", async () => {
    const { badge, mintSigner, user } = await deployPioneerFixture();
    const receiverFactory = await ethers.getContractFactory("NonERC721Receiver");
    const receiver = await receiverFactory.connect(user).deploy();
    await receiver.waitForDeployment();
    const receiverAddress = await receiver.getAddress();
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const signature = await signPioneerMintAuthorization(badge, mintSigner, receiverAddress, 1, deadline);

    await expect(receiver.connect(user).mintBadge(await badge.getAddress(), 1, deadline, signature))
      .to.emit(badge, "BadgeMinted")
      .withArgs(receiverAddress, 1, "alpha");

    expect(await badge.ownerOf(1)).to.equal(receiverAddress);
    expect(await badge.hasClaimed(receiverAddress)).to.equal(true);
  });

  it("rejects duplicate alpha badge minting", async () => {
    const { badge, mintSigner, user } = await deployPioneerFixture();
    const firstDeadline = Math.floor(Date.now() / 1000) + 3600;
    const firstSignature = await signPioneerMintAuthorization(badge, mintSigner, user.address, 1, firstDeadline);
    await badge.connect(user).mint(1, firstDeadline, firstSignature);

    const secondDeadline = firstDeadline + 1;
    const secondSignature = await signPioneerMintAuthorization(badge, mintSigner, user.address, 2, secondDeadline);
    await expect(badge.connect(user).mint(2, secondDeadline, secondSignature))
      .to.be.revertedWithCustomError(badge, "AlreadyClaimed");
  });

  it("rejects expired and invalid mint authorizations", async () => {
    const { badge, mintSigner, user, stranger } = await deployPioneerFixture();
    const expiredDeadline = Math.floor(Date.now() / 1000) - 1;
    const expiredSignature = await signPioneerMintAuthorization(badge, mintSigner, user.address, 1, expiredDeadline);

    await expect(badge.connect(user).mint(1, expiredDeadline, expiredSignature))
      .to.be.revertedWithCustomError(badge, "AuthorizationExpired");

    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const invalidSignature = await signPioneerMintAuthorization(badge, stranger, user.address, 2, deadline);
    await expect(badge.connect(user).mint(2, deadline, invalidSignature))
      .to.be.revertedWithCustomError(badge, "InvalidMintSigner");
  });

  it("rejects replayed mint authorizations", async () => {
    const { badge, mintSigner, user, recipient } = await deployPioneerFixture();
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const signature = await signPioneerMintAuthorization(badge, mintSigner, user.address, 1, deadline);

    await badge.connect(user).mint(1, deadline, signature);

    await expect(badge.connect(recipient).mint(1, deadline, signature))
      .to.be.revertedWithCustomError(badge, "InvalidMintSigner");
  });

  it("blocks user minting after permanent mint closure", async () => {
    const { badge, mintSigner, user } = await deployPioneerFixture();
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const signature = await signPioneerMintAuthorization(badge, mintSigner, user.address, 1, deadline);

    await badge.endMint();

    await expect(badge.connect(user).mint(1, deadline, signature))
      .to.be.revertedWithCustomError(badge, "MintClosed");
  });

  it("blocks transfers until the owner enables transfers", async () => {
    const { badge, mintSigner, user, recipient } = await deployPioneerFixture();
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const signature = await signPioneerMintAuthorization(badge, mintSigner, user.address, 1, deadline);
    await badge.connect(user).mint(1, deadline, signature);

    await expect(badge.connect(user).transferFrom(user.address, recipient.address, 1))
      .to.be.revertedWithCustomError(badge, "TransfersDisabled");

    await badge.setTransfersEnabled(true);
    await badge.connect(user).transferFrom(user.address, recipient.address, 1);
    expect(await badge.ownerOf(1)).to.equal(recipient.address);
  });

  it("blocks minting, airdrop, and transfer while paused", async () => {
    const { badge, mintSigner, operator, user, recipient } = await deployPioneerFixture();
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const signature = await signPioneerMintAuthorization(badge, mintSigner, user.address, 1, deadline);

    await badge.pause();

    await expect(badge.connect(user).mint(1, deadline, signature))
      .to.be.revertedWith("Pausable: paused");
    await expect(badge.connect(operator).airdrop(recipient.address))
      .to.be.revertedWith("Pausable: paused");

    await badge.unpause();
    await badge.connect(user).mint(1, deadline, signature);
    await badge.setTransfersEnabled(true);
    await badge.pause();

    await expect(badge.connect(user).transferFrom(user.address, recipient.address, 1))
      .to.be.revertedWith("Pausable: paused");
  });

  it("blocks transfers to wallets that already hold a badge", async () => {
    const { badge, mintSigner, user, recipient, secondRecipient } = await deployPioneerFixture();
    const firstDeadline = Math.floor(Date.now() / 1000) + 3600;
    const firstSignature = await signPioneerMintAuthorization(badge, mintSigner, user.address, 1, firstDeadline);
    const secondSignature = await signPioneerMintAuthorization(badge, mintSigner, recipient.address, 2, firstDeadline);

    await badge.connect(user).mint(1, firstDeadline, firstSignature);
    await badge.connect(recipient).mint(2, firstDeadline, secondSignature);
    await badge.setTransfersEnabled(true);

    await expect(badge.connect(user).transferFrom(user.address, recipient.address, 1))
      .to.be.revertedWithCustomError(badge, "RecipientAlreadyHoldsBadge");

    await badge.connect(user).transferFrom(user.address, secondRecipient.address, 1);
    expect(await badge.ownerOf(1)).to.equal(secondRecipient.address);
  });
});

describe("AiTraceRootAdvocateBadge", () => {
  it("supports operator airdrop", async () => {
    const [owner, operator, recipient] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("AiTraceRootAdvocateBadge");
    const badge = await factory.deploy();
    await badge.waitForDeployment();
    await badge.initialize(
      owner.address,
      operator.address,
      "ipfs://sandbox-beta/",
      0,
      "beta",
      "Sandbox Beta Badge",
      "SB-BETA"
    );

    await expect(badge.connect(operator).airdrop(recipient.address))
      .to.emit(badge, "BadgeAirdropped")
      .withArgs(recipient.address, 1, "beta");
  });

  it("blocks unauthorized airdrops and enforces max supply", async () => {
    const [owner, operator, first, second, stranger] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("AiTraceRootAdvocateBadge");
    const badge = await factory.deploy();
    await badge.waitForDeployment();
    await badge.initialize(
      owner.address,
      operator.address,
      "ipfs://sandbox-beta/",
      1,
      "beta",
      "Sandbox Beta Badge",
      "SB-BETA"
    );

    await expect(badge.connect(stranger).airdrop(first.address))
      .to.be.revertedWithCustomError(badge, "UnauthorizedOperator");

    await badge.connect(operator).airdrop(first.address);
    await expect(badge.connect(operator).airdrop(second.address))
      .to.be.revertedWithCustomError(badge, "MaxSupplyReached");
  });

  it("rejects duplicate airdrops to the same wallet", async () => {
    const [owner, operator, recipient] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("AiTraceRootAdvocateBadge");
    const badge = await factory.deploy();
    await badge.waitForDeployment();
    await badge.initialize(
      owner.address,
      operator.address,
      "ipfs://sandbox-beta/",
      0,
      "beta",
      "Sandbox Beta Badge",
      "SB-BETA"
    );

    await badge.connect(operator).airdrop(recipient.address);
    await expect(badge.connect(operator).airdrop(recipient.address))
      .to.be.revertedWithCustomError(badge, "AlreadyClaimed");
  });
});

describe("AiTraceRootBuilderBadge", () => {
  it("supports batch airdrop", async () => {
    const [owner, operator, first, second] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("AiTraceRootBuilderBadge");
    const badge = await factory.deploy();
    await badge.waitForDeployment();
    await badge.initialize(
      owner.address,
      operator.address,
      "ipfs://sandbox-gamma/",
      0,
      "gamma",
      "Sandbox Gamma Badge",
      "SB-GAMMA"
    );

    await badge.connect(operator).batchAirdrop([first.address, second.address]);
    expect(await badge.ownerOf(1)).to.equal(first.address);
    expect(await badge.ownerOf(2)).to.equal(second.address);
  });

  it("allows owner to disable an operator", async () => {
    const [owner, operator, recipient] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("AiTraceRootBuilderBadge");
    const badge = await factory.deploy();
    await badge.waitForDeployment();
    await badge.initialize(
      owner.address,
      operator.address,
      "ipfs://sandbox-gamma/",
      0,
      "gamma",
      "Sandbox Gamma Badge",
      "SB-GAMMA"
    );

    await badge.setOperator(operator.address, false);
    await expect(badge.connect(operator).airdrop(recipient.address))
      .to.be.revertedWithCustomError(badge, "UnauthorizedOperator");

    await badge.airdrop(recipient.address);
    expect(await badge.ownerOf(1)).to.equal(recipient.address);
  });
});
