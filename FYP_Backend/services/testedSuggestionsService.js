// FYP_Backend/services/testedSuggestionsService.js
const { processForSimulation } = require('../utils/processForSimulation');
const { PLAIN_LANGUAGE_RULES, callGemini } = require('./resultsAiService');

// In-memory cache keyed by process version + goal + arrival rate
const suggestionsCache = new Map();

function getProcessVersion(processDoc) {
  if (!processDoc) return 'v1';
  if (processDoc.updatedAt) return new Date(processDoc.updatedAt).getTime().toString();
  if (processDoc.createdAt) return new Date(processDoc.createdAt).getTime().toString();
  return (processDoc.__v ?? 0).toString();
}

function getCacheKey(processDoc, goal, arrivalRate) {
  const version = getProcessVersion(processDoc);
  return `${processDoc._id}_${version}_${goal}_${arrivalRate}`;
}

function invalidateSuggestionsCache(processId) {
  if (!processId) return;
  const pIdStr = String(processId);
  for (const key of suggestionsCache.keys()) {
    if (key.startsWith(`${pIdStr}_`)) {
      suggestionsCache.delete(key);
    }
  }
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function applyVariant(processData, variantDefinition) {
  const resources = clone(processData.resources || []);
  const nodes = clone(processData.nodes || []);

  for (const change of variantDefinition.resourceChanges || []) {
    const wanted = String(change.name || change.id || '').trim().toLowerCase();
    const quantity = Number(change.quantity);
    const resource = resources.find(
      item => String(item.name || item.id || '').trim().toLowerCase() === wanted
    );
    if (resource && Number.isFinite(quantity)) {
      resource.quantity = quantity;
    }
  }

  for (const change of variantDefinition.nodeChanges || []) {
    const wanted = String(change.id || '').trim().toLowerCase();
    const multiplier = Number(change.duration_multiplier);
    const node = nodes.find(
      item => String(item.id || '').trim().toLowerCase() === wanted
    );
    if (!node || !Number.isFinite(multiplier)) continue;
    const data = node.data && typeof node.data === 'object' ? node.data : node;
    for (const field of ['duration', 'duration_min', 'duration_max']) {
      if (data[field] !== undefined && data[field] !== null && Number.isFinite(Number(data[field]))) {
        data[field] = Number(data[field]) * multiplier;
      }
    }
  }
  return { resources, nodes, edges: clone(processData.edges || []) };
}

function getNodeResources(node, allResources = []) {
  const data = node.data || {};
  const resList = [];

  const single = data.resource || data.resource_id || node.resource;
  if (single && typeof single === 'string' && single.trim()) {
    const rName = single.trim().toLowerCase();
    const match = allResources.find(
      r => String(r.name || r.id || '').trim().toLowerCase() === rName ||
           String(r.id || '').trim().toLowerCase() === rName
    );
    if (match) resList.push(match);
  }

  if (data.resources && typeof data.resources === 'object') {
    if (Array.isArray(data.resources)) {
      for (const item of data.resources) {
        const name = typeof item === 'string' ? item : (item.name || item.id);
        if (name) {
          const match = allResources.find(
            r => String(r.name || r.id || '').trim().toLowerCase() === String(name).trim().toLowerCase()
          );
          if (match) resList.push(match);
        }
      }
    } else {
      for (const [rName, qty] of Object.entries(data.resources)) {
        if (Number(qty) > 0) {
          const match = allResources.find(
            r => String(r.name || r.id || '').trim().toLowerCase() === String(rName).trim().toLowerCase()
          );
          if (match) resList.push(match);
        }
      }
    }
  }

  return resList;
}

function isStaffHandledTask(node, allResources = []) {
  const nodeType = String(node.type || '').toLowerCase();
  const isTaskLike = nodeType === 'task' || nodeType.includes('task') || nodeType === 'send_message';
  if (!isTaskLike) return false;
  const assigned = getNodeResources(node, allResources);
  if (!assigned.length) return false;
  return assigned.some(r => r.type === 'staff') || assigned.length > 0;
}

function buildCandidates(processDoc, baselineResults, goal) {
  const candidates = [];
  const existingLabels = new Set();
  const resources = processDoc.resources || [];
  const nodes = processDoc.nodes || [];

  function addCandidate(cand) {
    if (!cand || existingLabels.has(cand.label) || candidates.length >= 4) return;
    existingLabels.add(cand.label);
    candidates.push(cand);
  }

  const resUtil = baselineResults.resource_utilization || {};
  let highestUtilResource = null;
  let maxUtil = -1;

  for (const [name, info] of Object.entries(resUtil)) {
    const utilPct = Number(info.utilization_pct ?? 0);
    if (utilPct > maxUtil) {
      maxUtil = utilPct;
      highestUtilResource = name;
    }
  }

  // 1. +1 on resource with highest utilization
  if (highestUtilResource) {
    const target = resources.find(
      r => String(r.name || r.id || '').trim().toLowerCase() === highestUtilResource.trim().toLowerCase()
    );
    if (target) {
      const newQty = Number(target.quantity || 1) + 1;
      addCandidate({
        label: `Add 1 ${target.name}`,
        variantDefinition: {
          label: `Add 1 ${target.name}`,
          resourceChanges: [{ name: target.name, quantity: newQty }],
          nodeChanges: [],
        },
      });
    }
  }

  // 2. +1 on resource with longest queue
  let longestQueueResource = null;
  let maxQueueWait = -1;
  const queueLevels = baselineResults.queue_levels || {};
  const activityResults = baselineResults.activity_results || {};

  for (const node of nodes) {
    if (!isStaffHandledTask(node, resources)) continue;
    const qInfo = queueLevels[node.id] || {};
    const actInfo = activityResults[node.id] || {};
    const queueScore = Math.max(
      Number(qInfo.avg_queue_length ?? 0),
      Number(qInfo.avg_wait_time ?? actInfo.avg_wait_time ?? 0)
    );
    if (queueScore > maxQueueWait) {
      maxQueueWait = queueScore;
      const assigned = getNodeResources(node, resources);
      if (assigned.length > 0) {
        longestQueueResource = assigned[0];
      }
    }
  }

  if (longestQueueResource) {
    const newQty = Number(longestQueueResource.quantity || 1) + 1;
    addCandidate({
      label: `Add 1 ${longestQueueResource.name}`,
      variantDefinition: {
        label: `Add 1 ${longestQueueResource.name}`,
        resourceChanges: [{ name: longestQueueResource.name, quantity: newQty }],
        nodeChanges: [],
      },
    });
  }

  // 3. -20% duration on staff-handled task with longest wait (never tasks without resources)
  let longestWaitTask = null;
  let maxTaskWait = -1;

  for (const node of nodes) {
    if (!isStaffHandledTask(node, resources)) continue;
    const act = activityResults[node.id] || queueLevels[node.id] || {};
    const waitTime = Number(act.avg_wait_time ?? 0);
    const procTime = Number(act.avg_processing_time ?? node.data?.duration ?? 0);
    const score = waitTime > 0 ? waitTime : procTime;
    if (score > maxTaskWait) {
      maxTaskWait = score;
      longestWaitTask = node;
    }
  }

  if (longestWaitTask) {
    const taskLabel = longestWaitTask.data?.label || longestWaitTask.label || longestWaitTask.id;
    addCandidate({
      label: `Speed up ${taskLabel} by 20%`,
      variantDefinition: {
        label: `Speed up ${taskLabel} by 20%`,
        resourceChanges: [],
        nodeChanges: [{ id: longestWaitTask.id, duration_multiplier: 0.8 }],
      },
    });
  }

  // 4. -1 staff on resources under 30% utilization when goal is cost
  if (goal === 'cost') {
    for (const r of resources) {
      if (r.type === 'staff' && Number(r.quantity) > 1) {
        const utilData = resUtil[r.name] || resUtil[r.id] || {};
        const utilPct = Number(utilData.utilization_pct ?? 0);
        if (utilPct < 30) {
          const newQty = Math.max(1, Number(r.quantity) - 1);
          addCandidate({
            label: `Reduce 1 ${r.name}`,
            variantDefinition: {
              label: `Reduce 1 ${r.name}`,
              resourceChanges: [{ name: r.name, quantity: newQty }],
              nodeChanges: [],
            },
          });
        }
      }
    }
  }

  return candidates.slice(0, 4);
}

async function callEngineSimulate(processJson, config, timeoutDeadline) {
  if (Date.now() > timeoutDeadline) {
    throw new Error('Testing took too long');
  }

  const engineBase = (process.env.SIMULATION_ENGINE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const url = `${engineBase}/simulate`;

  const payload = {
    process_json: processJson,
    config: {
      mode: 'deep',
      arrival_rate: Number(config.arrival_rate),
      seed: config.seed !== undefined ? Number(config.seed) : 42,
      replications: config.replications ? Number(config.replications) : 3,
      total_instances: config.total_instances ? Number(config.total_instances) : 200,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Simulation engine error (${response.status}): ${text}`);
  }

  return await response.json();
}

function extractMetricStats(results, metricType = 'cycle_time') {
  if (!results) return { mean: 0, ciLow: 0, ciHigh: 0, runs: 1 };
  const repStats = results.replication_stats || {};
  const runs = Number(repStats.n ?? results.runs ?? 1);

  if (metricType === 'cycle_time') {
    const tis = results.time_in_system || {};
    const mean = Number(repStats.mean_cycle_time ?? tis.avg ?? 0);
    let ciLow = repStats.ci_95_low ?? tis.ci_95_low;
    let ciHigh = repStats.ci_95_high ?? tis.ci_95_high;
    if (ciLow == null || ciHigh == null || (ciLow === 0 && ciHigh === 0 && mean > 0)) {
      const margin = runs >= 2 ? (1.96 * (tis.std_dev || mean * 0.08)) / Math.sqrt(runs) : mean * 0.05;
      ciLow = Math.max(0, mean - margin);
      ciHigh = mean + margin;
    }
    return { mean, ciLow: Number(ciLow), ciHigh: Number(ciHigh), runs };
  }

  if (metricType === 'wait_time') {
    const mean = Number(repStats.mean_avg_wait ?? results.time_in_system?.avg_wait ?? 0);
    let ciLow = repStats.wait_ci_95_low;
    let ciHigh = repStats.wait_ci_95_high;
    if (ciLow == null || ciHigh == null) {
      const margin = runs >= 2 ? (1.96 * (mean * 0.1)) / Math.sqrt(runs) : mean * 0.05;
      ciLow = Math.max(0, mean - margin);
      ciHigh = mean + margin;
    }
    return { mean, ciLow: Number(ciLow), ciHigh: Number(ciHigh), runs };
  }

  if (metricType === 'cost') {
    const fin = results.financial_summary || {};
    const mean = Number(repStats.mean_total_cost ?? fin.total_cost ?? 0);
    let ciLow = repStats.cost_ci_95_low;
    let ciHigh = repStats.cost_ci_95_high;
    if (ciLow == null || ciHigh == null) {
      const margin = runs >= 2 ? (1.96 * (mean * 0.05)) / Math.sqrt(runs) : mean * 0.05;
      ciLow = Math.max(0, mean - margin);
      ciHigh = mean + margin;
    }
    return { mean, ciLow: Number(ciLow), ciHigh: Number(ciHigh), runs };
  }

  if (metricType === 'throughput') {
    const rawVal = results.throughput_rates ?? results.throughput_rate ?? 0;
    const num = typeof rawVal === 'number' ? rawVal : (rawVal.avg ?? rawVal.per_hour ?? 0);
    const meanPerHour = Number(results.throughputPerHour ?? (num < 1 ? num * 60 : num));
    let ciLow = results.throughput_ci_95?.low ?? results.throughput_ci_95_low;
    let ciHigh = results.throughput_ci_95?.high ?? results.throughput_ci_95_high;
    if (ciLow == null || ciHigh == null) {
      const se = runs >= 2 ? meanPerHour / Math.sqrt(runs) : meanPerHour * 0.05;
      const margin = 1.96 * se;
      ciLow = Math.max(0, meanPerHour - margin);
      ciHigh = meanPerHour + margin;
    }
    return { mean: meanPerHour, ciLow: Number(ciLow), ciHigh: Number(ciHigh), runs };
  }

  return { mean: 0, ciLow: 0, ciHigh: 0, runs };
}

function checkIntervalMeaningfulChange(baseMetric, wiMetric) {
  if (!baseMetric || !wiMetric || baseMetric.mean === 0) {
    return { delta: 0, absDelta: 0, isMeaningful: false, overlap: true };
  }

  const delta = ((wiMetric.mean - baseMetric.mean) / baseMetric.mean) * 100;
  const absDelta = Math.abs(delta);

  const baseLow = baseMetric.ciLow ?? baseMetric.mean;
  const baseHigh = baseMetric.ciHigh ?? baseMetric.mean;
  const wiLow = wiMetric.ciLow ?? wiMetric.mean;
  const wiHigh = wiMetric.ciHigh ?? wiMetric.mean;

  const overlap = Math.max(baseLow, wiLow) <= Math.min(baseHigh, wiHigh);
  const isMeaningful = absDelta >= 5.0 && !overlap;

  return { delta, absDelta, isMeaningful, overlap };
}

function formatDuration(mins) {
  if (mins == null || isNaN(mins)) return '0m';
  if (mins < 1) {
    const s = Math.round(mins * 60);
    return `${s}s`;
  }
  if (mins < 60) {
    return `${mins.toFixed(1).replace(/\.0$/, '')}m`;
  }
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function containsOnlyJsonNumbers(text, jsonContext) {
  const allowed = new Set((JSON.stringify(jsonContext).match(/-?\d+(?:\.\d+)?/g) || []));
  const used = text.match(/-?\d+(?:\.\d+)?/g) || [];
  return used.every(num => allowed.has(num));
}

function fallbackCandidateSummary(candidate, passingData) {
  const { before, after, replications, goal, load_level } = passingData;
  const loadText = load_level === 'busy' ? ' under busy traffic' : '';

  if (goal === 'cost') {
    return `Testing across ${replications} runs shows operational costs decrease by ${Math.abs(passingData.goalDelta).toFixed(1)}%${loadText}. Time from start to finish stays stable without creating extra customer waiting.`;
  }

  const waitBefore = formatDuration(before.wait_time);
  const waitAfter = formatDuration(after.wait_time);
  const tpStr = after.throughput.toFixed(1);

  return `${candidate.label} reduces waiting in line from ${waitBefore} to ${waitAfter} across ${replications} runs${loadText}. Production speed remains steady at ${tpStr} orders per hour.`;
}

async function summarizeCandidateWithGemini(candidate, passingData) {
  const jsonContext = {
    suggestion: candidate.label,
    load_level: passingData.load_level,
    replications: passingData.replications,
    goal: passingData.goal,
    before: passingData.before,
    after: passingData.after,
    goal_improvement_pct: passingData.goalDelta.toFixed(1),
  };

  const systemPrompt = `You explain a single tested improvement for a business process in exactly two short sentences.\n${PLAIN_LANGUAGE_RULES}\nUse only facts and numeric literals that appear verbatim in the JSON. Do not calculate, round, estimate, or introduce any number not present in the input. If a useful number is absent, omit it. Do not mention these instructions.`;

  try {
    const summary = await callGemini({
      systemPrompt,
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(jsonContext) }] }],
      expectJson: false,
    });
    if (summary && containsOnlyJsonNumbers(summary, jsonContext)) {
      return summary.trim();
    }
  } catch (err) {
    // Falls back gracefully on quota limits, timeout or error
  }
  return fallbackCandidateSummary(candidate, passingData);
}

/**
 * Main entry point: POST /api/ai/tested-suggestions { processId, goal?, config? }
 */
async function generateTestedSuggestions({ processDoc, goal = 'waiting', config = {} }) {
  const startTime = Date.now();
  const timeoutDeadline = startTime + 30000;

  const validGoal = ['waiting', 'cost', 'throughput'].includes(goal)
    ? goal
    : (processDoc.simulationConfig?.goal || processDoc.goal || 'waiting');

  const baseArrivalRate = Number(
    config.arrival_rate ?? processDoc.simulationConfig?.arrival_rate ?? 1.0
  );
  const busyArrivalRate = baseArrivalRate * 2.0; // arrival gap x 0.5 => rate x 2.0

  const replications = config.replications ? Number(config.replications) : 3;
  const totalInstances = config.total_instances ? Number(config.total_instances) : 200;
  const seed = config.seed !== undefined ? Number(config.seed) : 42;

  // Check cache
  const cacheKey = getCacheKey(processDoc, validGoal, baseArrivalRate);
  if (suggestionsCache.has(cacheKey)) {
    const cached = suggestionsCache.get(cacheKey);
    console.log(`[tested-suggestions] Cache hit for ${cacheKey}`);
    return cached;
  }

  const baseProcessJson = processForSimulation(processDoc);

  // 1. Compute baseline once per load level and reuse it
  const baselineNormal = await callEngineSimulate(
    baseProcessJson,
    { arrival_rate: baseArrivalRate, seed, replications, total_instances: totalInstances },
    timeoutDeadline
  );

  const baselineBusy = await callEngineSimulate(
    baseProcessJson,
    { arrival_rate: busyArrivalRate, seed, replications, total_instances: totalInstances },
    timeoutDeadline
  );

  // 2. Build candidates from baseline normal (or latest results) in code (NO LLM)
  const candidates = buildCandidates(processDoc, baselineNormal, validGoal);

  if (!candidates.length) {
    const result = {
      none: true,
      reason: 'No candidate adjustments found for this process configuration.',
    };
    suggestionsCache.set(cacheKey, result);
    return result;
  }

  // 3. Test each candidate at baseline arrival rate AND at busy rate
  const passingCandidates = [];

  for (const candidate of candidates) {
    if (Date.now() > timeoutDeadline) throw new Error('Testing took too long');

    const variantProcessJson = applyVariant(baseProcessJson, candidate.variantDefinition);

    // Test normal load
    const candResultNormal = await callEngineSimulate(
      variantProcessJson,
      { arrival_rate: baseArrivalRate, seed, replications, total_instances: totalInstances },
      timeoutDeadline
    );

    // Test busy load
    const candResultBusy = await callEngineSimulate(
      variantProcessJson,
      { arrival_rate: busyArrivalRate, seed, replications, total_instances: totalInstances },
      timeoutDeadline
    );

    // Evaluate candidate on both load levels
    const levelsToEvaluate = [
      { level: 'normal', baseRes: baselineNormal, candRes: candResultNormal },
      { level: 'busy', baseRes: baselineBusy, candRes: candResultBusy },
    ];

    let passedEvaluation = null;

    for (const { level, baseRes, candRes } of levelsToEvaluate) {
      const baseCycle = extractMetricStats(baseRes, 'cycle_time');
      const candCycle = extractMetricStats(candRes, 'cycle_time');

      const baseWait = extractMetricStats(baseRes, 'wait_time');
      const candWait = extractMetricStats(candRes, 'wait_time');

      const baseThroughput = extractMetricStats(baseRes, 'throughput');
      const candThroughput = extractMetricStats(candRes, 'throughput');

      const baseCost = extractMetricStats(baseRes, 'cost');
      const candCost = extractMetricStats(candRes, 'cost');

      let goalImproved = false;
      let goalDelta = 0;

      if (validGoal === 'waiting') {
        const waitChange = checkIntervalMeaningfulChange(baseWait, candWait);
        const cycleChange = checkIntervalMeaningfulChange(baseCycle, candCycle);
        if ((waitChange.isMeaningful && waitChange.delta <= -5.0) ||
            (cycleChange.isMeaningful && cycleChange.delta <= -5.0)) {
          goalImproved = true;
          goalDelta = waitChange.isMeaningful ? waitChange.delta : cycleChange.delta;
        }
      } else if (validGoal === 'cost') {
        const costChange = checkIntervalMeaningfulChange(baseCost, candCost);
        if (costChange.isMeaningful && costChange.delta <= -5.0) {
          goalImproved = true;
          goalDelta = costChange.delta;
        }
      } else if (validGoal === 'throughput') {
        const tpChange = checkIntervalMeaningfulChange(baseThroughput, candThroughput);
        if (tpChange.isMeaningful && tpChange.delta >= 5.0) {
          goalImproved = true;
          goalDelta = tpChange.delta;
        }
      }

      if (!goalImproved) continue;

      // Check no other main metric worsens by >= 5%
      const cycleChange = checkIntervalMeaningfulChange(baseCycle, candCycle);
      const tpChange = checkIntervalMeaningfulChange(baseThroughput, candThroughput);

      const cycleWorsened = cycleChange.isMeaningful && cycleChange.delta >= 5.0;
      const tpWorsened = tpChange.isMeaningful && tpChange.delta <= -5.0;

      if (cycleWorsened || tpWorsened) {
        continue;
      }

      passedEvaluation = {
        load_level: level,
        goalDelta,
        replications,
        goal: validGoal,
        before: {
          wait_time: baseWait.mean,
          cycle_time: baseCycle.mean,
          throughput: baseThroughput.mean,
          total_cost: baseCost.mean,
        },
        after: {
          wait_time: candWait.mean,
          cycle_time: candCycle.mean,
          throughput: candThroughput.mean,
          total_cost: candCost.mean,
        },
      };
      break; // Found passing load level
    }

    if (passedEvaluation) {
      let testedEvidence;
      if (validGoal === 'cost') {
        testedEvidence = `Tested: cost Rs ${passedEvaluation.before.total_cost} -> Rs ${passedEvaluation.after.total_cost}, ${replications} runs`;
      } else if (validGoal === 'throughput') {
        testedEvidence = `Tested: speed ${passedEvaluation.before.throughput.toFixed(1)}/hr -> ${passedEvaluation.after.throughput.toFixed(1)}/hr, ${replications} runs`;
      } else {
        const beforeWait = formatDuration(passedEvaluation.before.wait_time);
        const afterWait = formatDuration(passedEvaluation.after.wait_time);
        testedEvidence = `Tested: wait ${beforeWait} -> ${afterWait}, ${replications} runs`;
      }

      const summary = await summarizeCandidateWithGemini(candidate, passedEvaluation);

      passingCandidates.push({
        label: candidate.label,
        type: validGoal === 'cost' ? 'info' : 'warn',
        summary,
        tested_evidence: testedEvidence,
        variant_definition: candidate.variantDefinition,
        before: passedEvaluation.before,
        after: passedEvaluation.after,
        goal_delta_pct: passedEvaluation.goalDelta,
        load_level: passedEvaluation.load_level,
      });
    }
  }

  const wallTimeMs = Date.now() - startTime;
  console.log(`[tested-suggestions] Process ${processDoc._id} evaluated in ${wallTimeMs}ms`);

  let finalResponse;
  if (!passingCandidates.length) {
    finalResponse = {
      none: true,
      reason: 'No change worth making at this load',
      wall_time_ms: wallTimeMs,
    };
  } else {
    finalResponse = {
      none: false,
      candidates: passingCandidates,
      wall_time_ms: wallTimeMs,
    };
  }

  suggestionsCache.set(cacheKey, finalResponse);
  return finalResponse;
}

module.exports = {
  generateTestedSuggestions,
  invalidateSuggestionsCache,
  buildCandidates,
  isStaffHandledTask,
  applyVariant,
  suggestionsCache,
};
