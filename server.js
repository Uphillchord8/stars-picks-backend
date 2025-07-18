// server.js
require('dotenv').config();
const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');

// Import routers
const authRouter        = require('./src/routes/auth');
const picksRouter       = require('./src/routes/picks');
const leaderboardRouter = require('./src/routes/leaderboard');

// 🔍 Debug router types
console.log('authRouter →', typeof authRouter);
console.log('picksRouter →', typeof picksRouter);
console.log('leaderboardRouter →', typeof leaderboardRouter);

const app = express();

// middleware
app.use(cors());
app.use(express.json());

// Mount routers
app.use('/auth',        authRouter);
app.use('/picks',       picksRouter);
app.use('/leaderboard', leaderboardRouter);

// global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server Error' });
});

// connect to Mongo and start server
const PORT = process.env.PORT || 4000;

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser:    true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log('🗄️  Connected to MongoDB');
    app.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });