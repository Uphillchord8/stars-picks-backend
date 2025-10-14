const cron = require('node-cron');
const fetch = global.fetch || require('node-fetch');
const Game = require('../models/game');
const { WebhookClient } = require('discord.js'); // or use raw fetch if preferred

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const NHL_API_BASE = process.env.NHL_API_BASE_URL || 'https://api-web.nhle.com/v1';
const STARS_TEAM_ABBR = 'DAL';

async function notifyGameDay() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const game = await Game.findOne({
    homeTeam: STARS_TEAM_ABBR,
    gameTime: {
      $gte: today,
      $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
    }
  });

  if (!game) {
    console.log('No game today for DAL.');
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

// Run daily at 9am
cron.schedule('0 9 * * *', async () => {
  console.log('🔔 Checking for game day...');
  await notifyGameDay();
});