// FYP_Backend/routes/aiRateLimit.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const aiRouter = require('./ai');

function createRateLimitTestApp(userId, ip = '127.0.0.1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = userId ? { _id: userId, id: userId.toString() } : null;
    req.ip = ip;
    next();
  });
  app.use('/api/ai', aiRouter);
  return app;
}

describe('AI Endpoint Rate Limiting (Module AI-RL)', () => {
  it('enforces 30 requests limit per user and returns localized error in Roman Urdu', async () => {
    const userId = new mongoose.Types.ObjectId();
    const app = createRateLimitTestApp(userId);
    const server = app.listen(0);
    const port = server.address().port;

    try {
      let lastRes = null;
      let lastStatus = null;
      // Send 31 requests
      for (let i = 0; i < 31; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/api/ai/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summary: { test: true },
            message: 'hello',
            preferredLanguage: 'ur-roman',
          }),
        });
        lastStatus = res.status;
        lastRes = await res.json();
      }

      assert.strictEqual(lastStatus, 429, '31st request should be rate-limited with HTTP 429');
      assert.strictEqual(lastRes.rateLimited, true);
      assert.match(lastRes.error, /Aapne 15 minute mein bohot zyada AI requests bhej di hain/);
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  it('returns localized error in Urdu script when preferredLanguage is ur', async () => {
    const userId = new mongoose.Types.ObjectId();
    const app = createRateLimitTestApp(userId);
    const server = app.listen(0);
    const port = server.address().port;

    try {
      let lastRes = null;
      let lastStatus = null;
      for (let i = 0; i < 31; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/api/ai/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summary: { test: true },
            message: 'hello',
            preferredLanguage: 'ur',
          }),
        });
        lastStatus = res.status;
        lastRes = await res.json();
      }

      assert.strictEqual(lastStatus, 429);
      assert.strictEqual(lastRes.rateLimited, true);
      assert.match(lastRes.error, /آپ نے 15 منٹ میں بہت زیادہ AI درخواستیں بھیجی ہیں/);
    } finally {
      await new Promise(r => server.close(r));
    }
  });
});
