// Cross-device placement sync server for 3D Eyewear Studio
// Storage: PostgreSQL (when DATABASE_URL env var is set) or local placements.json
const express = require('express');
const path = require('path');
const cors = require('cors');
const https = require('https');
const storage = require('./storage');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── API Routes (must be registered BEFORE express.static so POST requests aren't blocked) ──

// GET /api/placements — returns all saved placements
app.get('/api/placements', async (_req, res) => {
  try {
    const placements = await storage.getAllPlacements();
    res.json(placements);
  } catch (err) {
    console.error('[api] GET /placements error:', err.message);
    res.status(500).json({ error: 'Failed to load placements' });
  }
});

// GET /api/placements/:key — returns a single placement
app.get('/api/placements/:key', async (req, res) => {
  try {
    const placement = await storage.getPlacement(req.params.key);
    if (placement) {
      res.json(placement);
    } else {
      res.status(404).json({ error: 'Placement not found' });
    }
  } catch (err) {
    console.error('[api] GET /placements/:key error:', err.message);
    res.status(500).json({ error: 'Failed to load placement' });
  }
});

// POST /api/placements — save or update a placement (send { key, config })
app.post('/api/placements', async (req, res) => {
  const { key, config } = req.body;
  if (!key || !config) {
    return res.status(400).json({ error: 'Missing "key" or "config" in request body' });
  }
  try {
    const ok = await storage.savePlacement(key, config);
    if (ok) {
      res.json({ success: true, key });
    } else {
      res.status(500).json({ error: 'Failed to persist placement' });
    }
  } catch (err) {
    console.error('[api] POST /placements error:', err.message);
    res.status(500).json({ error: 'Failed to save placement' });
  }
});

// POST /api/chat — proxy OpenRouter API calls from the browser to avoid CORS / CSP issues
app.post('/api/chat', (req, res) => {
  const { apiKey, model, messages } = req.body;
  if (!apiKey || !model || !messages) {
    return res.status(400).json({ error: 'Missing "apiKey", "model", or "messages" in request body' });
  }

  const postData = JSON.stringify({ model, messages });

  const options = {
    hostname: 'openrouter.ai',
    port: 443,
    path: '/api/v1/chat/completions',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': req.get('origin') || 'https://pal-optical.com',
      'X-Title': '3D Eyewear Studio',
      'Content-Length': Buffer.byteLength(postData)
    },
    timeout: 30000
  };

  const proxyReq = https.request(options, (proxyRes) => {
    let body = '';
    proxyRes.on('data', (chunk) => { body += chunk; });
    proxyRes.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (proxyRes.statusCode !== 200) {
          console.error('[api] OpenRouter error:', proxyRes.statusCode, body.slice(0, 500));
          return res.status(proxyRes.statusCode).json({
            error: data.error?.message || `OpenRouter returned status ${proxyRes.statusCode}`,
            detail: data
          });
        }
        res.json(data);
      } catch (parseErr) {
        console.error('[api] Failed to parse OpenRouter response:', parseErr.message, body.slice(0, 200));
        res.status(502).json({ error: 'Invalid response from OpenRouter API' });
      }
    });
  });

  proxyReq.on('error', (err) => {
    console.error('[api] POST /chat proxy error:', err.message);
    res.status(502).json({ error: 'Failed to reach OpenRouter API. Please check your network connection.' });
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.status(504).json({ error: 'OpenRouter API request timed out' });
  });

  proxyReq.write(postData);
  proxyReq.end();
});

// ── Static Files (must be AFTER API routes so POST requests reach the routes) ──
app.use(express.static(path.join(__dirname)));

app.delete('/api/placements/:key', async (req, res) => {
  try {
    const placement = await storage.getPlacement(req.params.key);
    if (!placement) {
      return res.status(404).json({ error: 'Placement not found' });
    }
    await storage.deletePlacement(req.params.key);
    res.json({ success: true });
  } catch (err) {
    console.error('[api] DELETE /placements/:key error:', err.message);
    res.status(500).json({ error: 'Failed to delete placement' });
  }
});

app.listen(PORT, () => {
  const backend = storage.isPostgresConfigured() ? 'PostgreSQL' : 'local placements.json';
  console.log(`Eyewear Studio sync server running on http://localhost:${PORT}`);
  console.log(`Storage backend: ${backend}`);
  console.log('[api] Routes registered: GET/POST /api/placements, GET/DELETE /api/placements/:key, POST /api/chat');
});
