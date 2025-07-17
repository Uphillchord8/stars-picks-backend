const express = require('express');
const router = express.Router();
const db = require('../db');

// Get upcoming games
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM games WHERE is_active = TRUE ORDER BY game_time ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

module.exports = router;
