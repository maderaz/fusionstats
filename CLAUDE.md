# Fusion Stats

## UI rules: every page, every device

These hold on every page from a 320px phone to a 1920px desktop, in both
themes. `node tools/ui-audit.mjs` checks them in a real browser; run it after
any change to a page, `ui.css`, `nav.js` or `fusion-select.js`, and ship only
when it ends `clean`.

1. **A label is one line.** That covers figure names (TVL, DAO earnings),
   filter names and values, section titles, table headings, buttons, tabs and
   chips. When room runs short, in this order:
   - Size columns to what they hold (`minmax(min-content, 1fr)`,
     `minmax(max-content, 1fr)`, or a column minimum). Equal fractions that
     squeeze a label are not the answer.
   - On a phone, a button beside a section title shows just its icon
     (`.ui-head .ui-btn:has(> svg)`, and Stocks' `.xport-btn`). On the
     narrowest phones the title steps down a size.
   - Use the value's shorter word: `data-narrow` on a dropdown option ("All"
     for "All vaults"), `.m-show`/`.m-hide` words, or a nav page's `short`.
   - Change the layout: four filters become two by two, a table becomes
     two-line rows, a pair of switches takes a row each.

   Never let a label wrap, and never cut a short word with "…". Only a long
   name (a vault's, over about 20 characters) may end in "…", and only in a
   list's row. In a dropdown list it takes a second line instead. A caption
   under a figure ("of $4.74M in stocks") never ends in "…" either: use the
   shorter wording on a phone, and where a column is still too narrow it
   takes a second, balanced line.
2. **Nothing kisses.** The minimum gaps are:
   - 4px between an icon and its text;
   - 8px between a chevron and anything;
   - 6px between neighbouring items;
   - 6px between text or an icon and the side of the box drawn round it (a
     cell, a button, a pill).
3. **Chevrons.** A dropdown's chevron is fusion-select's own `.fs-chev`. It
   sits on the value's line at the cell's right, with its glyph at least 9px
   from the value. It is never a background image.
4. **Nothing past the edge.** No page scrolls sideways at any width. A wide
   table scrolls inside its own box.
5. **Filter boxes on a phone.** Hairlines appear only between cells: each cell
   draws its top and left line 1px out, under the box's clip. Inner corners
   are square, and every first-column label lines up.
6. **Rows are level.** In a table or list row, every cell's words sit on one
   line. A cell that starts with a mark (a market's logo, a network's icon)
   takes its baseline from its name: `align-items: baseline` with the mark
   `align-self: center` (as `.ui-chain` does), or the cell's content as a
   block `display: flex`. Never use a plain `inline-flex` that starts with an
   image: its baseline is the image's foot, and the name rides 2–3px high.

## Checking the UI

- `node tools/ui-audit.mjs` checks every page at 22 widths, 320 to 1920px. It
  also checks with each page's first dropdown open, Activity's More panel open
  and the phone menu sheet open. It looks for wrapped labels, text cut with
  "…", crowding, overlaps, text against its box, rows off level and anything
  past the edge. It lists each problem with the widths where it shows, and
  exits 1 if it finds any.
- `--widths 320,390,1440 --pages /,/stocks` narrows a run. `--json out.json`
  keeps the raw findings.
- Pass `--plotly <plotly-basic.min.js>` when cdn.plot.ly is unreachable
  (sandboxes), so charts draw from a local copy.
- Geist must be installed or reachable on Google Fonts. Widths measured in a
  fallback font mean nothing, and the tool warns when that happens.
