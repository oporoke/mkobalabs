// Mkoba ledger parser: Swahili/English free-text entries -> { type, direction, amount, confidence }

const TYPES = [
  { type: 'sale', direction: 'credit',
    re: /\b(?:(?:ni|tu|u|a)(?:me|li|na|ta)uz(?:a|ia)|nauza|mauzo|(?:ni|tu)(?:me|li)(?:pokea|pata)|sold|sale|sales|sell)\b/ },
  { type: 'purchase', direction: 'debit',
    re: /\b(?:(?:ni|tu|u|a)(?:me|li|na|ta)nunu(?:a|lia)|nanunua|manunuzi|ununuzi|bought|buy|purchased?)\b/ },
  { type: 'expense', direction: 'debit',
    re: /\b(?:(?:ni|tu|u|a)(?:me|li|na|ta)lip(?:a|ia)|(?:ni|tu)(?:me|li)tumia|gharama|matumizi|paid|spent|expenses?)\b/ },
];

const UNITS = { moja: 1, mbili: 2, tatu: 3, nne: 4, tano: 5, sita: 6, saba: 7, nane: 8, tisa: 9,
  kumi: 10, ishirini: 20, thelathini: 30, arobaini: 40, hamsini: 50, sitini: 60, sabini: 70, themanini: 80, tisini: 90 };
const MULTS = { mia: { v: 100, rank: 1 }, elfu: { v: 1000, rank: 2 }, laki: { v: 100000, rank: 3 }, milioni: { v: 1000000, rank: 4 } };

// "15,000" / "15.000" / "1.5" / "15000" -> number
function toNumber(s) {
  if (/^\d{1,3}(?:[,.]\d{3})+$/.test(s)) return parseFloat(s.replace(/[,.]/g, ''));
  return parseFloat(s.replace(/,/g, ''));
}

// Swahili number words, e.g. "elfu kumi na tano" = 15000, "elfu mbili na mia tano" = 2500
function parseWords(tokens) {
  let i = 0;
  const isMult = t => t in MULTS;
  function num(level) {
    let value = 0, seen = false;
    while (i < tokens.length) {
      const t = tokens[i];
      if (isMult(t) && MULTS[t].rank < level) {
        i++;
        const sub = num(MULTS[t].rank);
        value += MULTS[t].v * (sub || 1);
        seen = true;
      } else if (t in UNITS) { value += UNITS[t]; i++; seen = true; }
      else if (/^\d+$/.test(t) && seen === false && i > 0 && isMult(tokens[i - 1])) { value += +t; i++; seen = true; }
      else if (t === 'na') {
        if (level < 5 && isMult(tokens[i + 1])) break; // "na mia ..." belongs to the outer number
        i++;
      } else break;
    }
    return value;
  }
  return num(5);
}

function findAmounts(lower) {
  const out = []; // { value, strong }
  const NUM = '(\\d{1,3}(?:[,.]\\d{3})+|\\d+(?:\\.\\d+)?)';
  const CUR = '(?:tsh|tzs|shs?|shilingi|bob)';
  const patterns = [
    new RegExp(`\\b${CUR}\\.?\\s*${NUM}`, 'g'),          // TSh 15000
    new RegExp(`${NUM}\\s*(?:\\/=|\\/-|${CUR}\\b)`, 'g'), // 15000/=, 15000 tsh
  ];
  for (const re of patterns) for (const m of lower.matchAll(re)) out.push({ value: toNumber(m[1]), strong: true, at: m.index });

  for (const m of lower.matchAll(/\b(\d+(?:\.\d+)?)\s*(k|m)\b/g))          // 15k, 1.5m
    out.push({ value: parseFloat(m[1]) * (m[2] === 'k' ? 1e3 : 1e6), strong: true, at: m.index });

  for (const m of lower.matchAll(/\b\d{1,3}(?:,\d{3})+\b/g))                // 20,000 (formatted -> money)
    out.push({ value: toNumber(m[0]), strong: true, at: m.index });

  for (const m of lower.matchAll(/\b\d+(?:\.\d+)?\b/g))                     // any bare number
    out.push({ value: parseFloat(m[0]), strong: false, at: m.index });

  // Swahili word runs
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  for (let s = 0; s < tokens.length; s++) {
    if (!(tokens[s] in UNITS || tokens[s] in MULTS)) continue;
    let e = s;
    while (e + 1 < tokens.length) {
      const t = tokens[e + 1];
      if (t in UNITS || t in MULTS || t === 'na' || (/^\d+$/.test(t) && tokens[e] in MULTS)) e++; else break;
    }
    const run = tokens.slice(s, e + 1);
    while (run[run.length - 1] === 'na') run.pop();
    const value = parseWords(run);
    if (value) out.push({ value, strong: run.some(t => t in MULTS), at: s });
    s = e;
  }
  return out.filter(a => a.value > 0);
}

function parseLedgerEntry(text) {
  const lower = String(text || '').toLowerCase();

  const matched = TYPES.filter(t => t.re.test(lower));
  const kind = matched.length === 1 ? matched[0] : null;

  const amounts = findAmounts(lower);
  const strong = [...new Set(amounts.filter(a => a.strong).map(a => a.value))];
  const bare = [...new Set(amounts.filter(a => !a.strong).map(a => a.value))];

  let amount = null, amountScore = 0;
  if (strong.length === 1) { amount = strong[0]; amountScore = 1; }
  else if (strong.length > 1) { amount = Math.max(...strong); amountScore = 0.5; }   // several money values: ambiguous
  else if (bare.length === 1) { amount = bare[0]; amountScore = 0.9; }
  else if (bare.length > 1) { amount = Math.max(...bare); amountScore = 0.75; }      // e.g. "53 plates 15000"

  let confidence;
  if (matched.length > 1) confidence = 0.4;            // sale and purchase in one message
  else if (!kind || amount === null) confidence = 0.3;
  else confidence = +(0.95 * amountScore).toFixed(2);

  return {
    type: kind ? kind.type : 'unknown',
    direction: kind ? kind.direction : null,
    amount,
    confidence,
  };
}

module.exports = { parseLedgerEntry };