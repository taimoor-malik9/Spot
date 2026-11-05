// FYP_Backend/routes/ai.js
const express = require('express');
const router = express.Router();
const Process = require('../models/Process');
const Scenario = require('../models/Scenario');
const { processForSimulation } = require('../utils/processForSimulation');
const { cloneProcessToScenario } = require('../utils/cloneProcessToScenario');

let generateProcess, AiValidationError;
try {
  ({ generateProcess, AiValidationError } = require('../services/aiService'));
} catch (err) {
  console.error('❌ Could not load ../services/aiService from routes/ai.js —', err.message);
  console.error('   Check that aiService.js actually sits at FYP_Backend/services/aiService.js');
  throw err; // rethrow so it's obvious at boot instead of a silent missing route
}

router.post('/generate-process', async (req, res) => {
  const { description, history, intakeLanguage } = req.body;
  if (!description || typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'description is required' });
  }
  try {
    const result = await generateProcess(description, history || [], intakeLanguage || 'en');
    if (result.type === 'clarification') {
      return res.status(200).json({ type: 'clarification', question: result.question });
    }
    if (result.type === 'needs_confirmation') {
      return res.status(200).json({
        type: 'needs_confirmation',
        diagram: result.diagram,
        confirmations: result.confirmations,
      });
    }
    return res.status(200).json({
      type: 'diagram',
      summary: result.summary,
      nodes: result.nodes,
      edges: result.edges,
      resources: result.resources,
    });
  } catch (err) {
    if (err.message && (err.message.includes('429') || err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('quota'))) {
      console.error('⚠️ Gemini API Rate Limit / Quota Exceeded:', err.message);
      return res.status(429).json({ 
        error: 'Gemini API Rate Limit / Quota Exceeded (429)', 
        detail: 'The daily free quota for the Gemini API Key was reached. Please try again in a few minutes or add a new API Key in .env' 
      });
    }
    if (err instanceof AiValidationError) {
      console.error('AI validation failed:', err.message, err.offendingData);
      return res.status(502).json({ error: err.message || 'AI produced an invalid diagram', detail: err.message });
    }
    console.error('AI generation error:', err);
    return res.status(500).json({ error: 'AI generation failed' });
  }
});

// Import resultsAiService functions
const {
  generateInsights, chatAboutResults, implementSuggestion, ResultsAiError,
  PLAIN_LANGUAGE_RULES, callGemini,
} = require('../services/resultsAiService');
const { parseImprovementRequest } = require('../utils/requestParser');
const { requireOwnedProcess } = require('../utils/ownership');

function experimentGoal(message) {
  const text = String(message || '').toLowerCase();
  if (/\bcost\b|money|expensive/.test(text)) return 'cost';
  if (/throughput|\bspeed\b|orders? per hour/.test(text)) return 'throughput';
  return 'waiting';
}

