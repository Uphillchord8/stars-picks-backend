const Pick = require('../models/picks');
const Game = require('../models/game');

// Upsert a pick (create or update)
exports.upsertPick = async (req, res, next) => {
  try {
    const { gamePk, firstGoalPlayerId, gwGoalPlayerId } = req.body;

    if (!req.user || !req.user.id) {
      console.error('❌ Missing req.user or req.user.id');
      return res.status(401).json({ error: 'Unauthorized: user not found' });
    }

    if (!gamePk || !firstGoalPlayerId || !gwGoalPlayerId) {
      console.error('❌ Missing required fields in request body:', req.body);
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const game = await Game.findOne({ gamePk }).lean();
    if (!game) {
      console.error('❌ Game not found for gamePk:', gamePk);
      return res.status(404).json({ error: 'Game not found' });
    }

    const msToStart = new Date(game.gameTime) - new Date();
    if (msToStart < 5 * 60 * 1000) {
      console.warn('⏳ Pick locked: game starts in less than 5 minutes');
      return res.status(403).json({ error: 'Picks locked 5 minutes before game start' });
    }

    const filter = { userId: req.user.id, gamePk };
    const update = {
      gameId: game._id,
      gamePk,
      firstGoalPlayerId,
      gwGoalPlayerId,
      isDefault: false,
      submittedAt: new Date()
    };
    const opts = { upsert: true, new: true, setDefaultsOnInsert: true };

    console.log('🔄 Upserting pick:', { filter, update });

    const pick = await Pick.findOneAndUpdate(filter, update, opts).lean();
    return res.status(201).json(pick);
  } catch (err) {
    console.error('🔥 PICKS ERROR:', err);
    return res.status(500).json({ error: 'Server Error' });
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