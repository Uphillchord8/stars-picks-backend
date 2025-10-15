const cron = require('node-cron');
const Game = require('../models/game');
const User = require('../models/user');
const Pick = require('../models/picks');
const { fetchAndWriteGameResults } = require('./fetchGameResults');

// Run every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  console.log('⏰ Cron: checking for default picks and scoring updates');

  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() + 60 * 60 * 1000);

    // 1️⃣ Upcoming games for default picks
    const upcomingGames = await Game.find({
      isActive: true,
      gameTime: { $gte: now, $lte: cutoff }
    }).select('_id gamePk').lean();

    const users = await User.find({
      defaultFirstGoal: { $exists: true, $ne: null },
      defaultGWG: { $exists: true, $ne: null }
    }).select('_id defaultFirstGoal defaultGWG').lean();

    const toInsert = [];

    for (const game of upcomingGames) {
      for (const user of users) {
        toInsert.push({
          userId: user._id,
          gameId: game._id,
          gamePk: game.gamePk,
          firstGoalPlayerId: user.defaultFirstGoal,
          gwGoalPlayerId: user.defaultGWG,
          isDefault: true,
          submittedAt: new Date()
        });
      }
    }

    const existing = await Pick.find({
      $or: toInsert.map(p => ({ userId: p.userId, gameId: p.gameId }))
    }).select('userId gameId').lean();

    const existingSet = new Set(existing.map(e => `${e.userId}:${e.gameId}`));
    const filtered = toInsert.filter(p => !existingSet.has(`${p.userId}:${p.gameId}`));

    if (filtered.length) {
      await Pick.insertMany(filtered, { ordered: false });
      console.log(`✅ Applied ${filtered.length} default picks`);
    }

    // 2️⃣ Past games missing scoring results
    const pastGames = await Game.find({
      gameTime: { $lt: now },
      $or: [{ firstGoalPlayerId: null }, { gwGoalPlayerId: null }]
    }).limit(100).lean();

    for (const game of pastGames) {
      const result = await fetchAndWriteGameResults(game);
      if (result) {
        console.log(`✅ Scoring updated for gamePk ${game.gamePk}`, result);
      }
    }

  } catch (err) {
    console.error('❌ defaultPicks cron error:', err);
  }
});