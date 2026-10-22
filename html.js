// Shared HTML helpers for the web pages (dashboard, admin): escaping, layout, styles.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `
:root{--paper:#F7F8FB;--rule:#D6DEEE;--ink:#1E2A55;--muted:#5B6585;--in:#0B7A5F;--out:#A23B2A;--margin:#C8423B;--focus:#2F5BEA}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif}
main{max-width:34rem;margin:0 auto;padding:20px 16px 48px}
h1{font-size:1.05rem;font-weight:600;margin:0}
h2{font-size:1rem;font-weight:650;margin:32px 0 10px}
a{color:var(--ink)}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.num{font-variant-numeric:tabular-nums}
.in{color:var(--in)} .out{color:var(--out)}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px}
.top form{margin:0}
.link-btn{background:none;border:0;padding:6px 0;font:inherit;color:var(--muted);text-decoration:underline;cursor:pointer}
.periods{display:flex;gap:6px;margin:22px 0 6px}
.periods a{flex:1;text-align:center;padding:8px 4px;border:1.5px solid var(--rule);border-radius:999px;text-decoration:none;color:var(--muted);font-size:.92rem}
.periods a[aria-current=page]{border-color:var(--ink);color:var(--ink);font-weight:600}
.hero{margin:18px 0 4px}
.hero .label{font-size:1rem;color:var(--muted)}
.hero .big{display:block;font-size:clamp(2.6rem,12vw,3.6rem);font-weight:750;line-height:1.05;letter-spacing:-.02em}
.breakdown{margin:14px 0 0;padding:0;list-style:none}
.breakdown li{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--rule)}
.chart{display:block;width:100%;height:auto;margin-top:4px}
.chart-note{font-size:.85rem;color:var(--muted);margin:4px 0 0}
.daftari{list-style:none;margin:0;padding:0 0 0 18px;border-left:2px solid var(--margin)}
.daftari li{display:grid;grid-template-columns:1fr auto;gap:2px 12px;padding:9px 0;border-bottom:1px solid var(--rule)}
.daftari .debt{color:var(--ink)}
.daftari .what{font-weight:550}
.daftari .when{grid-column:1;font-size:.82rem;color:var(--muted)}
.daftari .amt{grid-column:2;grid-row:1 / span 2;align-self:center;font-weight:650}
.empty{color:var(--muted);background:#fff;border:1.5px dashed var(--rule);border-radius:10px;padding:14px}
.debts{margin:0;padding:0;list-style:none}
.debts li{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--rule)}
.debt-group{font-size:.9rem;color:var(--muted);margin:12px 0 2px}
.card{background:#fff;border:1.5px solid var(--rule);border-radius:12px;padding:20px}
.btn{display:block;width:100%;padding:14px;border:0;border-radius:10px;background:var(--ink);color:#fff;font:inherit;font-weight:650;cursor:pointer}
table{width:100%;border-collapse:collapse;font-size:.9rem}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--rule);vertical-align:top}
th{color:var(--muted);font-weight:600}
td.r,th.r{text-align:right}
.wide{max-width:72rem}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(8rem,1fr));gap:10px;margin:16px 0}
table.days td:first-child{white-space:nowrap}
.stats div{background:#fff;border:1.5px solid var(--rule);border-radius:10px;padding:10px 12px}
.stats b{display:block;font-size:1.4rem}
.scroll{overflow-x:auto}
.facts{color:var(--muted);margin:0 0 8px}
.note{color:var(--muted);font-size:.85rem;margin:8px 0 0;max-width:60rem}
.bar{width:22%;min-width:80px}
.bar span{display:block;height:10px;border-radius:2px;background:var(--rule)}
td.msg{max-width:28rem;white-space:pre-wrap;word-break:break-word}
code{background:#fff;border:1px solid var(--rule);border-radius:4px;padding:1px 5px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

function page(title, body, { wide = false } = {}) {
  return `<!doctype html><html lang="sw"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body><main${wide ? ' class="wide"' : ''}>${body}</main></body></html>`;
}

// Security headers for every web page.
function secureHeaders(_req, res, next) {
  res.set({
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  next();
}

module.exports = { esc, page, secureHeaders };
