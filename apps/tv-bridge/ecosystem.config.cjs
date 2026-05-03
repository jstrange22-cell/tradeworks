/**
 * pm2 ecosystem for the TradingView → TradeWorks Webhook bridge.
 *
 * Run from this directory (apps/tv-bridge):
 *   pnpm build && pm2 start ecosystem.config.cjs
 *   pm2 save                       # persist process list
 *   pm2 logs tv-bridge             # follow logs
 *
 * On Windows, also run pm2-startup once to register pm2 as a boot service:
 *   npm i -g pm2-windows-startup
 *   pm2-startup install
 *   pm2 save
 */
module.exports = {
  apps: [
    {
      name: 'tv-bridge',
      script: './dist/main.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        // Disable pino-pretty under pm2 — its transport worker sometimes loses
        // stdout when pm2 captures the stream, leaving the log file empty.
        // pm2 already adds timestamps via `time: true` below.
        PINO_PRETTY: 'false',
      },
      // Pino writes to stdout/stderr; pm2 captures to its own log files.
      out_file: './data/pm2-out.log',
      error_file: './data/pm2-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
