// Shared formatting for vendor-facing messages
const LABELS = { sale: 'mauzo', purchase: 'manunuzi', expense: 'matumizi' };
const fmtTsh = n => 'TSh ' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
const label = type => LABELS[type] || type;

// "mauzo ya chips (10 kg)" — e: { type, item, quantity, unit }
function describe(e, cap = false) {
  const qty = e.quantity != null ? ` (${Number(e.quantity).toLocaleString('en-US', { maximumFractionDigits: 3 })}${e.unit ? ' ' + e.unit : ''})` : '';
  const text = `${label(e.type)}${e.item ? ' ya ' + e.item : ''}${qty}`;
  return cap ? capitalize(text) : text;
}


// entries: [{ type, amount, item, quantity, unit }]
function savedMessage(entries) {
  if (entries.length === 1) return `Sawa! Nimeongeza ${describe(entries[0])} ${fmtTsh(entries[0].amount)}. Asante!`;
  return `Sawa! Nimeongeza:\n${listLines(entries)}\nAsante!`;
}
const listLines = entries => entries.map(e => `- ${describe(e, true)} ${fmtTsh(e.amount)}`).join('\n');

module.exports = { LABELS, fmtTsh, capitalize, label, describe, savedMessage, listLines };
