const mongoose = require('mongoose');
const { Schema } = mongoose;


const gameSchema = new mongoose.Schema({
   gameTime:   { type: Date, required: true },
   homeTeam:   { type: String, required: true },
   awayTeam:   { type: String, required: true },
   firstGoalPlayerId: { type: Schema.Types.ObjectId, ref: 'Player', default: null },
   gwGoalPlayerId:    { type: Schema.Types.ObjectId, ref: 'Player', default: null },
   finalScore: { type: String, default: null },
   winner:     { type: String, default: null },
   isActive:  { type: Boolean, default: true }
}, { timestamps: true });

// New compound index
gameSchema.index({ isActive: 1, gameTime: 1 });

module.exports = mongoose.model('Game', gameSchema);