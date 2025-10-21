const express = require('express');
const axios   = require('axios');
const router  = express.Router();
const Game    = require('../models/game');
const Player  = require('../models/players');

const NHL_API = 'https://api-web.nhle.com/v1';
const TEAM    = 'Dallas Stars';

// GET /api/stats
router.get('/', async (req, res) => {
  try {
    // 1) Last game highlights
    const lastGame = await Game.findOne({ isActive: false })
      .sort({ gameTime: -1 })
      .populate('firstGoalPlayerId')
      .populate('gwGoalPlayerId')
      .lean();

    const fetchHeadshot = async playerId => {
      try {
        const { data } = await axios.get(`${NHL_API}/player/${playerId}/landing`);
        return data.headshot;
      } catch {
        return null;
      }
    };

    let lastFirstGoal = null;
    if (lastGame?.firstGoalPlayerId) {
      const p = lastGame.firstGoalPlayerId;
      const headshot = (await fetchHeadshot(p.playerId)) || p.pictureUrl;
      lastFirstGoal = {
        player_id:  p._id,
        name:       p.name,
        position:   p.position,
        pictureUrl: headshot
      };
    }

    let lastWinningGoal = null;
    if (lastGame?.gwGoalPlayerId) {
      const p = lastGame.gwGoalPlayerId;
      const headshot = (await fetchHeadshot(p.playerId)) || p.pictureUrl;
      lastWinningGoal = {
        player_id:  p._id,
        name:       p.name,
        position:   p.position,
        pictureUrl: headshot
      };
    }

    // 2) Aggregate first-goal counts across all games
    const firstAgg = await Game.aggregate([
      { $match: { firstGoalPlayerId: { $ne: null } } },
      {
        $group: {
          _id:   '$firstGoalPlayerId',
          count: { $sum: 1 }
        }
      }
    ]);
    const firstMap = Object.fromEntries(
      firstAgg.map(o => [o._id.toString(), o.count])
    );

    // ✅ 3) Aggregate GWG counts across all games
    const gwgAgg = await Game.aggregate([
      { $match: { gwGoalPlayerId: { $ne: null } } },
      {
        $group: {
          _id:   '$gwGoalPlayerId',
          count: { $sum: 1 }
        }
      }
    ]);
    const gwgMap = Object.fromEntries(
      gwgAgg.map(o => [o._id.toString(), o.count])
    );

    // 4) Fetch active roster
    const players = await Player.find({
      team: TEAM,
      active: true
    }).lean();

    // 5) Build enriched seasonStats array
    const seasonStats = await Promise.all(
      players.map(async p => {
        let landing;
        try {
          const { data } = await axios.get(`${NHL_API}/player/${p.playerId}/landing`);
          landing = data;
        } catch {
          landing = null;
        }

        const number   = landing?.sweaterNumber ?? p.sweaterNumber ?? null;
        const position = landing?.position      ?? p.position;
        const picture  = landing?.headshot      ?? p.pictureUrl;

        return {
          player_id:  p._id,
          name:       p.name,
          position,
          number,
          pictureUrl: picture,
          goals:      landing?.featuredStats?.regularSeason?.subSeason?.goals || 0,
          firstGoals: firstMap[p._id.toString()] || 0,
          gwgs:       gwgMap[p._id.toString()] || 0  // ✅ internal GWG count
        };
      })
    );

    // 6) Sort by goals descending
    seasonStats.sort((a, b) => b.goals - a.goals);

    return res.json({ lastFirstGoal, lastWinningGoal, seasonStats });
  } catch (err) {
    console.error('❌ Failed to load stats:', err);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
});

module.exports = router;
