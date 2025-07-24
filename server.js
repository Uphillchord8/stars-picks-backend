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

// 5) Dynamic CORS whitelist
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL_WWW,
  process.env.NODECHEF_FE_DOMAIN
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow server‐side tools or same‐origin (no origin header)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Otherwise block it
      const msg =
        `CORS blocked: ${origin} not in ${allowedOrigins.join(', ')}`;
      return callback(new Error(msg), false);
    },
    credentials: true
  })
);

// 6) Body parser
app.use(express.json());

// 7) Health check (quick smoke test)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 8) Connect to MongoDB
require('./src/db');

// 9) Cron jobs
require('./src/cron/defaultPicks');
require('./src/cron/recalcSeasonGoals');

// 10) Route handlers
const authRouter        = require('./src/routes/auth');
const playersRouter     = require('./src/routes/players');
const gamesRouter       = require('./src/routes/games');
const statsRouter       = require('./src/routes/stats');
const picksRouter       = require('./src/routes/picks');
const leaderboardRouter = require('./src/routes/leaderboard');
const uploadRouter      = require('./src/routes/upload');

// Mount your API endpoints (no “/api” prefix so frontend calls match)
app.use('/auth',        authRouter);
app.use('/players',     playersRouter);
app.use('/games',       gamesRouter);
app.use('/stats',       statsRouter);
app.use('/picks',       picksRouter);
app.use('/leaderboard', leaderboardRouter);
app.use('/user',        uploadRouter);

// 11) Serve uploaded avatar files
app.use(
  '/avatars',
  express.static(path.join(__dirname, 'public', 'avatars'))
);

// 12) Production static-serve for React build + catch-all
const NODE_ENV = process.env.NODE_ENV || 'development';
if (NODE_ENV === 'production') {
  console.log('🚀 Production mode: serving React build');
  app.use(express.static(path.join(__dirname, 'build')));
  app.get('*', (req, res) =>
    res.sendFile(path.join(__dirname, 'build', 'index.html'))
  );
} else {
  console.log('🛠️ Development mode: skipping React static serve');
}

// 13) Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Global error handler caught:', err.message);
  res
    .status(err.status || 500)
    .json({
      error:
        process.env.NODE_ENV === 'production'
          ? 'Server Error'
          : err.message
    });
});

// 14) Start the server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`🎧 Server listening on port ${PORT}`)
);