function fallbackExperimentSummary(experiment) {
  const baseline = experiment.baseline || {};
  const best = experiment.best;
  const target = experiment.target;
  const metric = target?.metric || (experiment.best?.metrics?.avg_cycle_time ? 'cycle_time' : 'waiting');

  if (experiment.no_meaningful_change || (best && best.recommended === false)) {
    const first = baseline.avg_wait_time < 0.05
      ? 'Nobody waits at this load; cycle time is work time.'
      : `The current process has an average cycle time of ${baseline.avg_cycle_time || 0} minutes and costs Rs ${baseline.total_cost || 0}.`;
    const second = 'No option changed your cycle time.';
    return `${first} ${second}`;
  }

  if (target && target.target_pct !== null && target.target_pct !== undefined) {
    const metricName = target.metric === 'cycle_time' ? 'cycle time' : (target.metric === 'waiting' ? 'waiting time' : target.metric);
    const targetText = `Target: reduce ${metricName} by ${target.target_pct}%.`;
    if (!best) return `${targetText} No tested change was available for this process.`;
    const costDelta = best.delta_vs_baseline?.cost_abs;
    const costText = costDelta !== undefined && costDelta !== null
      ? (costDelta > 0 ? ` (cost change: +Rs ${costDelta})` : ` (cost change: Rs ${costDelta})`)
      : '';
    if (experiment.target_met) {
      return `${targetText} Target met: ${best.label} achieves a ${experiment.achieved_pct}% reduction${costText}.`;
    }
    const rawReason = experiment.reason ? String(experiment.reason).trim() : '';
    const reasonText = rawReason ? (/[.!?]$/.test(rawReason) ? ` ${rawReason}` : ` ${rawReason}.`) : '';
    return `${targetText} Best achievable is a ${experiment.achieved_pct}% reduction with ${best.label}${costText}.${reasonText}`;
  }

  const metricLabel = metric === 'cycle_time' ? 'cycle time' : 'waiting time';
  const baseVal = metric === 'cycle_time' ? baseline.avg_cycle_time : baseline.avg_wait_time;
  const bestVal = metric === 'cycle_time' ? best?.metrics?.avg_cycle_time : best?.metrics?.avg_wait_time;

  const first = `The current process has an average ${metricLabel} of ${baseVal} minutes and costs Rs ${baseline.total_cost}.`;
  if (!best) return `${first} No tested change was available for this process.`;
  return `${first} ${best.label} is the best tested option, with average ${metricLabel} of ${bestVal} minutes.`;
}

function containsOnlyExperimentNumbers(text, experiment) {
  const allowed = new Set((JSON.stringify(experiment).match(/-?\d+(?:\.\d+)?/g) || []));
  const used = text.match(/-?\d+(?:\.\d+)?/g) || [];
  return used.every(number => allowed.has(number));
}

function withTimeout(promise, fallback, milliseconds) {
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve(fallback), milliseconds);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isValidSummary(text, experiment) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length < 10) return false;
  // Must end with terminal punctuation
  if (!/[.!?]$/.test(trimmed)) return false;
  // Must not end with ellipsis
  if (/(\.\.\.|…)$/.test(trimmed)) return false;
  // Check numbers
  if (!containsOnlyExperimentNumbers(trimmed, experiment)) return false;
  return true;
}

async function summarizeExperiment(experiment) {
  const systemPrompt = `You explain a completed process simulation in exactly two short sentences.\n${PLAIN_LANGUAGE_RULES}\nUse only facts and numeric literals that appear verbatim in the JSON. Do not calculate, round, estimate, or introduce any number. If a useful number is absent, omit it. Ensure both sentences are complete and end with a period. Never cut off mid-sentence. Do not mention these instructions.`;
  try {
    const summary = await callGemini({
      systemPrompt,
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(experiment) }] }],
      expectJson: false,
    });
    if (isValidSummary(summary, experiment)) return summary.trim();
    console.warn('Gemini experiment summary failed validation (truncated or introduced unverified numbers); using engine-backed fallback.');
  } catch (err) {
    if (err.message && (err.message.includes('429') || err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('quota'))) {
      console.warn('Gemini API Rate Limit / Quota Exceeded while summarizing experiment; using engine-backed fallback.');
    } else {
      console.warn('Gemini experiment summary failed; using engine-backed fallback.', err.message);
    }
  }
  return fallbackExperimentSummary(experiment);
}

