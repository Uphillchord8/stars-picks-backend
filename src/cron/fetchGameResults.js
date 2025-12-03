
// src/cron/fetchGameResults.js (CommonJS)

const Game   = require('../models/game');
const Player = require('../models/players');

const NHL_API_BASE        = process.env.NHL_API_BASE_URL || 'https://api-web.nhle.com/v1';
const STARS_TEAM_CODE     = 'DAL';
const JAKE_OETTINGER_ID   = 8479979;
const CONCURRENCY_LIMIT   = Number(process.env.GAME_SYNC_CONCURRENCY || 2);
const MAX_RETRIES_429     = Number(process.env.GAME_SYNC_MAX_RETRIES || 5);
const FINAL_CACHE_CUTOFFH = Number(process.env.GAME_FINAL_CACHE_HOURS || 48);

// Helper: Get start of today in UTC (if needed elsewhere)
function getStartOfTodayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

// Throttled iteration helper
async function eachLimited(items, limit, handler) {
  const queue = Array.from(items);
  const running = new Set();
  while (queue.length || running.size) {
    while (queue.length && running.size < limit) {
      const item = queue.shift();
      const p = Promise.resolve().then(() => handler(item))
        .finally(() => running.delete(p));
      running.add(p);
    }
    await Promise.race(running);
  }
}

// Fetch play-by-play with exponential backoff for 429
async function nhlGamePlayByPlay(gamePk, attempt = 1) {
  const url = `${NHL_API_BASE}/gamecenter/${gamePk}/play-by-play`;
  const res = await fetch(url);

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
    const delayMs = retryAfter > 0 ? retryAfter * 1000
                                   : Math.min(16000, 1000 * 2 ** (attempt - 1)); // 1s..16s cap
    console.warn(`429 for ${gamePk}. Backing off ${delayMs}ms (attempt ${attempt})`);
    await new Promise(r => setTimeout(r, delayMs));
    if (attempt <= MAX_RETRIES_429) {
      return nhlGamePlayByPlay(gamePk, attempt + 1);
    }
    throw new Error(`NHL play-by-play fetch failed: 429 after ${attempt - 1} retries`);
  }

  if (!res.ok) throw new Error(`NHL play-by-play fetch failed: ${res.status}`);
  return res.json();
}

async function convertExternalPlayerIdToObjectId(externalId) {
  if (!externalId) return null;
  const player = await Player.findOne({ playerId: externalId }).select('_id').lean();
  if (!player) console.warn(`⚠️ No Player mapping for externalId=${externalId}`);
  return player ? player._id : null;
}

function extractScoringPlays(payload) {
  return (payload.plays || []).filter(p => p.typeDescKey === 'goal');
}

function getScorerExternalId(play) {
  return play?.details?.scoringPlayerId ?? null;
}

// First Stars goal (business rule retained as in your code; change if you want first goal of the game)
function findFirstStarsGoal(scoringPlays, payload) {
  const starsTeamId = payload.awayTeam?.abbrev === STARS_TEAM_CODE
    ? payload.awayTeam?.id
    : payload.homeTeam?.id;
  return scoringPlays.find(p => p.details?.eventOwnerTeamId === starsTeamId) || null;
}

// GWG by “losing final + 1” rule
function findGWGPlayByLosingTotal(scoringPlays, payload, homeCode, awayCode) {
  const finalHome = payload.homeTeam?.score;
  const finalAway = payload.awayTeam?.score;
  if (finalHome == null || finalAway == null) return null;

  const winningTeamCode  = finalHome > finalAway ? homeCode : awayCode;
  const losingFinalScore = Math.min(finalHome, finalAway);

  const sorted = (scoringPlays || []).sort((a, b) => a.sortOrder - b.sortOrder);

  let winnerGoals = 0;
  for (const play of sorted) {
    if (play?.typeDescKey !== 'goal') continue;
    const teamId   = play.details?.eventOwnerTeamId;
    const teamCode =
      teamId === payload.homeTeam?.id ? homeCode :
      teamId === payload.awayTeam?.id ? awayCode : null;

    if (teamCode === winningTeamCode) {
      winnerGoals += 1;
      if (winnerGoals === losingFinalScore + 1) {
        return play; // GWG under your rule
      }
    }
  }
  return null;
}

// Safer equality helpers
const asId = v => (v && typeof v === 'object' && v._id) ? String(v._id) : (v != null ? String(v) : null);
const eqId = (a, b) => asId(a) === asId(b);

