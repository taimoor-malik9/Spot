const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

// 10 fixed questions with IDs q1..q10
const SECURITY_QUESTIONS = [
  { id: 'q1', text: "What is your first pet's name?" },
  { id: 'q2', text: 'In what city were you born?' },
  { id: 'q3', text: 'What was your childhood nickname?' },
  { id: 'q4', text: 'What was the name of your first school?' },
  { id: 'q5', text: 'What street did you grow up on?' },
  { id: 'q6', text: "What is your best childhood friend's name?" },
  { id: 'q7', text: "What was your favorite teacher's name?" },
  { id: 'q8', text: 'What was your first mobile phone model?' },
  { id: 'q9', text: 'What is the first book you remember reading?' },
  { id: 'q10', text: 'What was your favorite childhood food?' },
];

// Rate limiting for login and signup endpoints: 20 requests per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try later.' }
});

// Rate limiting for recovery endpoints: 15 requests per 15 minutes per IP
const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try later.' }
});

const signToken = (userId) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured in environment variables');
  }
  return jwt.sign({ sub: userId }, secret, { expiresIn: '7d' });
};

const sanitizeUser = (userDoc) => {
  const obj = userDoc.toObject ? userDoc.toObject() : { ...userDoc };
  delete obj.passwordHash;
  delete obj.securityQuestions;
  delete obj.recoveryTokenHash;
  delete obj.recoveryTokenExpires;
  delete obj.recoveryLockUntil;
  delete obj.failedRecoveryAttempts;
  return obj;
};

// Normalize security question answers (trim, lowercase, collapse repeated spaces)
const normalizeAnswer = (str) => {
  if (!str || typeof str !== 'string') return '';
  return str.trim().toLowerCase().replace(/\s+/g, ' ');
};

// Password rules: 8+ characters, upper and lower case, a number, a symbol
const validatePassword = (password) => {
  if (!password || typeof password !== 'string') return false;
  if (password.length < 8) return false;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  return hasLower && hasUpper && hasNumber && hasSymbol;
};

// GET /api/auth/security-questions (public)
router.get('/security-questions', (req, res) => {
  return res.json(SECURITY_QUESTIONS);
});

