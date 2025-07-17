const mongoose = require('mongoose');
require('dotenv').config();

const Player = require('./src/models/players');
const Game   = require('./src/models/game');
const Pick   = require('./src/models/picks');
const User   = require('./src/models/user');



mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

async function seed() {
  try {
    await Promise.all([
      Player.deleteMany({}),
      Game.deleteMany({}),
      Pick.deleteMany({}),
      User.deleteMany({})
    ]);

    // Create Players
    const robertson = await Player.create({ name: 'Jason Robertson' });
    const hintz = await Player.create({ name: 'Roope Hintz' });
    const seguin = await Player.create({ name: 'Tyler Seguin' });

    // Create Users
    const cole = await User.create({ username: 'Cole', email: 'cole@example.com' });
    const alex = await User.create({ username: 'Alex', email: 'alex@example.com' });

    // Create Games
    const game1 = await Game.create({
      gameTime: new Date(),
      homeTeam: 'Dallas Stars',
      awayTeam: 'Colorado Avalanche',
      firstGoalPlayerId: robertson._id,
      gwGoalPlayerId: hintz._id,
      finalScore: '3-2',
      winner: 'Dallas Stars'
    });

    const game2 = await Game.create({
      gameTime: new Date(),
      homeTeam: 'Dallas Stars',
      awayTeam: 'Vegas Golden Knights',
      firstGoalPlayerId: seguin._id,
      gwGoalPlayerId: seguin._id,
      finalScore: '2-1',
      winner: 'Dallas Stars'
    });

    // Create Picks
    await Pick.create([
      {
        userId: cole._id,
        gameId: game1._id,
        firstGoalPlayerId: robertson._id,
        gwGoalPlayerId: hintz._id, // ✅ 3 pts
      },
      {
        userId: cole._id,
        gameId: game2._id,
        firstGoalPlayerId: robertson._id,
        gwGoalPlayerId: seguin._id, // ✅ 1 pt (GWG only)
      },
      {
        userId: alex._id,
        gameId: game1._id,
        firstGoalPlayerId: seguin._id,
        gwGoalPlayerId: hintz._id, // ✅ 1 pt (GWG only)
      }
    ]);

    console.log('✅ Seed complete');
    mongoose.disconnect();
  } catch (err) {
    console.error('❌ Seed failed:', err);
    mongoose.disconnect();
  }
}

seed();
