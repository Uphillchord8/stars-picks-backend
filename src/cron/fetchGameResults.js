
// src/cron/fetchGameResults.js

const Game   = require('../models/game');
const Player = require('../models/players');

const NHL_API_BASE        = process.env.NHL_API_BASE_URL || 'https://api-web.nhle.com/v1';
const STARS_TEAM_CODE     = 'DAL';
const JAKE_OETTINGER_ID   = 8479979;
const CONCURRENCY_LIMIT   = Number(process.env.GAME_SYNC_CONCURRENCY || 2);
const MAX_RETRIES_429     = Number(process.env.GAME_SYNC_MAX_RETRIES || 5);
const FINAL_CACHE_CUTOFFH = Number(process.env.GAME_FINAL_CACHE_HOURS || 48);
const FORCE_RECOMPUTE_GWG = process.env.FORCE_RECOMPUTE_GWG === 'true';

// ---------------------------------------------------------------------------
// Throttled iteration helper
// ---------------------------------------------------------------------------
async function eachLimited(items, limit, handler) {
  const queue = Array.from(items);
  const running = new Set();
  while (queue.length || running.size) {
    while (queue.length && running.size < limit) {
      const item = queue.shift();
      const p = Promise.resolve()
        .then(() => handler(item))
        .finally(() => running.delete(p));
      running.add(p);
    }
    await Promise.race(running);
  }
}

