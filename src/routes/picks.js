// src/routes/picks.js
const express     = require('express');
const router      = express.Router();
const requireAuth = require('../middleware/auth');
const {
  upsertPick,
  getUserPicks,
  getPicksByGame
} = require('../controllers/picksController');

// GET /api/picks
// Returns all picks by the logged-in user
router.get('/', requireAuth, getUserPicks);

// POST /api/picks
// Create or update a pick for the logged-in user
router.post('/', requireAuth, upsertPick);

// GET /api/picks/game/:gameId
// Returns all users’ picks for a specific game
router.get('/game/:gameId', requireAuth, getPicksByGame);

module.exports = router;