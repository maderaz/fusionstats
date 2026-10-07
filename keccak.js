'use strict';
// keccak.js — Keccak-256, as Ethereum uses it, with no dependencies: for a
// function's selector (its first four bytes) and an event's topic (all 32).
// Minimal Keccak-f[1600] over BigInt lanes; inputs are signatures, so speed
// doesn't matter. Keccak padding (0x01 … 0x80), not NIST SHA3's (0x06).
// Checked against known values when loaded.
//
//   keccak256Hex('balanceOf(address)')   → '70a08231…' (64 hex digits)
//   selector('balanceOf(address)')       → '0x70a08231'
//   topic('Transfer(address,address,uint256)') → '0xddf252ad…'

function keccak256Hex(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const MASK = (1n << 64n) - 1n;
  const RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
  ];
  // rotation offsets r[x][y]
  const ROT = [
    [0, 36, 3, 41, 18],
    [1, 44, 10, 45, 2],
    [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56],
    [27, 20, 39, 8, 14],
  ];
  const rotl = (x, n) => { const b = BigInt(n); return ((x << b) | (x >> (64n - b))) & MASK; };

  const S = new Array(25).fill(0n);
  function keccakF() {
    for (let round = 0; round < 24; round++) {
      const C = [0n, 0n, 0n, 0n, 0n];
      for (let x = 0; x < 5; x++) C[x] = S[x] ^ S[x + 5] ^ S[x + 10] ^ S[x + 15] ^ S[x + 20];
      for (let x = 0; x < 5; x++) {
        const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n);
        for (let y = 0; y < 5; y++) S[x + 5 * y] ^= D;
      }
      const B = new Array(25).fill(0n);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(S[x + 5 * y], ROT[x][y]);
      }
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
        S[x + 5 * y] = B[x + 5 * y] ^ ((~B[((x + 1) % 5) + 5 * y] & MASK) & B[((x + 2) % 5) + 5 * y]);
      }
      S[0] ^= RC[round];
    }
  }

  const RATE = 136; // bytes (1088 bits)
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / RATE) * RATE);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;

  for (let off = 0; off < padded.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      let lane = 0n;
      for (let k = 0; k < 8; k++) lane |= BigInt(padded[off + i * 8 + k]) << BigInt(8 * k);
      S[i] ^= lane;
    }
    keccakF();
  }

  let out = '';
  for (let i = 0; i < 4; i++) { // 4 lanes = 32 bytes
    let lane = S[i];
    for (let k = 0; k < 8; k++) { out += Number(lane & 0xffn).toString(16).padStart(2, '0'); lane >>= 8n; }
  }
  return out;
}
function selector(sig) { return '0x' + keccak256Hex(sig).slice(0, 8); }
function topic(sig) { return '0x' + keccak256Hex(sig); }

// balanceOf's selector and ERC-20's Transfer topic are relied on elsewhere here.
if (keccak256Hex('') !== 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
  || selector('balanceOf(address)') !== '0x70a08231'
  || topic('Transfer(address,address,uint256)') !== '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
  throw new Error('keccak256 self-test failed');
}

module.exports = { keccak256Hex, selector, topic };
