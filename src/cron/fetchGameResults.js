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
  return play.details?.scoringPlayerId || null;
}

function findGWGPlay(scoringPlays, payload, homeCode, awayCode) {
  const finalHome = payload.homeTeam?.score ?? null;
  const finalAway = payload.awayTeam?.score ?? null;
  if (finalHome === null || finalAway === null) return null;

  const winningTeamCode = finalHome > finalAway ? homeCode : awayCode;
  const losingTeamCode = finalHome > finalAway ? awayCode : homeCode;
  const finalMargin = Math.abs(finalHome - finalAway);

  let homeGoals = 0;
  let awayGoals = 0;

  for (const play of scoringPlays) {
    const teamCode = play.team?.abbrev;
    if (teamCode === homeCode) homeGoals++;
    if (teamCode === awayCode) awayGoals++;

    const winningGoals = winningTeamCode === homeCode ? homeGoals : awayGoals;
    const losingGoals = winningTeamCode === homeCode ? awayGoals : homeGoals;

    // This goal created the final lead margin
    if (teamCode === winningTeamCode && (winningGoals - losingGoals === finalMargin)) {
      return play;
    }
  }

  return null;
}

export async function fetchAndWriteGameResults(gameDoc) {
  if (!gameDoc || !gameDoc.gamePk) return null;

  try {
    const payload = await nhlGamePlayByPlay(gameDoc.gamePk);
    const scoringPlays = extractScoringPlays(payload);
    const update = {};

    if (!scoringPlays.length) {
      await Game.updateOne({ _id: gameDoc._id }, { $unset: { firstGoalPlayerId: '', gwGoalPlayerId: '' } });
      return null;
    }

    // First goal
    const firstPlay = scoringPlays[0];
    const firstExternal = getScorerExternalId(firstPlay);
    const firstObjId = await convertExternalPlayerIdToObjectId(firstExternal);
    if (firstObjId) update.firstGoalPlayerId = firstObjId;

    // Final score and winner
    const homeScore = payload.homeTeam?.score;
    const awayScore = payload.awayTeam?.score;
    if (homeScore !== undefined && awayScore !== undefined) {
      update.finalScore = `${homeScore}-${awayScore}`;
      update.winner = homeScore > awayScore ? gameDoc.homeTeam : gameDoc.awayTeam;
    }

    const starsWon =
      (gameDoc.homeTeam === STARS_TEAM_CODE && homeScore > awayScore) ||
      (gameDoc.awayTeam === STARS_TEAM_CODE && awayScore > homeScore);

    // GWG logic for Dallas wins
    if (starsWon) {
      const gwPlay = findGWGPlay(scoringPlays, payload, gameDoc.homeTeam, gameDoc.awayTeam);
      const gwExternal = gwPlay ? getScorerExternalId(gwPlay) : null;
      const gwObjId = await convertExternalPlayerIdToObjectId(gwExternal);
      if (gwObjId) update.gwGoalPlayerId = gwObjId;
    }

    // Shootout win override
    const endedInShootout = (payload.periods || []).some(p => p.periodType === 'SO');
    if (endedInShootout && starsWon) {
      const shootoutGWObjId = await convertExternalPlayerIdToObjectId(JAKE_OETTINGER_ID);
      if (shootoutGWObjId) {
        update.gwGoalPlayerId = shootoutGWObjId;
        console.log(`🏒 Shootout win detected — assigning GWG to Jake Oettinger for gamePk ${gameDoc.gamePk}`);
      }
    }

    if (Object.keys(update).length) {
      await Game.updateOne({ _id: gameDoc._id }, { $set: update });
    }

    return update;
  } catch (err) {
    console.error('fetchAndWriteGameResults error for', gameDoc._id, err);
    return null;
  }
}