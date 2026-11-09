# Mega menu: build guide for an agent

A top navigation bar whose items open white panels ("bubbles") of icon links,
with an optional feature card, folding into a sheet on phones. The reference
implementation is `mega-menu.html` in this folder: one self-contained file,
no build step, no dependencies (the Geist font link is optional). Open it in a
browser to see it work.

## What to do

1. Read `mega-menu.html` top to bottom. It has three parts:
   - **CSS variables** at the top of the `<style>` (`--mm-*`): colours, fonts,
     bar height, content width, collapse width. Rebrand here only.
   - **`MENU` config** at the top of the `<script>`: the brand, the menus and
     their links, the buttons at the right. This is the only part that holds
     content.
   - **Rendering and behaviour** below it: builds the markup from `MENU` and
     wires the interactions. It should not need edits to add options.
2. Port it into the target project as-is first (same markup, class names and
   behaviour), then adapt styles to the project's design tokens by mapping the
   `--mm-*` variables. Do not rewrite the interaction logic.
3. Replace the `MENU` content with the project's real menus.

## The config

```js
const MENU = {
  brand: { name: 'Fusion', href: '/' },
  menus: [
    {
      label: 'Products',      // the top-bar item
      columns: 2,             // 1, 2 or 3 columns of links in the bubble
      right: false,           // true for items near the right edge: the bubble opens leftwards
      feature: {              // optional: a dark card in its own column at the right
        kicker: 'Fusion today', value: '$81.0M', text: 'One or two lines.',
        cta: 'Open stats', href: '/stats',
      },
      links: [                // either links...
        { title: 'Vault Factory', desc: 'One line, short', href: '/factory',
          tag: 'NEW',         // optional small pill after the title
          icon: 'M2.5 15.5h13M4 15.5V8...' },  // SVG path data, 18 x 18 grid, stroked
      ],
      // ...or groups, each with a small mono heading:
      // groups: [{ name: 'Build', links: [...] }, { name: 'Trust', links: [...] }],
    },
  ],
  ctas: [
    { label: 'Talk to Us', href: '/contact', style: 'ghost' },  // hidden on phones, repeated in the sheet
    { label: 'Launch App', href: '/app', style: 'solid' },      // stays in the bar on phones
  ],
};
```

Icons are drawn as outlines (`stroke`, 1.5 width, round caps) on an 18 × 18
grid, so any 18 × 18 line icon's path data works (draw new ones on that grid).
External links (`http…`) open in a new tab automatically.

## Behaviour, which must be kept

- **Desktop:** a bubble opens on **hover**. The bubble's top padding (14px) is an
  invisible bridge between the bar and the bubble, so the pointer can move
  down into it without it closing. Do not remove it.
- **Click or Enter** on an item toggles its bubble; only one is open at a time.
- **Escape**, or a click anywhere outside the bar, closes everything.
- Leaving an item with the pointer closes it.
- **Keyboard:** `:focus-within` keeps a bubble open while Tab moves through its
  links. The buttons carry `aria-expanded` and `aria-controls`.
- **Phones (below 980px):** the items and the ghost button hide; a menu
  button opens a sheet under the bar where each menu is a `<details>` fold
  with the same links. Change the breakpoint in both `--mm-collapse` and the
  `@media (max-width: 980px)` rule.
- **Reduced motion:** transitions switch off under `prefers-reduced-motion`.

## Design rules

- Titles and labels stay on **one line** (`white-space: nowrap`); descriptions
  may wrap to two lines. Keep descriptions to about 40 characters.
- Gaps: 12px between icon box and text, 6px between links, 10px panel padding,
  8px between label and chevron.
- The feature card is optional and fixed at 230px wide; use it for one live
  figure or one highlight, not a list.
- More than about 8 links in a bubble: use `groups` and 2 or 3 `columns`
  rather than a long single column.

## Checklist before shipping

- [ ] Each bubble opens on hover, click and Enter, and closes on Escape and outside click.
- [ ] Moving the pointer from an item down into its bubble does not close it.
- [ ] Items near the right edge use `right: true` so their bubble stays on screen.
- [ ] Below the collapse width the sheet opens, folds work, and nothing scrolls sideways.
- [ ] No label wraps at 320px, 768px, 1024px or 1440px.
- [ ] All links point at real pages.
