// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// route imports
const authRoutes = require('./src/routes/auth');
const picksRoutes = require('./src/routes/picks');
const leaderboardRoutes = require('./src/routes/leaderboard');

const app = express();

// middleware
app.use(cors());
app.use(express.json());

// mount routes
app.use('/api/auth', authRoutes);
app.use('/api/picks', picksRoutes);
app.use('/api/leaderboard', leaderboardRoutes);

//console logs
console.log('authRouter:',        typeof authRouter,        authRouter);
console.log('picksRouter:',       typeof picksRouter,       picksRouter);
console.log('leaderboardRouter:', typeof leaderboardRouter, leaderboardRouter);

// global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server Error' });
});

// connect to Mongo and start server
const PORT = process.env.PORT; 

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
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
