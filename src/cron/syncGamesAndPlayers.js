// src/cron/syncGamesAndPlayers.js

const cron   = require('node-cron');
const Game   = require('../models/game');
const Player = require('../models/players');
const fetch  = global.fetch || require('node-fetch');

// Pull from env or fallback
const NHL_API_BASE   =
  process.env.NHL_API_BASE_URL ||
  'https://api-web.nhle.com/v1';
const STARS_TEAM_ID   = 'DAL';
const STARS_TEAM_NAME = 'Dallas Stars';

// Helper: YYYY-MM-DD (currently unused, but handy if you switch endpoints later)
function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// New endpoints
const scheduleUrl = () =>
  `${NHL_API_BASE}/club-schedule-season/${STARS_TEAM_ID}/now`;
const rosterUrl   = teamId =>
  `${NHL_API_BASE}/teams/${teamId}/roster`;

async function syncGames() {
  const url = scheduleUrl();
  console.log('🔗 Fetching games from:', url);

  const res = await fetch(url);
  if (!res.ok) {
    console.error('❌ Schedule fetch failed:', await res.text());
    return;
  }

  // Read payload once
  const payload = await res.json();
  console.log('🔍 schedule payload top-level keys:', Object.keys(payload));

  // Pull out the array of games
  const gamesList = Array.isArray(payload.games) ? payload.games : [];
  if (!gamesList.length) {
    console.log('ℹ️ No games found for today');
    return;
  }

  // Shape for Mongo
  const games = gamesList.map(g => ({
    gameTime: new Date(g.startTimeUTC),
    homeTeam: g.homeTeam.abbrev,
    awayTeam: g.awayTeam.abbrev
  }));

  // Bulk upsert
  const ops = games.map(g => ({
    updateOne: {
      filter: { gameTime: g.gameTime, homeTeam: g.homeTeam, awayTeam: g.awayTeam },
      update: { $setOnInsert: g },
      upsert: true
    }
  }));
  const result = await Game.bulkWrite(ops);
  console.log(`✅ Games synced — upserted: ${result.upsertedCount}, modified: ${result.modifiedCount}`);
}

async function syncPlayers() {
  const url = rosterUrl(STARS_TEAM_ID);
  console.log('🔗 Fetching roster from:', url);

  const res = await fetch(url);
  if (!res.ok) {
    console.error('❌ Roster fetch failed:', await res.text());
    return;
  }

  // The roster endpoint still returns { roster: [ … ] }
  const { roster } = await res.json();

  const players = roster.map(p => ({
    playerId:      p.person.id,
    name:          p.person.fullName,
    position:      p.position.abbreviation,
    sweaterNumber: parseInt(p.jerseyNumber, 10),
    team:          STARS_TEAM_NAME,
    pictureUrl:    `https://cms.nhl.bamgrid.com/images/headshots/current/168x168/${p.person.id}@2x.png`,
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

// Schedule & immediate run...
cron.schedule('0 2 * * *', async () => {
  console.log('🔄 NHL data sync job started');
  await syncGames();
  await syncPlayers();
});

(async () => {
  console.log('✨ Initial NHL sync');
  // give a second for DB connection
  await new Promise(r => setTimeout(r, 1000));
  await syncGames();
  await syncPlayers();
})();