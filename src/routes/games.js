// src/routes/games.js

const express = require('express');
const router  = express.Router();
const Game    = require('../models/game');
const Player  = require('../models/players');

// Only pull Dallas Stars roster for the pick dropdown
const PICK_TEAM_NAME = 'Dallas Stars';
const PICK_TEAM_ABBR = 'DAL';

// Base URL for NHL team logos (light theme)
const LOGO_BASE = 'https://assets.nhle.com/logos/nhl/svg';

// Invert of your old nhlTeamCodes: abbr → full name
const codeToName = {
  ANA: 'Anaheim Ducks',
  ARI: 'Arizona Coyotes',
  BOS: 'Boston Bruins',
  BUF: 'Buffalo Sabres',
  CGY: 'Calgary Flames',
  CAR: 'Carolina Hurricanes',
  CHI: 'Chicago Blackhawks',
  COL: 'Colorado Avalanche',
  CBJ: 'Columbus Blue Jackets',
  DAL: 'Dallas Stars',
  DET: 'Detroit Red Wings',
  EDM: 'Edmonton Oilers',
  FLA: 'Florida Panthers',
  LAK: 'Los Angeles Kings',
  MIN: 'Minnesota Wild',
  MTL: 'Montreal Canadiens',
  NSH: 'Nashville Predators',
  NJD: 'New Jersey Devils',
  NYI: 'New York Islanders',
  NYR: 'New York Rangers',
  OTT: 'Ottawa Senators',
  PHI: 'Philadelphia Flyers',
  PIT: 'Pittsburgh Penguins',
  SJS: 'San Jose Sharks',
  SEA: 'Seattle Kraken',
  STL: 'St. Louis Blues',
  TBL: 'Tampa Bay Lightning',
  TOR: 'Toronto Maple Leafs',
  UTA: 'Utah Hockey Club',
  VAN: 'Vancouver Canucks',
  VGK: 'Vegas Golden Knights',
  WSH: 'Washington Capitals',
  WPG: 'Winnipeg Jets'
};

router.get('/', async (req, res) => {
  try {
    // 1) Get active games in time order
    const rawGames = await Game.find({ isActive: true })
      .sort({ gameTime: 1 })
      .lean();

    // 2) Fetch the Stars roster once
    const starsRoster = await Player.find({
      team:   PICK_TEAM_NAME,
      active: true
    })
      .select('_id name')
      .lean();

    // 3) Format each game:
    const formatted = rawGames.map(g => {
      let homeCode = g.homeTeam;  // e.g. 'DAL'
      let awayCode = g.awayTeam;  // e.g. 'STL'

      // If Stars is the away team, swap so they're always on "home"/left
      if (awayCode === PICK_TEAM_ABBR) {
        [homeCode, awayCode] = [awayCode, homeCode];
      }

      return {
        _id:               g._id,
	gamePk:            g.gamePk,
        gameTime:          g.gameTime,

        // full names for display
        homeTeam:          codeToName[homeCode] || homeCode,
        awayTeam:          codeToName[awayCode] || awayCode,

        // logo URLs built from the 3-letter code
        homeLogo:          `${LOGO_BASE}/${homeCode}_light.svg`,
        awayLogo:          `${LOGO_BASE}/${awayCode}_light.svg`,

        firstGoalPlayerId: g.firstGoalPlayerId,
        gwGoalPlayerId:    g.gwGoalPlayerId,

        // same Stars roster for every card
        players:           starsRoster
      };
    });

    return res.json(formatted);
  } catch (err) {
    console.error('❌ Failed to fetch games:', err);
    return res.status(500).json({ error: 'Failed to fetch games' });
  }
});

module.exports = router;