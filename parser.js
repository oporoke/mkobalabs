function parseLedgerEntry(text) {
  const lower = text.toLowerCase();
  const isSale = /nimeuza/.test(lower);
  const isPurchase = /nimenunua/.test(lower);
  const amountMatch = lower.match(/tsh?\s?([\d,]+)/i);
  const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;
  return {
    type: isSale ? 'sale' : isPurchase ? 'purchase' : 'unknown',
    direction: isSale ? 'credit' : 'debit',
    amount,
    confidence: amount && (isSale || isPurchase) ? 0.9 : 0.3
  };
}
module.exports = { parseLedgerEntry };
