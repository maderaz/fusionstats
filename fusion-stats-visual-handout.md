# Fusion Stats: visual handout

This handout is a spec for recreating the look of the Fusion Stats site: its page frame, side menu, main canvas, spacing, colours, components and charts. It is meant for a person or another AI.

Every value here comes from the live code:

- `ui.css`: the tokens and components;
- `nav.js`: the side menu, the phone bars and the themes;
- `ui-chart.js`: the chart system;
- `stocks/index.html`: one complete page.

Where this handout and the code disagree, the code wins.

The site's character is quiet and editorial, close to shadcn/Vercel. The content sits on a white (or deep purple) canvas without cards or boxes. Sections are separated by 1px hairlines. The type is Geist, tight and confident. Purple `#8429FF` is the only accent. Charts are lean and smooth, drawn on a faint dot grid.

---

## 1. Foundations

### Fonts

```html
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
```

- **Sans:** `'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`
- **Mono:** `'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace`. Used for addresses and token tickers, at 12.5px with `-0.01em` tracking.
- **Body text:** 14px, line-height 1.5, `-webkit-font-smoothing: antialiased`.
- **Numbers:** always `font-variant-numeric: tabular-nums`.
- **Weights:** only 400, 500 and 600. Bold (700) appears only in the chart hover's big number.
- **Labels are Title Case** (`text-transform: capitalize`): figure names, section titles, table headings, buttons, tabs and segments. Values (tickers like cbETH) keep their own spelling.

### Type scale

| Role | Size | Weight | Tracking | Colour |
|---|---|---|---|---|
| Page title (h1) | 32px (26px on a phone), line-height 1.1 | 600 | -0.035em | `--text` |
| Lede under the title | 15px (14px on a phone) | 400 | – | `--text-2` |
| Section title (h2) | 18px | 600 | -0.02em | `--text` |
| Sub-title | 15px | 600 | -0.01em | `--text` |
| Big figure value | `clamp(20px, 3.2cqi, 34px)`, line-height 1.1 | 600 | -0.035em | `--text` (or `--pos`/`--neg`) |
| Figure label | 13px | 500 | – | `--text-3` |
| Caption, meta, count | 12.5–13px | 400 | – | `--text-3` |
| Table heading | 12px | 500 | – | `--text-3` |
| Table cell | 14px | 400 | – | `--text` |
| Filter label | 11.5px | 500 | – | `--text-2` |
| Chart tick labels | 12px (11px on a phone) | 400 | – | `--text-3`, or the series colour |

### Colour tokens: three themes

The site has three themes: Light, Dark and **Purple**. Purple is the default for a first visit. The theme is set on `<html>` with `data-theme="dark"`, plus `data-palette="purple"` for Purple. The choice is stored in `localStorage['fusionstats_theme']`.

| Token | Light | Dark | Purple (default) | Use |
|---|---|---|---|---|
| `--bg` | `#FFFFFF` | `#0A0A0C` | `#2C0C55` | page and sidebar |
| `--bg-subtle` | `#F7F7F8` | `#131317` | `#351363` | segmented track, hover fill, skeletons |
| `--bg-hover` | `#F5F5F7` | `#141419` | `#3D186D` | menu row hover |
| `--line` | `#EDEDF0` | `#1E1E24` | `#4C247F` | hairlines |
| `--line-strong` | `#E2E2E7` | `#2A2A32` | `#5D3097` | control borders |
| `--text` | `#0B0B0F` | `#F4F4F6` | `#FFFFFF` | primary text |
| `--text-2` | `#5E5E6B` | `#A3A3AE` | `#E2CDFE` | secondary text |
| `--text-3` | `#9A9AA6` | `#70707C` | `#B794E6` | muted labels, ticks |
| `--accent` | `#8429FF` | `#A37FFF` | `#D7B8FF` | links, active state, the TVL line |
| `--accent-bg` | `rgba(132,41,255,.08)` | `rgba(163,127,255,.14)` | `rgba(255,255,255,.13)` | active menu row, badge |
| `--pos` | `#16A34A` | `#22C55E` | `#5EE89A` | gains |
| `--neg` | `#DC2626` | `#EF4444` | `#FF8A8A` | losses, exits |
| `--amber` | `#B45309` | `#F59E0B` | `#FCD34D` | warnings |
| `--tip-bg` / `--tip-fg` | `#111116` / `#FFF` | `#F4F4F6` / `#0A0A0C` | `#FFF` / `#2C0C55` | ⓘ tooltip bubble |

