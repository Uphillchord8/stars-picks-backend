// src/routes/picks.js
const router = require('express').Router();
const auth = require('../middlewares/auth');
const {
  submitPicks,
  getPicksByGame
} = require('../controllers/picksController');

router.post('/', auth, submitPicks);
router.get('/:gameId', getPicksByGame);

module.exports = router;