// Per-game processing
async function processSingleGame(gameDoc) {
  try {
    if (!gameDoc || !gameDoc.gamePk) {
      console.warn('Invalid gameDoc or missing gamePk');
      return;
    }

    // Skip future games
    if (!gameDoc.gameTime || new Date(gameDoc.gameTime) > new Date()) {
      console.log(`Skipping game ${gameDoc.gamePk}: not finished (gameTime=${gameDoc.gameTime})`);
      return;
    }

    // Skip already-final games beyond cache horizon
    const alreadyFinal   = gameDoc.finalScore && gameDoc.winner;
    const olderThanCutoff = (Date.now() - new Date(gameDoc.gameTime).getTime()) > (FINAL_CACHE_CUTOFFH * 3600 * 1000);
    if (alreadyFinal && olderThanCutoff) {
      console.log(`✅ Skip (cached final): ${gameDoc.gamePk}`);
      return;
    }

    // Fetch payload with backoff
    const payload = await nhlGamePlayByPlay(gameDoc.gamePk);

    // Gate on finality from payload
    const homeScore = payload.homeTeam?.score;
    const awayScore = payload.awayTeam?.score;
    const isFinal   = Number.isFinite(homeScore) && Number.isFinite(awayScore);
    if (!isFinal) {
      console.log(`Skipping (not final per payload): ${gameDoc.gamePk}`);
      return;
    }

    const scoringPlays = extractScoringPlays(payload).sort((a, b) => a.sortOrder - b.sortOrder);
    const update = {};

    // First Stars goal (as implemented)
    const firstStarsPlay = findFirstStarsGoal(scoringPlays, payload);
    let firstStarsObjId = null;
    if (firstStarsPlay) {
      const firstStarsExternal = getScorerExternalId(firstStarsPlay);
      if (firstStarsExternal) {
        firstStarsObjId = await convertExternalPlayerIdToObjectId(firstStarsExternal);
        if (firstStarsObjId) update.firstGoalPlayerId = firstStarsObjId;
      }
    }

    // Final score & winner
    update.finalScore = `${homeScore}-${awayScore}`;
    update.winner     = homeScore > awayScore ? gameDoc.homeTeam : gameDoc.awayTeam;

    // GWG
    const starsWon =
      (gameDoc.homeTeam === STARS_TEAM_CODE && homeScore > awayScore) ||
      (gameDoc.awayTeam === STARS_TEAM_CODE && awayScore > homeScore);

    const endedInShootout =
      payload.shootoutInUse === true &&
      payload.gameOutcome?.lastPeriodType === 'SO';

    let gwObjId = null;
    if (starsWon && endedInShootout) {
      // Optional business rule: goalie credited as GWG in shootout
      gwObjId = await convertExternalPlayerIdToObjectId(JAKE_OETTINGER_ID);
      if (gwObjId) update.gwGoalPlayerId = gwObjId;
    } else {
      const gwPlay     = findGWGPlayByLosingTotal(scoringPlays, payload, gameDoc.homeTeam, gameDoc.awayTeam);
      const gwExternal = gwPlay ? getScorerExternalId(gwPlay) : null;
      if (gwExternal) {
        gwObjId = await convertExternalPlayerIdToObjectId(gwExternal);
        if (gwObjId) update.gwGoalPlayerId = gwObjId;
      }
    }

    // Only flag update when we actually have a changed value
    const needsUpdate =
      (update.firstGoalPlayerId && !eqId(gameDoc.firstGoalPlayerId, update.firstGoalPlayerId)) ||
      (update.gwGoalPlayerId    && !eqId(gameDoc.gwGoalPlayerId,    update.gwGoalPlayerId)) ||
      (update.finalScore        && gameDoc.finalScore !== update.finalScore) ||
      (update.winner            && gameDoc.winner     !== update.winner);

    if (needsUpdate && Object.keys(update).length) {
      await Game.updateOne({ _id: gameDoc._id }, { $set: update });
      console.log(`✅ DB updated for gamePk: ${gameDoc.gamePk}`);
    } else {
      console.log(`No update needed for gamePk: ${gameDoc.gamePk}`);
    }
  } catch (err) {
    console.error(`❌ Final failure for ${gameDoc?.gamePk}: ${err.message}`);
  }
}

// MAIN JOB: Check and update all games for DAL
async function fetchAndWriteGameResults() {
  try {
    // Find all games for DAL (home or away), oldest first
    const allGames = await Game.find({
      $or: [
        { homeTeam: STARS_TEAM_CODE },
        { awayTeam: STARS_TEAM_CODE }
      ]
    }).sort({ gameTime: 1 });

    // Throttle per run to avoid bursts
    await eachLimited(allGames, CONCURRENCY_LIMIT, processSingleGame);
  } catch (err) {
    console.error('fetchAndWriteGameResults error:', err);
  }
}

module.exports = { fetchAndWriteGameResults };
