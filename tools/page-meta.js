#!/usr/bin/env node
'use strict';
// Writes each page's title, description and share tags (Open Graph, X) from
// tools/pages.js, in one block in its <head>, and noindex while the site is
// kept out of search (INDEXED):
//
//   <!-- page-meta: … -->  …  <!-- /page-meta -->
//
// The block takes the place of the page's <title> and description, so there
// is one of each. Run it after changing a page's name or description:
//
//   node tools/page-meta.js           write every page
//   node tools/page-meta.js --check   exit 1 if any page is out of date

const fs = require('fs');
const path = require('path');
const { SITE_NAME, INDEXED, PAGES, title, url, cardUrl } = require('./pages.js');

const ROOT = path.join(__dirname, '..');
const BEGIN = '<!-- page-meta: written by tools/page-meta.js from tools/pages.js -->';
const END = '<!-- /page-meta -->';

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const text = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function block(p, indent) {
  const img = cardUrl(p);
  const lines = [
    BEGIN,
    ...(INDEXED ? [] : ['<meta name="robots" content="noindex">']),
    `<title>${text(title(p))}</title>`,
    `<meta name="description" content="${attr(p.description)}">`,
    `<link rel="canonical" href="${attr(url(p))}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${attr(SITE_NAME)}">`,
    `<meta property="og:title" content="${attr(title(p))}">`,
    `<meta property="og:description" content="${attr(p.description)}">`,
    `<meta property="og:url" content="${attr(url(p))}">`,
    ...(img ? [
      `<meta property="og:image" content="${attr(img)}">`,
      `<meta property="og:image:width" content="1200">`,
      `<meta property="og:image:height" content="630">`,
      `<meta property="og:image:alt" content="${attr(p.name + ': ' + p.description)}">`,
    ] : []),
    `<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${attr(title(p))}">`,
    `<meta name="twitter:description" content="${attr(p.description)}">`,
    ...(img ? [`<meta name="twitter:image" content="${attr(img)}">`] : []),
    END,
  ];
  return lines.map(l => indent + l).join('\n');
}

// The page with its block written, in its <head>: an existing block is
// replaced; otherwise the block goes where the <title> was. Any other title
// or description in the head goes, so there is one of each.
const SLOT = '\u0000page-meta\u0000';
function rewrite(html, p) {
  const h = html.indexOf('</head>');
  if (h < 0) throw new Error(p.file + ': no </head>');
  let head = html.slice(0, h), indent;
  const a = head.indexOf(BEGIN), b = head.indexOf(END);
  if (a >= 0 && b > a) {
    const from = head.lastIndexOf('\n', a) + 1, nl = head.indexOf('\n', b);
    indent = head.slice(from, a);
    head = head.slice(0, from) + SLOT + '\n' + head.slice(nl < 0 ? head.length : nl + 1);
  } else {
    const t = head.match(/^([ \t]*)<title>[\s\S]*?<\/title>[ \t]*\n/m);
    if (!t) throw new Error(p.file + ': no <title> to replace');
    indent = t[1];
    head = head.slice(0, t.index) + SLOT + '\n' + head.slice(t.index + t[0].length);
  }
  head = head.replace(/^[ \t]*<meta name="description"[^>]*>[ \t]*\n/gm, '')
    .replace(/^[ \t]*<title>[\s\S]*?<\/title>[ \t]*\n/gm, '');
  return head.replace(SLOT, block(p, indent)) + html.slice(h);
}

// The text of a page's first <h1>, as written in the file.
function heading(html) {
  const m = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : null;
}

function run({ check = false } = {}) {
  const stale = [];
  for (const p of PAGES) {
    const file = path.join(ROOT, p.file);
    const html = fs.readFileSync(file, 'utf8');
    const next = rewrite(html, p);
    if (next === html) continue;
    stale.push(p.file);
    if (!check) fs.writeFileSync(file, next);
  }
  return stale;
}

module.exports = { block, rewrite, heading, run, BEGIN, END };

if (require.main === module) {
  const check = process.argv.includes('--check');
  const stale = run({ check });
  if (check && stale.length) { console.error('Out of date (run node tools/page-meta.js): ' + stale.join(', ')); process.exit(1); }
  console.log(check ? 'Every page is up to date.' : stale.length ? 'Wrote ' + stale.join(', ') : 'Every page was up to date.');
}
