const cron = require('node-cron');
const fetch = global.fetch || require('node-fetch');
const Game = require('../models/game');

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const STARS_TEAM_ABBR = 'DAL';
const TIMEZONE = 'America/Chicago';

async function notifyGameDay() {
  // Get current date in Central Time
  const nowCentral = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
  
  // Start and end of day in Central
  const startOfDayCentral = new Date(nowCentral);
  startOfDayCentral.setHours(0, 0, 0, 0);
  
  const endOfDayCentral = new Date(startOfDayCentral);
  endOfDayCentral.setDate(startOfDayCentral.getDate() + 1);

  // Convert to UTC for MongoDB query (do NOT wrap in new Date again)
  const startUTC = new Date(startOfDayCentral.toLocaleString('en-US', { timeZone: 'UTC' }));
  const endUTC = new Date(endOfDayCentral.toLocaleString('en-US', { timeZone: 'UTC' }));

  const game = await Game.findOne({
    homeTeam: STARS_TEAM_ABBR,
    gameTime: {
      $gte: startUTC,
      $lt: endUTC
    }
  });

  if (!game) {
    console.log('📭 No game today for DAL.');
    return;
  }

  const message = '🏒 GAME TODAY! MAKE YOUR PICKS! https://www.firstandgame.com';

  try {
    const res = await fetch(`https://discord.com/api/channels/${DISCORD_CHANNEL_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${DISCORD_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content: message })
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('❌ Discord message failed:', errorText);
    } else {
      console.log('✅ Discord message sent for gamePk:', game.gamePk);
    }
  } catch (err) {
    console.error('❌ Discord send error:', err);
  }
}

// Run daily at 7am Central Time (12pm UTC)
cron.schedule('0 12 * * *', async () => {
  console.log('🔔 Checking for game day (Central Time)...');
  await notifyGameDay();
});
