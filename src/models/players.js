// src/models/Player.js
const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  nhlId:      { type: Number, unique: true },
  name:       { type: String },
  position:   { type: String },
  headshotUrl:{ type: String },
  team:       { type: String },
});

module.exports = mongoose.model('Player', playerSchema);
