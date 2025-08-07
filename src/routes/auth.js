// src/routes/auth.js

const express        = require('express');
const multer         = require('multer');
const router         = express.Router();
const authController = require('../controllers/authController');

// Multer config: store uploads in public/avatars
const upload = multer({
  dest: 'public/avatars/',
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB max
});

// Middleware to require fields
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

// Signup with avatar upload
router.post(
  '/signup',
  upload.single('avatar'),
  requireFields(['username', 'email', 'password']),
  authController.signup
);

// Login
router.post(
  '/login',
  requireFields(['username', 'password']),
  authController.login
);

// Forgot password
router.post(
  '/forgot',
  requireFields(['email']),
  authController.forgotPassword
);

// Reset password
router.post(
  '/reset',
  requireFields(['userId', 'token', 'newPassword']),
  authController.resetPassword
);

module.exports = router;