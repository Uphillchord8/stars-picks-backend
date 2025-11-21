import Game from '../models/game.js';
import Player from '../models/players.js';

const NHL_API_BASE = process.env.NHL_API_BASE_URL || 'https://api-web.nhle.com/v1';
const STARS_TEAM_CODE = 'DAL';
const JAKE_OETTINGER_ID = 8479979;

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

// Use eventOwnerTeamId instead of team.abbrev
function findFirstStarsGoal(scoringPlays, payload) {
  const starsTeamId = payload.awayTeam?.abbrev === STARS_TEAM_CODE
    ? payload.awayTeam?.id
    : payload.homeTeam?.id;
  return scoringPlays.find(p => p.details?.eventOwnerTeamId === starsTeamId) || null;
}

// GWG logic: first goal that created decisive lead never erased
function findGWGPlay(scoringPlays, payload, homeCode, awayCode) {
  const finalHome = payload.homeTeam?.score;
  const finalAway = payload.awayTeam?.score;
  if (finalHome == null || finalAway == null) return null;

  const winningTeamCode = finalHome > finalAway ? homeCode : awayCode;
  const losingFinalScore = Math.min(finalHome, finalAway);

  // Sort plays chronologically
  const sortedPlays = scoringPlays.sort((a, b) => a.sortOrder - b.sortOrder);

  let homeScore = 0;
  let awayScore = 0;

  for (let i = 0; i < sortedPlays.length; i++) {
    const play = sortedPlays[i];
    const teamId = play.details?.eventOwnerTeamId;
    const teamCode =
      teamId === payload.homeTeam?.id ? homeCode :
      teamId === payload.awayTeam?.id ? awayCode : null;

    // Update score after this goal
    if (teamCode === homeCode) homeScore++;
    else if (teamCode === awayCode) awayScore++;

    // Only consider goals by the winning team
    if (teamCode !== winningTeamCode) continue;

    // Check if this goal gives the winning team a lead
    if ((winningTeamCode === homeCode && homeScore <= awayScore) ||
        (winningTeamCode === awayCode && awayScore <= homeScore)) {
      continue; // No lead yet
    }

    // Simulate future goals to see if lead is erased (tie or overtaken)
    let tempHome = homeScore;
    let tempAway = awayScore;
    let leadErased = false;

    for (let j = i + 1; j < sortedPlays.length; j++) {
      const futurePlay = sortedPlays[j];
      const futureTeamId = futurePlay.details?.eventOwnerTeamId;
      const futureTeamCode =
        futureTeamId === payload.homeTeam?.id ? homeCode :
        futureTeamId === payload.awayTeam?.id ? awayCode : null;

      if (futureTeamCode === homeCode) tempHome++;
      else if (futureTeamCode === awayCode) tempAway++;

      // If scores become equal or opponent overtakes, lead is erased
      if ((winningTeamCode === homeCode && tempAway >= tempHome) ||
          (winningTeamCode === awayCode && tempHome >= tempAway)) {
        leadErased = true;
        break;
      }
    }

    if (!leadErased) {
      return play; // This is the GWG
    }
  }

  return null; // No GWG found
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
    }).sort({ gameTime: 1 }); // chronological order

    for (const gameDoc of allGames) {
      if (!gameDoc || !gameDoc.gamePk) {
        console.warn('Invalid gameDoc or missing gamePk');
        continue;
      }

      try {
        const payload = await nhlGamePlayByPlay(gameDoc.gamePk);
        const scoringPlays = extractScoringPlays(payload).sort((a, b) => a.sortOrder - b.sortOrder);
        const update = {};

        // First goal by DAL
        const firstStarsPlay = findFirstStarsGoal(scoringPlays, payload);
        let firstStarsObjId = null;
        if (firstStarsPlay) {
          const firstStarsExternal = getScorerExternalId(firstStarsPlay);
          if (firstStarsExternal) {
            firstStarsObjId = await convertExternalPlayerIdToObjectId(firstStarsExternal);
            if (firstStarsObjId) update.firstGoalPlayerId = firstStarsObjId;
          }
        }

        // Final score and winner
        const homeScore = payload.homeTeam?.score;
        const awayScore = payload.awayTeam?.score;
        if (homeScore !== undefined && awayScore !== undefined) {
          update.finalScore = `${homeScore}-${awayScore}`;
          update.winner = homeScore > awayScore ? gameDoc.homeTeam : gameDoc.awayTeam;
        }

        // GWG logic
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

        // Only update if any value is missing or incorrect
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