// src/controllers/picksController.js
const Pick = require('../models/picks');

exports.submitPicks = async (req, res, next) => {
  try {
    const { gameId, firstGoalPlayerId, gwGoalPlayerId } = req.body;
    const filter = { userId: req.user.id, gameId };
    const update = {
      firstGoalPlayerId,
      gwGoalPlayerId,
      isDefault: false,
      submittedAt: Date.now(),
    };
    const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
    const pick = await Pick.findOneAndUpdate(filter, update, opts);
    res.status(201).json(pick);
  } catch (err) {
    next(err);
  }
};

exports.getPicksByGame = async (req, res, next) => {
  try {
    const picks = await Pick.find({ gameId: req.params.gameId })
      .populate('userId', 'username avatarUrl')
      .populate('firstGoalPlayerId', 'name headshotUrl')
      .populate('gwGoalPlayerId', 'name headshotUrl');
    res.json(picks);
  } catch (err) {
    next(err);
  }
};
