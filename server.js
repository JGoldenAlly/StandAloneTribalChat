'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!WEBHOOK_URL) {
  console.error('FATAL: WEBHOOK_URL environment variable is not set.');
  process.exit(1);
}

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint (used by Docker HEALTHCHECK)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Expose WEBHOOK_URL to the browser without embedding it in static files.
// index.html loads this as <script src="/config.js"></script>
app.get('/config.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`window.TRIBAL_CONFIG = ${JSON.stringify({ webhookUrl: WEBHOOK_URL })};`);
});

app.listen(PORT, () => {
  console.log(`Tribal chat running on port ${PORT}`);
  console.log(`Webhook target: ${WEBHOOK_URL}`);
});
