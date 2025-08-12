// src/cron/syncGamesAndPlayers.js
const cron   = require('node-cron');
const Game   = require('../models/game');
const Player = require('../models/players');
const fetch  = global.fetch || require('node-fetch');

// Pull from env or fallback
const NHL_API_BASE   =
  process.env.NHL_API_BASE_URL ||
  'https://api-web.nhle.com/v1';
const STARS_TEAM_ID   = '25';
const STARS_TEAM_NAME = 'Dallas Stars';

// Helper: YYYY-MM-DD
function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// Build endpoints on the new API
const scheduleUrl = date =>
  `${NHL_API_BASE}/schedule/${date}`;
const rosterUrl = teamId =>
  `${NHL_API_BASE}/teams/${teamId}/roster`;

async function syncGames() {
  const today = isoDate(0);
  const url   = scheduleUrl(today);

  console.log('🔗 Fetching games from:', url);
  const res       = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    console.error('❌ Schedule fetch failed:', text);
    return;
  }

  // Now gamesList is an array, not { dates }
  const gamesList = await res.json();
  // Example game object: 
  // { gameDate: '2025-08-12T23:00:00Z', teams: { home: { team: { name: 'DAL' }}, away: {...} }, ... }

  const games = gamesList.map(g => ({
    gameTime: new Date(g.gameDate),
    homeTeam: g.teams.home.team.name,
    awayTeam: g.teams.away.team.name
  }));

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
    const text = await res.text();
    console.error('❌ Roster fetch failed:', text);
    return;
  }

  // The new roster endpoint still returns { roster: [ ...players ] }
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
  await new Promise(r => setTimeout(r, 1000));
  await syncGames();
  await syncPlayers();
})();