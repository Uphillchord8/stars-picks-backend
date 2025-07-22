const mongoose = require('mongoose');
const { Schema } = mongoose; 

const tokenSchema = new mongoose.Schema({
  userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
  token:     { type: String, required: true },
  expiresAt: { type: Date, required: true }
});

// Auto-remove expired docs
tokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Token', tokenSchema);