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
];

// Whether search engines may list the site. Off for now: every page says
// noindex (tools/page-meta.js writes it; the pages outside the menu carry
// their own). Turn it on and run node tools/page-meta.js to be listed.
const INDEXED = false;

const title = (p) => p.name + ' • ' + SITE_NAME;
const url = (p) => SITE + p.path;
const cardUrl = (p) => (CARDS ? CARDS + p.card + '.png' : null);

module.exports = { SITE, SITE_NAME, CARDS, INDEXED, PAGES, title, url, cardUrl };
