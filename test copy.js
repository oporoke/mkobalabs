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
  ['nimeuza mia saba hamsini', 'sale', 750, true],
  ['nimeuza mia moja na hamsini', 'sale', 150, true],
  ['nimeuza elfu mbili mia tano', 'sale', 2500, true],
  ['nimeuza elfu tatu na mia tano hamsini', 'sale', 3550, true],
  ['nimeuza elfu mia tano', 'sale', 500000, true],
  ['nimeuza elfu kumi tano', 'sale', 15000, true],
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
// Debts: [text, type, name, amount]
const { parseDebt, parseDebtQuery } = require('./debts');
const debts = [
  ['Juma ananidai 5000', 'credit_received', 'Juma', 5000],
  ['nadaiwa na Juma elfu tano', 'credit_received', 'Juma', 5000],
  ['nimekopa kwa mama Asha 20,000', 'credit_received', 'Mama Asha', 20000],
  ['namdai Juma 5000', 'credit_given', 'Juma', 5000],
  ['Hassan anadaiwa 12k', 'credit_given', 'Hassan', 12000],
  ['nimemkopesha Neema 3000', 'credit_given', 'Neema', 3000],
  ['Juma amelipa 2000', 'repayment_received', 'Juma', 2000],
  ['leo Juma amenilipa tsh 1500', 'repayment_received', 'Juma', 1500],
  ['nimemlipa Juma 2000', 'repayment_made', 'Juma', 2000],
  ['nimelipa deni la Hassan 4000', 'repayment_made', 'Hassan', 4000],
  ['Juma owes me 7000', 'credit_given', 'Juma', 7000],
  ['Juma ananidai', 'credit_received', 'Juma', null],
  ['nimelipa kodi 50000', null], ['nimeuza 5000', null], ['paid rent 100k', null], ['nimenunua unga 20000', null],
];
for (const [text, type, name, amount] of debts) {
  const r = parseDebt(text);
  const ok = type === null ? r === null : (r && r.type === type && r.name === name && r.amount === amount);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  debt ${JSON.stringify(text).padEnd(37)} -> ${JSON.stringify(r)}`);
}
const dq = [['madeni', { all: true }], ['Deni', { all: true }], ['deni la juma', { name: 'Juma' }], ['deni mama asha', { name: 'Mama Asha' }], ['deni la juma 5000', null]];
for (const [text, expected] of dq) {
  const r = parseDebtQuery(text);
  const ok = JSON.stringify(r) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  debt query ${JSON.stringify(text).padEnd(31)} -> ${JSON.stringify(r)}`);
}
// Onboarding answers
const { extractName, extractBusiness } = require('./onboarding');
const names = [['Juma', 'Juma'], ['juma hassan', 'Juma Hassan'], ['Jina langu ni Asha', 'Asha'], ['naitwa mama neema', 'Mama Neema'],
  ['habari', null], ['nimeuza 5000', null], ['leo', null], ['ndio', null], ['Juma 2', null], ['futa', null]];