// ---------------------------------------------------------------------------
// Fetch play-by-play with exponential backoff for 429
// ---------------------------------------------------------------------------
async function nhlGamePlayByPlay(gamePk, attempt = 1) {
  const url = `${NHL_API_BASE}/gamecenter/${gamePk}/play-by-play`;
  const res = await fetch(url);

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
    const delayMs = retryAfter > 0
      ? retryAfter * 1000
      : Math.min(16000, 1000 * 2 ** (attempt - 1));
    console.warn(`429 for ${gamePk}. Backing off ${delayMs}ms (attempt ${attempt})`);
    await new Promise(r => setTimeout(r, delayMs));
    if (attempt <= MAX_RETRIES_429) return nhlGamePlayByPlay(gamePk, attempt + 1);
    throw new Error(`NHL play-by-play fetch failed: 429 after ${attempt - 1} retries`);
  }

  if (!res.ok) throw new Error(`NHL play-by-play fetch failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Convert NHL numeric player ID to Mongoose ObjectId
// ---------------------------------------------------------------------------
async function convertExternalPlayerIdToObjectId(externalId) {
  if (!externalId) return null;
  const player = await Player.findOne({ playerId: externalId }).select('_id').lean();
  if (!player) console.warn(`No Player mapping for externalId=${externalId}`);
  return player ? player._id : null;
}

// ---------------------------------------------------------------------------
// Extract all goal plays from a play-by-play payload
// ---------------------------------------------------------------------------
function extractScoringPlays(payload) {
  return (payload.plays || []).filter(p => p.typeDescKey === 'goal');
}

// ---------------------------------------------------------------------------
// Get the scorer's NHL numeric player ID from a goal play
// ---------------------------------------------------------------------------
function getScorerExternalId(play) {
  return play?.details?.scoringPlayerId ?? null;
}

// ---------------------------------------------------------------------------
// Find the first Stars goal in the game.
// FIX: was using details.eventOwnerTeamId — correct field is details.scoringTeamId
// ---------------------------------------------------------------------------
function findFirstStarsGoal(scoringPlays, payload) {
  const starsTeamId = payload.awayTeam?.abbrev === STARS_TEAM_CODE
    ? payload.awayTeam?.id
    : payload.homeTeam?.id;

  return scoringPlays.find(p => p.details?.scoringTeamId === starsTeamId) || null;
}

// ---------------------------------------------------------------------------
// GWG by "losing final + 1" rule.
// Only ever called when Stars won — never runs on a loss.
// FIX: was using details.eventOwnerTeamId — correct field is details.scoringTeamId
// ---------------------------------------------------------------------------
function findGWGPlayByLosingTotal(scoringPlays, payload, homeCode, awayCode) {
  const finalHome = payload.homeTeam?.score;
  const finalAway = payload.awayTeam?.score;
  if (finalHome == null || finalAway == null) return null;

  const winningTeamCode  = finalHome > finalAway ? homeCode : awayCode;
  const losingFinalScore = Math.min(finalHome, finalAway);

  const sorted = [...(scoringPlays || [])].sort((a, b) => a.sortOrder - b.sortOrder);

  let winnerGoals = 0;
  for (const play of sorted) {
    if (play?.typeDescKey !== 'goal') continue;

    // FIX: scoringTeamId is the correct field for goal events
    const teamId   = play.details?.scoringTeamId;
    const teamCode =
      teamId === payload.homeTeam?.id ? homeCode :
      teamId === payload.awayTeam?.id ? awayCode : null;

    if (teamCode === winningTeamCode) {
      winnerGoals += 1;
      if (winnerGoals === losingFinalScore + 1) return play;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Safer ObjectId equality helpers
// ---------------------------------------------------------------------------
const asId = v =>
  v && typeof v === 'object' && v._id
    ? String(v._id)
    : (v != null ? String(v) : null);
const eqId = (a, b) => asId(a) === asId(b);

// ---------------------------------------------------------------------------
// Per-game processing
// ---------------------------------------------------------------------------
async function processSingleGame(gameDoc) {
  try {
    if (!gameDoc || !gameDoc.gamePk) {
      console.warn('Invalid gameDoc or missing gamePk');
      return;
    }

    // Skip future games
    if (!gameDoc.gameTime || new Date(gameDoc.gameTime) > new Date()) {
      console.log(`Skipping game ${gameDoc.gamePk}: not finished yet`);
      return;
    }

    // Skip already-final games beyond cache horizon unless forced
    const alreadyFinal    = gameDoc.finalScore && gameDoc.winner;
    const olderThanCutoff =
      (Date.now() - new Date(gameDoc.gameTime).getTime()) > (FINAL_CACHE_CUTOFFH * 3600 * 1000);
    if (alreadyFinal && olderThanCutoff && !FORCE_RECOMPUTE_GWG) {
      console.log(`Skip (cached final): ${gameDoc.gamePk}`);
      return;
    }

    // Fetch play-by-play with backoff
    const payload = await nhlGamePlayByPlay(gameDoc.gamePk);

    // Only process truly finished games
    const homeScore = payload.homeTeam?.score;
    const awayScore = payload.awayTeam?.score;
    const isFinal   = Number.isFinite(homeScore) && Number.isFinite(awayScore);
    if (!isFinal) {
      console.log(`Skipping (not final per payload): ${gameDoc.gamePk}`);
      return;
    }

    const scoringPlays = extractScoringPlays(payload).sort((a, b) => a.sortOrder - b.sortOrder);
    const update = {};

    // --- First Stars goal ---
    const firstStarsPlay = findFirstStarsGoal(scoringPlays, payload);
    if (firstStarsPlay) {
      const firstExternal = getScorerExternalId(firstStarsPlay);
      if (firstExternal) {
        const firstObjId = await convertExternalPlayerIdToObjectId(firstExternal);
        if (firstObjId) update.firstGoalPlayerId = firstObjId;
      }
    }

    // --- Final score and winner ---
    update.finalScore = `${homeScore}-${awayScore}`;
    update.winner     = homeScore > awayScore ? gameDoc.homeTeam : gameDoc.awayTeam;

    // --- GWG: FIX — only set when Stars actually won ---
    const starsWon =
      (gameDoc.homeTeam === STARS_TEAM_CODE && homeScore > awayScore) ||
      (gameDoc.awayTeam === STARS_TEAM_CODE && awayScore > homeScore);

    if (starsWon) {
      const endedInShootout = payload.gameOutcome?.lastPeriodType === 'SO';

      if (endedInShootout) {
        // Business rule: goalie gets GWG credit for SO wins
        const gwObjId = await convertExternalPlayerIdToObjectId(JAKE_OETTINGER_ID);
        if (gwObjId) update.gwGoalPlayerId = gwObjId;
      } else {
        const gwPlay     = findGWGPlayByLosingTotal(scoringPlays, payload, gameDoc.homeTeam, gameDoc.awayTeam);
        const gwExternal = gwPlay ? getScorerExternalId(gwPlay) : null;
        if (gwExternal) {
          const gwObjId = await convertExternalPlayerIdToObjectId(gwExternal);
          if (gwObjId) update.gwGoalPlayerId = gwObjId;
        }
      }
    } else {
      // Stars lost — clear any previously-stored bad GWG data
      update.gwGoalPlayerId = null;
    }

    // --- Only write if something actually changed ---
    const needsUpdate =
      (update.firstGoalPlayerId !== undefined && !eqId(gameDoc.firstGoalPlayerId, update.firstGoalPlayerId)) ||
      (update.gwGoalPlayerId    !== undefined && !eqId(gameDoc.gwGoalPlayerId,    update.gwGoalPlayerId))    ||
      (update.finalScore        && gameDoc.finalScore !== update.finalScore) ||
      (update.winner            && gameDoc.winner     !== update.winner);

    if (needsUpdate && Object.keys(update).length) {
      await Game.updateOne({ _id: gameDoc._id }, { $set: update });
      console.log(`DB updated: gamePk=${gameDoc.gamePk} winner=${update.winner} starsWon=${starsWon}`);
    } else {
      console.log(`No update needed: gamePk=${gameDoc.gamePk}`);
    }

  } catch (err) {
    console.error(`Final failure for ${gameDoc?.gamePk}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// MAIN JOB — fetch and score all Stars games in the DB
// ---------------------------------------------------------------------------
async function fetchAndWriteGameResults() {
  try {
    const allGames = await Game.find({
      $or: [
        { homeTeam: STARS_TEAM_CODE },
        { awayTeam: STARS_TEAM_CODE }
      ]
    }).sort({ gameTime: 1 });

    console.log(`Processing ${allGames.length} Stars games...`);
    await eachLimited(allGames, CONCURRENCY_LIMIT, processSingleGame);
    console.log('fetchAndWriteGameResults complete');
  } catch (err) {
    console.error('fetchAndWriteGameResults error:', err);
  }
}

module.exports = { fetchAndWriteGameResults };