The soft fills (`--pos-soft`, `--neg-soft`, `--amber-soft`) are the colour at 10–18% alpha.

**Chart categories** (`--chart-1` … `--chart-5`), used when one chart has several series:

| | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Light | `#F54900` | `#009689` | `#104E64` | `#FFB900` | `#FE9A00` |
| Dark | `#1447E6` | `#00BC7D` | `#FE9A00` | `#AD46FF` | `#FF2056` |
| Purple | `#5EEAD4` | `#FDE047` | `#F9A8D4` | `#7DD3FC` | `#FDBA74` |

A chart with a single series draws it in `--accent`. Its tick labels and dates then take that same colour (`--chart-ink`).

**Brand gradient** (for CTAs only, rarely used on the stats pages): `linear-gradient(90deg, #8429FF, #6C00FF)`.

### Radii, shadows, motion

- **Radii:**
  - 8px: menu rows, hover card;
  - 9–10px: buttons;
  - 12px: segmented track;
  - 14px: filter bar and dropdown menus;
  - 20px: the top of the phone sheet;
  - 999px: pills and badges.
- **Shadows** are rare and soft:
  - control: `0 1px 2px rgba(16,16,24,.04)`;
  - active segment: `0 1px 2px rgba(16,16,24,.08), 0 0 0 1px var(--line)`;
  - menus: `0 18px 44px rgba(16,16,24,.14), 0 2px 6px rgba(16,16,24,.06)`;
  - sidebar: `0 0 24px rgba(0,0,0,.04)`.
- **Transitions:** 0.12–0.2s on colour and background. The phone sheet slides in with `cubic-bezier(.32,.72,0,1)` over 0.32s.

---

## 2. Page frame

### Desktop (over 900px)

```
┌────────────┬──────────────────────────────────────────────────┐
│  SIDEBAR   │                 MAIN CANVAS                      │
│  220px     │   .ui-page: max-width 1120px, centred in the     │
│  fixed     │   space right of the sidebar                     │
│  full      │   padding 44px 48px 96px                         │
│  height    │                                                  │
│            │   [masthead]                                     │
│            │   ─────────── hairline ───────────               │
│            │   [figures row]                                  │
│            │   ─────────── hairline ───────────               │
│            │   [section: title + controls + chart]            │
│            │   ─────────── hairline ───────────               │
│            │   [section …]                                    │
└────────────┴──────────────────────────────────────────────────┘
```

- `body { padding-left: 220px }`. The sidebar is `position: fixed; left: 0; top: 0; bottom: 0; width: 220px`.
- The main column is `.ui-page { max-width: 1120px; margin: 0 auto; padding: 44px 48px 96px; container-type: inline-size; }`. Components respond to **the column's width** through `@container` queries, not to the window's.
- **Side padding steps down:** `36px 32px 80px` at ≤1200px, `12px 24px 64px` at ≤900px and `6px 16px 48px` at ≤480px.
- There are **no cards.** Content sits directly on `--bg`. Sections are divided by `border-top: 1px solid var(--line)` with 32–36px of padding above and below.
- No page ever scrolls sideways. A wide table scrolls inside its own box.

### Sidebar

The sidebar's styles are in `nav.js`. Its background is `--bg`, with `border-right: 1px solid var(--line)` and a soft shadow. Vertical padding is 16px.

1. **Brand row**, at padding `3px 20px 20px`:
   - the Fusion atom mark (purple `#8429FF` SVG) at 24×24;
   - a 9px gap;
   - the word **"Ecosystem"** at `600 17px/1`, letter-spacing -0.03em, black (white in dark themes).
2. **Link groups**, a column with `gap: 20px` and `padding: 0 10px 16px`:
   - The first group (Key Metrics, Stocks, Explorer) has no heading.
   - The other groups ("Finances", "Insights", "Tools") each have a quiet heading at `500 11.5px`, `--text-3`, padding `0 10px 6px`.
   - Insights and Tools fold. Their heading is a button with a 12px chevron that rotates -90° when closed. The opening animates `grid-template-rows: 1fr ↔ 0fr` over 0.22s.
   - A "Demo" group sits at the foot (`margin-top: auto`).
3. **Link row:**
   - `display:flex; gap:10px; height:34px; padding:0 10px; border-radius:8px; font: 500 13.5px/1; color: --text-2`;
   - rows are 1px apart.
   - **Hover:** `--text` on `--bg-hover`.
   - **Active:** `--accent` text on `--accent-bg`, weight 600.
