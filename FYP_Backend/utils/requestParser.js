// FYP_Backend/utils/requestParser.js
const { callGemini } = require('../services/resultsAiService');

/**
 * Parse user improvement request into:
 * {
 *   metric: 'cycle_time' | 'waiting' | 'throughput' | 'cost' | null,
 *   direction: 'decrease' | 'increase',
 *   target_pct: number | null
 * }
 *
 * Regex-first ("50%", "by half", "twice as fast"), Gemini fallback.
 * Never defaults silently to 20%; if no target is given, target_pct is null.
 */
function parseRequestWithRegex(text) {
  if (!text || typeof text !== 'string') return null;
  const str = text.trim().toLowerCase();

  // 1. Identify Metric
  let metric = null;
  if (/\b(cycle[- ]?time|turnaround|lead[- ]?time|process[- ]?time|total\s+time|time\s+in\s+system)\b/i.test(str)) {
    metric = 'cycle_time';
  } else if (/\b(wait(?:ing)?(?:\s+time)?|queue(?:\s+length|\s+time)?|in\s+line)\b/i.test(str)) {
    metric = 'waiting';
  } else if (/\b(throughput|capacity|volume|orders?\s+per\s+hour|customers?\s+per\s+hour)\b/i.test(str)) {
    metric = 'throughput';
  } else if (/\b(cost|expenses?|spending|budget|cheaper)\b/i.test(str)) {
    metric = 'cost';
  } else if (/\b(fast|faster|speed\s*up|faster\s+service)\b/i.test(str)) {
    metric = 'cycle_time';
  }

  // 2. Identify Target Percentage
  let target_pct = null;
  const pctMatch = str.match(/(?:by\s+|to\s+)?(\d+(?:\.\d+)?)\s*%/i);
  if (pctMatch) {
    target_pct = parseFloat(pctMatch[1]);
  } else if (/\b(?:by\s+|in\s+)?half\b/i.test(str) || /\bcut\s+(?:it\s+)?in\s+half\b/i.test(str)) {
    target_pct = 50;
  } else if (/\b(?:twice\s+as\s+fast|2x\s+faster|double\s+the\s+speed)\b/i.test(str)) {
    target_pct = 50;
  } else if (/\b(?:double|twice\s+as\s+many|2x)\b/i.test(str)) {
    target_pct = metric === 'throughput' ? 100 : 50;
  }

  // 3. Direction
  let direction = 'decrease';
  if (metric === 'throughput') {
    direction = /\b(decrease|reduce|cut|lower)\b/i.test(str) ? 'decrease' : 'increase';
  } else {
    direction = /\b(increase|raise|higher)\b/i.test(str) ? 'increase' : 'decrease';
  }

  if (metric || target_pct !== null) {
    return {
      metric: metric || null,
      direction,
      target_pct: target_pct !== null && !isNaN(target_pct) ? target_pct : null,
    };
  }

  return null;
}

async function parseImprovementRequest(text, contextGoal = null) {
  const regexResult = parseRequestWithRegex(text);
  if (regexResult) {
    if (!regexResult.metric && contextGoal) {
      regexResult.metric = contextGoal;
    }
    if (regexResult.metric) {
      return regexResult;
    }
  }

  // Gemini JSON Fallback
  try {
    const prompt = `You parse an operational process improvement request into a JSON object.\nUser text: "${text}"\nReturn ONLY a raw JSON object with:\n{\n  "metric": "cycle_time" | "waiting" | "throughput" | "cost" | null,\n  "direction": "decrease" | "increase" | null,\n  "target_pct": number | null\n}\nIf no explicit percentage, fraction, or ratio target was stated, target_pct MUST be null (never guess 20%).`;
    const response = await callGemini({
      systemPrompt: 'You extract goal metrics and numeric targets from process questions.',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      expectJson: true,
    });
    if (response && typeof response === 'object') {
      const metric = ['cycle_time', 'waiting', 'throughput', 'cost'].includes(response.metric)
        ? response.metric
        : (contextGoal || 'cycle_time');
      const direction = response.direction === 'increase' ? 'increase' : 'decrease';
      const target_pct = typeof response.target_pct === 'number' && !isNaN(response.target_pct)
        ? response.target_pct
        : (regexResult?.target_pct ?? null);
      return { metric, direction, target_pct };
    }
  } catch (err) {
    console.warn('Gemini request parsing fallback failed:', err.message);
  }

  return {
    metric: regexResult?.metric || contextGoal || 'waiting',
    direction: regexResult?.direction || 'decrease',
    target_pct: regexResult?.target_pct ?? null,
  };
}

module.exports = {
  parseRequestWithRegex,
  parseImprovementRequest,
};
