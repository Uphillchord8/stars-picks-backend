// src/routes/leaderboard.js
const router = require('express').Router();

router.get('/', (req, res) => {
  res.json({ message: 'Leaderboard route placeholder' });
});

module.exports = router;
