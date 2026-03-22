#!/usr/bin/env node
//
// Fusion Stats Collector — run hourly via cron to build history.json
//
// Usage:
//   node collect.js              # single run, appends to history.json
//   crontab: 0 * * * * cd /path/to/fusionstats && node collect.js
//

const fs = require('fs');
const path = require('path');

const MORPHO_API = 'https://api.morpho.org/graphql';
const HISTORY_FILE = path.join(__dirname, 'history.json');
const MAX_ENTRIES = 720; // ~30 days of hourly data

const FUSION_VAULTS = [
  '0xb8a451107a9f87fde481d4d686247d6e43ed715e',
  '0x3b3bdaa4462851621818d2cebc835e077587147a',
  '0x604117f0c94561231060f56cd2ddd16245d434c5',
  '0xd36f53497507e948df9f277cf8c3ececb09a1c1d',
  '0xbfa9d6ec0e04b6691fcae5f8b48838c3918ec117',
  '0x43a32d4f6c582f281c52393f8f9e5ace1d4a1e68',
  '0x63103375659d0aa94e9f35df15be01a3dd1ae9c0',
  '0xe9385eff3f937fcb0f0085da9a3f53d6c2b4fb5f',
  '0xb0f56bb0bf13ee05fef8cd2d8df5ffdfcac7a74f',
  '0xf6cd9e8415162c8fb3c52676c7ca68812a34f76e',
  '0x6f66b845604dad6e80b2a1472e6cacbbe66a8c40',
  '0xe47358eae04719f3cf7025e95d0ad202e68bd9b2',
  '0xc50b2d51fd1e2ac67a9c09eaf63c24ea2465c64b',
  '0xe48cdd5ecec5aa53e630a7b4df12f79067b68dac',
  '0x20e934c725b6703f0ac696f1689008057db9ac44',
  '0xef53663bb775a51181f04d590f88fc38d6bd5751',
  '0xad685fec2066d7f5436f5804882998ba79725706',
  '0x87428d886f43068a44d7bdeef106d3c42e1d6f23',
  '0x9824dcdac89f208bf8b5cb5c4dc41f04a0878607',
  '0x60e36a79c3d21120350e39b5ea59ae26b75ae74c',
  '0x0b45a1e71a8a09f5d382fed27202d50ed983aaf3',
  '0xc2a119ea6de75e4b1451330321cb2474eb8d82d4',
];

async function gql(query) {
  const res = await fetch(MORPHO_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

async function fetchTotalLoans() {
  const data = await gql(`{
    markets(
      first: 1000
      orderBy: BorrowAssetsUsd
      orderDirection: Desc
      where: { chainId_in: [1], whitelisted: true }
    ) {
      items { state { borrowAssetsUsd } }
      pageInfo { count countTotal }
    }
  }`);
  return data.markets.items.reduce((s, m) => s + (m.state?.borrowAssetsUsd || 0), 0);
}

async function fetchVaultSupply(address) {
  const data = await gql(`{
    vaultByAddress(chainId: 1, address: "${address}") {
      address
      name
      state {
        totalAssetsUsd
        allocation {
          supplyAssetsUsd
          market {
            uniqueKey
            state { borrowAssetsUsd }
          }
        }
      }
    }
  }`);
  const vault = data?.vaultByAddress;
  if (!vault?.state) return { totalAssetsUsd: 0, borrowInMarkets: 0 };
  const totalAssetsUsd = vault.state.totalAssetsUsd || 0;
  // Sum up borrow demand in markets where this vault allocates
  const borrowInMarkets = (vault.state.allocation || []).reduce((s, a) =>
    s + (a.market?.state?.borrowAssetsUsd || 0), 0);
  return { totalAssetsUsd, borrowInMarkets };
}

async function collect() {
  console.log(`[${new Date().toISOString()}] Collecting Fusion stats...`);

  // Fetch total loans
  const totalLoans = await fetchTotalLoans();
  console.log(`  Total Morpho loans: $${(totalLoans / 1e6).toFixed(2)}M`);

  // Fetch all vault data in batches of 5
  let fusionTotalAssets = 0;
  let fusionBorrowInMarkets = 0;
  for (let i = 0; i < FUSION_VAULTS.length; i += 5) {
    const batch = FUSION_VAULTS.slice(i, i + 5);
    const results = await Promise.all(batch.map(a => fetchVaultSupply(a)));
    for (const r of results) {
      fusionTotalAssets += r.totalAssetsUsd;
      fusionBorrowInMarkets += r.borrowInMarkets;
    }
  }

  const sharePercent = totalLoans > 0 ? (fusionTotalAssets / totalLoans * 100) : 0;

  console.log(`  Fusion vault TVL: $${(fusionTotalAssets / 1e6).toFixed(2)}M`);
  console.log(`  Borrow in Fusion markets: $${(fusionBorrowInMarkets / 1e6).toFixed(2)}M`);
  console.log(`  Share of total loans: ${sharePercent.toFixed(2)}%`);

  // Read existing history
  let history = [];
  try {
    history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (e) { /* first run */ }

  // Append new data point
  history.push({
    timestamp: new Date().toISOString(),
    totalLoans,
    fusionTotalAssets,
    fusionBorrowInMarkets,
    sharePercent,
    vaultCount: FUSION_VAULTS.length,
  });

  // Trim to max entries
  if (history.length > MAX_ENTRIES) {
    history = history.slice(history.length - MAX_ENTRIES);
  }

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  console.log(`  Saved to ${HISTORY_FILE} (${history.length} entries)`);
}

collect().catch(err => {
  console.error('Collection failed:', err.message);
  process.exit(1);
});
