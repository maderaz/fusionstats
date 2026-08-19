//
// lib/lending-health.js — per-market collateral, debt, LTV and health factor.
//
// Morpho Blue is what the Tesseract vaults run on (their balance fuses report
// 100% of total in MORPHO markets), so that is what is implemented here.
//
// Reads, all at an explicit block so the series stays historical:
//   PlasmaVault.getMarketSubstrates(marketId) -> bytes32[]  (Morpho market ids)
//   Morpho.position(id, vault)     -> supplyShares, borrowShares, collateral
//   Morpho.market(id)              -> totalBorrowAssets / totalBorrowShares
//   Morpho.idToMarketParams(id)    -> loanToken, collateralToken, oracle, irm, lltv
//   oracle.price()                 -> collateral priced in loan units, scale 1e36
//
// Health maths follows Morpho's own definition:
//   debtAssets      = borrowShares * totalBorrowAssets / totalBorrowShares
//   collateralValue = collateral * price / 1e36            (in loan-token units)
//   ltv             = debtAssets / collateralValue
//   healthFactor    = collateralValue * lltv / debtAssets   (lltv is WAD)
//
// Every call is defensive: a failure yields null for that field rather than
// breaking the surrounding series collection.

const { selector } = require('./keccak');

const SEL = {
  marketSubstrates: selector('getMarketSubstrates(uint256)'),
  position: selector('position(bytes32,address)'),
  market: selector('market(bytes32)'),
  idToMarketParams: selector('idToMarketParams(bytes32)'),
  price: selector('price()'),
};

// Morpho Blue uses the same address on every chain it is deployed to.
const MORPHO = '0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb';
const IPOR_MORPHO_MARKET_ID = 14;
const ORACLE_SCALE = 10n ** 36n;
const WAD = 10n ** 18n;

const word = (hex, i) => BigInt('0x' + hex.slice(2 + i * 64, 2 + i * 64 + 64));
const pad = (h) => h.replace(/^0x/, '').toLowerCase().padStart(64, '0');

// Decode a bytes32[] returned from a dynamic array getter.
function decodeBytes32Array(hex) {
  if (!hex || hex === '0x' || hex.length < 130) return [];
  const len = Number(word(hex, 1));
  const out = [];
  for (let i = 0; i < len; i++) out.push('0x' + hex.slice(2 + (2 + i) * 64, 2 + (3 + i) * 64));
  return out;
}

async function marketIdsFor(callAt, vault, block, iporMarketId = IPOR_MORPHO_MARKET_ID) {
  try {
    const r = await callAt(vault, SEL.marketSubstrates + BigInt(iporMarketId).toString(16).padStart(64, '0'), block);
    return decodeBytes32Array(r);
  } catch { return []; }
}

async function healthForMarket(callAt, vault, marketId, block) {
  const out = {
    market: 'morpho', marketId,
    collateral: null, debt: null, ltv: null, maxLtv: null, healthFactor: null,
    collateralValue: null,
  };
  try {
    const [posR, mktR, prmR] = await Promise.all([
      callAt(MORPHO, SEL.position + pad(marketId) + pad(vault), block),
      callAt(MORPHO, SEL.market + pad(marketId), block),
      callAt(MORPHO, SEL.idToMarketParams + pad(marketId), block),
    ]);
    if (!posR || posR === '0x' || !mktR || mktR === '0x' || !prmR || prmR === '0x') return out;

    const borrowShares = word(posR, 1);
    const collateral = word(posR, 2);
    const totalBorrowAssets = word(mktR, 2);
    const totalBorrowShares = word(mktR, 3);
    const oracle = '0x' + prmR.slice(2 + 2 * 64 + 24, 2 + 3 * 64);
    const lltv = word(prmR, 4);

    out.collateral = Number(collateral);
    out.maxLtv = Number(lltv) / Number(WAD);

    const debt = totalBorrowShares > 0n ? (borrowShares * totalBorrowAssets) / totalBorrowShares : 0n;
    out.debt = Number(debt);

    if (collateral > 0n) {
      const pr = await callAt(oracle, SEL.price, block).catch(() => null);
      if (pr && pr !== '0x') {
        const price = word(pr, 0);
        const collValue = (collateral * price) / ORACLE_SCALE;
        out.collateralValue = Number(collValue);
        if (collValue > 0n) {
          out.ltv = Number(debt) / Number(collValue);
          out.healthFactor = debt > 0n
            ? Number((collValue * lltv) / WAD) / Number(debt)
            : null; // no debt: health factor is undefined, not infinite
        }
      }
    } else if (debt === 0n) {
      out.ltv = 0;
    }
  } catch { /* leave nulls */ }
  return out;
}

// Gross collateral over net assets. Both must be in the same unit, so the
// caller passes collateral value already expressed in the vault's underlying.
function leverage(grossCollateral, netAssets) {
  if (!netAssets || netAssets <= 0 || grossCollateral == null) return null;
  return grossCollateral / netAssets;
}

module.exports = { SEL, MORPHO, IPOR_MORPHO_MARKET_ID, marketIdsFor, healthForMarket, leverage, decodeBytes32Array };
