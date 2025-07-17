const express = require('express');
const router = express.Router();
const db = require('../db');
const verifyToken = require('../middleware/verifyToken'); // ✅ Add this line

// ✅ Protected GET: Fetch picks for logged-in user
router.get('/', verifyToken, async (req, res) => {
  const userId = req.userId;

  try {
    const result = await db.query('SELECT * FROM picks WHERE user_id = $1', [userId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch picks' });
  }
});

// ✅ Public POST: Submit a new pick
router.post('/', async (req, res) => {
  const { user_id, game_id, selected_team } = req.body;

  try {
    await db.query(
      'INSERT INTO picks (user_id, game_id, selected_team) VALUES ($1, $2, $3)',
      [user_id, game_id, selected_team]
    );
    res.status(201).json({ message: 'Pick submitted!' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit pick' });
  }
});

module.exports = router;