4. **Icons** are custom: a 16px grid, 1.5px strokes, round caps and joins, `fill: none`.
   - At rest an icon is `--text-3`.
   - On hover, the part of the icon marked `.a` turns `--accent`.
   - On the active page the whole icon is `--accent`.
   - Each page has its own small pictogram: a house, candles, a lens over a square, a pediment, and so on.
5. **Badge** ("New"): a pill with padding `2px 6px`, `600 10px`, `--accent` on `--accent-bg`.
6. **Sub-pages:**
   - a 24px chevron button at the right of the row opens them;
   - they are indented 17px, with a 1px `--line` rule on their left;
   - their rows are 30px high at 13px, with 14px icons.
7. **Theme switch** at the foot, with padding `18px 20px 6px`:
   - It is a segmented control: track `--bg-subtle`, 1px `--line` border, radius 11px, padding 3px.
   - It has three buttons (Light / Dark / Purple), each 30px high at `500 12.5px`, words only.
   - The pressed button is `--bg` with the segment shadow.
8. **Scrollbars**, site-wide: a 10px bar with a thin rounded thumb in `--text-3` at 45%, no track and no arrows.

### Phone and tablet (≤900px)

- The sidebar is hidden.
- **Top bar**, 56px, `position:absolute` so it scrolls away with the page:
  - the mark at 22px and the page's name at 16.5px/600;
  - on the right, "Updated 2 h ago" in `--text-3`/`--text-2`, 13px, which refreshes the data when tapped.
- **Tab bar**, fixed at the bottom, 58px high plus the safe-area inset, `--bg` with a `--line` border on top:
  - It has equal columns: the key pages, then **More**.
  - Each tab is a 20px icon over an `11px/500` label.
  - The icon sits in a 52×28 pill. On the active tab the pill fills with `--accent-bg` and the tab turns `--accent`, weight 600.
- **More sheet:**
  - it rises from behind the tab bar, with radius `20px 20px 0 0` and shadow `0 -18px 48px rgba(10,10,14,.16)`;
  - it has a 38×5 grab handle;
  - the pages are tiles in a 2-column grid with an 8px gap;
  - the theme switch sits at its foot.
- The body gets `padding-top: 56px` and `padding-bottom: 74px` plus the inset.

---

## 3. Main canvas, top to bottom

### Masthead

```html
<header class="ui-masthead">
  <div>
    <h1>Stocks</h1>
    <p class="ui-lede">Tokenized stocks on Base, held in <b>Fusion vaults</b>.</p>
    <div class="ui-status">Updated <b>2 h 11 min</b> ago</div>
  </div>
  <div class="ui-meta">…controls…</div>
</header>
```

- `display:flex; align-items:flex-end; justify-content:space-between; gap:16px 32px; padding-bottom:28px; border-bottom:1px solid var(--line)`.
- The text block flexes as `1 1 520px`. The meta and controls are pushed right with `margin-left:auto`.
- The lede's max-width is 720px. Bold words in it are `--text` at weight 600.
- When the column is ≤560px the lede hides (unless it has `.keep`) and the padding-bottom drops to 16px.
- On desktop a "Copy as .md" ghost button sits at the masthead's top right:
  - `height:32px; padding:0 12px; border:1px solid var(--line); radius:9px; 500 13px; color --text-2`;
  - hover: `--text` on `--bg-subtle`.

### Figures row (headline numbers)

```html
<div class="ui-figures" style="--n:4">
  <div class="ui-figure"><div class="k">TVL <i class="ui-tip"></i></div><div class="v">$4.74M</div><div class="s">of $5.1M peak</div></div>
  …
</div>
```

- It is a grid of `repeat(var(--n,4), minmax(0,1fr))` with `padding: 26px 0 30px` and a hairline below.
- Each figure has `padding: 0 24px` and a 1px `--line` rule on its left. The first figure has neither.
- `.k` is the label (13px/500, `--text-3`, never wraps), followed by an optional ⓘ.
- `.v` is the big number, 6px below the label.
- `.s` is the caption, 12.5px in `--text-3`. It uses `text-wrap: balance` and never ends in "…".
- While loading, `.v` shows a shimmer bar: a 200% gradient `--bg-subtle → --line → --bg-subtle` over 1.4s.
- When the column is ≤700px the row becomes 2 columns, with hairlines between the rows as well.

