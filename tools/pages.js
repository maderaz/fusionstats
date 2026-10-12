'use strict';
// Every page in the side menu, as search engines and share cards see it.
//
// A page's name is its name in the side menu (nav.js), and it is also its
// title, its heading and the name a shared link shows: one name everywhere.
// The description is the line under it in search results and on a shared
// link. card is the share card's file (tools/og-cards.mjs draws them).
//
// tools/page-meta.js writes each page's <head> from this list; its test
// checks the names against nav.js and each page's <h1>.

const SITE = 'https://fusionecosystem.xyz';
const SITE_NAME = 'Fusion Ecosystem';
// The share cards: drawn every day by a workflow (og-cards.yml, with
// tools/og-cards.mjs) onto a branch of their own, which keeps one copy of
// each; GitHub's raw CDN serves the latest within minutes, with no deploy.
const CARDS = 'https://raw.githubusercontent.com/maderaz/fusionstats/og-cards/';

const PAGES = [
  { path: '/', file: 'index.html', name: 'Key Metrics', card: 'key-metrics',
    description: 'Fusion vaults at a glance: TVL, annualized earnings, net inflow over 24 hours, 7 and 30 days, and every deposit and withdrawal as it happens.' },
  { path: '/stocks', file: 'stocks/index.html', name: 'Stocks', card: 'stocks',
    description: 'TVL, participating wallets and live flows for Fusion vaults backed by tokenised equities.' },
  { path: '/stocks/aave-v4', file: 'stocks/aave-v4/index.html', name: 'Aave V4 Data', card: 'aave-v4',
    description: 'What Fusion\'s stock vaults supply to Aave V4\'s tokenised-stock markets on Base: by day, by market, and what the idle stock would add.' },
  { path: '/explorer', file: 'explorer/index.html', name: 'Explorer', card: 'explorer',
    description: 'Every Fusion vault, one at a time: its yield, assets, markets, allocation over time and capacity.' },
  { path: '/finances/dao', file: 'finances/dao/index.html', name: 'DAO Earnings', card: 'dao-earnings',
    description: 'The IPOR DAO\'s share of the fees Fusion vaults charge, week by week from the start of their history.' },
  { path: '/finances/curator', file: 'finances/curator/index.html', name: 'Curator Earnings', card: 'curator-earnings',
    description: 'What curators and operators keep of the fees Fusion vaults charge, week by week from the start of their history.' },
  { path: '/protocol-tvl', file: 'protocol-tvl/index.html', name: 'Protocol TVL', card: 'protocol-tvl',
    description: 'What every Fusion vault holds together, day by day since the first deposits, in total and by network.' },
  { path: '/switchers', file: 'switchers/index.html', name: 'Switchers', card: 'switchers',
    description: 'Wallets that move capital from one Fusion vault into another, chasing a better rate: deposits funded by a similar-size withdrawal from a different vault.' },
  { path: '/dust', file: 'dust/index.html', name: 'Dust Tracker', card: 'dust-tracker',
    description: 'How many small deposits (under $100, $1K or $5K) reach Fusion vaults over time, with a breakdown by vault.' },
  { path: '/dominance', file: 'dominance/index.html', name: 'Dominance', card: 'dominance',
    description: 'How much of all Morpho lending on Ethereum is borrowed by Fusion vaults: the share now, over time, and vault by vault.' },
  { path: '/monitor', file: 'monitor/index.html', name: 'Monitor', card: 'monitor',
    description: 'Each Fusion vault\'s share price over a window, and how the rate it earned compares with the rate the IPOR app shows, the widest gaps first.' },
  { path: '/spark', file: 'spark/index.html', name: 'Spark', card: 'spark',
    description: 'The IPOR stETH vault\'s looping position on SparkLend\'s wstETH market, read live: supplied, borrowed, health factor, leverage, and its rank among the market\'s suppliers.' },
  { path: '/demo/homepage', file: 'demo/homepage/index.html', name: 'Homepage', card: 'demo-homepage', demo: true,
    title: 'Fusion • Vault infrastructure for institutional-grade yield', kicker: 'Onchain vault infrastructure', head: 'Vaults built for|institutional-grade yield.',
    description: 'Deploy, curate and allocate to onchain vaults: transparent by design, live on six networks, and used by curators, custodians and ETP issuers.' },
  { path: '/demo/fuses', file: 'demo/fuses/index.html', name: 'Fuses', card: 'demo-fuses', demo: true,
    title: 'Fuse Library • Fusion', kicker: 'Fuse library', head: 'Every market,|one fuse away.',
    description: 'Every protocol a Fusion vault can act on, by function or by name, with Aave V4 in full: Hub and Spoke, permissions, checks, a typical flow and the risks.' },
  { path: '/demo/news', file: 'demo/news/index.html', name: 'News', card: 'demo-news', demo: true,
    title: 'Newsroom • Fusion', kicker: 'Newsroom', head: 'News from the|Fusion ecosystem.',
    description: 'Partnerships, integrations and milestones from the institutions, curators and custodians building institutional-grade onchain yield on Fusion.' },
  { path: '/demo/contact', file: 'demo/contact/index.html', name: 'Talk to Us', card: 'demo-contact', demo: true,
    title: 'Talk to Us • Fusion', kicker: 'Talk to us', head: 'Let\'s build|your vault.',
    description: 'Launching a vault, allocating capital or integrating Fusion: tell us what you are building, and the people who build Fusion will get back to you.' },
];

