const express = require('express');
const router = express.Router();
const Pick = require('../models/picks');
const Game = require('../models/game');
const User = require('../models/user');

router.get('/', async (req, res) => {
  try {
    const picks = await Pick.find().populate('userId').populate('gameId');

    const scores = {};

    picks.forEach(pick => {
      const user = pick.userId.username;
      const game = pick.gameId;

      const correctFirst = pick.firstGoalPlayerId?.toString() === game.firstGoalPlayerId?.toString();
      const correctGWG = pick.gwGoalPlayerId?.toString() === game.gwGoalPlayerId?.toString();

      let points = 0;
      if (correctFirst && correctGWG) {
        points = 3;
      } else if (correctFirst || correctGWG) {
        points = 1;
      }

      if (!scores[user]) {
        scores[user] = 0;
      }

      scores[user] += points;
    });

    // Convert to array and sort
    const leaderboard = Object.entries(scores)
      .map(([username, total_points]) => ({ username, total_points }))
      .sort((a, b) => b.total_points - a.total_points);

    res.json(leaderboard);
  } catch (err) {
    console.error('Scoring error:', err);
    res.status(500).json({ error: 'Failed to calculate leaderboard' });
  }
});
