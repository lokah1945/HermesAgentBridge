module.exports = {
  apps: [
    {
      name: 'hermes-server',
      script: 'dist/server/index.js',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
