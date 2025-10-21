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

// ✅ Correct GWG logic based on final score
function findGWGPlay(scoringPlays, payload, homeCode, awayCode) {
  const finalHome = payload.homeTeam?.score ?? null;
  const finalAway = payload.awayTeam?.score ?? null;
  if (finalHome === null || finalAway === null) return null;

  const winningTeamCode = finalHome > finalAway ? homeCode : awayCode;

  const sortedPlays = scoringPlays.sort((a, b) => a.sortOrder - b.sortOrder);

  for (const play of sortedPlays.reverse()) {
    const teamId = play.details?.eventOwnerTeamId;
    const teamCode =
      teamId === payload.homeTeam?.id ? homeCode :
      teamId === payload.awayTeam?.id ? awayCode :
      null;

    if (teamCode !== winningTeamCode) continue;

    const awayScore = play.details?.awayScore;
    const homeScore = play.details?.homeScore;

    if (awayScore === finalAway && homeScore === finalHome) {
      console.log('✅ GWG play found:', play);
      return play;
    }
  }

  console.warn('⚠️ GWG play not found using final score logic.');
  return null;
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

    // ✅ First goal by Dallas Stars
    const firstStarsPlay = findFirstStarsGoal(scoringPlays);
    if (firstStarsPlay) {
      const firstStarsExternal = getScorerExternalId(firstStarsPlay);
      if (firstStarsExternal) {
        const firstStarsObjId = await convertExternalPlayerIdToObjectId(firstStarsExternal);
        if (firstStarsObjId) update.firstGoalPlayerId = firstStarsObjId;
      }
    }

    // ✅ Final score and winner
    const homeScore = payload.homeTeam?.score;
    const awayScore = payload.awayTeam?.score;
    if (homeScore !== undefined && awayScore !== undefined) {
      update.finalScore = `${homeScore}-${awayScore}`;
      update.winner = homeScore > awayScore ? gameDoc.homeTeam : gameDoc.awayTeam;
    }

    // ✅ Determine if Stars won and if it ended in shootout
    const starsWon =
      (gameDoc.homeTeam === STARS_TEAM_CODE && homeScore > awayScore) ||
      (gameDoc.awayTeam === STARS_TEAM_CODE && awayScore > homeScore);

    const endedInShootout = (payload.periods || []).some(p => p.periodType === 'SO');

    // ✅ GWG logic
    if (starsWon && endedInShootout) {
      const shootoutGWObjId = await convertExternalPlayerIdToObjectId(JAKE_OETTINGER_ID);
      if (shootoutGWObjId) {
        update.gwGoalPlayerId = shootoutGWObjId;
      }
    } else {
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
    }

    // ✅ Log update payload before DB write
    console.log('🧾 Update payload for DB:', update);
    console.log('🏒 Game ID:', gameDoc._id);

    // ✅ Write to DB
    if (Object.keys(update).length) {
      await Game.updateOne({ _id: gameDoc._id }, { $set: update });
      console.log('✅ DB updated for gamePk:', gameDoc.gamePk);
    } else {
      console.warn('⚠️ No update applied for gamePk:', gameDoc.gamePk);
    }

    return update;
  } catch (err) {
    console.error('fetchAndWriteGameResults error for', gameDoc._id, err);
    return null;
  }
}