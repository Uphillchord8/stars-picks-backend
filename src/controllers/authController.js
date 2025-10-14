// src/controllers/authController.js

const crypto     = require('crypto');
const bcrypt     = require('bcrypt');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const User       = require('../models/user');
const Token      = require('../models/token');

// POST /auth/login
exports.login = async (req, res) => {
  const { username, password, remember } = req.body;
  try {
    const user = await User.findOne({ username }).lean();
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: remember ? '30d' : '1d' }
    );

    return res.json({
      token,
      user: {
        id:               user._id,
        username:         user.username,
        email:            user.email,
        avatarUrl:        user.avatarUrl,
        defaultFirstGoal: user.defaultFirstGoal,
        defaultGWG:       user.defaultGWG
      }
    });
  } catch (err) {
    console.error('LOGIN ERROR:', err);
    return res.status(500).json({ error: 'Server error during login' });
  }
};

// POST /auth/signup
exports.signup = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const avatarFile = req.file; // from multer

    const avatarUrl = avatarFile
      ? `/avatars/${avatarFile.filename}`
      : null;

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      username,
      email,
      passwordHash,
      avatarUrl
    });

    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      token,
      user: {
        id:               user._id,
        username:         user.username,
        email:            user.email,
        avatarUrl:        user.avatarUrl,
        defaultFirstGoal: user.defaultFirstGoal,
        defaultGWG:       user.defaultGWG
      }
    });
  } catch (err) {
    console.error('SIGNUP ERROR:', err);
    if (err.code === 11000) {
      const field = Object.keys(err.keyValue)[0];
      return res.status(400).json({ error: `${field} already in use` });
    }
    return res.status(500).json({ error: 'Server error during signup' });
  }
};

// POST /auth/forgot
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email }).lean();
    if (!user) {
      return res.json({ message: 'If that email exists, check your inbox.' });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hash     = await bcrypt.hash(rawToken, 10);
    const expires  = new Date(Date.now() + 60 * 60 * 1000); // 1h

    await Token.create({ userId: user._id, token: hash, expiresAt: expires });

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: +process.env.SMTP_PORT,
      secure: false, // SendGrid uses TLS on port 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${rawToken}&id=${user._id}`;
    try {
      await transporter.sendMail({
        from: `"No Reply" <${process.env.SMTP_USER}>`,
        to: user.email,
        subject: 'Password Reset Request',
        html: `<p>Reset your password ${resetUrl}here</a>. Link expires in 1 hour.</p>`
      });
    } catch (emailErr) {
      console.error('❌ Email send failed:', emailErr);
    }

    return res.json({ message: 'If that email exists, check your inbox.' });
  } catch (err) {
    console.error('FORGOT-PW ERROR:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// POST /auth/reset
exports.resetPassword = async (req, res) => {
  const { userId, token, newPassword } = req.body;
  try {
    const record = await Token.findOne({
      userId,
      expiresAt: { $gt: new Date() }
    });
    if (!record) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const match = await bcrypt.compare(token, record.token);
    if (!match) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(userId, { passwordHash });
    await Token.deleteOne({ _id: record._id });

    return res.json({ message: 'Password has been reset. You can now log in.' });
  } catch (err) {
    console.error('RESET-PW ERROR:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};