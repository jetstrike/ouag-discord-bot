module.exports = {
  apps: [
    {
      name: 'ouag-discord-bot',
      script: 'src/index.js',
      watch: false,
      max_memory_restart: '300M',
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
