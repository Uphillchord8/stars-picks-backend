// src/routes/auth.js

const express     = require('express');
const bcrypt      = require('bcrypt');
const jwt         = require('jsonwebtoken');
const multer      = require('multer');
const mongoose    = require('mongoose');
const User        = require('../models/user');
const authController = require('../controllers/authController'); // for login/forgot/reset
const router      = express.Router();

// Multer config: store uploads in memory (we'll stream into GridFS)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB max
});

// Simple middleware to require fields in req.body
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

/**
 * POST /auth/signup
 * — Create user, optionally store avatar in GridFS, return user + token
 */
router.post(
  '/signup',
  upload.single('avatar'),
  requireFields(['username', 'email', 'password']),
  async (req, res, next) => {
    try {
      const { username, email, password } = req.body;

      // 1) Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // 2) Create the user (no avatarUrl yet)
      const user = await User.create({ username, email, passwordHash });

      // 3) If avatar was uploaded, stream into GridFS
      if (req.file) {
        const ext      = req.file.mimetype.split('/')[1] || 'png';
        const filename = `${user.id}.${ext}`;
        const bucket   = new mongoose.mongo.GridFSBucket(
          mongoose.connection.db,
          { bucketName: 'avatars' }
        );

        const uploadStream = bucket.openUploadStream(filename, {
          contentType: req.file.mimetype
        });
        uploadStream.end(req.file.buffer);

        // Wait until GridFS has written the file
        await new Promise((resolve, reject) => {
          uploadStream.on('finish', resolve);
          uploadStream.on('error', reject);
        });

        user.avatarUrl = `/avatars/${filename}`;
        await user.save();
      }

      // 4) Issue JWT
      const token = jwt.sign(
        { id: user.id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      // 5) Return the sanitized user object + token
      return res.json({
        user: {
          id:               user.id,
          username:         user.username,
          email:            user.email,
          avatarUrl:        user.avatarUrl,
          defaultFirstGoal: user.defaultFirstGoal,
          defaultGWG:       user.defaultGWG
        },
        token
      });
    } catch (err) {
      // handle duplicates
      if (err.code === 11000) {
        return res.status(409).json({ error: 'Username or email already exists' });
      }
      next(err);
    }
  }
);

// Login, forgot-password, reset-password remain in your authController
router.post(
  '/login',
  requireFields(['username', 'password']),
  authController.login
);

router.post(
  '/forgot',
  requireFields(['email']),
  authController.forgotPassword
);

router.post(
  '/reset',
  requireFields(['userId', 'token', 'newPassword']),
  authController.resetPassword
);

module.exports = router;