const { parseLedgerEntry: p } = require('./parser');
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
console.log(`\n${cases.length - fail}/${cases.length} passed`);
process.exit(fail ? 1 : 0);
