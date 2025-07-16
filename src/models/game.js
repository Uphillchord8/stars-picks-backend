// src/models/Game.js
const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
  nhlGameId:               { type: Number, unique: true },
  date:                    { type: Date },
  homeTeam:                { type: String },
  awayTeam:                { type: String },
  status:                  { type: String, enum: ['scheduled','in_progress','final'], default: 'scheduled' },
  firstGoalPlayerId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null },
  gameWinningGoalPlayerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null },
});

module.exports = mongoose.model('Game', gameSchema);
