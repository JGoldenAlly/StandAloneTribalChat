'use strict';

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const app          = express();
const PORT         = process.env.PORT || 3000;
const WEBHOOK_URL  = process.env.WEBHOOK_URL;
const DATA_DIR     = process.env.DATA_DIR || path.join(__dirname, 'data');

if (!WEBHOOK_URL) {
  console.error('FATAL: WEBHOOK_URL environment variable is not set.');
  process.exit(1);
}

// Ensure the session data directory exists at startup
fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Session helpers ──────────────────────────────────────

function decodeJwtPayload(token) {
  try {
    const b64    = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch { return null; }
}

// Derive a stable user identifier from the JWT payload.
// Prefer a unique claim (sub, email, upn) over a display name.
function getUserId(req) {
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const p = decodeJwtPayload(token);
  if (!p) return null;
  return p.sub ?? p.email ?? p.upn ?? p.displayName ?? null;
}

// Hash the userId so user-supplied strings never appear in filenames.
function userFilePath(userId) {
  const hash = crypto.createHash('sha256').update(userId).digest('hex').slice(0, 32);
  return path.join(DATA_DIR, `${hash}.json`);
}

// In-memory cache avoids a disk read on every GET within a debounce window.
const sessionCache = new Map();  // userId → sessions array
const writeTimers  = new Map();  // userId → debounce timer handle

// Debounce disk writes: update the in-memory cache immediately, flush to disk
// after 1500 ms of inactivity for that user.
function scheduleSave(userId, data) {
  sessionCache.set(userId, data);
  if (writeTimers.has(userId)) clearTimeout(writeTimers.get(userId));
  writeTimers.set(userId, setTimeout(() => {
    writeTimers.delete(userId);
    fs.writeFile(userFilePath(userId), JSON.stringify(data), 'utf8', (err) => {
      if (err) console.error('Session write error for user hash:', err);
    });
  }, 1500));
}

// ── Session API ──────────────────────────────────────────

// GET /api/sessions — return this user's session array
app.get('/api/sessions', (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  // Serve from in-memory cache if available (handles rapid reloads)
  if (sessionCache.has(userId)) return res.json(sessionCache.get(userId));

  fs.readFile(userFilePath(userId), 'utf8', (err, raw) => {
    if (err) return res.json([]);   // no file yet → empty history
    try {
      const data = JSON.parse(raw);
      sessionCache.set(userId, data);
      res.json(Array.isArray(data) ? data : []);
    } catch { res.json([]); }
  });
});

// PUT /api/sessions — replace this user's session array
app.put('/api/sessions', (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Body must be an array' });

  scheduleSave(userId, req.body);
  res.sendStatus(204);
});

// ── Existing endpoints ───────────────────────────────────

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
  console.log(`Session data:   ${DATA_DIR}`);
});
