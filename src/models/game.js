const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
  gameTime:           { type: Date, required: true },
  homeTeam:           { type: String, required: true },
  awayTeam:           { type: String, required: true },
  firstGoalPlayerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Player' }, // Actual scorer
  gwGoalPlayerId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Player' }, // Actual GWG
  finalScore:         { type: String }, // Optional: "4-2"
  winner:             { type: String }, // Optional: "Dallas Stars"
});

module.exports = mongoose.model('Game', gameSchema);
