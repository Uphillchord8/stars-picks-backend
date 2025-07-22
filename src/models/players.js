// src/models/players.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const playerSchema = new Schema({
  playerId:      { type: Number, required: true, unique: true },
  name:          { type: String, required: true },
  position:      { type: String, required: true },
  sweaterNumber: { type: Number, required: true },
  team:          { type: String, required: true },
  pictureUrl:    { type: String, required: true },
  active:        { type: Boolean, default: true },
  seasonGoals:   { type: Number, default: 0 }
}, {
  timestamps: true
});

module.exports = mongoose.model('Player', playerSchema);