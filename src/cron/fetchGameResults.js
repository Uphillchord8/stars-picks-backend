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

function findFirstStarsGoal(scoringPlays) {
  return scoringPlays.find(p => p.team?.abbrev === STARS_TEAM_CODE) || null;
}

// GWG logic 
function findGWGPlay(scoringPlays, payload, homeCode, awayCode) {
  const finalHome = payload.homeTeam?.score;
  const finalAway = payload.awayTeam?.score;
  if (finalHome == null || finalAway == null) return null;

  const winningTeamCode = finalHome > finalAway ? homeCode : awayCode;
  const losingTeamCode = winningTeamCode === homeCode ? awayCode : homeCode;
  const losingFinalScore = Math.min(finalHome, finalAway);

  const sortedPlays = scoringPlays.sort((a, b) => a.sortOrder - b.sortOrder);
  let homeScore = 0;
  let awayScore = 0;
  const candidateGWGs = [];

  for (let i = 0; i < sortedPlays.length; i++) {
    const play = sortedPlays[i];
    const teamId = play.details?.eventOwnerTeamId;
    const teamCode =
      teamId === payload.homeTeam?.id ? homeCode :
      teamId === payload.awayTeam?.id ? awayCode :
      null;

    if (teamCode === homeCode) homeScore++;
    else if (teamCode === awayCode) awayScore++;

    if (teamCode !== winningTeamCode) continue;

    const winningScoreAfterGoal = Math.max(homeScore, awayScore);
    if (winningScoreAfterGoal <= losingFinalScore) continue;

    let tempHome = homeScore;
    let tempAway = awayScore;
    let leadErased = false;

    for (let j = i + 1; j < sortedPlays.length; j++) {
      const futurePlay = sortedPlays[j];
      const futureTeamId = futurePlay.details?.eventOwnerTeamId;
      const futureTeamCode =
        futureTeamId === payload.homeTeam?.id ? homeCode :
        futureTeamId === payload.awayTeam?.id ? awayCode :
        null;

      if (futureTeamCode === homeCode) tempHome++;
      else if (futureTeamCode === awayCode) tempAway++;

      if (
        (winningTeamCode === homeCode && tempAway >= tempHome) ||
        (winningTeamCode === awayCode && tempHome >= tempAway)
      ) {
        leadErased = true;
        break;
      }
    }

    if (!leadErased) {
      candidateGWGs.push(play);
    }
  }

  return candidateGWGs.length > 0 ? candidateGWGs[candidateGWGs.length - 1] : null;
}


export async function fetchAndWriteGameResults(gameDoc) {
  if (!gameDoc || !gameDoc.gamePk) {
    console.warn('Invalid gameDoc or missing gamePk');
    return null;
  }

  try {
    const payload = await nhlGamePlayByPlay(gameDoc.gamePk);
    const scoringPlays = extractScoringPlays(payload).sort((a, b) => a.sortOrder - b.sortOrder);
    const update = {};

    if (!scoringPlays.length) {
      await Game.updateOne({ _id: gameDoc._id }, { $unset: { firstGoalPlayerId: '', gwGoalPlayerId: '' } });
      return null;
    }

    const firstStarsPlay = findFirstStarsGoal(scoringPlays);
    if (firstStarsPlay) {
      const firstStarsExternal = getScorerExternalId(firstStarsPlay);
      if (firstStarsExternal) {
        const firstStarsObjId = await convertExternalPlayerIdToObjectId(firstStarsExternal);
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

    const endedInShootout = (payload.periods || []).some(p => p.periodType === 'SO');

    if (starsWon && endedInShootout) {
      const shootoutGWObjId = await convertExternalPlayerIdToObjectId(JAKE_OETTINGER_ID);
      if (shootoutGWObjId) {
        update.gwGoalPlayerId = shootoutGWObjId;
      }
    } else if (starsWon) {
      const gwPlay = findGWGPlay(scoringPlays, payload, gameDoc.homeTeam, gameDoc.awayTeam);
      const gwExternal = gwPlay ? getScorerExternalId(gwPlay) : null;

      console.log('GWG Play:', gwPlay);
      console.log('GWG External ID:', gwExternal);

      if (gwExternal) {
        const gwObjId = await convertExternalPlayerIdToObjectId(gwExternal);
        if (gwObjId) {
          update.gwGoalPlayerId = gwObjId;
        } else {
          console.warn('GWG Object ID not found for external ID:', gwExternal);
        }
      } else {
        console.warn('GWG External ID was null');
      }
    } else {
      console.log('Skipping GWG assignment: Dallas Stars did not win.');
    }

    console.log('Update payload for DB:', update);
    console.log('Game ID:', gameDoc._id);

    if (Object.keys(update).length) {
      await Game.updateOne({ _id: gameDoc._id }, { $set: update });
      console.log('DB updated for gamePk:', gameDoc.gamePk);
    } else {
      console.warn('No update applied for gamePk:', gameDoc.gamePk);
    }

    return update;
  } catch (err) {
    console.error('fetchAndWriteGameResults error for', gameDoc._id, err);
    return null;
  }
}