// Shared formatting for vendor-facing messages
const LABELS = { sale: 'mauzo', purchase: 'manunuzi', expense: 'matumizi' };
const fmtTsh = n => 'TSh ' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
const label = type => LABELS[type] || type;


// entries: [{ type, amount }]
function savedMessage(entries) {
  if (entries.length === 1) return `Sawa! Nimeongeza ${label(entries[0].type)} ${fmtTsh(entries[0].amount)}. Asante!`;
  return `Sawa! Nimeongeza:\n${listLines(entries)}\nAsante!`;
}
const listLines = entries => entries.map(e => `- ${capitalize(label(e.type))} ${fmtTsh(e.amount)}`).join('\n');

module.exports = { LABELS, fmtTsh, capitalize, label, savedMessage, listLines };
