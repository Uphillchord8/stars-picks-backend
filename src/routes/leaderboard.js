// src/routes/leaderboard.js

const express = require('express');
const router  = express.Router();
const { getLeaderboard } = require('../controllers/leaderboardController');

// GET /api/leaderboard
// Query params: period=week|month|season (defaults to season)
router.get('/', getLeaderboard);

module.exports = router;