// src/middleware/auth.js

const jwt = require('jsonwebtoken');

/**
 * Protects a route by verifying the JWT.
 * On success: req.user = { id, username, ... }
 * On failure: 401 Unauthorized
 */
module.exports = function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = header.split(' ')[1];
  try {
    // Verify and decode
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Attach user info to the request object
    req.user = { id: payload.id, username: payload.username };
    return next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};