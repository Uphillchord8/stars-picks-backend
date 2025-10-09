const fetch = global.fetch || require('node-fetch');
const Game  = require('../models/game');
const Player = require('../models/players');

const NHL_API_BASE = process.env.NHL_API_BASE_URL || 'https://api-web.nhle.com/v1';

async function nhlGameContent(gamePk) {
  const url = `${NHL_API_BASE}/game/${gamePk}/content`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NHL content fetch failed: ${res.status}`);
  return res.json();
}

async function convertExternalPlayerIdToObjectId(externalId) {
  if (!externalId) return null;
  const player = await Player.findOne({ playerId: externalId }).select('_id').lean();
  return player ? player._id : null;
}

function extractScoringPlays(payload) {
  return (payload.plays?.allPlays || payload.liveData?.plays?.allPlays || [])
    .filter(p => p.result && p.result.eventTypeId === 'GOAL');
}

function getScorerExternalId(play) {
  return play.players?.find(pl => pl.playerType === 'Scorer')?.player?.id || null;
}

function findGWGPlay(scoringPlays, payload, homeCode, awayCode) {
  const flagged = scoringPlays.find(p => p.result && p.result.gameWinningGoal === true);
  if (flagged) return flagged;

  const finalHome = payload.liveData?.linescore?.teams?.home?.goals ?? null;
  const finalAway = payload.liveData?.linescore?.teams?.away?.goals ?? null;
  if (finalHome === null || finalAway === null) return null;

  const winningTeamCode = finalHome > finalAway ? homeCode : awayCode;
  let cum = { home: 0, away: 0 };

  for (const play of scoringPlays) {
    const tri = play.team?.triCode;
    const side = tri === homeCode ? 'home' : 'away';
    cum[side]++;
    if ((winningTeamCode === homeCode && cum.home > cum.away) ||
        (winningTeamCode === awayCode && cum.away > cum.home)) {
      return play;
    }
  }
  return null;
}

async function fetchAndWriteGameResults(gameDoc) {
  if (!gameDoc || !gameDoc.gamePk) return null;
  try {
    const payload = await nhlGameContent(gameDoc.gamePk);
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

module.exports = { fetchAndWriteGameResults };