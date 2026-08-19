// Offline verification of lib/keccak.js. Vectors 4-9 are constants this repo
// already relies on in production (collect-activity.js / collect-fe-apy.js),
// so a regression here would break the existing collectors too.
const { keccak256, selector, topic } = require('./keccak');

const CASES = [
  ['keccak256("")', keccak256(''), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'],
  ['keccak256("abc")', keccak256('abc'), '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45'],
  ['Transfer topic', topic('Transfer(address,address,uint256)'), '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
  ['ERC4626 Deposit topic', topic('Deposit(address,address,uint256,uint256)'), '0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7'],
  ['ERC4626 Withdraw topic', topic('Withdraw(address,address,address,uint256,uint256)'), '0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db'],
  ['totalAssets()', selector('totalAssets()'), '0x01e1d114'],
  ['decimals()', selector('decimals()'), '0x313ce567'],
  ['asset()', selector('asset()'), '0x38d52e0f'],
  ['convertToAssets(uint256)', selector('convertToAssets(uint256)'), '0x07a2d13a'],
  ['getPerformanceFeeData()', selector('getPerformanceFeeData()'), '0x90acbe9c'],
  ['getManagementFeeData()', selector('getManagementFeeData()'), '0x31ee80ca'],
  ['totalSupply()', selector('totalSupply()'), '0x18160ddd'],
  ['FusionInstanceCreated', topic('FusionInstanceCreated(uint256,uint256,string,string,uint8,address,string,uint8,address,address,address,address)'), '0x9c0af8f185eba94f5cd30afcaee7c849a3ce40571f1f27677b1de7383aa9e78f'],
];

let failed = 0;
for (const [name, got, want] of CASES) {
  const ok = got.toLowerCase() === want.toLowerCase();
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n   got  ${got}\n   want ${want}`}`);
}
console.log(failed ? `\n${failed} failed` : `\nAll ${CASES.length} vectors pass.`);
process.exit(failed ? 1 : 0);
