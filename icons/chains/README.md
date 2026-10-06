# Network marks

The chain logos shown in the site's dropdowns (`/fusion-select.js`), served
from our own origin so a filter never waits on, or breaks with, someone
else's CDN.

They are the "branded" network icons from
[web3icons](https://github.com/0xa3k5/web3icons) by 0xa3k5
(`raw-svgs/networks/branded/`), unmodified, under the MIT License:

| file | web3icons name | chain id in our data |
| --- | --- | --- |
| arbitrum.svg | arbitrum-one | `arbitrum` |
| avalanche.svg | avalanche | `avalanche` |
| base.svg | base | `base` |
| ethereum.svg | ethereum | `ethereum` |
| hyperevm.svg | hyper-evm | `999` |
| ink.svg | ink | `ink` |
| katana.svg | katana | `katana` |
| monad.svg | monad | `143` |
| plasma.svg | plasma | `plasma` |
| unichain.svg | unichain | `unichain` |

TAC (`tac`) has no mark in that set, so the dropdown draws a lettered badge
for it. Adding `tac.svg` here and its file name in `CHAINS` in
`/fusion-select.js` is all it takes to show the real one.

```
MIT License

Copyright (c) 0xa3k5

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
