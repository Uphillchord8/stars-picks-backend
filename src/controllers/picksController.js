// src/controllers/picksController.js
const Pick = require('../models/picks');
const Game = require('../models/game');

// Upsert a pick (create or update)
exports.upsertPick = async (req, res, next) => {
  try {
    const { gameId, firstGoalPlayerId, gwGoalPlayerId } = req.body;

    // Prevent submissions within 5 minutes of start
    const game        = await Game.findById(gameId).lean();
    const msToStart   = new Date(game.gameTime) - new Date();
    if (msToStart < 5 * 60 * 1000) {
      return res.status(403).json({ error: 'Picks locked 5 minutes before game start' });
    }

    const filter = { userId: req.user.id, gameId };
    const update = {
      firstGoalPlayerId,
      gwGoalPlayerId,
      isDefault:    false,
      submittedAt:  Date.now()
    };
    const opts = { upsert: true, new: true, setDefaultsOnInsert: true };

    const pick = await Pick.findOneAndUpdate(filter, update, opts).lean();
    return res.status(201).json(pick);
  } catch (err) {
    console.error('PICKS ERROR:', err);
    return next(err);
  }
};

// GET /api/picks
// Returns all picks by the logged-in user
exports.getUserPicks = async (req, res, next) => {
  try {
    const picks = await Pick.find({ userId: req.user.id })
      .populate('gameId')
      .populate('firstGoalPlayerId')
      .populate('gwGoalPlayerId')
      .lean();
    return res.json(picks);
  } catch (err) {
    console.error('FETCH PICKS ERROR:', err);
    return next(err);
  }
};

// GET /api/picks/game/:gameId
// Returns all picks for a specific game (admin/viewing others)
exports.getPicksByGame = async (req, res, next) => {
  try {
    const picks = await Pick.find({ gameId: req.params.gameId })
      .populate('userId', 'username avatarUrl')
      .populate('firstGoalPlayerId', 'name')
      .populate('gwGoalPlayerId', 'name')
      .lean();
    return res.json(picks);
  } catch (err) {
    console.error('FETCH GAME PICKS ERROR:', err);
    return next(err);
  }
};