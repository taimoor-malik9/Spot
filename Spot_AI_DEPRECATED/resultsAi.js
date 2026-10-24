const express = require('express');
const router = express.Router();
const { generateInsights, chatAboutResults, ResultsAiError } = require('./resultsAiService');

// POST /api/ai/insights
// body: { summary: object }  — the compact summary from aiSummary.js, NOT the raw results
router.post('/insights', async (req, res) => {
  const { summary } = req.body;

  if (!summary || typeof summary !== 'object') {
    return res.status(400).json({ error: 'summary is required' });
  }

  try {
    const insights = await generateInsights(summary);
    return res.status(200).json({ insights });
  } catch (err) {
    if (err instanceof ResultsAiError) {
      console.error('Results AI insights error:', err.message, err.detail);
      return res.status(502).json({ error: 'AI failed to generate insights', detail: err.message });
    }
    console.error('Unexpected insights error:', err);
    return res.status(500).json({ error: 'Insights generation failed' });
  }
});

// POST /api/ai/chat
// body: { summary: object, message: string, history?: Array<{role, content}> }
router.post('/chat', async (req, res) => {
  const { summary, message, history } = req.body;

  if (!summary || typeof summary !== 'object') {
    return res.status(400).json({ error: 'summary is required' });
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const reply = await chatAboutResults(summary, message, history || []);
    return res.status(200).json({ reply });
  } catch (err) {
    if (err instanceof ResultsAiError) {
      console.error('Results AI chat error:', err.message, err.detail);
      return res.status(502).json({ error: 'AI failed to respond', detail: err.message });
    }
    console.error('Unexpected chat error:', err);
    return res.status(500).json({ error: 'Chat failed' });
  }
});

module.exports = router;
