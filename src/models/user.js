// src/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username:       { type: String, required: true, unique: true },
  email:          { type: String, required: true, unique: true },
  passwordHash:   { type: String, required: true },
  avatarUrl:      { type: String, default: null },
defaultFirstGoal: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
defaultGWG:        { type: mongoose.Schema.Types.ObjectId, ref: 'Player' }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
