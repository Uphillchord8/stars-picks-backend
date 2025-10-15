import fetch from 'node-fetch';
import Game from '../models/game.js';
import Player from '../models/players.js';

const NHL_API_BASE = process.env.NHL_API_BASE_URL || 'https://api-web.nhle.com/v1';

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

  let homeGoals = 0;
  let awayGoals = 0;

  for (const play of scoringPlays) {
    const teamCode = play.team?.abbrev;
    if (teamCode === homeCode) homeGoals++;
    if (teamCode === awayCode) awayGoals++;

    const winningGoals = winningTeamCode === homeCode ? homeGoals : awayGoals;
    const losingGoals = losingTeamCode === homeCode ? homeGoals : awayGoals;

    if (
      winningGoals > losingGoals &&
      ((winningTeamCode === homeCode && homeGoals - awayGoals === 1) ||
       (winningTeamCode === awayCode && awayGoals - homeGoals === 1))
    ) {
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

    const firstPlay = scoringPlays[0];
    const firstExternal = getScorerExternalId(firstPlay);

    const gwPlay = findGWGPlay(scoringPlays, payload, gameDoc.homeTeam, gameDoc.awayTeam);
    const gwExternal = gwPlay ? getScorerExternalId(gwPlay) : null;

    const firstObjId = await convertExternalPlayerIdToObjectId(firstExternal);
    const gwObjId = await convertExternalPlayerIdToObjectId(gwExternal);

    if (firstObjId) update.firstGoalPlayerId = firstObjId;
    if (gwObjId) update.gwGoalPlayerId = gwObjId;

    // Handle shootout win for Stars
    const STARS_TEAM_CODE = 'DAL';
    const JAKE_OETTINGER_ID = 8479979;
    const endedInShootout = (payload.periods || []).some(p => p.periodType === 'SO');

    const starsWon =
      (gameDoc.homeTeam === STARS_TEAM_CODE && payload.homeTeam?.score > payload.awayTeam?.score) ||
      (gameDoc.awayTeam === STARS_TEAM_CODE && payload.awayTeam?.score > payload.homeTeam?.score);

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