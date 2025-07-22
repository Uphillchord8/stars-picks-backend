// src/routes/players.js
const express = require('express');
const router  = express.Router();
const Player  = require('../models/players');

// GET /api/players
// Returns full list of players (public)
router.get('/', async (req, res, next) => {
  try {
    const players = await Player.find({}).lean();
    return res.json(players);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;