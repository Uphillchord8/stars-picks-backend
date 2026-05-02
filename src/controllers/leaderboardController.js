// src/controllers/leaderboardController.js

const Pick = require('../models/picks');
const User = require('../models/user');
const Game = require('../models/game');

// Season boundaries — applied consistently across all period filters
const SEASON_START = new Date('2025-10-09T00:00:00Z'); // first regular season game
const SEASON_END   = new Date('2026-04-16T00:00:00Z'); // day after last regular season game

exports.getLeaderboard = async (req, res, next) => {
  try {
    const { period = 'season' } = req.query;
    const now = new Date();

    // Default: full regular season window
    let since = SEASON_START;
    let until = SEASON_END < now ? SEASON_END : now; // don't go past season end

    if (period === 'week') {
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      // still cap at season boundaries
      if (since < SEASON_START) since = SEASON_START;
      until = SEASON_END < now ? SEASON_END : now;
    } else if (period === 'month') {
      since = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      if (since < SEASON_START) since = SEASON_START;
      until = SEASON_END < now ? SEASON_END : now;
    }

    // 1) Load all users
    const users = await User.find({}, 'username avatarUrl').lean();

    // 2) Initialize scores for all users at zero
    const scores = {};
    for (const u of users) {
      const id = u._id.toString();
      scores[id] = {
        id,
        username:         u.username || 'Unknown',
        avatarUrl:        u.avatarUrl || null,
        total_points:     0,
        last_game_points: 0,
        last_game_time:   new Date(0),
      };
    }

    // 3) Load picks and join game results
    const picks = await Pick.find({})
      .populate('gameId', 'gameTime firstGoalPlayerId gwGoalPlayerId')
      .populate('userId', '_id')
      .lean();

    // Helper: normalize ObjectId or populated doc to string
    const getId = (v) => {
      if (!v) return null;
      if (typeof v === 'object' && v._id) return v._id.toString();
      return v.toString();
    };

    // 4) Filter to valid finished games within the season window and selected period
    const valid = picks.filter((p) => {
      const g = p.gameId;
      return (
        g &&
        g.gameTime >= since &&   // after period start (and never before season start)
        g.gameTime < until &&    // before period end (capped at season end)
        (g.firstGoalPlayerId != null || g.gwGoalPlayerId != null) &&
        p.userId
      );
    });

    // 5) Tally points
    for (const p of valid) {
      const userId = p.userId._id.toString();
      const game   = p.gameId;

      if (!scores[userId]) continue;

      const correctFirst =
        p.firstGoalPlayerId &&
        game.firstGoalPlayerId &&
        getId(p.firstGoalPlayerId) === getId(game.firstGoalPlayerId);

      const correctGWG =
        p.gwGoalPlayerId &&
        game.gwGoalPlayerId &&
        getId(p.gwGoalPlayerId) === getId(game.gwGoalPlayerId);

      // 3 pts for both correct, 1 pt for either correct, 0 for neither
      const pts = correctFirst && correctGWG ? 3 : (correctFirst || correctGWG ? 1 : 0);

      scores[userId].total_points += pts;

      // Track most recent game points
      const gameTime = new Date(game.gameTime);
      if (gameTime > scores[userId].last_game_time) {
        scores[userId].last_game_time   = gameTime;
        scores[userId].last_game_points = pts;
      }
    }

    // 6) Sort by total points descending
    const leaderboard = Object.values(scores)
      .map((u) => ({
        id:               u.id,
        username:         u.username,
        avatarUrl:        u.avatarUrl,
        total_points:     u.total_points,
        last_game_points: u.last_game_points,
      }))
      .sort((a, b) => b.total_points - a.total_points);

    return res.json(leaderboard);
  } catch (err) {
    console.error('LEADERBOARD ERROR:', err);
    return next(err);
  }
};