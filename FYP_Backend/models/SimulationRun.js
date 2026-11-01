const mongoose = require('mongoose');

const MAX_RESULTS_BYTES = 200 * 1024; // ~200 KB limit

function sanitizeResultsPayload(results) {
  if (!results || typeof results !== 'object') return {};
  try {
    let clone = JSON.parse(JSON.stringify(results));
    let str = JSON.stringify(clone);
    if (str.length <= MAX_RESULTS_BYTES) {
      return clone;
    }

    console.warn(`[SimulationRun] Results payload size (${(str.length / 1024).toFixed(1)} KB) exceeds 200 KB limit. Truncating large arrays...`);

    // Recursively truncate any array with more than 50 elements
    function truncateArrays(obj) {
      if (!obj || typeof obj !== 'object') return;
      for (const key of Object.keys(obj)) {
        if (Array.isArray(obj[key])) {
          if (obj[key].length > 50) {
            obj[key] = obj[key].slice(0, 50);
          }
        } else if (typeof obj[key] === 'object') {
          truncateArrays(obj[key]);
        }
      }
    }

    truncateArrays(clone);
    str = JSON.stringify(clone);
    if (str.length > MAX_RESULTS_BYTES) {
      // If still too large, omit raw trace arrays while preserving core aggregate summaries
      delete clone.all_times;
      delete clone.all_task_durations;
      delete clone.all_task_wait_times;
      delete clone.all_resource_busy;
      delete clone.task_arrival_times;
      delete clone.task_queue_depths;
      console.warn(`[SimulationRun] Omitted raw token traces. New payload size: ${(JSON.stringify(clone).length / 1024).toFixed(1)} KB`);
    }
    return clone;
  } catch (err) {
    console.error('[SimulationRun] Error sanitizing results payload:', err.message);
    return {};
  }
}

function extractSummaryMetrics(results) {
  if (!results || typeof results !== 'object') return {};
  const tis = results.time_in_system || {};
  const avgCycle = typeof tis.avg === 'number' ? tis.avg : (typeof results.avg_cycle_time === 'number' ? results.avg_cycle_time : null);

  const act = results.activity_results || {};
  const waitTimes = Object.values(act).map(a => a.avg_wait_time).filter(v => typeof v === 'number');
  const avgWait = waitTimes.length > 0 ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length : (typeof results.avg_wait_time === 'number' ? results.avg_wait_time : null);

  const rawThru = results.throughput_rates ?? results.throughput_rate ?? results.throughput ?? null;
  const throughput = typeof rawThru === 'number' ? rawThru * 60 : (typeof results.throughput_per_hour === 'number' ? results.throughput_per_hour : null);

  const fin = results.financial_summary || {};
  const totalCost = typeof fin.total_cost === 'number' ? fin.total_cost : (typeof results.total_cost === 'number' ? results.total_cost : null);

  return {
    avg_cycle_time: avgCycle !== null ? Number(avgCycle.toFixed(3)) : null,
    avg_wait_time: avgWait !== null ? Number(avgWait.toFixed(3)) : null,
    throughput_per_hour: throughput !== null ? Number(throughput.toFixed(3)) : null,
    total_cost: totalCost !== null ? Number(totalCost.toFixed(2)) : null,
  };
}

const SimulationRunSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  processId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Process',
    required: true,
    index: true,
  },
  scenarioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Scenario',
    default: null,
    index: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  config: {
    arrival: { type: Number, default: 1.0 },
    instances: { type: Number, default: 1000 },
    seed: { type: Number, default: 42 },
    replications: { type: Number, default: 1 },
  },
  summary: {
    avg_cycle_time: { type: Number, default: null },
    avg_wait_time: { type: Number, default: null },
    throughput_per_hour: { type: Number, default: null },
    total_cost: { type: Number, default: null },
  },
  results: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

SimulationRunSchema.index({ userId: 1, processId: 1, scenarioId: 1, createdAt: -1 });

/**
 * Saves a simulation run and enforces the 50-run retention limit per (userId, processId, scenarioId).
 */
async function saveSimulationRun({ userId, processId, scenarioId = null, title, config = {}, results = {} }) {
  if (!userId || !processId) {
    throw new Error('userId and processId are required to save a simulation run');
  }

  const normalizedConfig = {
    arrival: Number(config.arrival_rate ?? config.arrival ?? 1.0),
    instances: Number(config.total_instances ?? config.instances ?? 1000),
    seed: Number(config.seed ?? 42),
    replications: Number(config.replications ?? 1),
  };

  const summary = extractSummaryMetrics(results);
  const sanitizedResults = sanitizeResultsPayload(results);

  const run = new mongoose.model('SimulationRun')( {
    userId,
    processId,
    scenarioId: scenarioId || null,
    title: title || (scenarioId ? 'Scenario' : 'Baseline'),
    config: normalizedConfig,
    summary,
    results: sanitizedResults,
    createdAt: new Date(),
  });

  await run.save();

  // Retention: keep newest 50 runs per scenario/process per user
  try {
    const filter = {
      userId,
      processId,
      scenarioId: scenarioId ? scenarioId : null,
    };
    const olderRuns = await mongoose.model('SimulationRun')
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(50)
      .select('_id');

    if (olderRuns.length > 0) {
      const idsToDelete = olderRuns.map(r => r._id);
      await mongoose.model('SimulationRun').deleteMany({ _id: { $in: idsToDelete } });
    }
  } catch (pruneErr) {
    console.warn('[SimulationRun] Failed to prune older runs:', pruneErr.message);
  }

  return run;
}

async function deleteRunsForScenario(scenarioId, userId) {
  if (!scenarioId || !userId) return;
  await mongoose.model('SimulationRun').deleteMany({ scenarioId, userId });
}

async function deleteRunsForProcess(processId, userId) {
  if (!processId || !userId) return;
  await mongoose.model('SimulationRun').deleteMany({ processId, userId });
}

const SimulationRun = mongoose.model('SimulationRun', SimulationRunSchema);

module.exports = {
  SimulationRun,
  saveSimulationRun,
  deleteRunsForScenario,
  deleteRunsForProcess,
  sanitizeResultsPayload,
  extractSummaryMetrics,
};
