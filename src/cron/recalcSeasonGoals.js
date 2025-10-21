const cron     = require('node-cron');
const mongoose = require('mongoose');
const Game     = require('../models/game');
const Player   = require('../models/players');

// Runs nightly at 3:00 AM server time
cron.schedule('0 3 * * *', async () => {
  console.log('⏱️  Cron: Recalculating seasonGoals for all players');

  try {
    // 1) Aggregate total first goals per player across all finished games after Oct 8, 2025
    const cutoffDate = new Date('2025-10-08T00:00:00Z');

    const agg = await Game.aggregate([
      {
        $match: {
          firstGoalPlayerId: { $ne: null },
          gameTime: { $gt: cutoffDate }
        }
      },
      {
        $group: {
          _id: '$firstGoalPlayerId',
          goals: { $sum: 1 }
        }
      }
    ]);

    // 2) Build a map for quick lookup
    const goalMap = new Map(agg.map(entry => [entry._id.toString(), entry.goals]));

    // 3) Fetch all active Stars players (or remove filter to update all)
    const players = await Player.find({ active: true }).select('_id').lean();

    // 4) Bulk update each player’s seasonGoals
    const bulkOps = players.map(p => {
      const newCount = goalMap.get(p._id.toString()) || 0;
      return {
        updateOne: {
          filter: { _id: p._id },
          update: { seasonGoals: newCount }
        }
      };
    });

    if (bulkOps.length) {
      await Player.bulkWrite(bulkOps);
      console.log(`✅ Updated seasonGoals for ${bulkOps.length} players`);
    } else {
      console.log('ℹ️  No active players found to update');
    }

  } catch (err) {
    console.error('❌ Error in recalcSeasonGoals cron job:', err);
  }
});