const fetch = global.fetch || require('node-fetch');
const Game = require('../models/game');
const Player = require('../models/players');

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

    // GWG is the goal that puts the winning team ahead by 1 more than the losing team
    if (winningGoals > losingGoals &&
        ((winningTeamCode === homeCode && homeGoals - awayGoals === 1) ||
         (winningTeamCode === awayCode && awayGoals - homeGoals === 1))) {
      return play;
    }
  }

  return null;
}

async function fetchAndWriteGameResults(gameDoc) {
  if (!gameDoc || !gameDoc.gamePk) return null;
  try {
    const payload = await nhlGamePlayByPlay(gameDoc.gamePk);
    const scoringPlays = extractScoringPlays(payload);
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

    const update = {};
    if (firstObjId) update.firstGoalPlayerId = firstObjId;
    if (gwObjId) update.gwGoalPlayerId = gwObjId;

    if (Object.keys(update).length) {
      await Game.updateOne({ _id: gameDoc._id }, { $set: update });
    }

    return update;
  } catch (err) {
    console.error('fetchAndWriteGameResults error for', gameDoc._id, err);
    return null;
  }
}


const STARS_TEAM_CODE = 'DAL';
const JAKE_OETTINGER_ID = 8479979;

// Check if game ended in shootout
const endedInShootout = (payload.periods || []).some(p => p.periodType === 'SO');

// Check if Stars won
const starsWon =
  gameDoc.homeTeam === STARS_TEAM_CODE && payload.homeTeam?.score > payload.awayTeam?.score ||
  gameDoc.awayTeam === STARS_TEAM_CODE && payload.awayTeam?.score > payload.homeTeam?.score;

if (endedInShootout && starsWon) {
  const gwObjId = await convertExternalPlayerIdToObjectId(JAKE_OETTINGER_ID);
  if (gwObjId) {
    update.gwGoalPlayerId = gwObjId;
    console.log(`🏒 Shootout win detected — assigning GWG to Jake Oettinger for gamePk ${gameDoc.gamePk}`);
  }
}


module.exports = {
  fetchAndWriteGameResults
};

