
// src/controllers/leaderboardController.js
const Pick = require('../models/picks');
const User = require('../models/user'); // ensure this path is correct in your project
const Game = require('../models/game');

exports.getLeaderboard = async (req, res, next) => {
  try {
    const { period = 'season' } = req.query;
    const now = new Date();
    let since = new Date(0); // default to beginning of time (season)

    if (period === 'week') {
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    } else if (period === 'month') {
      since = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    }

    // 1) Load all users first
    const users = await User.find({}, 'username avatarUrl').lean();

    // 2) Initialize scores object with all users (zeroed)
    // userId -> { id, username, avatarUrl, total_points, last_game_points, last_game_time }
    const scores = {};
    for (const u of users) {
      const id = u._id.toString();
      scores[id] = {
        id,
        username: u.username || 'Unknown',
        avatarUrl: u.avatarUrl || null,
        total_points: 0,
        last_game_points: 0,
        last_game_time: new Date(0),
      };
    }

    // 3) Load picks & join game results we need
    const picks = await Pick.find({})
      .populate('gameId', 'gameTime firstGoalPlayerId gwGoalPlayerId')
      .populate('userId', '_id') // we only need id to attribute points
      .lean();

    // Helper: normalize possible ObjectId or populated doc to string id
    const getId = (v) => {
      if (!v) return null;
      if (typeof v === 'object' && v._id) return v._id.toString();
      return v.toString();
    };

    // 4) Filter to valid finished games within period
    // Patch A: allow scoring when either result is present (first OR gwg),
    // not only when both are present.
    const valid = picks.filter((p) => {
      const g = p.gameId;
      return (
        g &&
        g.gameTime >= since &&
        g.gameTime < now &&
        (g.firstGoalPlayerId != null || g.gwGoalPlayerId != null) &&
        p.userId // ensure pick has a user
      );
    });

    // 5) Tally points into existing scores entries
    for (const p of valid) {
      const userId = p.userId._id.toString();
      const game = p.gameId;

      // skip if the user in pick isn't in users list for some reason
      if (!scores[userId]) continue;

      // Safe, type-agnostic comparisons (ObjectId or populated doc)
      const correctFirst =
        p.firstGoalPlayerId &&
        game.firstGoalPlayerId &&
        getId(p.firstGoalPlayerId) === getId(game.firstGoalPlayerId);

      const correctGWG =
        p.gwGoalPlayerId &&
        game.gwGoalPlayerId &&
        getId(p.gwGoalPlayerId) === getId(game.gwGoalPlayerId);

      // 3 / 1 / 0 scoring (unchanged)
      const pts = correctFirst && correctGWG ? 3 : (correctFirst || correctGWG ? 1 : 0);

      scores[userId].total_points += pts;

      // update last_game_points if this game's time is more recent
      const gameTime = new Date(game.gameTime);
      if (gameTime > scores[userId].last_game_time) {
        scores[userId].last_game_time = gameTime;
        scores[userId].last_game_points = pts;
      }
    }

    // 6) Convert to array and sort by total_points desc
    const leaderboard = Object.values(scores)
      .map((u) => ({
        id: u.id,
        username: u.username,
        avatarUrl: u.avatarUrl,
        total_points: u.total_points,
        last_game_points: u.last_game_points,
      }))
      .sort((a, b) => b.total_points - a.total_points);

    return res.json(leaderboard);
  } catch (err) {
    console.error('LEADERBOARD ERROR:', err);
    return next(err);
  }
};