for (const [text, expected] of names) {
  const r = extractName(text);
  const ok = r === expected;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  name ${JSON.stringify(text).padEnd(37)} -> ${r}`);
}
const biz = [['chakula', 'chakula'], ['nauza mboga', 'mboga'], ['duka la nguo', 'nguo'], ['mama lishe', 'mama lishe'],
  ['nimeuza 5000', null], ['salio', null], ['habari', null]];
for (const [text, expected] of biz) {
  const r = extractBusiness(text);
  const ok = r === expected;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  business ${JSON.stringify(text).padEnd(33)} -> ${r}`);
}
// Report settings
const { parseReportSetting } = require('./reports');
const rep = [['acha ripoti', false], ['ACHA RIPOTI!', false], ['anza ripoti', true], ['ripoti', null], ['acha', null]];
for (const [text, expected] of rep) {
  const r = parseReportSetting(text);
  const ok = r === expected;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  report ${JSON.stringify(text).padEnd(35)} -> ${r}`);
}
// Typos and slang: [text, type, amount]
const typos = [
  ['nmeuza 5000', 'sale', 5000], ['nimeuuza 5000', 'sale', 5000], ['nimeuxa chips 3000', 'sale', 3000],
  ['Nimeauza 4000', 'sale', 4000], ['nimenunu mkaa 3000', 'purchase', 3000], ['nimenunuwa unga 20000', 'purchase', 20000],
  ['nmelipa nauli 2000', 'expense', 2000], ['nimetumi nauli 1500', 'expense', 1500],
  ['nimeuza buku tano', 'sale', 5000], ['nimeuza buku 5', 'sale', 5000], ['nimeuza buku mbili jero', 'sale', 2500],
  ['nimeuza jero', 'sale', 500], ['nimelipa ngiri 3', 'expense', 3000], ['nimeuza elf 10', 'sale', 10000],
  ['nimeona 5000', 'unknown', 5000], ['nimelima 5000', 'unknown', 5000], ['nimepita 5000', 'unknown', 5000],
  ['nimepika wali 5000', 'unknown', 5000], ['nimepiga hela 5000', 'unknown', 5000], ['nimekopa 5000', 'unknown', 5000],
  ['nimeleta mzigo 3000', 'unknown', 3000], ['nimefunga duka 2000', 'unknown', 2000],
  ['nimelipwa 5000', 'sale', 5000], ['nimetumiwa 20000', 'sale', 20000], ['nimeuziwa mchele 25000', 'purchase', 25000],
  ['nimelipia umeme 15000', 'expense', 15000],
];
for (const [text, type, amount] of typos) {
  const r = p(text);
  const ok = r.type === type && r.amount === amount;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  typo ${JSON.stringify(text).padEnd(37)} -> ${r.type} ${r.amount} ${r.confidence}`);
}
const typoDebt = parseDebt('Sabina amelipa 2000');
if (!(typoDebt && typoDebt.name === 'Sabina' && typoDebt.amount === 2000)) { fail++; console.log('FAIL  debt name Sabina'); }
else console.log('PASS  debt name "Sabina" is not turned into a number');
// Dashboard link request
const { parseDashboardRequest } = require('./dashboard');
const dash = [['dashibodi', true], ['Dashibodi!', true], ['dashboard', true], ['nimeuza 5000', false], ['leo', false]];
for (const [text, expected] of dash) {
  const r = parseDashboardRequest(text);
  const ok = r === expected;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  dashboard ${JSON.stringify(text).padEnd(32)} -> ${r}`);
}
// Mobile-money SMS (real samples): [sms, kind, amount, fee, name, ref]
const { parseMobileMoney } = require('./mobilemoney');
const mmCases = [
  ['UJH53B7F66 Confirmed. Ksh510.00 sent to EUNICE  OLUOCH 0729622160 on 17/10/26 at 12:50 PM. New M-PESA balance is Ksh0.00. Transaction cost, Ksh13.00.', 'currency'],
  ['UIA536OXTF\n Confirmed. Ksh 27.65 from your M-PESA has been used to fully pay your outstanding Fuliza M-PESA.', 'currency'],
  ['SUCCESS! TID #362570 USD 21.62 ANTHROPIC* CLAUDE SUB from your  card *1143 has been approved on 21-10-2026 01:43. Charge USD 21.62 Bal: 17,148.30.', 'card'],
  ['Payment to Airtel Money Global Pay is successful. Transaction Amt: 2,704 TSh, Bal: 70338.97 TSh.TID: VD261021.1138.OG3856', 'own_transfer'],
  ['Received 130,000 TSh from Agent: SELEMANI HASSANI. Balance: 130042.97 TSh. TID: CI261021.1112.S99790', 'own_transfer'],
  ['You have successfully deposited 11,000.00 Tsh to Airtel Money Global Pay card.Charges 0.00 Tsh New Balance 557.97 Tsh. Date:10.13.26 TID:XX261013.1101.S12027', 'own_transfer'],
  ['SENT TSh 1,000 equiv KES (FX 0.0465) to 742397883 DEBORA ODHIAMBO, 20/10/26. Fee TSh 20. Bal 42.97 TSh. TID: IO261020.2043.PI0586', 'person', 1000, 20, 'Debora Odhiambo', 'IO261020.2043.PI0586'],
  ['You have paid 1,000 TSh for YATOSHA BUNDLE. Fee TSh0.00. Balance 1062.97 TSh. TID: BS261020.1656.B96475', 'bundle', 1000, 0, 'Yatosha Bundle', 'BS261020.1656.B96475'],
  ['You have paid 1,000.00 Tsh to TIPS TIPS. Fee Tsh 45.00. Balance 10,512.97 Tsh. TID:XX261013.1424.X62862', 'merchant', 1000, 45, 'Tips Tips', 'XX261013.1424.X62862'],
  ['Paid 1000.00 TSh to 255769225819 NICHOLAS OTIENO. Charges Tsh 45.00 (Service charge Tsh 45.00 + Govt Levy Tsh 0.00). TID:XX261013.1424.X62862', 'person', 1000, 45, 'Nicholas Otieno', 'XX261013.1424.X62862'],
  ['Paid 10,000 Tsh to VODACOM TNQR.LIPA OLAYCE STEVEN LOTHA. Till 68708140, Fee Tsh 1,000.00.TID:XX261013.1035.U49330', 'merchant', 10000, 1000, 'Olayce Steven Lotha', 'XX261013.1035.U49330'],
  ['nimeuza 5000', null], ['Juma amelipa 2000', null], ['paid rent 100k', null],
];
for (const [sms, kind, amount, fee, name, ref] of mmCases) {
  const r = parseMobileMoney(sms);
  const ok = kind === null ? r === null
    : r && r.kind === kind && (amount === undefined || (r.amount === amount && r.fee === fee && r.name === name && r.ref === ref));
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  sms ${JSON.stringify(sms.slice(0, 34)).padEnd(38)} -> ${JSON.stringify(r)}`);
}
// Privacy: consent and deletion phrases
const { parseConsent, parseDeletion } = require('./privacy');
const priv = [
  ['NAKUBALI', 'consent', true], ['i agree', 'consent', true], ['ndio', 'consent', true], ['habari', 'consent', false], ['nimeuza 5000', 'consent', false],
  ['FUTA DATA', 'deletion', 'request'], ['delete my data', 'deletion', 'request'], ['futa kabisa', 'deletion', 'confirm'],
  ['DELETE EVERYTHING', 'deletion', 'confirm'], ['futa', 'deletion', null], ['futa kabisa akaunti', 'deletion', null],
];
for (const [text, fn, expected] of priv) {
  const r = fn === 'consent' ? parseConsent(text) : parseDeletion(text);
  const ok = r === expected;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${fn} ${JSON.stringify(text).padEnd(33)} -> ${r}`);
}
const total = cases.length + multi.length + cmds.length + corr.length + conf.length + items.length + debts.length + dq.length + names.length + biz.length + rep.length + typos.length + 1 + dash.length + mmCases.length + priv.length;
console.log(`\n${total - fail}/${total} passed`);
process.exit(fail ? 1 : 0);
