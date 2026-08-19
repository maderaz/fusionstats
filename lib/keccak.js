//
// lib/keccak.js — pure-JS keccak256 (Ethereum variant, 0x01 padding).
//
// The repo has no dependencies and the sandbox has no network, so selectors
// and event topics are derived here rather than hardcoded from memory.
// Verified offline against known vectors — see lib/keccak.test.js.
//
// Exports:
//   keccak256(stringOrBytes) -> 64-char hex (no 0x)
//   selector(sig)            -> '0x' + first 4 bytes  e.g. 'totalAssets()'
//   topic(sig)               -> '0x' + full 32 bytes  e.g. 'Deposit(address,...)'
//

const M64 = (1n << 64n) - 1n;

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROTC = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
const PILN = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];

const rotl = (x, n) => ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64;

function keccakF(A) {
  for (let round = 0; round < 24; round++) {
    // Theta
    const C = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) A[x + y] ^= D;
    }
    // Rho & Pi
    let t = A[1];
    for (let i = 0; i < 24; i++) {
      const j = PILN[i];
      const tmp = A[j];
      A[j] = rotl(t, ROTC[i]);
      t = tmp;
    }
    // Chi
    for (let y = 0; y < 25; y += 5) {
      const b = [A[y], A[y + 1], A[y + 2], A[y + 3], A[y + 4]];
      for (let x = 0; x < 5; x++) A[y + x] = b[x] ^ ((~b[(x + 1) % 5] & M64) & b[(x + 2) % 5]);
    }
    // Iota
    A[0] ^= RC[round];
  }
}

function keccak256(input) {
  const RATE = 136; // 1088 bits
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);

  // Keccak padding (pad10*1 with 0x01 domain byte — NOT SHA3's 0x06).
  const padLen = RATE - (bytes.length % RATE);
  const padded = Buffer.concat([bytes, Buffer.alloc(padLen)]);
  padded[bytes.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  const A = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]);
      A[i] ^= lane;
    }
    keccakF(A);
  }

  const out = [];
  for (let i = 0; i < 4; i++) {
    let lane = A[i];
    for (let b = 0; b < 8; b++) { out.push(Number(lane & 0xffn)); lane >>= 8n; }
  }
  return Buffer.from(out).toString('hex');
}

const selector = (sig) => '0x' + keccak256(sig).slice(0, 8);
const topic = (sig) => '0x' + keccak256(sig);

module.exports = { keccak256, selector, topic };
