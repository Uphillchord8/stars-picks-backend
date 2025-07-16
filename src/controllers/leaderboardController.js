// src/controllers/leaderboardController.js
const Score = require('../models/Score');
const mongoose = require('mongoose');

exports.getLeaderboard = async (req, res, next) => {
  try {
    const { period = 'season' } = req.query;
    let startDate = new Date(0);
    const now = new Date();

    if (period === 'week') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    } else if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    }

    const leaderboard = await Score.aggregate([
      { $match: { awardedAt: { $gte: startDate } } },
      {
        $group: {
          _id: '$userId',
          totalPoints: { $sum: '$points' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $project: {
          _id: 0,
          userId: '$user._id',
          username: '$user.username',
          avatarUrl: '$user.avatarUrl',
          totalPoints: 1
        }
      },
      { $sort: { totalPoints: -1 } }
    ]);

    res.json(leaderboard);
  } catch (err) {
    next(err);
  }
};