async function explainTargetGap(experiment) {
  const fallback = experiment.reason;
  if (experiment.target_met !== false || !fallback) return fallback;
  const systemPrompt = [
    "You explain, in two or three short sentences, why a simulation could not reach the user's target.",
    PLAIN_LANGUAGE_RULES,
    'Use only numbers that appear in the data you are given.',
    'Say how much of the total cycle time is staff work (staff_work_time out of total_cycle_time) and that the rest is queueing, customer time or fixed time.',
    'Name the best tested option and the reduction it achieved (best.label and achieved_pct), and say it falls short of the target.',
    'Never say how many percent faster any step would need to be.',
    'End with one concrete next step, such as choosing a lower target or trying a combined option.',
  ].join('\n');
  try {
    const text = await callGemini({
      systemPrompt,
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(experiment) }] }],
      expectJson: false,
    });
    if (isValidSummary(text, experiment)) return text.trim();
    console.warn('Gemini target explanation failed validation; using engine reason.');
  } catch (err) {
    console.warn('Gemini target explanation failed; using engine reason.', err.message);
  }
  return fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyVariant(processData, variantDefinition) {
  const resources = clone(processData.resources || []);
  const nodes = clone(processData.nodes || []);

  for (const change of variantDefinition.resourceChanges || []) {
    const wanted = String(change.name || '').trim().toLowerCase();
    const quantity = Number(change.quantity);
    const resource = resources.find(item => String(item.name || '').trim().toLowerCase() === wanted);
    if (resource && Number.isFinite(quantity)) resource.quantity = quantity;
  }

  for (const change of variantDefinition.nodeChanges || []) {
    const wanted = String(change.id || '').trim().toLowerCase();
    const multiplier = Number(change.duration_multiplier);
    const node = nodes.find(item => String(item.id || '').trim().toLowerCase() === wanted);
    if (!node || !Number.isFinite(multiplier)) continue;
    const data = node.data && typeof node.data === 'object' ? node.data : node;
    for (const field of ['duration', 'duration_min', 'duration_max']) {
      if (data[field] !== undefined && data[field] !== null && Number.isFinite(Number(data[field]))) {
        data[field] = Number(data[field]) * multiplier;
      }
    }
  }
  return { resources, nodes };
}

