// src/scripts/cleanupAndRescore.js
//
// Run once to:
//   1. Clear gwGoalPlayerId on any game the Stars lost (bad data from old bug)
//   2. Force a full rescore of all games using the fixed logic
//
// Usage:
//   FORCE_RECOMPUTE_GWG=true node src/scripts/cleanupAndRescore.js

require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected.\n');

  const Game = require('../models/game');

  // -----------------------------------------------------------------------
  // Step 1: Clear gwGoalPlayerId on all games the Stars lost
  // -----------------------------------------------------------------------
  const badGames = await Game.find({
    winner: { $exists: true, $ne: null },
    $expr: { $ne: ['$winner', 'DAL'] },
    gwGoalPlayerId: { $ne: null }
  }).lean();

  if (badGames.length === 0) {
    console.log('No bad GWG records found — DB already clean.');
  } else {
    console.log(`Found ${badGames.length} games where Stars lost but had a GWG recorded:`);
    badGames.forEach(g =>
      console.log(`  gamePk=${g.gamePk}  winner=${g.winner}  finalScore=${g.finalScore}`)
    );

    const result = await Game.updateMany(
      {
        winner: { $exists: true, $ne: null },
        $expr: { $ne: ['$winner', 'DAL'] },
        gwGoalPlayerId: { $ne: null }
      },
      { $set: { gwGoalPlayerId: null } }
    );
    console.log(`Cleared gwGoalPlayerId on ${result.modifiedCount} games.\n`);
  }

  // -----------------------------------------------------------------------
  // Step 2: Force full rescore with the fixed logic
  //   FORCE_RECOMPUTE_GWG=true bypasses the 48h cache skip
  // -----------------------------------------------------------------------
  console.log('Starting full rescore (FORCE_RECOMPUTE_GWG=' + process.env.FORCE_RECOMPUTE_GWG + ')...\n');

  const { fetchAndWriteGameResults } = require('../cron/fetchGameResults');
  await fetchAndWriteGameResults();

  console.log('\nDone. Disconnecting...');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
