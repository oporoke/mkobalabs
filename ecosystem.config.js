// PM2 config for mkoba-app (item 33). Start/update with: pm2 startOrReload ecosystem.config.js
module.exports = {
  apps: [{
    name: 'mkoba-app',
    script: 'index.js',
    cwd: __dirname,
    exec_mode: 'cluster',   // reload replaces instances one at a time: no downtime
    instances: 2,
    wait_ready: true,       // a new instance counts as up only after it calls process.send('ready')
    listen_timeout: 10000,
    kill_timeout: 15000,    // time for an old instance to finish in-flight messages (app waits up to 10s)
    max_memory_restart: '300M',
    env: { NODE_ENV: 'production' },
  }],
};
