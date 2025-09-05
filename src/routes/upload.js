const express   = require('express');
const multer    = require('multer');
const mongoose  = require('mongoose');
const path      = require('path');
const User      = require('../models/user');
const requireAuth = require('../middleware/auth');

const router = express.Router();

// Multer in‐memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Ensure GridFSBucket is ready
let bucket;
mongoose.connection.once('open', () => {
  bucket = new mongoose.mongo.GridFSBucket(
    mongoose.connection.db,
    { bucketName: 'avatars' }
  );
});

router.post(
  '/avatar',
  requireAuth,
  upload.single('avatar'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Derive filename and content type
      const ext = path.extname(req.file.originalname);
      const filename = `${req.user.id}${ext}`;

      // Stream buffer into GridFS
      const uploadStream = bucket.openUploadStream(filename, {
        contentType: req.file.mimetype
      });
      uploadStream.end(req.file.buffer);

      uploadStream.on('finish', async () => {
        // Save the public URL to the user doc
        const avatarUrl = `/avatars/${filename}`;
        await User.findByIdAndUpdate(
          req.user.id,
          { avatarUrl },
          { new: true }
        );
        res.json({ avatarUrl });
      });

      uploadStream.on('error', err => next(err));
    } catch (err) {
      next(err);
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