// Demo pages outside the side menu: reached from the demo site's own menus,
// with a head and a share card like the rest (no <h1> check: not in nav.js).
const EXTRA = [
  { path: '/demo/factory', file: 'demo/factory/index.html', name: 'Vault Factory', card: 'demo-factory', demo: true,
    title: 'Vault Factory • Fusion', kicker: 'Vault Factory', head: 'Deploy a vault.|No permission needed.',
    description: 'Create a Plasma Vault and the managers around it in one transaction. Anyone can deploy one; you set the rules it runs by, onchain for all to read.' },
  { path: '/demo/alpha', file: 'demo/alpha/index.html', name: 'Alpha', card: 'demo-alpha', demo: true,
    title: 'Alpha • Fusion', kicker: 'Alpha', head: 'Strategy off-chain.|Bounds onchain.',
    description: 'An Alpha runs a vault\'s strategy: it decides off-chain and acts onchain through fuses, only ever inside the markets the vault has granted.' },
  { path: '/demo/institutions', file: 'demo/institutions/index.html', name: 'Institutions', card: 'demo-institutions', demo: true,
    title: 'Fusion for Institutions • MiCA-compliant, with Tesseract', kicker: 'For institutions', head: 'Sovereign vaults|for institutions.',
    description: 'Onchain yield with the custody, controls and reporting institutions need, and a MiCA-compliant solution with our partner Tesseract.' },
  { path: '/demo/exchanges', file: 'demo/exchanges/index.html', name: 'Exchanges', card: 'demo-exchanges', demo: true,
    title: 'Fusion for Exchanges', kicker: 'For exchanges', head: 'Onchain yield,|inside your product.',
    description: 'Offer curated vault yield to your users through one standard, ERC-4626, without building the strategies or the contracts behind them.' },
  { path: '/demo/curators', file: 'demo/curators/index.html', name: 'Curators', card: 'demo-curators', demo: true,
    title: 'Fusion for Curators', kicker: 'For curators', head: 'Launch vaults.|Skip the Solidity.',
    description: 'Pick fuses, set the parameters and run the strategy with an Alpha. Launch vaults without Solidity and earn fees as an Atomist.' },
  { path: '/demo/news/cbeth-on-base', file: 'demo/news/cbeth-on-base/index.html', name: 'Fusion Vaults Now Account for ~45% of cbETH on Base', card: 'demo-news-cbeth', demo: true,
    title: 'Fusion Vaults Now Account for ~45% of cbETH on Base • Fusion', kicker: 'Ecosystem · Jul 15, 2026', head: 'Fusion vaults hold|~45% of cbETH on Base.',
    description: 'As of 15 July 2026, vaults built on Fusion hold about 30,500 cbETH on Base: roughly 45% of the network\'s cbETH and 19.3% of the circulating supply.' },
];

// Whether search engines may list the site. Off for now: every page says
// noindex (tools/page-meta.js writes it; the pages outside the menu carry
// their own). Turn it on and run node tools/page-meta.js to be listed.
const INDEXED = false;

// A demo page is the Fusion site's, not Fusion Stats': its own brand, and a
// title of its own where the menu's name would not say enough.
const siteName = (p) => (p.demo ? 'Fusion' : SITE_NAME);
const title = (p) => p.title || p.name + ' • ' + siteName(p);
const url = (p) => SITE + p.path;
const cardUrl = (p) => (CARDS ? CARDS + p.card + '.png' : null);

module.exports = { SITE, SITE_NAME, CARDS, INDEXED, PAGES, EXTRA, title, siteName, url, cardUrl };
