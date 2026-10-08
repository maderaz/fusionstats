#!/usr/bin/env node
'use strict';
// One name per page, everywhere. Run: node tools/page-meta.test.js
//
// The side menu (nav.js), the page list (tools/pages.js), each page's
// <title>, its <h1> and its share tags all give a page the same name.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PAGES, INDEXED, title, url, cardUrl } = require('./pages.js');
const { rewrite, heading, block, BEGIN, END } = require('./page-meta.js');

const ROOT = path.join(__dirname, '..');
let passed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n').join('\n        ')); process.exitCode = 1; }
}

// The side menu's pages, from nav.js's own list.
const nav = fs.readFileSync(path.join(ROOT, 'nav.js'), 'utf8');
const NAV = [...nav.matchAll(/\{\s*href:\s*'([^']+)',\s*label:\s*'([^']+)'/g)].map(m => ({ path: m[1], name: m[2] }));
const read = (p) => fs.readFileSync(path.join(ROOT, p.file), 'utf8');

console.log('\nPage names');
test('every page in the side menu is in tools/pages.js, by the same name, and no other', () => {
  assert.ok(NAV.length >= 10, 'read ' + NAV.length + ' pages from nav.js');
  assert.deepStrictEqual(PAGES.map(p => [p.path, p.name]), NAV.map(p => [p.path, p.name]));
});
test('each page\'s <h1> is its name', () => {
  const off = PAGES.filter(p => heading(read(p)) !== p.name).map(p => p.file + ': "' + heading(read(p)) + '"');
  assert.deepStrictEqual(off, []);
});
test('each page has one <title> and one description, in its block, and the block is up to date', () => {
  for (const p of PAGES) {
    const html = read(p);
    assert.strictEqual((html.match(/<title>/g) || []).length, 1, p.file + ': titles');
    assert.strictEqual((html.match(/<meta name="description"/g) || []).length, 1, p.file + ': descriptions');
    assert.ok(html.includes(BEGIN) && html.includes(END), p.file + ': no block (run node tools/page-meta.js)');
    assert.strictEqual(rewrite(html, p), html, p.file + ': out of date (run node tools/page-meta.js)');
  }
});
test('the block: title, description, canonical address, and the share card once there is one', () => {
  const p = PAGES.find(x => x.path === '/stocks');
  const b = block(p, '');
  assert.ok(b.includes('<title>Stocks • Fusion Ecosystem</title>'));
  assert.ok(b.includes('<link rel="canonical" href="https://fusionecosystem.xyz/stocks">'));
  assert.ok(b.includes('<meta property="og:title" content="Stocks • Fusion Ecosystem">'));
  if (cardUrl(p)) {
    assert.ok(b.includes('<meta property="og:image" content="' + cardUrl(p) + '">'));
    assert.ok(b.includes('<meta name="twitter:card" content="summary_large_image">'));
  } else {
    assert.ok(!b.includes('og:image') && !b.includes('twitter:image'), 'no image before the cards exist');
    assert.ok(b.includes('<meta name="twitter:card" content="summary">'));
  }
  assert.strictEqual(title(p), 'Stocks • Fusion Ecosystem');
  assert.strictEqual(url(PAGES[0]), 'https://fusionecosystem.xyz/');
});
test('while the site is kept out of search, every page in the repo says noindex, once', () => {
  if (INDEXED) return;
  const { execSync } = require('child_process');
  const files = execSync('git ls-files -z -- "*.html"', { cwd: ROOT }).toString().split('\0').filter(Boolean);
  assert.ok(files.length >= PAGES.length, 'read ' + files.length + ' pages');
  const off = files.filter(f => {
    const tags = fs.readFileSync(path.join(ROOT, f), 'utf8').match(/<meta name="robots" content="[^"]*"\s*\/?>/g) || [];
    return tags.length !== 1 || !/noindex/.test(tags[0]);
  });
  assert.deepStrictEqual(off, []);
  assert.ok(block(PAGES[0], '').includes('<meta name="robots" content="noindex">'));
});
test('every page has the site\'s favicon, once, and nothing of an old icon tag left in its text', () => {
  const { execSync } = require('child_process');
  const files = execSync('git ls-files -z -- "*.html"', { cwd: ROOT }).toString().split('\0').filter(Boolean).filter(f => !f.startsWith('tools/'));
  const off = files.filter(f => {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    return (head.match(/href="\/favicon\.svg"/g) || []).length !== 1 || /<link rel="icon"[^>]*data:image/.test(head)
      || /apple-touch-icon\.png">[^\n]/.test(head);   // a tag's tail left after it, shown on the page as text
  });
  assert.deepStrictEqual(off, []);
});
test('descriptions fit a search result (at most 170 characters), and cards have distinct names', () => {
  const long = PAGES.filter(p => p.description.length > 170).map(p => p.file + ' ' + p.description.length);
  assert.deepStrictEqual(long, []);
  assert.strictEqual(new Set(PAGES.map(p => p.card)).size, PAGES.length);
});
test('rewrite: a page without a block gets one in its title\'s place, and loses its old description', () => {
  const html = '<head>\n  <meta charset="UTF-8">\n  <title>Old</title>\n  <meta name="description" content="old">\n  <link rel="icon">\n</head>';
  const out = rewrite(html, PAGES[1]);
  assert.ok(!out.includes('<title>Old</title>') && !out.includes('content="old"'));
  assert.ok(out.includes('  ' + BEGIN) && out.includes('  <link rel="icon">'));
  assert.strictEqual(rewrite(out, PAGES[1]), out);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
