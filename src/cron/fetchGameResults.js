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

  let homeGoals = 0;
  let awayGoals = 0;

  // Track score progression
  const scoreTimeline = [];

  for (const play of scoringPlays) {
    const teamCode = play.team?.abbrev;
    if (teamCode === homeCode) homeGoals++;
    if (teamCode === awayCode) awayGoals++;

    scoreTimeline.push({
      play,
      teamCode,
      homeGoals,
      awayGoals
    });
  }

  // Find the first goal that gives the winning team a lead they never lose
  for (let i = 0; i < scoreTimeline.length; i++) {
    const { play, teamCode, homeGoals, awayGoals } = scoreTimeline[i];

    const winningGoals = winningTeamCode === homeCode ? homeGoals : awayGoals;
    const losingGoals = winningTeamCode === homeCode ? awayGoals : homeGoals;

    if (teamCode !== winningTeamCode) continue;

    const leadMargin = winningGoals - losingGoals;

    if (leadMargin <= 0) continue;

    // Check if the losing team ever ties or overtakes after this point
    let leadLost = false;
    for (let j = i + 1; j < scoreTimeline.length; j++) {
      const later = scoreTimeline[j];
      const laterWinningGoals = winningTeamCode === homeCode ? later.homeGoals : later.awayGoals;
      const laterLosingGoals = winningTeamCode === homeCode ? later.awayGoals : later.homeGoals;

      if (laterWinningGoals <= laterLosingGoals) {
        leadLost = true;
        break;
      }
    }

    if (!leadLost) {
      return play;
    }
  }

  console.warn(`⚠️ No GWG play found for gamePk ${payload.id}`);
  return null;
}


export async function fetchAndWriteGameResults(gameDoc) {
  if (!gameDoc || !gameDoc.gamePk) return null;

  try {
    const payload = await nhlGamePlayByPlay(gameDoc.gamePk);
    const scoringPlays = extractScoringPlays(payload).sort((a, b) => a.sortOrder - b.sortOrder);
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

    console.log(`🏒 Dallas win detected: ${starsWon}`);

    // GWG logic for Dallas wins
    if (starsWon) {
      const gwPlay = findGWGPlay(scoringPlays, payload, gameDoc.homeTeam, gameDoc.awayTeam);
      const gwExternal = gwPlay ? getScorerExternalId(gwPlay) : null;
      console.log('GWG External ID:', gwExternal);
      const gwObjId = await convertExternalPlayerIdToObjectId(gwExternal);
      console.log('GWG Object ID:', gwObjId);
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
      console.log(`✅ Game ${gameDoc.gamePk} updated with:`, update);
    } else {
      console.warn(`⚠️ No updates applied for gamePk ${gameDoc.gamePk}`);
    }

    return update;
  } catch (err) {
    console.error('❌ fetchAndWriteGameResults error for', gameDoc._id, err);
    return null;
  }
}