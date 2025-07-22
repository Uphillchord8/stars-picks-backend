// src/routes/auth.js
const express        = require('express');
const router         = express.Router();
const authController = require('../controllers/authController');

// Middleware to ensure required fields are present in req.body
function requireFields(fields) {
  return (req, res, next) => {
    for (const field of fields) {
      if (!req.body[field]) {
        return res.status(400).json({ error: `${field} is required` });
      }
    }
    next();
  };
}

// POST /api/auth/login
router.post(
  '/login',
  requireFields(['username', 'password']),
  authController.login
);

// POST /api/auth/signup
router.post(
  '/signup',
  requireFields(['username', 'email', 'password']),
  authController.signup
);

// POST /api/auth/forgot
router.post(
  '/forgot',
  requireFields(['email']),
  authController.forgotPassword
);

// POST /api/auth/reset
router.post(
  '/reset',
  requireFields(['userId', 'token', 'newPassword']),
  authController.resetPassword
);

module.exports = router;