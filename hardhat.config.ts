import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import fs from "node:fs";
import path from "node:path";

function loadRootEnv() {
  const envPath = path.resolve(__dirname, "../.env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) {
      continue;
    }
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

loadRootEnv();

const deployerPrivateKey =
  process.env.DEPLOYER_PRIVATE_KEY || process.env.BSC_MAINNET_PRIVATE_KEY_1 || process.env.BSC_TESTNET_PRIVATE_KEY || "";
const bscRpcUrl = process.env.BSC_RPC_URL || process.env.BSC_MAINNET_RPC_URL || "";
const hardhatForkRpcUrl = process.env.HARDHAT_FORK_RPC_URL || "";
const hardhatForkAccounts = deployerPrivateKey
  ? [
      {
        privateKey: deployerPrivateKey,
        balance: "1000000000000000000000"
      }
    ]
  : [];

const config: HardhatUserConfig = {
  paths: {
    sources: "src",
    tests: "test",
    cache: "cache",
    artifacts: "artifacts"
  },
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: hardhatForkRpcUrl
      ? {
          chainId: 56,
          forking: {
            url: hardhatForkRpcUrl
          },
          hardfork: "shanghai",
          chains: {
            56: {
              hardforkHistory: {
                shanghai: 0
              }
            }
          },
          accounts: hardhatForkAccounts
        }
      : {},
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC_URL || "",
      accounts: deployerPrivateKey ? [deployerPrivateKey] : []
    },
    bsc: {
      url: bscRpcUrl,
      accounts: deployerPrivateKey ? [deployerPrivateKey] : []
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || process.env.BSCSCAN_API_KEY || ""
  },
  sourcify: {
    enabled: true
  }
};

export default config;
