// src/cron/syncGamesAndPlayers.js

const cron  = require('node-cron');
const Game  = require('../models/game');
const Player = require('../models/players');

// Pull from env or fallback
const NHL_API_BASE = process.env.NHL_API_BASE_URL
  || 'https://statsapi.web.nhl.com/api/v1';
const STARS_TEAM_ID = parseInt(process.env.STARS_TEAM_ID, 10) || 25;
const STARS_TEAM_NAME = 'Dallas Stars';

// Helper: YYYY-MM-DD
function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// Build endpoints
const scheduleUrl = (start, end) =>
  `${NHL_API_BASE}/schedule?startDate=${start}&endDate=${end}`;
const rosterUrl = teamId =>
  `${NHL_API_BASE}/teams/${teamId}/roster`;

async function syncGames() {
  const start = isoDate(0);
  const end   = isoDate(7);
  const res   = await fetch(scheduleUrl(start, end));
  const { dates } = await res.json();

  const games = dates.flatMap(day =>
    day.games.map(({ gameDate, teams }) => ({
      gameTime: new Date(gameDate),
      homeTeam: teams.home.team.name,
      awayTeam: teams.away.team.name
    }))
  );

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
  const res = await fetch(rosterUrl(STARS_TEAM_ID));
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

// Schedule: run daily at 2 AM
cron.schedule('0 2 * * *', async () => {
  console.log('🔄 NHL data sync job started');
  try {
    await syncGames();
    await syncPlayers();
  } catch (err) {
    console.error('❌ NHL data sync failed:', err);
  }
});

// Trigger immediately on startup (optional)
(async () => {
  console.log('✨ Initial NHL sync');
  setTimeout(async () => {
    try {
      await syncGames();
      await syncPlayers();
    } catch (err) {
      console.error(err);
    }
  }, 1000);
})();