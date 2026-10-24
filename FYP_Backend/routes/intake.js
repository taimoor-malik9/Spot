// FYP_Backend/routes/intake.js
const express = require('express');
const router = express.Router();
const { parseIntakeAnswer } = require('../services/intakeService');

/**
 * POST /api/intake/parse-answer
 *
 * Accepts: { screenId, text, currentAnswers, rawDiagram }
 * Returns:
 *   - { value: { ...fieldsForScreen }, text }
 *   - { proposal: "...", proposedValue: { ...fieldsForScreen }, text }
 *   - { fallback: true, text }
 *
 * The endpoint must NEVER fail (even on 429, timeout, network error, etc.).
 */
router.post('/parse-answer', async (req, res) => {
  const { screenId, text, currentAnswers, rawDiagram } = req.body || {};

  try {
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(200).json({
        fallback: true,
        text: text || '',
      });
    }

    const result = await parseIntakeAnswer({
      screenId: Number(screenId),
      text: text.trim(),
      currentAnswers: currentAnswers || {},
      rawDiagram: rawDiagram || {},
    });

    return res.status(200).json(result);
  } catch (err) {
    console.warn('⚠️ POST /api/intake/parse-answer caught unexpected error, returning fallback:', err.message);
    return res.status(200).json({
      fallback: true,
      text: text || '',
      reason: err.message,
    });
  }
});

module.exports = router;