// POST /api/auth/signup
router.post('/signup', authLimiter, async (req, res) => {
  try {
    const { name, email, password, securityQuestions } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Full name is required' });
    }

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Enter a valid email' });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({ error: 'Use 8+ characters' });
    }

    // Validate security questions
    if (!Array.isArray(securityQuestions) || securityQuestions.length !== 2) {
      return res.status(400).json({ error: 'Choose two questions' });
    }

    const q1Id = securityQuestions[0]?.questionId;
    const q2Id = securityQuestions[1]?.questionId;
    const validIds = SECURITY_QUESTIONS.map(q => q.id);

    if (!validIds.includes(q1Id) || !validIds.includes(q2Id) || q1Id === q2Id) {
      return res.status(400).json({ error: 'Choose two different questions' });
    }

    const a1Norm = normalizeAnswer(securityQuestions[0]?.answer);
    const a2Norm = normalizeAnswer(securityQuestions[1]?.answer);

    if (a1Norm.length < 3 || a2Norm.length < 3) {
      return res.status(400).json({ error: 'Answer is too short' });
    }

    // Check duplicate email
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    // Hash password and answers with bcrypt cost 12
    const passwordHash = await bcrypt.hash(password, 12);
    const answer1Hash = await bcrypt.hash(a1Norm, 12);
    const answer2Hash = await bcrypt.hash(a2Norm, 12);

    const user = new User({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      provider: 'local',
      securityQuestions: [
        { questionId: q1Id, answerHash: answer1Hash },
        { questionId: q2Id, answerHash: answer2Hash }
      ]
    });

    await user.save();

    const token = signToken(user._id);

    return res.status(201).json({
      token,
      user: sanitizeUser(user)
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Email already in use' });
    }
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Signup failed' });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.passwordHash) {
      return res.status(401).json({ error: 'Use Google to sign in' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user._id);

    return res.json({
      token,
      user: sanitizeUser(user)
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/google
router.post('/google', async (req, res) => {
  try {
    const { code, credential } = req.body || {};
    if (!code && !credential) {
      return res.status(400).json({ error: 'Authorization code or credential is required' });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId) {
      console.error('❌ Missing environment variable: GOOGLE_CLIENT_ID in FYP_Backend/.env');
      return res.status(500).json({ error: 'Google client ID not configured on server' });
    }

    let idToken = credential;

    if (code) {
      if (!clientSecret || clientSecret.includes('placeholder')) {
        console.error('❌ GOOGLE_CLIENT_SECRET is missing or set to placeholder in FYP_Backend/.env');
        return res.status(400).json({ error: 'Google client secret not configured on server' });
      }

      const oauth2Client = new OAuth2Client(clientId, clientSecret, 'postmessage');
      let tokens;
      try {
        const tokenRes = await oauth2Client.getToken(code);
        tokens = tokenRes.tokens;
      } catch (tokenErr) {
        console.error('Google token exchange error:', tokenErr.message);
        if (tokenErr.message.includes('invalid_client')) {
          return res.status(401).json({ error: 'Invalid Google client secret on server' });
        }
        if (tokenErr.message.includes('invalid_grant')) {
          return res.status(400).json({ error: 'Google authorization code expired' });
        }
        return res.status(400).json({ error: tokenErr.message || 'Google token exchange failed' });
      }

      if (!tokens || !tokens.id_token) {
        return res.status(400).json({ error: 'Failed to retrieve Google token' });
      }
      idToken = tokens.id_token;
    }

    const oauth2Client = new OAuth2Client(clientId);
    const ticket = await oauth2Client.verifyIdToken({
      idToken,
      audience: clientId,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      console.warn('Google ID token does not contain an email address');
      return res.status(401).json({ error: 'Invalid Google account data' });
    }

    if (payload.email_verified === false) {
      console.warn(`Google account email ${payload.email} is not verified`);
      return res.status(401).json({ error: 'Google email not verified' });
    }

    const googleId = payload.sub;
    const normalizedEmail = payload.email.trim().toLowerCase();
    const name = payload.name || payload.given_name || normalizedEmail.split('@')[0];
    const picture = payload.picture || null;

    let user = await User.findOne({ email: normalizedEmail });

    if (user) {
      let changed = false;
      if (!user.googleId) {
        user.googleId = googleId;
        changed = true;
      }
      if (picture && !user.picture) {
        user.picture = picture;
        changed = true;
      }
      if (changed) {
        await user.save();
      }
    } else {
      user = new User({
        name,
        email: normalizedEmail,
        googleId,
        provider: 'google',
        picture,
      });
      await user.save();
    }

    const token = signToken(user._id);

    return res.json({
      token,
      user: sanitizeUser(user)
    });
  } catch (err) {
    console.error('Google auth error:', err.message);
    return res.status(500).json({ error: err.message || 'Google sign-in failed' });
  }
});

// POST /api/auth/recovery/start
router.post('/recovery/start', recoveryLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({ error: 'No account found with this email' });
    }

    if (!user.securityQuestions || user.securityQuestions.length !== 2) {
      return res.status(400).json({ error: 'No security questions set for this account' });
    }

    const q1Obj = SECURITY_QUESTIONS.find(q => q.id === user.securityQuestions[0].questionId);
    const q2Obj = SECURITY_QUESTIONS.find(q => q.id === user.securityQuestions[1].questionId);

    if (!q1Obj || !q2Obj) {
      return res.status(400).json({ error: 'Security questions not found' });
    }

    return res.json({
      questions: [
        { questionId: q1Obj.id, text: q1Obj.text },
        { questionId: q2Obj.id, text: q2Obj.text }
      ]
    });
  } catch (err) {
    console.error('Recovery start error:', err);
    return res.status(500).json({ error: 'Recovery failed' });
  }
});

// POST /api/auth/recovery/verify
router.post('/recovery/verify', recoveryLimiter, async (req, res) => {
  try {
    const { email, answers } = req.body || {};
    if (!email || !Array.isArray(answers) || answers.length !== 2) {
      return res.status(400).json({ error: "Answers don't match" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normA1 = normalizeAnswer(answers[0]);
    const normA2 = normalizeAnswer(answers[1]);

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({ error: 'No account found with this email' });
    }

    if (!user.securityQuestions || user.securityQuestions.length !== 2) {
      return res.status(400).json({ error: 'No security questions set for this account' });
    }

    // Check account lockout
    if (user.recoveryLockUntil && user.recoveryLockUntil > new Date()) {
      return res.status(429).json({ error: 'Too many attempts. Try later' });
    }

    const m1 = await bcrypt.compare(normA1, user.securityQuestions[0].answerHash);
    const m2 = await bcrypt.compare(normA2, user.securityQuestions[1].answerHash);
    const isMatch = m1 && m2;

    if (!isMatch) {
      user.failedRecoveryAttempts = (user.failedRecoveryAttempts || 0) + 1;
      if (user.failedRecoveryAttempts >= 5) {
        user.recoveryLockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min lock
        await user.save();
        return res.status(429).json({ error: 'Too many attempts. Try later' });
      }
      await user.save();
      return res.status(400).json({ error: "Answers don't match" });
    }

    // Verified: generate single-use 32-byte recovery token with 10-minute expiry
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    user.recoveryTokenHash = tokenHash;
    user.recoveryTokenExpires = new Date(Date.now() + 10 * 60 * 1000);
    user.failedRecoveryAttempts = 0;
    user.recoveryLockUntil = null;
    await user.save();

    return res.json({ token: rawToken });
  } catch (err) {
    console.error('Recovery verify error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

// POST /api/auth/recovery/reset
router.post('/recovery/reset', recoveryLimiter, async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || typeof token !== 'string' || !password) {
      return res.status(400).json({ error: 'Session expired. Start again.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
    const user = await User.findOne({
      recoveryTokenHash: tokenHash,
      recoveryTokenExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ error: 'Session expired. Start again.' });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({ error: 'Use 8+ characters' });
    }

    user.passwordHash = await bcrypt.hash(password, 12);
    user.recoveryTokenHash = null;
    user.recoveryTokenExpires = null;
    user.failedRecoveryAttempts = 0;
    user.recoveryLockUntil = null;
    await user.save();

    return res.json({ message: 'Password updated' });
  } catch (err) {
    console.error('Recovery reset error:', err);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

// POST /api/auth/security-questions (authenticated update)
router.post('/security-questions', requireAuth, async (req, res) => {
  try {
    const { currentPassword, securityQuestions } = req.body || {};
    const user = req.user;

    if (user.passwordHash) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required' });
      }
      const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isMatch) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }

    if (!Array.isArray(securityQuestions) || securityQuestions.length !== 2) {
      return res.status(400).json({ error: 'Choose two questions' });
    }

    const q1Id = securityQuestions[0]?.questionId;
    const q2Id = securityQuestions[1]?.questionId;
    const validIds = SECURITY_QUESTIONS.map(q => q.id);

    if (!validIds.includes(q1Id) || !validIds.includes(q2Id) || q1Id === q2Id) {
      return res.status(400).json({ error: 'Choose two different questions' });
    }

    const a1Norm = normalizeAnswer(securityQuestions[0]?.answer);
    const a2Norm = normalizeAnswer(securityQuestions[1]?.answer);

    if (a1Norm.length < 3 || a2Norm.length < 3) {
      return res.status(400).json({ error: 'Answer is too short' });
    }

    const hash1 = await bcrypt.hash(a1Norm, 12);
    const hash2 = await bcrypt.hash(a2Norm, 12);

    user.securityQuestions = [
      { questionId: q1Id, answerHash: hash1 },
      { questionId: q2Id, answerHash: hash2 }
    ];

    await user.save();

    return res.json({ message: 'Security questions updated' });
  } catch (err) {
    console.error('Update security questions error:', err);
    return res.status(500).json({ error: 'Failed to update security questions' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const user = req.user;

    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'New password is required' });
    }

    if (user.passwordHash) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required' });
      }
      const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isMatch) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      if (currentPassword === newPassword) {
        return res.status(400).json({ error: 'New password must differ' });
      }
    }

    if (!validatePassword(newPassword)) {
      return res.status(400).json({ error: 'Use 8+ characters' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();

    return res.status(200).json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'Failed to change password' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  return res.json({ user: sanitizeUser(req.user) });
});

module.exports = router;
