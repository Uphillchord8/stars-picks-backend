// src/cron/defaultPicks.js
const cron   = require('node-cron');
const Game   = require('../models/game');
const User   = require('../models/user');
const Pick   = require('../models/picks');

// Run every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  console.log('⏰ Cron: checking for default picks');

  try {
    const now      = new Date();
    const cutoff   = new Date(now.getTime() + 60 * 60 * 1000);
    // Only games starting in the next hour
    const games    = await Game.find({
      isActive: true,
      gameTime: { $gte: now, $lte: cutoff }
    }).select('_id').lean();

    if (!games.length) return;

    // Only users who set both defaults
    const users = await User.find({
      defaultFirstGoal: { $exists: true, $ne: null },
      defaultGWG:       { $exists: true, $ne: null }
    }).select('_id').lean();

    if (!users.length) return;

    const toInsert = [];

    for (const { _id: gameId } of games) {
      for (const { _id: userId } of users) {
        toInsert.push({
          userId,
          gameId,
          firstGoalPlayerId: users.find(u => u._id.equals(userId)).defaultFirstGoal,
          gwGoalPlayerId:    users.find(u => u._id.equals(userId)).defaultGWG,
          isDefault: true,
          submittedAt: new Date()
        });
      }
    }

    // Filter out any that already exist
    const existing = await Pick.find({
      $or: toInsert.map(p => ({ userId: p.userId, gameId: p.gameId }))
    }).select('userId gameId').lean();

    const existingSet = new Set(
      existing.map(e => `${e.userId}:${e.gameId}`)
    );

    const filtered = toInsert.filter(
      p => !existingSet.has(`${p.userId}:${p.gameId}`)
    );

    if (filtered.length) {
      await Pick.insertMany(filtered, { ordered: false });
      console.log(`✅ Applied ${filtered.length} default picks`);
    }

  } catch (err) {
    console.error('❌ defaultPicks cron error:', err);
  }
});