### Section

```html
<section class="ui-section">
  <div class="ui-head"><h2>TVL <span class="ui-count">12 vaults</span></h2> <button class="ui-btn">…</button></div>
  …toolbar, then the chart…
</section>
```

- Padding is `32px 0` (36/28 on Stocks), with a hairline on top. The head row sits 14–16px above its content.
- When the column is ≤560px, a button with an icon beside a title shrinks to a 36px icon-only square.

### Controls

- **Filter bar** (`.ui-filters`), one box of cells:
  - The box: `border:1px solid var(--line-strong); radius:14px; box-shadow:0 1px 2px rgba(16,16,24,.04)`.
  - Each cell is 54px high, `padding: 9px 14px 0`, with a `--line` rule on its left.
  - A cell holds a small label (11.5px/500, `--text-2`) over its value (`500 14px`, `--text`).
  - A 12px chevron sits at the cell's right. The whole cell is the click target.
  - Hover: `--bg-subtle`.
  - When the column is ≤700px the box becomes a 2-column grid with square inner corners and hairlines only between cells.
- **Segmented control** (`.ui-seg`):
  - Track: padding 3px, `border:1px solid var(--line)`, radius 12px, `--bg-subtle`.
  - Buttons: 34px high, `0 14px`, radius 9px, `500 13px`, `--text-2`.
  - The selected button is `--bg` and `--text`, with `0 1px 2px rgba(16,16,24,.08), 0 0 0 1px var(--line)`.
  - It goes full width on a phone.
- **Buttons** (`.ui-btn`):
  - 36px high, `0 14px`, radius 10px, `1px solid --line-strong`, `--bg`, `500 13px`, `--text`;
  - 14px stroke icons with a 7px gap;
  - `.primary` is `--text` on `--bg` (inverted), at 0.88 opacity on hover.
- **Dropdown menu** (export settings and the like):
  - 260px wide, padding 12px, radius 14px, `1px --line-strong`, `--bg`, with the menu shadow;
  - small 11.5px `--text-3` headings over segmented controls and checkboxes (`accent-color: --accent`).
- **ⓘ tooltip:**
  - a 13px masked "i" icon in `--text-3` (`--text-2` on hover);
  - its bubble: `--tip-bg`/`--tip-fg`, radius 10px, padding `9px 12px`, `12.5px/1.5`, max 320px, shadow `0 12px 32px rgba(0,0,0,.18)`.

### Tables

- Hairlines only: no boxes, no zebra stripes.
- **Headings:** `th` is `10px 12px`, `12px/500 --text-3`, with a `--line` rule below. When sorted, the heading is `--text` with a 10px arrow.
- **Cells:** `td` is `13px 12px`, with a `--line` rule below. The first and last columns have 0 outer padding, so the table aligns flush with the text above it.
- Numbers are right-aligned, tabular and never wrap. A secondary line under a cell value is `.ui-sub` (12.5px, `--text-3`, 2px gap).
- **Chips:**
  - a network chip is a 16px logo with radius 4px, then the name;
  - a token chip is mono `500 12px` on `--bg-subtle` with radius 6px.
- **Pager:**
  - "1–25 of 312" on the left; Prev · page numbers · Next on the right;
  - its buttons are 34px with radius 9px;
  - the current page is inverted (`--text` background).

### Layout rules (from CLAUDE.md, enforced by `tools/ui-audit.mjs`)

1. **A label is one line.** Never let a label wrap, and never cut a short word with "…". Only a long vault name in a list row may end in "…".
2. **Nothing touches.** The minimum gaps are:
   - 4px between an icon and its text;
   - 8px around a chevron;
   - 6px between neighbouring items;
   - 6px between text and the edge of the box drawn round it.
3. **Nothing goes past the edge,** at any width from 320 to 1920px.
4. **Rows are level.** A cell that starts with a logo aligns to the name's baseline, with the logo `align-self: center`.

---

## 4. Charts

All charts are **Plotly** (`plotly-basic-2.35.2`). The visual reference is shadcn's Recharts line charts. Plotly config: `{ displayModeBar:false, responsive:true, doubleClick:false, scrollZoom:false }`. Both backgrounds are transparent, and `dragmode:false`.

### The chart box

