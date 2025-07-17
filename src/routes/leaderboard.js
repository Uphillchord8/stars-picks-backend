const express = require('express');
const router = express.Router();
const db = require('../db');

// Calculate scores per user
router.get('/', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT u.username, COUNT(*) AS total_points
      FROM picks p
      JOIN games g ON p.game_id = g.id
      JOIN users u ON p.user_id = u.id
      WHERE p.selected_team = g.winner
      GROUP BY u.username
      ORDER BY total_points DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

module.exports = router;
