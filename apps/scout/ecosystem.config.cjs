/**
 * pm2 ecosystem for the AI Watchlist Scout.
 *
 * Runs as a long-lived daemon — refresh loop is internal (every 4h during
 * market hours by default). Persists watchlist.json which the gateway
 * exposes at /api/v1/scout/watchlist.
 */
module.exports = {
  apps: [
    {
      name: 'scout',
      script: './dist/main.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
      },
      out_file: './data/pm2-out.log',
      error_file: './data/pm2-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
