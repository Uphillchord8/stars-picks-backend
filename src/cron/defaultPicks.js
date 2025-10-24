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
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const fixedCutoffDate = new Date('2025-10-24T00:00:00Z'); // ⬅️ Fixed date for past game logic

    // 1️⃣ Default picks for upcoming games (within the next hour)
    const upcomingGames = await Game.find({
      isActive: true,
      gameTime: { $gte: now, $lte: oneHourFromNow }
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
      console.log(`✅ Applied ${filtered.length} default picks for upcoming games`);
    }

    // 2️⃣ Backfill picks for past games (before 10/24/2025) with null picks
    const pastGames = await Game.find({
      gameTime: { $lt: fixedCutoffDate }
    }).select('_id gamePk').lean();

    const pastToInsert = [];

    for (const game of pastGames) {
      for (const user of users) {
        pastToInsert.push({
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

    const pastExisting = await Pick.find({
      $or: pastToInsert.map(p => ({ userId: p.userId, gameId: p.gameId }))
    }).select('userId gameId firstGoalPlayerId gwGoalPlayerId').lean();

    const pastExistingMap = new Map(
      pastExisting.map(e => [`${e.userId}:${e.gameId}`, e])
    );

    const pastFiltered = pastToInsert.filter(p => {
      const existing = pastExistingMap.get(`${p.userId}:${p.gameId}`);
      return !existing || !existing.firstGoalPlayerId || !existing.gwGoalPlayerId;
    });

    if (pastFiltered.length) {
      await Pick.insertMany(pastFiltered, { ordered: false });
      console.log(`✅ Backfilled ${pastFiltered.length} default picks for past games`);
    }

    // 3️⃣ Past games missing scoring results
    const scoringGames = await Game.find({
      gameTime: { $lt: now },
      $or: [{ firstGoalPlayerId: null }, { gwGoalPlayerId: null }]
    }).limit(100).lean();

    for (const game of scoringGames) {
      try {
        console.log(`🔍 Processing gamePk ${game.gamePk}`);
        const result = await fetchAndWriteGameResults(game);
        if (result) {
          console.log(`✅ Scoring updated for gamePk ${game.gamePk}`, result);
        }
      } catch (err) {
        console.error(`❌ Failed to update gamePk ${game.gamePk}:`, err);
      }
    }

  } catch (err) {
    console.error('❌ defaultPicks cron error:', err);
  }
});