// src/cron/syncGamesAndPlayers.js

const cron   = require('node-cron');
const Game   = require('../models/game');
const Player = require('../models/players');
const fetch  = global.fetch || require('node-fetch');

// ──────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────
const NHL_API_BASE     = process.env.NHL_API_BASE_URL
  || 'https://api-web.nhle.com/v1';

const STARS_TEAM_ABBR  = 'DAL';   // used for club‐schedule‐season endpoint
const STARS_TEAM_NAME  = 'Dallas Stars';

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────
function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

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

  // parse once
  const payload  = await res.json();
  console.log('🔍 schedule payload keys:', Object.keys(payload));

  // payload.games is the array of games
  const gamesList = Array.isArray(payload.games) ? payload.games : [];
  if (gamesList.length === 0) {
    console.log('ℹ️ No games found for today');
    return;
  }

  // map to our schema
  const games = gamesList.map(g => ({
    gameTime: new Date(g.startTimeUTC),
    homeTeam: g.homeTeam.abbrev,
    awayTeam: g.awayTeam.abbrev
  }));

  // bulk upsert
  const ops = games.map(g => ({
    updateOne: {
      filter:  { gameTime: g.gameTime, homeTeam: g.homeTeam, awayTeam: g.awayTeam },
      update:  { $setOnInsert: g },
      upsert:   true
    }
  }));

  const result = await Game.bulkWrite(ops);
  console.log(`✅ Games synced — upserted: ${result.upsertedCount}, modified: ${result.modifiedCount}`);
}

// ──────────────────────────────────────────────────────────
// Sync Players
// ──────────────────────────────────────────────────────────
async function syncPlayers() {
  const url = rosterUrl(); // → https://api-web.nhle.com/v1/roster/DAL/current
  const res = await fetch(url);
  if (!res.ok) {
    console.error('❌ Roster fetch failed:', await res.text());
    return;
  }

  const payload = await res.json();
  console.log('🔍 roster payload keys:', Object.keys(payload));

  // Flatten the three position arrays
  const rosterArr = [
    ...(payload.forwards   || []),
    ...(payload.defensemen || []),
    ...(payload.goalies    || [])

console.log('🔍 Sample roster entry:', JSON.stringify(rosterArr[0], null, 2)); 
 ];




  if (rosterArr.length === 0) {
    console.log('ℹ️ No players found');
    return;
  }

  const players = rosterArr.map(p => ({
    playerId:      p.person.id,
    name:          p.person.fullName,
    position:      p.position.abbreviation,
    sweaterNumber: parseInt(p.jerseyNumber, 10),
    team:           STARS_TEAM_NAME,
    pictureUrl:    `https://cms.nhl.bamgrid.com/images/headshots/current/168x168/${p.person.id}@2x.png`,
    active:        true
  }));




  const ops = players.map(p => ({
    updateOne: {
      filter:  { playerId: p.playerId },
      update:  { $set: p },
      upsert:   true
    }
  }));

  const result = await Player.bulkWrite(ops);
  console.log(`✅ Players synced — upserted: ${result.upsertedCount}, modified: ${result.modifiedCount}`);
}

// ──────────────────────────────────────────────────────────
// Schedule and Immediate Run
// ──────────────────────────────────────────────────────────
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