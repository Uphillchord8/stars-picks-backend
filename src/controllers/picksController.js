const Pick = require('../models/picks');
const Game = require('../models/game');

// Upsert a pick (create or update)
exports.upsertPick = async (req, res, next) => {
  try {
    const { gamePk, firstGoalPlayerId, gwGoalPlayerId } = req.body;

    // Find the game by its NHL gamePk
    const game = await Game.findOne({ gamePk }).lean();
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Prevent submissions within 5 minutes of start
    const msToStart = new Date(game.gameTime) - new Date();
    if (msToStart < 5 * 60 * 1000) {
      return res.status(403).json({ error: 'Picks locked 5 minutes before game start' });
    }

    // ✅ Safe debug log inside the function
    console.log('Upserting pick with:', {
      userId: req.user.id,
      gameId: game._id,
      gamePk,
      firstGoalPlayerId,
      gwGoalPlayerId
    });

    const filter = { userId: req.user.id, gamePk };
    const update = {
      gameId: game._id,
      gamePk,
      firstGoalPlayerId,
      gwGoalPlayerId,
      isDefault: false,
      submittedAt: Date.now()
    };
    const opts = { upsert: true, new: true, setDefaultsOnInsert: true };

    const pick = await Pick.findOneAndUpdate(filter, update, opts).lean();
    return res.status(201).json(pick);
  } catch (err) {
    console.error('PICKS ERROR:', err);
    return res.status(500).json({ error: 'Server Error' });
  }
};

// GET /api/picks
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