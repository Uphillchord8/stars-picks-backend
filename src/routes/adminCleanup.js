// src/routes/adminCleanup.js
// TEMPORARY — delete this file and remove from server.js after running once

const express = require('express');
const router  = express.Router();
const Game    = require('../models/game');
const Pick    = require('../models/picks');

const CLEANUP_SECRET = process.env.CLEANUP_SECRET || 'stars-cleanup-2026';

router.post('/cleanup-games', async (req, res) => {
  // Basic secret check so this can't be triggered by anyone
  const { secret } = req.body;
  if (secret !== CLEANUP_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const results = {};

    // 1) Delete picks tied to preseason games
    const preseasonPicksDel = await Pick.deleteMany({
      gamePk: { $gte: 2025010000, $lt: 2025020000 }
    });
    results.preseasonPicksDeleted = preseasonPicksDel.deletedCount;

    // 2) Delete picks tied to playoff games
    const playoffPicksDel = await Pick.deleteMany({
      gamePk: { $gte: 2025030000, $lt: 2025040000 }
    });
    results.playoffPicksDeleted = playoffPicksDel.deletedCount;

    // 3) Delete preseason games
    const preseasonDel = await Game.deleteMany({
      gamePk: { $gte: 2025010000, $lt: 2025020000 }
    });
    results.preseasonGamesDeleted = preseasonDel.deletedCount;

    // 4) Delete playoff games (includes duplicates)
    const playoffDel = await Game.deleteMany({
      gamePk: { $gte: 2025030000, $lt: 2025040000 }
    });
    results.playoffGamesDeleted = playoffDel.deletedCount;

    // 5) Confirm remaining game count
    results.regularSeasonGamesRemaining = await Game.countDocuments();

    console.log('✅ Admin cleanup complete:', results);
    return res.json({ success: true, results });

  } catch (err) {
    console.error('❌ Admin cleanup failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
