// src/models/Pick.js
const mongoose = require('mongoose');

const pickSchema = new mongoose.Schema({
  userId:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  gameId:            { type: mongoose.Schema.Types.ObjectId, ref: 'Game', required: true },
  gamePk:            { type: Number, required: true, index: true },
  firstGoalPlayerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', required: true },
  gwGoalPlayerId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Player', required: true },
  submittedAt:       { type: Date, default: Date.now },
  isDefault:         { type: Boolean, default: false },
});

pickSchema.index({ userId: 1, gameId: 1 }, { unique: true });

module.exports = mongoose.model('Pick', pickSchema);
