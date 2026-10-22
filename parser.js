// Mkoba ledger parser: Swahili/English free-text entries ->
// { type, direction, amount, confidence, item, quantity, unit }

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
const MULTS = { mia: { v: 100, rank: 1 }, elfu: { v: 1000, rank: 2 }, laki: { v: 100000, rank: 3 }, milioni: { v: 1000000, rank: 4 },
  // slang: buku/ngiri/thao = 1,000 ("buku tano" = 5,000), jero = 500 ("jero mbili" = 1,000)
  buku: { v: 1000, rank: 2 }, ngiri: { v: 1000, rank: 2 }, thao: { v: 1000, rank: 2 }, jero: { v: 500, rank: 1 } };

// Spelling variants of number words
const VARIANTS = { elf: 'elfu', elfuu: 'elfu', milion: 'milioni', million: 'milioni', laaki: 'laki',
  // passive verb forms: the vendor is the one paid / sent money / sold to
  nimelipwa: 'nimepokea', nililipwa: 'nimepokea', nimetumiwa: 'nimepokea', nilitumiwa: 'nimepokea',
  nimeuziwa: 'nimenunua', niliuziwa: 'nimenunua' };

// Typo tolerance for verbs: "nmeuza", "nimeuuza", "nimeuxa", "nimenunu" -> canonical form.
const CANON_VERBS = ['nimeuza', 'niliuza', 'tumeuza', 'tuliuza', 'nimeuzia', 'nauza', 'mauzo',
  'nimenunua', 'nilinunua', 'tumenunua', 'nanunua', 'manunuzi',
  'nimelipa', 'nililipa', 'tumelipa', 'nimetumia', 'nilitumia', 'matumizi', 'gharama',
  'bought', 'spent', 'purchased', 'expense'];
// Real words that are close to a verb but mean something else; never "correct" these.
const REAL_WORDS = new Set(['nimeona', 'nimeuma', 'nimelima', 'nimepita', 'nimelala', 'nimekula', 'nimefika', 'nimeamka',
  'nimechoka', 'nimeoga', 'nimeenda', 'nimekuja', 'nimeuliza', 'niliuliza', 'nimesema', 'nimeanza', 'nimepata', 'nimepokea',
  'nimetuma', 'nimelia', 'nililia', 'nimekaa', 'mauaji', 'gharika', 'spend', 'expensive',
  'nimepika', 'nilipika', 'nimepiga', 'nilipiga', 'nimeua', 'nimeleta', 'nimelewa', 'nimefunga', 'nimefungua', 'nimenuna',
  'nimeuguza', 'nimelinda', 'nimetumwa', 'nimekopa', 'nilikopa']);

// Optimal string alignment distance (Levenshtein + adjacent transpositions)
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function fixVerb(w) {
  if (w.length < 5 || REAL_WORDS.has(w) || CANON_VERBS.includes(w)) return w;
  const limit = w.length >= 8 ? 2 : 1;
  let best = null, bestDist = Infinity, tie = false;
  for (const c of CANON_VERBS) {
    const dist = editDistance(w, c);
    if (dist < bestDist) { best = c; bestDist = dist; tie = false; }
    else if (dist === bestDist) tie = true;
  }
  return bestDist <= limit && !tie ? best : w;
}

// Lowercase and fix known variants/typos word by word.
function normalize(text) {
  return String(text || '').toLowerCase().replace(/[a-z]+/g, w => VARIANTS[w] || fixVerb(w));
}

// Measurement units -> normalized name
const MEASURE = { kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', lita: 'l', litre: 'l', liter: 'l', litres: 'l', liters: 'l',
  ltr: 'l', l: 'l', gramu: 'g', gram: 'g', grams: 'g', g: 'g', pcs: 'pcs', pc: 'pcs', vipande: 'pcs', kipande: 'pcs' };
const MEASURE_WORDS = Object.keys(MEASURE).filter(w => w.length > 1).join('|'); // single letters only after a number
const MEASURE_ALL = Object.keys(MEASURE).join('|');

