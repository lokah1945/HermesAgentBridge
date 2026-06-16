module.exports = {
  apps: [
    {
      name: 'hermes-ilma',
      script: 'dist/server/index.js',
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
