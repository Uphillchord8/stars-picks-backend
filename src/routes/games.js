// src/routes/games.js

const express = require('express');
const router  = express.Router();
const Game    = require('../models/game');
const Player  = require('../models/players');

// Only pull Dallas Stars roster for the pick dropdown
const PICK_TEAM = 'Dallas Stars';

// NHL team → 3-letter code mapping for building asset URLs
const nhlTeamCodes = {
  'Anaheim Ducks':           'ANA',
  'Arizona Coyotes':         'ARI',
  'Boston Bruins':           'BOS',
  'Buffalo Sabres':          'BUF',
  'Calgary Flames':          'CGY',
  'Carolina Hurricanes':     'CAR',
  'Chicago Blackhawks':      'CHI',
  'Colorado Avalanche':      'COL',
  'Columbus Blue Jackets':   'CBJ',
  'Dallas Stars':            'DAL',
  'Detroit Red Wings':       'DET',
  'Edmonton Oilers':         'EDM',
  'Florida Panthers':        'FLA',
  'Los Angeles Kings':       'LAK',
  'Minnesota Wild':          'MIN',
  'Montreal Canadiens':      'MTL',
  'Nashville Predators':     'NSH',
  'New Jersey Devils':       'NJD',
  'New York Islanders':      'NYI',
  'New York Rangers':        'NYR',
  'Ottawa Senators':         'OTT',
  'Philadelphia Flyers':     'PHI',
  'Pittsburgh Penguins':     'PIT',
  'San Jose Sharks':         'SJS',
  'Seattle Kraken':          'SEA',
  'St. Louis Blues':         'STL',
  'Tampa Bay Lightning':     'TBL',
  'Toronto Maple Leafs':     'TOR',
  'Utah Hockey Club':        'UTA',
  'Vancouver Canucks':       'VAN',
  'Vegas Golden Knights':    'VGK',
  'Washington Capitals':     'WSH',
  'Winnipeg Jets':           'WPG'
};

router.get('/', async (req, res) => {
  try {
    // 1) Load all active games in chronological order
    const games = await Game.find({ isActive: true })
      .sort({ gameTime: 1 })
      .lean();

    // 2) Fetch Stars roster once (not per game)
    const starsRoster = await Player.find({
      team:   PICK_TEAM,
      active: true
    })
    .select('_id name')
    .lean();

    // 3) Attach logos + same roster to each game
    const formatted = games.map(game => {
      const homeCode = nhlTeamCodes[game.homeTeam];
      const awayCode = nhlTeamCodes[game.awayTeam];

      return {
        _id:               game._id,
        gameTime:          game.gameTime,
        homeTeam:          game.homeTeam,
        awayTeam:          game.awayTeam,
        homeLogo:          homeCode
                              ? `https://assets.nhle.com/logos/nhl/svg/${homeCode}_light.svg`
                              : null,
        awayLogo:          awayCode
                              ? `https://assets.nhle.com/logos/nhl/svg/${awayCode}_light.svg`
                              : null,
        firstGoalPlayerId: game.firstGoalPlayerId,
        gwGoalPlayerId:    game.gwGoalPlayerId,
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