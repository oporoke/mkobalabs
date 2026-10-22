// Entry point: load config, start the HTTP server, shut down gracefully.
require('dotenv').config({ quiet: true });
const log = require('./log');
const pool = require('./db');
const { app, state } = require('./app');

process.on('unhandledRejection', err => log.error('unhandled_rejection', { error: err?.message, stack: err?.stack }));

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const server = app.listen(PORT, HOST, () => {
  log.info('server_started', { host: HOST, port: PORT, pid: process.pid });
  if (process.send) process.send('ready'); // PM2 wait_ready: old instance is stopped only after this
});

// Graceful shutdown (PM2 reload/restart): stop accepting, finish in-flight work, then exit.
async function shutdown(signal) {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  log.info('shutdown_started', { signal, in_flight: state.inFlight, pid: process.pid });
  server.close();                // stop accepting new connections
  server.closeIdleConnections(); // drop idle keep-alive connections so clients reconnect to a live instance
  const deadline = Date.now() + 10000;
  while (state.inFlight > 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
  await pool.end().catch(() => {});
  log.info('shutdown_complete', { in_flight: state.inFlight, pid: process.pid });
  process.stdout.write('', () => process.exit(0)); // flush the log line before exiting
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