const FILLER = new Set(['kwa', 'ya', 'za', 'la', 'wa', 'cha', 'vya', 'leo', 'jana', 'na', 'tsh', 'tzs', 'sh', 'shs',
  'shilingi', 'bob', 'bei', 'jumla', 'for', 'at', 'of', 'the', 'a', 'an', 'worth', 'today', 'yesterday', 'total', 'k', 'm']);

function toNumber(s) {
  if (/^\d{1,3}(?:[,.]\d{3})+$/.test(s)) return parseFloat(s.replace(/[,.]/g, ''));
  return parseFloat(s.replace(/,/g, ''));
}

// Swahili number words, e.g. "elfu kumi na tano" = 15000, "elfu mbili na mia tano" = 2500,
// also without "na": "mia saba hamsini" = 750, "elfu mbili mia tano" = 2500
function parseWords(tokens) {
  let i = 0;
  const isMult = t => t in MULTS;
  function num(level) {
    const top = level === 5;
    let value = 0, seen = false, lastUnit = false;
    while (i < tokens.length) {
      const t = tokens[i];
      if (isMult(t) && MULTS[t].rank < level) {
        if (seen && !top) break;                 // "elfu mbili | mia tano": mia belongs to the outer number
        i++;
        const sub = num(MULTS[t].rank);
        value += MULTS[t].v * (sub || 1);
        seen = true; lastUnit = false;
      } else if (t in UNITS) {
        const v = UNITS[t];
        if (!top && seen && (v >= 10 || lastUnit)) break; // "mia saba | hamsini": tens after a digit start a new term
        value += v; i++; seen = true; lastUnit = v < 10;
      } else if (/^\d+$/.test(t) && !seen && i > 0 && isMult(tokens[i - 1])) { value += +t; i++; seen = true; }
      else if (t === 'na') {
        if (!top && isMult(tokens[i + 1])) break; // "na mia ..." belongs to the outer number
        i++;
      } else break;
    }
    return value;
  }
  return num(5);
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

// Quantities attached to a unit: "kilo 10", "10 kg", "10kg", "vipande 3"
function findMeasures(lower) {
  const out = [];
  for (const m of lower.matchAll(new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*(${MEASURE_ALL})\\b`, 'g')))
    out.push({ quantity: parseFloat(m[1]), unit: MEASURE[m[2]], start: m.index, end: m.index + m[0].length });
  for (const m of lower.matchAll(new RegExp(`\\b(${MEASURE_WORDS})\\s+(\\d+(?:\\.\\d+)?)\\b`, 'g')))
    out.push({ quantity: parseFloat(m[2]), unit: MEASURE[m[1]], start: m.index, end: m.index + m[0].length });
  return out;
}

// Number candidates with their character spans: { value, strong, start, end }
function findNumbers(lower) {
  const out = [];
  const add = (value, strong, start, len) => out.push({ value, strong, start, end: start + len });
  const NUM = '(\\d{1,3}(?:[,.]\\d{3})+|\\d+(?:\\.\\d+)?)';
  const CUR = '(?:tsh|tzs|shs?|shilingi|bob)';
  for (const re of [new RegExp(`\\b${CUR}\\.?\\s*${NUM}`, 'g'), new RegExp(`${NUM}\\s*(?:\\/=|\\/-|${CUR}\\b)`, 'g')])
    for (const m of lower.matchAll(re)) add(toNumber(m[1]), true, m.index, m[0].length);
  for (const m of lower.matchAll(/\b(\d+(?:\.\d+)?)\s*(k|m)\b/g))
    add(parseFloat(m[1]) * (m[2] === 'k' ? 1e3 : 1e6), true, m.index, m[0].length);
  for (const m of lower.matchAll(/\b\d{1,3}(?:,\d{3})+\b/g)) add(toNumber(m[0]), true, m.index, m[0].length);
  for (const m of lower.matchAll(/\b\d+(?:\.\d+)?\b/g)) add(parseFloat(m[0]), false, m.index, m[0].length);

  const toks = [...lower.matchAll(/[a-z0-9]+/g)];
  for (let s = 0; s < toks.length; s++) {
    const w = toks[s][0];
    if (!(w in UNITS || w in MULTS)) continue;
    let e = s;
    while (e + 1 < toks.length) {
      const t = toks[e + 1][0];
      if (t in UNITS || t in MULTS || t === 'na' || (/^\d+$/.test(t) && toks[e][0] in MULTS)) e++; else break;
    }
    while (e > s && toks[e][0] === 'na') e--;
    const run = toks.slice(s, e + 1).map(t => t[0]);
    const value = parseWords(run);
    if (value) add(value, run.some(t => t in MULTS), toks[s].index, toks[e].index + toks[e][0].length - toks[s].index);
    s = e;
  }
  return out.filter(a => a.value > 0);
}

function parseLedgerEntry(text) {
  const lower = normalize(text);

  const matched = TYPES.filter(t => t.re.test(lower));
  const kind = matched.length === 1 ? matched[0] : null;

  const measures = findMeasures(lower);
  // A number that is part of a measure ("kilo 10") is a quantity, never the amount.
  const numbers = findNumbers(lower).filter(n => !measures.some(m => overlaps(n, m)));
  const strong = [...new Set(numbers.filter(a => a.strong).map(a => a.value))];
  const bare = [...new Set(numbers.filter(a => !a.strong).map(a => a.value))];

  let amount = null, amountScore = 0;
  if (strong.length === 1) { amount = strong[0]; amountScore = 1; }
  else if (strong.length > 1) { amount = Math.max(...strong); amountScore = 0.5; }
  else if (bare.length === 1) { amount = bare[0]; amountScore = 0.9; }
  else if (bare.length > 1) { amount = Math.max(...bare); amountScore = 0.75; }

  let confidence;
  if (matched.length > 1) confidence = 0.4;
  else if (!kind || amount === null) confidence = 0.3;
  else confidence = +(0.95 * amountScore).toFixed(2);

  // Quantity: a measure, else the first remaining number that isn't the amount.
  const amountSpans = numbers.filter(n => n.value === amount);
  const rest = numbers.filter(n => n.value !== amount && !amountSpans.some(a => overlaps(n, a)))
    .sort((a, b) => a.start - b.start);
  let quantity = null, unit = null;
  if (measures.length) ({ quantity, unit } = measures[0]);
  else if (rest.length) quantity = rest[0].value;

  // Item: what's left after removing the verb, numbers, units and filler words.
  let itemText = lower;
  const blank = (start, end) => { itemText = itemText.slice(0, start) + ' '.repeat(end - start) + itemText.slice(end); };
  for (const t of TYPES) for (const m of lower.matchAll(new RegExp(t.re.source, 'g'))) blank(m.index, m.index + m[0].length);
  for (const s of [...measures, ...numbers]) blank(s.start, s.end);
  const words = (itemText.match(/[a-z]+/g) || []).filter(w => !FILLER.has(w) && !(w in MEASURE) && !(w in UNITS) && !(w in MULTS));
  const item = words.length ? words.join(' ').slice(0, 60) : null;

  return {
    type: kind ? kind.type : 'unknown',
    direction: kind ? kind.direction : null,
    amount,
    confidence,
    item,
    quantity,
    unit,
  };
}

// Split a message into one segment per entry: by line, then at each verb (nimeuza ... nimenunua ...).
function splitEntries(text) {
  const segments = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = normalize(rawLine);
    const lower = line;
    const starts = [];
    for (const t of TYPES) for (const m of lower.matchAll(new RegExp(t.re.source, 'g'))) starts.push(m.index);
    starts.sort((a, b) => a - b);
    const cuts = [0, ...starts.slice(1), line.length];
    for (let i = 0; i < cuts.length - 1; i++) {
      const seg = line.slice(cuts[i], cuts[i + 1]).replace(/^[\s,;.]+|[\s,;.]+$/g, '');
      if (seg) segments.push(seg);
    }
  }
  return segments;
}

function parseLedgerEntries(text) {
  return splitEntries(text).map(seg => ({ ...parseLedgerEntry(seg), text: seg }));
}

module.exports = { parseLedgerEntry, parseLedgerEntries, splitEntries, normalize };
