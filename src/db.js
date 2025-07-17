// src/db.js
require('dotenv').config()
const mongoose = require('mongoose')

const MONGO_URI = process.env.MONGO_URI
if (!MONGO_URI) {
  console.error('❌  Missing MONGO_URI in .env')
  process.exit(1)
}

// Optional: suppress deprecation warnings
mongoose.set('strictQuery', false)

mongoose
  .connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('✅  MongoDB connected'))
  .catch(err => {
    console.error('❌  MongoDB connection error:', err)
    process.exit(1)
  })

module.exports = mongoose