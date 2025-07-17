const express = require('express');
const router = express.Router();
const db = require('../db');

// Get latest stats
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM player_stats ORDER BY game_id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

module.exports = router;
