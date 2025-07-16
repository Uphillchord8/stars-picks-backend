// src/cron/assignDefaults.js
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Game = require('../models/Game');
const Pick = require('../models/Pick');

async function assignDefaults() {
  await mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true, useUnifiedTopology: true
  });

  const now = new Date();
  const inFiveMin = new Date(now.getTime() + 5 * 60000);

  // find games starting in the next 5 minutes
  const upcomingGames = await Game.find({
    status: 'scheduled',
    date: { $gte: now, $lte: inFiveMin }
  });

  for (let game of upcomingGames) {
    const users = await User.find({});
    for (let user of users) {
      const exists = await Pick.findOne({ userId: user._id, gameId: game._id });
      if (!exists && user.defaultFirstGoalPick && user.defaultGwGoalPick) {
        await Pick.create({
          userId: user._id,
          gameId: game._id,
          firstGoalPlayerId: user.defaultFirstGoalPick,
          gwGoalPlayerId: user.defaultGwGoalPick,
          isDefault: true,
        });
      }
    }
  }

  console.log('✔ Defaults assigned');
  process.exit(0);
}

assignDefaults().catch(err => {
  console.error(err);
  process.exit(1);
});
