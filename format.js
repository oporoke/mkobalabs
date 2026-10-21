// Shared formatting for vendor-facing messages
const LABELS = { sale: 'mauzo', purchase: 'manunuzi', expense: 'matumizi' };
const fmtTsh = n => 'TSh ' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
const label = type => LABELS[type] || type;

module.exports = { LABELS, fmtTsh, capitalize, label };
