// src/cron/syncGamesAndPlayers.js

const cron   = require('node-cron');
const Game   = require('../models/game');
const Player = require('../models/players');

const NHL_API_BASE    = process.env.NHL_API_BASE_URL || 'https://api-web.nhle.com/v1';
const STARS_TEAM_ABBR = 'DAL';
const STARS_TEAM_NAME = 'Dallas Stars';

// Browser-like headers to avoid Cloudflare blocks
const NHL_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json'
};

// Season boundaries — only sync regular season games
const SEASON_START     = new Date('2025-10-09T00:00:00Z');
const SEASON_END       = new Date('2026-04-16T00:00:00Z');

// Only sync regular season (2) and playoff (3) games — skip preseason (1)
const VALID_GAME_TYPES = new Set([2, 3]);

const scheduleUrl = () => `${NHL_API_BASE}/club-schedule-season/${STARS_TEAM_ABBR}/now`;
const rosterUrl   = () => `${NHL_API_BASE}/roster/${STARS_TEAM_ABBR}/current`;

async function syncGames() {
  try {
    const res = await fetch(scheduleUrl(), { headers: NHL_HEADERS });
    if (!res.ok) {
      console.error('❌ Schedule fetch failed:', res.status);
      return;
    }

    const payload   = await res.json();
    const gamesList = Array.isArray(payload.games) ? payload.games : [];
    if (!gamesList.length) {
      console.log('ℹ️  No games returned from schedule API');
      return;
    }

    // Filter to regular season/playoff games within season boundaries only
    const filteredGames = gamesList.filter(g => {
      if (!VALID_GAME_TYPES.has(g.gameType)) return false;
      const gameTime = new Date(g.startTimeUTC);
      return gameTime >= SEASON_START && gameTime <= SEASON_END;
    });

    console.log(`📅 Schedule: ${gamesList.length} total, ${filteredGames.length} within regular season window`);

    const games = filteredGames.map(g => {
      const gamePk = g.id || g.gamePk || null;
      if (!gamePk) console.warn('⚠️  Missing gamePk for game:', g);
      return {
        gamePk,
        gameTime: new Date(g.startTimeUTC),
        homeTeam: g.homeTeam?.abbrev,
        awayTeam: g.awayTeam?.abbrev
      };
    }).filter(g => g.gamePk);

    if (!games.length) {
      console.log('ℹ️  No games to sync after filtering');
      return;
    }

    // Upsert by gamePk to avoid duplicates
    const ops = games.map(g => ({
      updateOne: {
        filter: { gamePk: g.gamePk },
        update: {
          $set: {
            gamePk:   g.gamePk,
            homeTeam: g.homeTeam,
            awayTeam: g.awayTeam,
            gameTime: g.gameTime
          },
          $setOnInsert: { isActive: true }
        },
        upsert: true
      }
    }));

    const result = await Game.bulkWrite(ops);
    console.log(`✅ Games synced — upserted: ${result.upsertedCount}, modified: ${result.modifiedCount}`);

  } catch (err) {
    console.error('❌ syncGames error:', err.message);
  }
}

async function syncPlayers() {
  try {
    const res = await fetch(rosterUrl(), { headers: NHL_HEADERS });
    if (!res.ok) {
      console.error('❌ Roster fetch failed:', res.status);
      return;
    }

    const payload   = await res.json();
    const rosterArr = [
      ...(payload.forwards   || []),
      ...(payload.defensemen || []),
      ...(payload.goalies    || [])
    ];
    if (!rosterArr.length) {
      console.log('ℹ️  No roster players returned');
      return;
    }

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
  } catch (err) {
    console.error('❌ syncPlayers error:', err.message);
  }
}

// Schedule: daily at 2am
cron.schedule('0 2 * * *', async () => {
  console.log('🔄 Nightly NHL sync started');
  await syncGames();
  await syncPlayers();
});

// Startup: delay 10s to avoid colliding with the game results sync in server.js
(async () => {
  console.log('✨ Initial NHL sync (starting in 10s)...');
  await new Promise(r => setTimeout(r, 10000));
  await syncGames();
  await syncPlayers();
})();