
// server.js

// 1) Load environment variables
require('dotenv').config();
if (!process.env.MONGO_URI) {
  console.error('❌ Missing MONGO_URI in .env');
  process.exit(1);
}

// 2) Core imports
const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const path     = require('path');
const mongoose = require('mongoose');

// 3) Initialize Express
const app = express();

// 4) Security & CSP + Allow cross-origin resources
const API_DOMAIN = 'https://dallas-stars-pickems-27161.nodechef.com';

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri:    ["'self'"],
        imgSrc:     ["'self'", 'data:', API_DOMAIN],
        connectSrc: ["'self'", API_DOMAIN],
        fontSrc:    ["'self'", 'data:'],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'", "'unsafe-inline'"],
        objectSrc:  ["'none'"],
        upgradeInsecureRequests: []
      }
    },
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);

// 5) Dynamic CORS whitelist
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL_WWW,
  process.env.NODECHEF_FE_DOMAIN
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked: ${origin}`), false);
    },
    credentials: true
  })
);

// 6) Body parser
app.use(express.json());

// 7) Health check
app.get('/health', (req, res) =>
  res.json({ status: 'ok', time: new Date().toISOString() })
);

// 8) Connect to MongoDB
require('./src/db');

// 9) Stream avatars from GridFS
app.get('/avatars/:filename', async (req, res, next) => {
  try {
    console.log('>>> GET /avatars hit for', req.params.filename);

    const bucket = new mongoose.mongo.GridFSBucket(
      mongoose.connection.db,
      { bucketName: 'avatars' }
    );

    const filesColl = mongoose.connection.db.collection('avatars.files');
    const fileDoc   = await filesColl.findOne({ filename: req.params.filename });
    if (!fileDoc) {
      console.log('>>> Avatar not found in GridFS');
      return res.status(404).json({ error: 'Avatar not found' });
    }

    res.set('Content-Type', fileDoc.contentType || 'application/octet-stream');
    bucket.openDownloadStreamByName(req.params.filename).pipe(res);
  } catch (err) {
    console.error('>>> Error in /avatars route:', err);
    next(err);
  }
});

// 10) Cron jobs (ensure NO duplicate scheduling of the game-results job here)
//    Keep other jobs if they’re unrelated. If any of them schedule game results,
//    remove their schedules and call our runOnce() instead (below).
require('./src/cron/defaultPicks');        // <-- verify this does NOT schedule fetchGameResults
require('./src/cron/recalcSeasonGoals');
require('./src/cron/syncGamesAndPlayers'); // <-- if this schedules game results, disable the schedule there
require('./src/cron/notifyGameDay');
console.log('🔌 cron files loaded');

// 10.1) Centralized scheduling for game results (mutex + cron)
const cron = require('node-cron');
const { fetchAndWriteGameResults } = require('./src/cron/fetchGameResults');

let isGameJobRunning = false;
async function runGameResultsOnce() {
  if (isGameJobRunning) { console.log('⏭️ Skip: game results job already running'); return; }
  isGameJobRunning = true;
  try {
    console.log('🔄 Game Stats sync job started');
    await fetchAndWriteGameResults();
    console.log('✅ Game Stats sync job completed');
  } catch (e) {
    console.error('❌ Game Stats sync failed:', e.message);
  } finally {
    isGameJobRunning = false;
  }
}

// Nightly consolidation at 02:30 local (safer than midnight for NHL game windows)
cron.schedule('30 2 * * *', runGameResultsOnce);

// Optional: run on startup (after short delay)
(async () => {
  console.log('✨ Game Stats On Start Up sync');
  await new Promise(r => setTimeout(r, 1000));
  await runGameResultsOnce();
})();

// 11) Route handlers
const authRouter        = require('./src/routes/auth');
const playersRouter     = require('./src/routes/players');
const gamesRouter       = require('./src/routes/games');
const statsRouter       = require('./src/routes/stats');
const picksRouter       = require('./src/routes/picks');
const leaderboardRouter = require('./src/routes/leaderboard');
const uploadRouter      = require('./src/routes/upload');

app.use('/auth',        authRouter);
app.use('/players',     playersRouter);
app.use('/games',       gamesRouter);
app.use('/stats',       statsRouter);
app.use('/picks',       picksRouter);
app.use('/leaderboard', leaderboardRouter);
app.use('/user',        uploadRouter);

// 12) Serve React build in production
const NODE_ENV = process.env.NODE_ENV || 'development';
if (NODE_ENV === 'production') {
  console.log('🚀 Production mode: serving React build');
  app.use(express.static(path.join(__dirname, 'build')));
  app.get('*', (req, res) =>
    res.sendFile(path.join(__dirname, 'build', 'index.html'))
  );
} else {
  console.log('🛠️ Development mode: skipping build serve');
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
