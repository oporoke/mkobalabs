// Shared formatting for vendor-facing messages
const { t } = require('./i18n');
const LABELS = t('sw').labels;

const fmtTsh = n => 'TSh ' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
const label = (type, lang = 'sw') => t(lang).labels[type] || type;

// "mauzo ya chips (10 kg)" — e: { type, item, quantity, unit }
function describe(e, cap = false, lang = 'sw') {
  const L = t(lang);
  const qty = e.quantity != null ? ` (${Number(e.quantity).toLocaleString('en-US', { maximumFractionDigits: 3 })}${e.unit ? ' ' + e.unit : ''})` : '';
  const text = e.counterparty && L.debtLabels[e.type]
    ? L.debtLabels[e.type](e.counterparty)
    : `${label(e.type, lang)}${e.item ? ` ${L.of} ${e.item}` : ''}${qty}`;
  return cap ? capitalize(text) : text;
}


// entries: [{ type, amount, item, quantity, unit }]
function savedMessage(entries, lang = 'sw') {
  if (entries.length === 1) return t(lang).savedOne(describe(entries[0], false, lang), fmtTsh(entries[0].amount));
  return t(lang).savedMany(listLines(entries, lang));
}
const listLines = (entries, lang = 'sw') => entries.map(e => `- ${describe(e, true, lang)} ${fmtTsh(e.amount)}`).join('\n');

module.exports = { LABELS, fmtTsh, capitalize, label, describe, savedMessage, listLines };
