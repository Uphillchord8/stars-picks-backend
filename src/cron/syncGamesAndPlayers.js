// src/cron/syncGamesAndPlayers.js

const cron   = require('node-cron');
const Game   = require('../models/game');
const Player = require('../models/players');
const fetch  = global.fetch || require('node-fetch');

// ──────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────
const NHL_API_BASE    = process.env.NHL_API_BASE_URL
  || 'https://api-web.nhle.com/v1';

const STARS_TEAM_ABBR = 'DAL';              // for /club-schedule-season
const STARS_TEAM_NAME = 'Dallas Stars';     // for DB entries

// ──────────────────────────────────────────────────────────
// Endpoints
// ──────────────────────────────────────────────────────────
const scheduleUrl = () =>
  `${NHL_API_BASE}/club-schedule-season/${STARS_TEAM_ABBR}/now`;

const rosterUrl = () =>
  `${NHL_API_BASE}/roster/${STARS_TEAM_ABBR}/current`;

// ──────────────────────────────────────────────────────────
// Sync Games
// ──────────────────────────────────────────────────────────
async function syncGames() {
  const url = scheduleUrl();
  console.log('🔗 Fetching games from:', url);

  const res = await fetch(url);
  if (!res.ok) {
    console.error('❌ Schedule fetch failed:', await res.text());
    return;
  }

  const payload = await res.json();
  console.log('🔍 schedule payload keys:', Object.keys(payload));

  const gamesList = Array.isArray(payload.games) ? payload.games : [];
  if (!gamesList.length) {
    console.log('ℹ️ No games found for today');
    return;
  }

  const games = gamesList.map(g => ({
    gameTime: new Date(g.startTimeUTC),
    homeTeam: g.homeTeam.abbrev,
    awayTeam: g.awayTeam.abbrev
  }));

  const ops = games.map(g => ({
    updateOne: {
      filter: { gameTime: g.gameTime, homeTeam: g.homeTeam, awayTeam: g.awayTeam },
      update: { $setOnInsert: g },
      upsert: true
    }
  }));

  const result = await Game.bulkWrite(ops);
  console.log(
    `✅ Games synced — upserted: ${result.upsertedCount}, modified: ${result.modifiedCount}`
  );
}

// ──────────────────────────────────────────────────────────
// Sync Players
// ──────────────────────────────────────────────────────────
async function syncPlayers() {
  const url = rosterUrl();
  console.log('🔗 Fetching roster from:', url);

  const res = await fetch(url);
  if (!res.ok) {
    console.error('❌ Roster fetch failed:', await res.text());
    return;
  }

  const payload = await res.json();
  console.log('🔍 roster payload keys:', Object.keys(payload));

  const rosterArr = [
    ...(payload.forwards   || []),
    ...(payload.defensemen || []),
    ...(payload.goalies    || [])
  ];

  if (!rosterArr.length) {
    console.log('ℹ️ No players found');
    return;
  }

  console.log(
    '🔍 Sample roster entry:',
    JSON.stringify(rosterArr[0], null, 2)
  );

  // Adapted mapping to the new fields
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
  console.log(
    `✅ Players synced — upserted: ${result.upsertedCount}, modified: ${result.modifiedCount}`
  );
}


// ──────────────────────────────────────────────────────────
// Schedule & Immediate Run
// ──────────────────────────────────────────────────────────
cron.schedule('0 2 * * *', async () => {
  console.log('🔄 NHL data sync job started');
  await syncGames();
  await syncPlayers();
});

(async () => {
  console.log('✨ Initial NHL sync');
  // slight delay to ensure Mongo connection is live
  await new Promise(r => setTimeout(r, 1000));
  await syncGames();
  await syncPlayers();
})();