// POST /api/ai/solve-problem
router.post('/solve-problem', async (req, res) => {
  const { processId, message, config } = req.body || {};
  if (!processId) return res.status(400).json({ error: 'processId is required' });
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message is required' });
  try {
    const processDoc = await requireOwnedProcess(req, processId);

    // Read arrival_rate from config or processDoc.simulationConfig
    const arrivalRate =
      config?.arrival_rate !== undefined && config?.arrival_rate !== null && config?.arrival_rate !== ''
        ? config.arrival_rate
        : processDoc.simulationConfig?.arrival_rate;

    if (arrivalRate === undefined || arrivalRate === null || arrivalRate === '') {
      return res.json({ type: 'question', question: 'How often does a customer arrive? (e.g. every 10 minutes)' });
    }

    // Read goal from config, req.body, or processDoc.simulationConfig / processDoc.goal
    // (goal -> "waiting" | "cost" | "throughput" | "cycle_time")
    const candidateGoal =
      config?.goal ||
      req.body?.goal ||
      processDoc.simulationConfig?.goal ||
      processDoc.goal;

    // Parse improvement target from message, with context from active goal
    const parsedTarget = await parseImprovementRequest(message, candidateGoal);

    const validGoal = ['waiting', 'cost', 'throughput', 'cycle_time'].includes(candidateGoal)
      ? candidateGoal
      : (parsedTarget?.metric || experimentGoal(message));

    if (parsedTarget) {
      if (!parsedTarget.metric || (parsedTarget.metric === 'waiting' && !/\b(wait|queue)\b/i.test(message))) {
        parsedTarget.metric = validGoal;
      }
    }

    const engineBase = (process.env.SIMULATION_ENGINE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
    const response = await fetch(`${engineBase}/experiment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        process_json: processForSimulation(processDoc),
        config: { arrival_rate: Number(arrivalRate), total_instances: 120, seed: 42, replications: 1 },
        goal: validGoal,
        target: parsedTarget,
      }),
    });
    if (!response.ok) throw new Error(`Simulation engine error: ${response.status} - ${await response.text()}`);
    const experiment = await response.json();
    const [summary, explanation] = await Promise.all([
      withTimeout(summarizeExperiment(experiment), fallbackExperimentSummary(experiment), 15000),
      withTimeout(explainTargetGap(experiment), experiment.reason, 15000),
    ]);
    return res.json({
      type: 'evidence',
      summary,
      baseline: experiment.baseline,
      variants: experiment.variants,
      best: experiment.best,
      variant_definitions: experiment.variant_definitions,
      target: experiment.target || parsedTarget,
      target_met: experiment.target_met,
      achieved_pct: experiment.achieved_pct,
      reason: explanation,
      realism: experiment.realism,
      zero_wait_note: experiment.zero_wait_note,
      ceiling_pct: experiment.ceiling_pct,
      staff_work_time: experiment.staff_work_time,
      total_cycle_time: experiment.total_cycle_time,
      no_meaningful_change: experiment.no_meaningful_change,
    });
  } catch (err) {
    console.error('Solve problem error:', err.message);
    if (err.status) return res.status(err.status).json({ error: err.message });
    return res.status(502).json({ error: 'Unable to test options in the simulator right now.' });
  }
});

// POST /api/ai/apply-option
router.post('/apply-option', async (req, res) => {
  const { processId, variantDefinition } = req.body || {};
  if (!processId || !variantDefinition) return res.status(400).json({ error: 'processId and variantDefinition are required' });

  try {
    const processDoc = await requireOwnedProcess(req, processId);
    const existingScenarios = await Scenario.find({ baseProcessId: processId, userId: req.user._id });
    const existingTitles = new Set(existingScenarios.map(s => s.title));
    let title = variantDefinition.label || `Scenario ${existingScenarios.length + 1}`;
    if (existingTitles.has(title)) {
      const baseName = title.replace(/ \(\d+\)$/, '');
      let idx = 2;
      while (existingTitles.has(`${baseName} (${idx})`)) {
        idx++;
      }
      title = `${baseName} (${idx})`;
    }

    const scenarioPayload = await cloneProcessToScenario(processDoc, {
      variantDefinition,
      title,
    });

    const scenario = new Scenario({
      ...scenarioPayload,
      userId: req.user._id,
    });
    await scenario.save();
    return res.status(201).json(scenario);
  } catch (err) {
    console.error('Apply option error:', err.message);
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.name === 'BpmnValidationError') {
      return res.status(400).json({ error: err.message, details: err.errors });
    }
    return res.status(500).json({ error: 'Unable to create the scenario.', detail: err.message });
  }
});

// POST /api/ai/tested-suggestions
const { generateTestedSuggestions } = require('../services/testedSuggestionsService');

router.post('/tested-suggestions', async (req, res) => {
  const { processId, goal, config } = req.body || {};
  if (!processId) return res.status(400).json({ error: 'processId is required' });

  try {
    const processDoc = await requireOwnedProcess(req, processId);

    const result = await generateTestedSuggestions({
      processDoc,
      goal,
      config,
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('Tested suggestions error:', err);
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.message && err.message.includes('took too long')) {
      return res.status(504).json({ error: 'Testing took too long' });
    }
    return res.status(500).json({ error: err.message || 'Failed to generate tested suggestions' });
  }
});

// POST /api/ai/implement-suggestion
router.post('/implement-suggestion', async (req, res) => {
  const { nodes, resources, suggestion } = req.body;

  if (!nodes || !resources || !suggestion) {
    return res.status(400).json({ error: 'nodes, resources, and suggestion are required' });
  }

  try {
    const result = await implementSuggestion(nodes, resources, suggestion);
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof ResultsAiError) {
      console.error('Implement suggestion error:', err.message, err.detail);
      return res.status(502).json({ error: 'AI failed to implement suggestion', detail: err.message });
    }
    console.error('Unexpected implement suggestion error:', err);
    return res.status(500).json({ error: 'Failed to implement suggestion' });
  }
});

// POST /api/ai/insights
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