- 340px tall on desktop, 260px when the column is ≤700px. It has no border and no card.
- **Dot grid:** the plot area (only that area) sits on a dot grid. The dots are a 1px radius on a 20px pitch.
  - Dot colour: `rgba(11,11,15,.14)` in light, `rgba(255,255,255,.09)` in the dark and purple themes.
  - The dots stop exactly at the plot's edges. The page colour is painted over the margins.
  - The grid is the only scale cue. **There are no gridlines, no axis lines, no zero line and no tick marks.**

```css
.ui-chart {
  height: 340px;
  --dots: rgba(11,11,15,.14);
  --plot-t: 20px; --plot-b: 50px; --plot-l: 65px; --plot-r: 10px;   /* set from the drawn plot */
  background:
    linear-gradient(var(--bg),var(--bg)) top    / 100% var(--plot-t) no-repeat,
    linear-gradient(var(--bg),var(--bg)) bottom / 100% var(--plot-b) no-repeat,
    linear-gradient(var(--bg),var(--bg)) left   / var(--plot-l) 100% no-repeat,
    linear-gradient(var(--bg),var(--bg)) right  / var(--plot-r) 100% no-repeat,
    radial-gradient(circle, var(--dots) 1px, transparent 1.5px) 0 0 / 20px 20px;
}
```

### Margins and axes

| | Desktop | Phone (column ≤560px) |
|---|---|---|
| Margin t / r / b / l | 20 / 10 / 50 / 65 | 20 / 8 / 34 / 8 |
| Y labels | outside, right-aligned in the 65px gutter, 21px short of the plot | **inside** the plot, just above the level they name, under the data |
| Tick font | 12px | 11px |
| Dates under the plot | 5 | 3 |

- **Y axis:**
  - It has **five round levels** from zero (or the lowest reading) to just above the highest.
  - The step is "nice": 1, 2, 2.5, 3, 4, 5, 6, 8 or 10 × a power of ten.
  - Labels are compact (`$4.7M`, `120K`) with no trailing zeros.
- **X axis:**
  - It runs from the first reading to the last, with **no dead space** either side.
  - Plotly's own x tick labels are off. The dates are drawn as an HTML row under the plot: evenly spaced, the first and last kept inside the plot's ends, 12px in `--text-3`.
- **Tick labels have a halo** of the page colour, so they stay legible over the data: `paint-order: stroke fill; stroke: var(--bg); stroke-width: 3px`.
- **One series:** the y labels and the dates take that series' colour.

### Lines

- Lines are at most 2px wide, with round caps and joins.
- They are **smoothed with a monotone cubic.** The curve never dips before a jump and never overshoots a peak.
- **Area fill:** the growth/TVL look is the accent line over `fill: 'tozeroy'` at **10% alpha** of the accent.
- **High and low dots:** a single-series line gets a ringed dot on its highest and lowest reading.
  - The dot is 12px in the line's colour, with a 2px white ring.
  - It has a drop shadow: `filter: drop-shadow(2px 3px 3px rgba(0,0,0,.35))`.
  - It is not clipped at the plot's edge.

### Bars

- **Bar shape:**
  - Corners are rounded with `marker.cornerradius: '45%'`, with no outline.
  - Each bar is **56% of its slot**, so bars are thin with generous gaps.
  - Stacked bars use `--chart-1…5`.
- **Inflows and outflows:** deposits go up in the series colours, exits go down in `--neg-bar`.
- **Stock marks:** on Stocks, each stack segment can carry the stock's logo inside it where there is room. The key sits under the chart: logo, ticker and current value, in 13px `--text-2`.

### Hover (custom: Plotly's own hover label is suppressed)

Plotly runs with `hovermode: 'x unified'` and `hoverdistance: -1`, but draws nothing itself. The page draws the hover:

- **Hairline:** a vertical dashed rule (3px on, 3px off) in `--text-3` at 50% opacity. It runs *under* the bars.
- **Active dot:** 12px in the series colour, with a white 2px ring and the shadow `2px 3px 6px rgba(0,0,0,.35)`. It glides between points, with `transform` transitions of 0.16s `cubic-bezier(.2,.8,.2,1)`.
- **Card:**
  - box: `--bg`, `1px --line-strong`, radius 8px, padding 12px, min-width 128px;
  - shadow: `0 12px 30px rgba(16,16,24,.12), 0 2px 6px rgba(16,16,24,.05)`;
  - contents:
    - the date (13px, `--text-3`);
    - the big value (16px/700, tabular);
    - one row per series: an 8px colour dot, the name in `--text-2`, then the value at weight 600.
