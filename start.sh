#!/bin/bash
# Install dependencies
npm install

# Compile TypeScript
npm run build

# Start Hermes Server via PM2
npx pm2 start pm2.config.js
