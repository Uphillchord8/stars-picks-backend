// src/db.js

// Load env vars (again) in case this is run standalone
require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ Missing MONGO_URI in .env');
  process.exit(1);
}

// Suppress deprecation warnings
mongoose.set('strictQuery', false);

// Connect!
mongoose
  .connect(MONGO_URI, {
    useNewUrlParser:    true,
    useUnifiedTopology: true
  })
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// Export mongoose in case you need it elsewhere
module.exports = mongoose;