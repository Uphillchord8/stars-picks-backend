// backend/models/userModel.js
const db = require('../db');

module.exports = {
  getByUsername: async (username) => {
    const query = 'SELECT * FROM users WHERE username = $1';
    const result = await db.query(query, [username]);
    return result.rows[0];
  },
  create: async (username, passwordHash) => {
    const query = 'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING *';
    const result = await db.query(query, [username, passwordHash]);
    return result.rows[0];
  }
};
