// Abstract placement storage — supports multiple backends
// - PostgreSQL when DATABASE_URL is set (cloud deployment)
// - JSON file when running locally (falls back to file)

const fs = require('fs');
const path = require('path');

const PLACEMENTS_FILE = path.join(__dirname, 'placements.json');

let pgPool = null; // PostgreSQL connection pool (lazy init)

// ─── PostgreSQL helpers ────────────────────────────────────────────────

async function getPgPool() {
  if (pgPool) return pgPool;
  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
  });
  // Create table if missing
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS placements (
      key   TEXT PRIMARY KEY,
      config JSONB NOT NULL
    );
  `);
  console.log('[storage] PostgreSQL connected, table ready');
  return pgPool;
}

function isPostgresConfigured() {
  return !!process.env.DATABASE_URL;
}

// ─── File helpers ──────────────────────────────────────────────────────

function loadFilePlacements() {
  try {
    if (fs.existsSync(PLACEMENTS_FILE)) {
      const raw = fs.readFileSync(PLACEMENTS_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('[storage] Failed to load placements file:', err.message);
  }
  return {};
}

function saveFilePlacements(placements) {
  try {
    fs.writeFileSync(PLACEMENTS_FILE, JSON.stringify(placements, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('[storage] Failed to save placements file:', err.message);
    return false;
  }
}

// ─── Public API ────────────────────────────────────────────────────────

// Get all placements
async function getAllPlacements() {
  if (isPostgresConfigured()) {
    try {
      const pool = await getPgPool();
      const result = await pool.query('SELECT key, config FROM placements');
      const obj = {};
      result.rows.forEach(row => { obj[row.key] = row.config; });
      return obj;
    } catch (err) {
      console.error('[storage] PostgreSQL getAll error:', err.message);
      return {};
    }
  }
  return loadFilePlacements();
}

// Get a single placement by key
async function getPlacement(key) {
  if (isPostgresConfigured()) {
    try {
      const pool = await getPgPool();
      const result = await pool.query('SELECT config FROM placements WHERE key = $1', [key]);
      return result.rows.length > 0 ? result.rows[0].config : null;
    } catch (err) {
      console.error('[storage] PostgreSQL get error:', err.message);
      return null;
    }
  }
  const placements = loadFilePlacements();
  return placements[key] || null;
}

// Save or update a placement
async function savePlacement(key, config) {
  if (isPostgresConfigured()) {
    try {
      const pool = await getPgPool();
      await pool.query(
        'INSERT INTO placements (key, config) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET config = $2',
        [key, JSON.stringify(config)]
      );
      return true;
    } catch (err) {
      console.error('[storage] PostgreSQL save error:', err.message);
      return false;
    }
  }
  const placements = loadFilePlacements();
  placements[key] = config;
  return saveFilePlacements(placements);
}

// Delete a placement
async function deletePlacement(key) {
  if (isPostgresConfigured()) {
    try {
      const pool = await getPgPool();
      await pool.query('DELETE FROM placements WHERE key = $1', [key]);
      return true;
    } catch (err) {
      console.error('[storage] PostgreSQL delete error:', err.message);
      return false;
    }
  }
  const placements = loadFilePlacements();
  if (placements[key]) {
    delete placements[key];
    return saveFilePlacements(placements);
  }
  return true;
}

module.exports = { getAllPlacements, getPlacement, savePlacement, deletePlacement, isPostgresConfigured };