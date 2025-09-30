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

    // 1) Load picks & join game results & user info
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

    // 3) Tally points per user (keyed by userId)
    const scores = {}; // userId -> { id, username, avatarUrl, total_points, last_game_points, last_game_time }

    for (const p of valid) {
      if (!p.userId || !p.gameId) continue;

      const userId = p.userId._id.toString();
      const username = p.userId.username || 'Unknown';
      const avatarUrl = p.userId.avatarUrl || null;
      const game = p.gameId;

      const correctFirst = p.firstGoalPlayerId && game.firstGoalPlayerId
        && p.firstGoalPlayerId.toString() === game.firstGoalPlayerId.toString();

      const correctGWG = p.gwGoalPlayerId && game.gwGoalPlayerId
        && p.gwGoalPlayerId.toString() === game.gwGoalPlayerId.toString();

      const pts = correctFirst && correctGWG ? 3 : (correctFirst || correctGWG ? 1 : 0);

      if (!scores[userId]) {
        scores[userId] = {
          id: userId,
          username,
          avatarUrl,
          total_points: 0,
          last_game_points: 0,
          last_game_time: new Date(0)
        };
      }

      // add points
      scores[userId].total_points += pts;

      // update last_game_points if this game's time is more recent
      const gameTime = new Date(game.gameTime);
      if (gameTime > scores[userId].last_game_time) {
        scores[userId].last_game_time = gameTime;
        scores[userId].last_game_points = pts;
      }
    }

    // 4) Build sorted leaderboard array (strip internal last_game_time)
    const leaderboard = Object.values(scores)
      .map(u => ({
        id: u.id,
        username: u.username,
        avatarUrl: u.avatarUrl,
        total_points: u.total_points,
        last_game_points: u.last_game_points
      }))
      .sort((a, b) => b.total_points - a.total_points);

    return res.json(leaderboard);
  } catch (err) {
    console.error('LEADERBOARD ERROR:', err);
    return next(err);
  }
};