// server.js

// 1) Load environment variables
require('dotenv').config();
if (!process.env.MONGO_URI) {
  console.error('❌ Missing MONGO_URI in .env');
  process.exit(1);
}

// 2) Core imports
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const path    = require('path');

// 3) Initialize Express
const app = express();

// 4) Security middleware
app.use(helmet());

// 5) CORS: open in dev, locked to FRONTEND_URL in prod
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

if (process.env.NODE_ENV === 'production') {
  console.log('🔒 CORS origin set to:', FRONTEND_URL);
  app.use(cors({
    origin: FRONTEND_URL,
    credentials: true
  }));
} else {
  app.use(cors());
}

// 6) Body parser
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});


// 7) Connect to MongoDB
require('./src/db');

// 8) Cron jobs
require('./src/cron/defaultPicks');
require('./src/cron/recalcSeasonGoals');

// 9) Route handlers
const authRouter        = require('./src/routes/auth');
const playersRouter     = require('./src/routes/players');
const gamesRouter       = require('./src/routes/games');
const statsRouter       = require('./src/routes/stats');
const picksRouter       = require('./src/routes/picks');
const leaderboardRouter = require('./src/routes/leaderboard');
const uploadRouter      = require('./src/routes/upload');

// Mount without the `/api` prefix so React’s `api.post('/auth/login')` matches
app.use('/auth',        authRouter);
app.use('/players',     playersRouter);
app.use('/games',       gamesRouter);
app.use('/stats',       statsRouter);
app.use('/picks',       picksRouter);
app.use('/leaderboard', leaderboardRouter);
app.use('/user',        uploadRouter);

// 10) Serve uploaded avatar files
app.use(
  '/avatars',
  express.static(path.join(__dirname, 'public', 'avatars'))
);

// 11) Production static-serve for React build + catch-all
const NODE_ENV = process.env.NODE_ENV || 'development';
if (NODE_ENV === 'production') {
  console.log('🚀 Production mode: serving React build');
  app.use(express.static(path.join(__dirname, 'build')));
  app.get('*', (req, res) =>
    res.sendFile(path.join(__dirname, 'build', 'index.html'))
  );
} else {
  console.log('🛠️  Development mode: skipping React static serve');
}

// 12) Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Global error handler caught:', err);
  res
    .status(err.status || 500)
    .json({
      error:
        process.env.NODE_ENV === 'production'
          ? 'Server Error'
          : err.message
    });
});

// 13) Start the server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`🎧 Server listening on port ${PORT}`)
);