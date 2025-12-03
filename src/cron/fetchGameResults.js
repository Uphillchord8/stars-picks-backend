import Game from '../models/game.js';
import Player from '../models/players.js';

const NHL_API_BASE = process.env.NHL_API_BASE_URL || 'https://api-web.nhle.com/v1';
const STARS_TEAM_CODE = 'DAL';
const JAKE_OETTINGER_ID = 8479979;

// Helper: Get start of today in UTC
function getStartOfTodayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

// Fetch play-by-play for a gamePk
async function nhlGamePlayByPlay(gamePk) {
  const url = `${NHL_API_BASE}/gamecenter/${gamePk}/play-by-play`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NHL play-by-play fetch failed: ${res.status}`);
  return res.json();
}

async function convertExternalPlayerIdToObjectId(externalId) {
  if (!externalId) return null;
  const player = await Player.findOne({ playerId: externalId }).select('_id').lean();
  return player ? player._id : null;
}

function extractScoringPlays(payload) {
  return (payload.plays || []).filter(p => p.typeDescKey === 'goal');
}

function getScorerExternalId(play) {
  return play?.details?.scoringPlayerId ?? null;
}

function findFirstStarsGoal(scoringPlays, payload) {
  const starsTeamId = payload.awayTeam?.abbrev === STARS_TEAM_CODE
    ? payload.awayTeam?.id
    : payload.homeTeam?.id;
  return scoringPlays.find(p => p.details?.eventOwnerTeamId === starsTeamId) || null;
}


// Fetch GWG
function findGWGPlayByLosingTotal(scoringPlays, payload, homeCode, awayCode) {
  const finalHome = payload.homeTeam?.score;
  const finalAway = payload.awayTeam?.score;
  if (finalHome == null || finalAway == null) return null;

  // Which team won?
  const winningTeamCode = finalHome > finalAway ? homeCode : awayCode;

  // GWG is the (losing score + 1)-th goal by the winner
  const losingFinalScore = Math.min(finalHome, finalAway);

  // Sort chronologically
  const sortedPlays = (scoringPlays || []).sort((a, b) => a.sortOrder - b.sortOrder);

  let winnerGoalCount = 0;
  for (const play of sortedPlays) {
    if (play?.typeDescKey !== 'goal') continue;

    const teamId   = play.details?.eventOwnerTeamId;
    const teamCode =
      teamId === payload.homeTeam?.id ? homeCode :
      teamId === payload.awayTeam?.id ? awayCode : null;

    if (teamCode === winningTeamCode) {
      winnerGoalCount += 1;
      if (winnerGoalCount === losingFinalScore + 1) {
        // This play is the GWG by your rule
        return play;
      }
    }
  }

  // If we didn’t find it (edge case), fall back to nothing
  return null;
}

// MAIN JOB: Check and update all games for DAL
export async function fetchAndWriteGameResults() {
  try {
    // Find all games for DAL (home or away)
    const allGames = await Game.find({
      $or: [
        { homeTeam: STARS_TEAM_CODE },
        { awayTeam: STARS_TEAM_CODE }
      ]
    }).sort({ gameTime: 1 });

    const todayUTC = getStartOfTodayUTC();

    for (const gameDoc of allGames) {
      if (!gameDoc || !gameDoc.gamePk) {
        console.warn('Invalid gameDoc or missing gamePk');
        continue;
      }

      // *** CHANGE: Only process games scheduled before today ***
      if (!gameDoc.gameTime || new Date(gameDoc.gameTime) >= todayUTC) {
        console.log(`Skipping game ${gameDoc.gamePk}: not finished (gameTime=${gameDoc.gameTime})`);
        continue;
      }

      try {
        const payload = await nhlGamePlayByPlay(gameDoc.gamePk);
        const scoringPlays = extractScoringPlays(payload).sort((a, b) => a.sortOrder - b.sortOrder);
        const update = {};

        const firstStarsPlay = findFirstStarsGoal(scoringPlays, payload);
        let firstStarsObjId = null;
        if (firstStarsPlay) {
          const firstStarsExternal = getScorerExternalId(firstStarsPlay);
          if (firstStarsExternal) {
            firstStarsObjId = await convertExternalPlayerIdToObjectId(firstStarsExternal);
            if (firstStarsObjId) update.firstGoalPlayerId = firstStarsObjId;
          }
        }

        const homeScore = payload.homeTeam?.score;
        const awayScore = payload.awayTeam?.score;
        if (homeScore !== undefined && awayScore !== undefined) {
          update.finalScore = `${homeScore}-${awayScore}`;
          update.winner = homeScore > awayScore ? gameDoc.homeTeam : gameDoc.awayTeam;
        }

        const starsWon =
          (gameDoc.homeTeam === STARS_TEAM_CODE && homeScore > awayScore) ||
          (gameDoc.awayTeam === STARS_TEAM_CODE && awayScore > homeScore);

        const endedInShootout =
          payload.shootoutInUse === true &&
          payload.gameOutcome?.lastPeriodType === 'SO';

        let gwObjId = null;
        if (starsWon && endedInShootout) {
          gwObjId = await convertExternalPlayerIdToObjectId(JAKE_OETTINGER_ID);
          if (gwObjId) update.gwGoalPlayerId = gwObjId;
        } else if (starsWon) {
          const gwPlay = findGWGPlay(scoringPlays, payload, gameDoc.homeTeam, gameDoc.awayTeam);
          const gwExternal = gwPlay ? getScorerExternalId(gwPlay) : null;
          if (gwExternal) {
            gwObjId = await convertExternalPlayerIdToObjectId(gwExternal);
            if (gwObjId) update.gwGoalPlayerId = gwObjId;
          }
        }

        const needsUpdate =
          (!gameDoc.firstGoalPlayerId || String(gameDoc.firstGoalPlayerId) !== String(firstStarsObjId)) ||
          (!gameDoc.gwGoalPlayerId || String(gameDoc.gwGoalPlayerId) !== String(gwObjId)) ||
          (!gameDoc.finalScore || gameDoc.finalScore !== update.finalScore) ||
          (!gameDoc.winner || gameDoc.winner !== update.winner);

        if (needsUpdate && Object.keys(update).length) {
          await Game.updateOne({ _id: gameDoc._id }, { $set: update });
          console.log(`✅ DB updated for gamePk: ${gameDoc.gamePk}`);
        } else {
          console.log(`No update needed for gamePk: ${gameDoc.gamePk}`);
        }
      } catch (err) {
        console.error('Error processing game:', gameDoc.gamePk, err);
      }
    }
  } catch (err) {
    console.error('fetchAndWriteGameResults error:', err);
  }
}

// Schedule to run daily at 00:00

cron.schedule('0 0 * * *', async () => {
  console.log('🔄 Game Stats sync job started');
  await fetchAndWriteGameResults();
});

// Run immediately on startup
(async () => {
  console.log('✨ Game Stats On Start Up sync');
  await new Promise(r => setTimeout(r, 1000));
  await fetchAndWriteGameResults();
})();