- **Bars:**
  - A rounded `--bg-subtle` slot (radius 8px) glides behind the hovered day.
  - All other bars fade to **35% opacity**.
- On touch devices, sliding a finger across the plot moves the hover.

### Chart-level layout snippet

```js
const layout = {
  paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
  font: { family: 'Geist, sans-serif', size: 12, color: cssVar('--text-2') },
  margin: { t: 20, r: 10, b: 50, l: 65, pad: 0 },
  showlegend: false, hovermode: 'x unified', hoverdistance: -1, dragmode: false,
  xaxis: { type: 'date', showticklabels: false, showgrid: false, zeroline: false, showline: false, ticks: '' },
  yaxis: { showgrid: false, zeroline: false, showline: false, ticks: '',
           tickfont: { size: 12, color: cssVar('--text-3') }, ticklabelstandoff: 20,
           tickmode: 'linear', tick0: 0, dtick: niceStep, range: [0, niceTop] },
};
const line = { type: 'scatter', mode: 'lines', line: { color: cssVar('--accent'), width: 2 },
               fill: 'tozeroy', fillcolor: 'rgba(132,41,255,0.1)', hoverinfo: 'none' };
```

### PNG export (Stocks)

The export button opens a menu:

- **Style:**
  - Chart only (transparent);
  - Transparent + headline;
  - Solid + headline.
- **Size:**
  - Page;
  - 16:9;
  - 4:3;
  - 1:1 (960px).
- **Dots:** on or off.

A headline export is laid out top to bottom:

- **Headline:** a big lead number in the accent colour (units with no decimals, or USD), then the title, wrapped to two balanced lines.
- **Legend:** a row of stock logos with their share, placed in the empty band above the chart's peak.
- **Chart:** purple axes, y labels *inside* the plot running nearly full width, and the 12px ringed start and end dots.
- **Footer:** small type, with the snapshot date and "N vaults on Base", then the vault addresses in spaced columns.
- **Brand:** the Fusion mark and wordmark in the top corner.
- **Dots on transparent styles:** solid grey (`#BDBDC6` light, `#5E5E6B` dark), so they show on any background.

---

## 5. Minimal page skeleton

```html
<!doctype html>
<html lang="en" data-theme="dark" data-palette="purple">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/ui.css">          <!-- tokens + components (section 1 and 3) -->
  <script src="/nav.js"></script>                 <!-- sidebar / phone bars / theme -->
  <script src="https://cdn.plot.ly/plotly-basic-2.35.2.min.js"></script>
  <script src="/ui-chart.js"></script>            <!-- FusionChart.fit / soft / glide / frame -->
</head>
<body>
  <main class="ui-page">
    <header class="ui-masthead">…</header>
    <div class="ui-figures" style="--n:4">…</div>
    <section class="ui-section">
      <div class="ui-head"><h2>TVL</h2></div>
      <div class="ui-toolbar"><div class="ui-seg"><button class="on">30D</button><button>90D</button><button>All</button></div></div>
      <div class="ui-chart" id="tvl"></div>
    </section>
  </main>
</body>
</html>
```

```js
const traces = FusionChart.quiet(FusionChart.soft([FusionChart.growth({ x: dates, y: values })]));
Plotly.newPlot('tvl', traces, FusionChart.fit(baseLayout, traces), CONFIG)
  .then(gd => FusionChart.glide(gd, describePoint));   // custom hover + frame()
```

## 6. Recreation checklist

- [ ] Geist everywhere, tabular numbers, Title Case labels.
- [ ] A fixed 220px sidebar; content in a 1120px column with 48px sides; no cards, hairlines between sections.
- [ ] All three themes driven by the CSS variables. Purple (`#2C0C55` ground) is the default.
- [ ] A single accent (purple). Green and red only for gains and losses.
- [ ] Charts: no gridlines or axis lines, a dot grid clipped to the plot, five nice y levels, x running edge to edge, 5 dates.
- [ ] Smooth 2px lines with a 10% area fill and ringed high/low dots. Bars at 56% of the slot with 45% rounded corners.
- [ ] A custom hover: dashed hairline, ringed gliding dot, light card. Bars dim to 35%.
- [ ] Phone (≤900px): top bar plus bottom tab bar with a More sheet; y labels inside the plot, 3 dates, a 260px chart.
- [ ] No horizontal scroll, no wrapped labels and no "…" anywhere, from 320 to 1920px.
