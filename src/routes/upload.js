// src/routes/upload.js
const express     = require('express');
const multer      = require('multer');
const path        = require('path');
const User        = require('../models/user');
const requireAuth = require('../middleware/auth');

const router = express.Router();

// Where avatars get written
const AVATAR_DIR = path.join(process.cwd(), 'public', 'avatars');

// Multer storage config
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, AVATAR_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.user.id}${ext}`);
  }
});
const upload = multer({ storage });

/**
 * POST /api/user/avatar
 * — Upload a new avatar image
 */
router.post(
  '/avatar',
  requireAuth,
  upload.single('avatar'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      const avatarUrl = `/avatars/${req.file.filename}`;
      await User.findByIdAndUpdate(req.user.id, { avatarUrl });
      return res.json({ avatarUrl });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * POST /api/user/defaults
 * — Save default picks: defaultFirstGoal and/or defaultGWG
 */
router.post(
  '/defaults',
  requireAuth,
  async (req, res, next) => {
    try {
      const updates = {};
      if (req.body.defaultFirstGoal) updates.defaultFirstGoal = req.body.defaultFirstGoal;
      if (req.body.defaultGWG)        updates.defaultGWG       = req.body.defaultGWG;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No defaults provided' });
      }

      const updatedUser = await User.findByIdAndUpdate(
        req.user.id,
        updates,
        { new: true }
      ).lean();

      return res.json({
        defaultFirstGoal: updatedUser.defaultFirstGoal,
        defaultGWG:       updatedUser.defaultGWG
      });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;