const express = require('express');
const router = express.Router();
const { generateProcess, AiValidationError } = require('./aiService');

// POST /api/ai/generate-process
// body: { description: string, history?: Array<{role, content}> }
router.post('/generate-process', async (req, res) => {
  const { description, history } = req.body;

  if (!description || typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'description is required' });
  }

  try {
    const result = await generateProcess(description, history || []);

    if (result.type === 'clarification') {
      return res.status(200).json({
        type: 'clarification',
        question: result.question
      });
    }

    // type === 'diagram', already structurally validated
    return res.status(200).json({
      type: 'diagram',
      summary: result.summary,
      nodes: result.nodes,
      edges: result.edges,
      resources: result.resources
    });

  } catch (err) {
    if (err instanceof AiValidationError) {
      console.error('AI validation failed:', err.message, err.offendingData);
      return res.status(502).json({
        error: 'AI produced an invalid diagram',
        detail: err.message,
        raw_snippet: err.offendingData // remove this field once things are stable; useful only for debugging
      });
    }
    console.error('AI generation error:', err);
    return res.status(500).json({ error: 'AI generation failed' });
  }
});

module.exports = router;