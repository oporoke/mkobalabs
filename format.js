// Shared formatting for vendor-facing messages
const LABELS = { sale: 'mauzo', purchase: 'manunuzi', expense: 'matumizi' };
// Debt entries, described with the person's name
const DEBT_LABELS = {
  credit_given: n => `deni la ${n} (anadaiwa)`,
  credit_received: n => `deni lako kwa ${n}`,
  repayment_received: n => `malipo kutoka kwa ${n}`,
  repayment_made: n => `malipo kwa ${n}`,
};
const fmtTsh = n => 'TSh ' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
const label = type => LABELS[type] || type;

// "mauzo ya chips (10 kg)" — e: { type, item, quantity, unit }
function describe(e, cap = false) {
  const qty = e.quantity != null ? ` (${Number(e.quantity).toLocaleString('en-US', { maximumFractionDigits: 3 })}${e.unit ? ' ' + e.unit : ''})` : '';
  const text = e.counterparty && DEBT_LABELS[e.type]
    ? DEBT_LABELS[e.type](e.counterparty)
    : `${label(e.type)}${e.item ? ' ya ' + e.item : ''}${qty}`;
  return cap ? capitalize(text) : text;
}


// entries: [{ type, amount, item, quantity, unit }]
function savedMessage(entries) {
  if (entries.length === 1) return `Sawa! Nimeongeza ${describe(entries[0])} ${fmtTsh(entries[0].amount)}. Asante!`;
  return `Sawa! Nimeongeza:\n${listLines(entries)}\nAsante!`;
}
const listLines = entries => entries.map(e => `- ${describe(e, true)} ${fmtTsh(e.amount)}`).join('\n');

module.exports = { LABELS, fmtTsh, capitalize, label, describe, savedMessage, listLines };
