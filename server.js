// Cross-device placement sync server for 3D Eyewear Studio
// Storage: PostgreSQL (when DATABASE_URL env var is set) or local placements.json
const express = require('express');
const path = require('path');
const cors = require('cors');
const storage = require('./storage');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

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

// DELETE /api/placements/:key — remove a placement
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
});
