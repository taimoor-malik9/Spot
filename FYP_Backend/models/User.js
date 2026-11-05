const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  passwordHash: {
    type: String,
    default: null,
  },
  googleId: {
    type: String,
    default: null,
    sparse: true,
  },
  provider: {
    type: String,
    enum: ['local', 'google'],
    default: 'local',
  },
  picture: {
    type: String,
    default: null,
  },
  businessName: {
    type: String,
    default: '',
    trim: true,
  },
  businessType: {
    type: String,
    default: 'retail',
    trim: true,
  },
  currency: {
    type: String,
    default: 'Rs',
    trim: true,
  },
  workingHoursPerDay: {
    type: Number,
    default: 8,
  },
  preferredLanguage: {
    type: String,
    enum: ['en', 'ur-roman', 'ur'],
    default: 'en',
  },
  securityQuestions: [
    {
      questionId: {
        type: String,
        required: true,
      },
      answerHash: {
        type: String,
        required: true,
      },
    },
  ],
  failedRecoveryAttempts: {
    type: Number,
    default: 0,
  },
  recoveryLockUntil: {
    type: Date,
    default: null,
  },
  recoveryTokenHash: {
    type: String,
    default: null,
  },
  recoveryTokenExpires: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('User', userSchema);
