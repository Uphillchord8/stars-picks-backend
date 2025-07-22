// src/controllers/leaderboardController.js

const Pick = require('../models/picks');
const Game = require('../models/game');

exports.getLeaderboard = async (req, res, next) => {
  try {
    const { period = 'season' } = req.query;
    const now = new Date();
    let since = new Date(0);

    if (period === 'week') {
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    } else if (period === 'month') {
      since = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    }

    // 1) Load picks & join game results
    const picks = await Pick.find()
      .populate('gameId', 'gameTime firstGoalPlayerId gwGoalPlayerId')
      .populate('userId', 'username avatarUrl')
      .lean();

    // 2) Filter by period & only finished games
    const valid = picks.filter(p => {
      const g = p.gameId;
      return (
        g &&
        g.gameTime >= since &&
        g.gameTime < now &&
        g.firstGoalPlayerId != null &&
        g.gwGoalPlayerId != null
      );
    });

    // 3) Tally points
    const scores = {};
    for (const p of valid) {
      const user   = p.userId.username;
      const game   = p.gameId;
      const correctFirst = p.firstGoalPlayerId.toString() === game.firstGoalPlayerId.toString();
      const correctGWG   = p.gwGoalPlayerId.toString()   === game.gwGoalPlayerId.toString();
      let    pts        = correctFirst && correctGWG ? 3 : (correctFirst || correctGWG ? 1 : 0);

      if (!scores[user]) {
        scores[user] = {
          username:         user,
          avatarUrl:        p.userId.avatarUrl || null,
          total_points:     0,
          last_game_points: null
        };
      }

      scores[user].total_points += pts;
      // first time we see them = most recent
      if (scores[user].last_game_points === null) {
        scores[user].last_game_points = pts;
      }
    }

    // 4) Sort & return
    const leaderboard = Object.values(scores).sort((a, b) => b.total_points - a.total_points);
    return res.json(leaderboard);

  } catch (err) {
    console.error('LEADERBOARD ERROR:', err);
    return next(err);
  }
};