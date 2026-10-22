// Structured logging: one JSON line per event. LOG_LEVEL = debug | info (default) | warn | error
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const min = LEVELS[process.env.LOG_LEVEL] || LEVELS.info;

function write(level, msg, fields = {}) {
  if (LEVELS[level] < min) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  (LEVELS[level] >= LEVELS.warn ? console.error : console.log)(line);
}

// Phone numbers in logs: keep only the last 4 digits.
const mask = phone => (phone ? '***' + String(phone).slice(-4) : undefined);

module.exports = {
  debug: (msg, f) => write('debug', msg, f),
  info: (msg, f) => write('info', msg, f),
  warn: (msg, f) => write('warn', msg, f),
  error: (msg, f) => write('error', msg, f),
  mask,
};
