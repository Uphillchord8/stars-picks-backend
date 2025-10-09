const cron   = require('node-cron');
const Game   = require('../models/game');
const Player = require('../models/players');
const fetch  = global.fetch || require('node-fetch');
const { fetchAndWriteGameResults } = require('./fetchGameResults');

const NHL_API_BASE    = process.env.NHL_API_BASE_URL || 'https://api-web.nhle.com/v1';
const STARS_TEAM_ABBR = 'DAL';
const STARS_TEAM_NAME = 'Dallas Stars';

const scheduleUrl = () => `${NHL_API_BASE}/club-schedule-season/${STARS_TEAM_ABBR}/now`;
const rosterUrl = () => `${NHL_API_BASE}/roster/${STARS_TEAM_ABBR}/current`;

async function syncGames() {
  const url = scheduleUrl();
  const res = await fetch(url);
  if (!res.ok) {
    console.error('❌ Schedule fetch failed:', await res.text());
    return;
  }

  const payload = await res.json();
  const gamesList = Array.isArray(payload.games) ? payload.games : [];
  if (!gamesList.length) return;

  const games = gamesList.map(g => ({
    gamePk:   g.gamePk || g.gameId || null,
    gameTime: new Date(g.startTimeUTC),
    homeTeam: g.homeTeam.abbrev,
    awayTeam: g.awayTeam.abbrev
  }));

  const ops = games.map(g => ({
    updateOne: {
      filter: { gamePk: g.gamePk, gameTime: g.gameTime, homeTeam: g.homeTeam, awayTeam: g.awayTeam },
      update: { $setOnInsert: g },
      upsert: true
    }
  }));

  const result = await Game.bulkWrite(ops);
  console.log(`✅ Games synced — upserted: ${result.upsertedCount}, modified: ${result.modifiedCount}`);

  // Update finished games missing results
  const finishedGames = await Game.find({
    gamePk: { $exists: true, $ne: null },
    gameTime: { $lt: new Date() },
    $or: [{ firstGoalPlayerId: null }, { gwGoalPlayerId: null }]
  }).limit(100).lean();

  for (const g of finishedGames) {
    await fetchAndWriteGameResults(g);
  }
}

async function syncPlayers() {
  const url = rosterUrl();
  const res = await fetch(url);
  if (!res.ok) {
    console.error('❌ Roster fetch failed:', await res.text());
    return;
  }
  const payload = await res.json();
  const rosterArr = [...(payload.forwards || []), ...(payload.defensemen || []), ...(payload.goalies || [])];
  if (!rosterArr.length) return;

  const players = rosterArr
    .filter(p => p.id && p.firstName?.default && p.lastName?.default)
    .map(p => ({
      playerId:      p.id,
      name:          `${p.firstName.default} ${p.lastName.default}`,
      position:      p.positionCode,
      sweaterNumber: p.jerseyNumber ? parseInt(p.jerseyNumber, 10) : null,
      team:          STARS_TEAM_NAME,
      pictureUrl:    p.headshot,
      active:        true
    }));

  const ops = players.map(p => ({
    updateOne: {
      filter: { playerId: p.playerId },
      update: { $set: p },
      upsert: true
    }
  }));

  const result = await Player.bulkWrite(ops);
  console.log(`✅ Players synced — upserted: ${result.upsertedCount}, modified: ${result.modifiedCount}`);
}

cron.schedule('0 2 * * *', async () => {
  console.log('🔄 NHL data sync job started');
  await syncGames();
  await syncPlayers();
});

(async () => {
  console.log('✨ Initial NHL sync');
  await new Promise(r => setTimeout(r, 1000));
  await syncGames();
  await syncPlayers();
})();