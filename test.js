const { parseLedgerEntry: p, parseLedgerEntries: pm } = require('./parser');
const cases = [
  ['Nimeuza 53 plates TSH 15000', 'sale', 15000, true],
  ['nimeuza 15000', 'sale', 15000, true],
  ['Nimeuza chips 15,000', 'sale', 15000, true],
  ['nimeuza 15k', 'sale', 15000, true],
  ['nimeuza 1.5m', 'sale', 1500000, true],
  ['Nimeuza 20000/=', 'sale', 20000, true],
  ['niliuza mandazi tsh. 5,500', 'sale', 5500, true],
  ['mauzo ya leo 85000', 'sale', 85000, true],
  ['nimeuza elfu kumi na tano', 'sale', 15000, true],
  ['nimeuza sabuni moja kwa elfu mbili', 'sale', 2000, true],
  ['nimeuza elfu mbili na mia tano', 'sale', 2500, true],
  ['mauzo laki moja na elfu ishirini', 'sale', 120000, true],
  ['nimeuza elfu 15', 'sale', 15000, true],
  ['nimenunua unga 20,000', 'purchase', 20000, true],
  ['Nimenunua mkaa kwa shilingi elfu tano', 'purchase', 5000, true],
  ['nimenunua mchele kilo 10 kwa 25000', 'purchase', 25000, true],
  ['nimelipa kodi 50000', 'expense', 50000, true],
  ['nimetumia nauli 2000', 'expense', 2000, true],
  ['sold 3 bags for 45000 tsh', 'sale', 45000, true],
  ['paid rent 100k', 'expense', 100000, true],
  ['nimeuza', 'sale', null, false],
  ['habari yako', 'unknown', null, false],
  ['15000', 'unknown', 15000, false],
  ['nimeuza 30000 nimenunua mkaa 5000', null, null, false],
];
let fail = 0;
for (const [text, type, amount, save] of cases) {
  const r = p(text);
  const ok = (type === null || r.type === type) && (amount === null || r.amount === amount) && (r.confidence >= 0.6) === save;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${text.padEnd(42)} -> ${JSON.stringify(r)}`);
}

// Multi-entry messages: [text, [[type, amount], ...]]
const multi = [
  ['nimeuza 30000 nimenunua mkaa 5000', [['sale', 30000], ['purchase', 5000]]],
  ['nimeuza 30,000, nimenunua mkaa 5000', [['sale', 30000], ['purchase', 5000]]],
  ['leo nimeuza chips 15k na nimelipa nauli 2000', [['sale', 15000], ['expense', 2000]]],
  ['nimeuza chips 5000\nnimeuza soda 2000\nnimenunua mkaa elfu tatu', [['sale', 5000], ['sale', 2000], ['purchase', 3000]]],
  ['nimeuza elfu kumi na tano', [['sale', 15000]]],
  ['Nimeuza 53 plates TSH 15000', [['sale', 15000]]],
];
for (const [text, expected] of multi) {
  const r = pm(text);
  const ok = r.length === expected.length && r.every((e, i) => e.type === expected[i][0] && e.amount === expected[i][1] && e.confidence >= 0.6);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(text).padEnd(42)} -> ${JSON.stringify(r.map(e => [e.type, e.amount, e.confidence]))}`);
}
// Summary commands
const { parseCommand } = require('./summary');
const cmds = [['Leo', 'leo'], ['leo?', 'leo'], ['  WIKI hii ', 'wiki'], ['salio!', 'salio'], ['mwezi huu', 'mwezi'],
  ['jana', 'jana'], ['help', 'msaada'], ['nimeuza leo 5000', null], ['habari', null]];
for (const [text, expected] of cmds) {
  const r = parseCommand(text);
  const ok = r === expected;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  command ${JSON.stringify(text).padEnd(34)} -> ${r}`);
}
// Corrections
const { parseCorrection } = require('./corrections');
const corr = [['futa', { action: 'undo' }], ['Futa!', { action: 'undo' }], ['undo', { action: 'undo' }],
  ['rekebisha 6000', { action: 'correct', amount: 6000 }], ['Rekebisha 6,500', { action: 'correct', amount: 6500 }],
  ['badilisha elfu kumi', { action: 'correct', amount: 10000 }], ['rekebisha', { action: 'correct', amount: null }],
  ['futa kabisa akaunti', null], ['nimeuza 5000', null]];
for (const [text, expected] of corr) {
  const r = parseCorrection(text);
  const ok = JSON.stringify(r) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  correction ${JSON.stringify(text).padEnd(31)} -> ${JSON.stringify(r)}`);
}
// Confirmations
const { parseConfirmation } = require('./ledger');
const conf = [['NDIO', 'yes'], ['ndiyo!', 'yes'], ['sawa', 'yes'], ['Hapana', 'no'], ['no', 'no'], ['nimeuza 5000', null], ['leo', null]];
for (const [text, expected] of conf) {
  const r = parseConfirmation(text);
  const ok = r === expected;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  confirm ${JSON.stringify(text).padEnd(34)} -> ${r}`);
}
// Items and quantities: [text, item, quantity, unit]
const items = [
  ['Nimeuza 53 plates TSH 15000', 'plates', 53, null],
  ['Nimeuza chips 15,000', 'chips', null, null],
  ['nimeuza sabuni moja kwa elfu mbili', 'sabuni', 1, null],
  ['nimenunua mchele kilo 10 kwa 25000', 'mchele', 10, 'kg'],
  ['nimenunua unga 10kg 12000', 'unga', 10, 'kg'],
  ['nimenunua mafuta lita 5 kwa 18000', 'mafuta', 5, 'l'],
  ['nimeuza vipande 3 vya sabuni 4500', 'sabuni', 3, 'pcs'],
  ['sold 3 bags for 45000 tsh', 'bags', 3, null],
  ['nimelipa kodi 50000', 'kodi', null, null],
  ['mauzo ya leo 85000', null, null, null],
  ['nimeuza 15k', null, null, null],
];
for (const [text, item, quantity, unit] of items) {
  const r = p(text);
  const ok = r.item === item && r.quantity === quantity && r.unit === unit;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  item ${JSON.stringify(text).padEnd(37)} -> ${r.item} | ${r.quantity} ${r.unit || ''}`);
}
const total = cases.length + multi.length + cmds.length + corr.length + conf.length + items.length;
console.log(`\n${total - fail}/${total} passed`);
process.exit(fail ? 1 : 0);
