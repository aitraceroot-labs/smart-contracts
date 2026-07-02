<p align="center">
  <img src="https://raw.githubusercontent.com/aitraceroot-labs/media-assets/main/assets/brand/aitraceroot-art-logo.png" alt="AiTraceRoot ART logo" width="220" />
</p>

# AiTraceRoot Smart Contracts

Public smart contracts for the ART ecosystem.

## Contracts

- `AiTraceRootPioneerBadge`: public free mint with platform authorization.
- `AiTraceRootAdvocateBadge`: referral achievement badge distributed by platform airdrop.
- `AiTraceRootBuilderBadge`: ecosystem contributor badge distributed by owner or operator airdrop.
- `AiTraceRootToken`: ART token contract.
- `AiTraceRootVesting`: ART vesting contract.

## Shared Features

- UUPS upgradeable proxy pattern.
- Owner-authorized upgrades.
- Owner and operator permission model.
- Pause and unpause.
- Transfer enable and disable switch.
- Optional max supply.
- Base URI updates.
- Single-recipient airdrop.
- Batch airdrop.
- One successful mint or airdrop per wallet per badge contract.

## Development Commands

```bash
npm install
npm run build
npm run test
```

## Boundary

This repository contains public contracts and tests only. It does not contain production environment files, private keys, backend services, admin panels, deployment scripts, source maps, or server configuration files.
