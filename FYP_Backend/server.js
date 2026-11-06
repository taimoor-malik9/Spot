const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Process = require('./models/Process');
const { toFriendlyError } = require('./utils/friendlyError');
const { processForSimulation } = require('./utils/processForSimulation');
const { requestSimulationEngine } = require('./utils/requestSimulationEngine');
require('dotenv').config();

const app = express();

console.log("🚀 Starting minimal server...");

// Middleware
const defaultOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];
const envOrigins = (process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
const allowedOrigins = [...new Set([...defaultOrigins, ...envOrigins])];
const hasWildcard = allowedOrigins.includes('*');

const isOriginAllowed = (origin) => {
  if (!origin) return true;
  if (hasWildcard) return true;
  if (allowedOrigins.includes(origin)) return true;
  try {
    const parsed = new URL(origin);
    // Allow any Vercel deployment (*.vercel.app)
    if (parsed.hostname.endsWith('.vercel.app')) return true;
    // Allow local development hostnames
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return true;
  } catch (_) {}
  return false;
};

app.use(cors({
  origin: (origin, callback) => {
    callback(null, isOriginAllowed(origin));
  },
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));

// MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected!'))
  .catch(err => console.error('❌ MongoDB Error:', err));

const { requireAuth } = require('./middleware/auth');
const { requireOwnedProcess } = require('./utils/ownership');
const { saveSimulationRun, deleteRunsForProcess } = require('./models/SimulationRun');
const Scenario = require('./models/Scenario');
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

app.use('/api/scenario', requireAuth, require('./routes/scenario'));
app.use('/api/scenarios', requireAuth, require('./routes/scenario'));
app.use('/api/runs', requireAuth, require('./routes/runs'));
const { getValidateBpmn } = require('./utils/cloneProcessToScenario');

app.post('/api/process', requireAuth, async (req, res) => {
    console.log('📥 POST /api/process hit!');
    try {
        const { title, resources, nodes, edges, layoutElements, simulationConfig, goal } = req.body;

        // Edge data is a Mixed field. Keep it as an object so the frontend
        // can reliably restore `data.type: 'message-flow'` after a save.
        const cleanEdges = (edges || []).map(edge => {
            const isMsg =
                edge.flowType === 'message' ||
                edge.type === 'message-flow' ||
                edge.type === 'message' ||
                (typeof edge.data === 'object' && (edge.data?.type === 'message-flow' || edge.data?.flowType === 'message'));
            const edgeLabel = edge.label || (typeof edge.data === 'object' ? edge.data?.label : '') || '';
            return {
                id: edge.id || edge._id,
                source: edge.source || edge.fromId || edge.from,
                target: edge.target || edge.toId || edge.to,
                type: edge.type || (isMsg ? 'message-flow' : 'sequence-flow'),
                flowType: edge.flowType || (isMsg ? 'message' : 'sequence'),
                label: edgeLabel,
                data: typeof edge.data === 'object'
                    ? { ...edge.data, label: edgeLabel, type: isMsg ? 'message-flow' : (edge.data?.type || 'sequence-flow') }
                    : { label: edgeLabel }
            };
        });

        const cleanNodes = (nodes || []).map(node => ({
            ...node,
            data: typeof node.data === 'object' ? { ...node.data } : node.data
        }));

        // Run full validator on base process at save time
        const validateBpmn = await getValidateBpmn();
        const validation = validateBpmn({ nodes: cleanNodes, edges: cleanEdges, resources: resources || [] });
        if (Array.isArray(validation.errors) && validation.errors.length > 0) {
            return res.status(400).json({
                error: `BPMN validation failed with ${validation.errors.length} error(s):\n- ${validation.errors.join('\n- ')}`,
                details: validation.errors
            });
        }

        const newProcess = new Process({ 
            title: title || 'Untitled Process', 
            userId: req.user._id,
            resources: resources || [], 
            nodes: cleanNodes, 
            edges: cleanEdges,
            layoutElements: layoutElements || [],
            simulationConfig: simulationConfig || null,
            goal: goal || null
        });

        await newProcess.save();
        console.log('✅ Process saved! ID:', newProcess._id);

        res.status(201).json({ 
            message: 'Process saved successfully!', 
            process: newProcess
        });
    } catch (err) {
        console.error('❌ Save error:', err.message);
        if (err.name === 'ValidationError') {
            return res.status(400).json({
                error: 'Validation failed: please check required process and resource fields.',
                detail: err.message,
                details: Object.values(err.errors || {}).map(e => e.message)
            });
        }
        if (err.status) return res.status(err.status).json({ error: err.message });
        const friendly = toFriendlyError(err);
        res.status(500).json({ error: friendly.userMessage, detail: friendly.detail });
    }
});

app.get('/api/process', requireAuth, async (req, res) => {
    try {
        const processes = await Process.find({ userId: req.user._id }).sort({ updatedAt: -1, createdAt: -1 }).lean();
        const procIds = processes.map(p => p._id);

        let scenCountMap = {};
        let runMap = {};

        if (procIds.length > 0) {
            try {
                const scenarioCounts = await Scenario.aggregate([
                    { $match: { baseProcessId: { $in: procIds }, userId: req.user._id } },
                    { $group: { _id: '$baseProcessId', count: { $sum: 1 } } }
                ]);
                scenarioCounts.forEach(s => {
                    if (s._id) scenCountMap[s._id.toString()] = s.count;
                });
            } catch (err) {
                console.warn('Failed to aggregate scenario counts:', err.message);
            }

            try {
                const latestRuns = await SimulationRun.aggregate([
                    { $match: { processId: { $in: procIds }, userId: req.user._id } },
                    { $sort: { createdAt: -1 } },
                    { $group: {
                        _id: '$processId',
                        lastRunId: { $first: '$_id' },
                        title: { $first: '$title' },
                        scenarioId: { $first: '$scenarioId' },
                        summary: { $first: '$summary' },
                        createdAt: { $first: '$createdAt' }
                    }}
                ]);
                latestRuns.forEach(r => {
                    if (r._id) runMap[r._id.toString()] = r;
                });
            } catch (err) {
                console.warn('Failed to aggregate latest runs:', err.message);
            }
        }

        const enriched = processes.map(p => {
            const pIdStr = p._id.toString();
            const scenarioCount = scenCountMap[pIdStr] || 0;
            const runInfo = runMap[pIdStr];

            let lastRunSummary = null;
            if (runInfo?.summary) {
                lastRunSummary = {
                    runId: runInfo.lastRunId,
                    title: runInfo.title,
                    scenarioId: runInfo.scenarioId,
                    avg_cycle_time: runInfo.summary.avg_cycle_time != null ? Number(runInfo.summary.avg_cycle_time) : null,
                    avg_wait_time: runInfo.summary.avg_wait_time != null ? Number(runInfo.summary.avg_wait_time) : null,
                    throughput_rate: runInfo.summary.throughput_rate != null ? Number(runInfo.summary.throughput_rate) : null,
                    total_cost: runInfo.summary.total_cost != null ? Number(runInfo.summary.total_cost) : null,
                    createdAt: runInfo.createdAt
                };
            } else if (p.simulationResults) {
                const sr = p.simulationResults;
                const cycleTime = sr.time_in_system?.avg != null ? Number(sr.time_in_system.avg) : null;
                const tp = sr.throughput_rates != null ? (
                    typeof sr.throughput_rates === 'object'
                        ? (sr.throughput_rates.mean ?? sr.throughput_rates.system)
                        : sr.throughput_rates
                ) : null;
                lastRunSummary = {
                    title: 'Baseline Simulation',
                    avg_cycle_time: cycleTime,
                    throughput_rate: tp != null ? Number(tp) : null,
                    createdAt: p.updatedAt || p.createdAt
                };
            }

            return {
                ...p,
                scenarioCount,
                lastRunSummary
            };
        });

        res.json(enriched);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        const friendly = toFriendlyError(err);
        res.status(500).json({ error: friendly.userMessage, detail: friendly.detail });
    }
});

app.get('/api/process/:id', requireAuth, async (req, res) => {
    try {
        const process = await requireOwnedProcess(req, req.params.id);
        res.json(process);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        const friendly = toFriendlyError(err);
        res.status(500).json({ error: friendly.userMessage, detail: friendly.detail });
    }
});

// ==================== UPDATE PROCESS ====================
app.put('/api/process/:id', requireAuth, async (req, res) => {
    try {
        const { title, resources, nodes, edges, layoutElements, simulationConfig, goal } = req.body;
        const processDoc = await requireOwnedProcess(req, req.params.id);
        if (!processDoc) return res.status(404).json({ error: 'Process not found' });

        if (title !== undefined) processDoc.title = title;
        if (resources !== undefined) processDoc.resources = resources;

        if (nodes !== undefined) {
            // Preserve positions, dimensions, pool/lane assignment, and BPMN
            // type metadata as well as the simulation data.
            processDoc.nodes = nodes.map(node => ({
                ...node,
                data: typeof node.data === 'object' ? { ...node.data } : node.data
            }));
        }

        if (edges !== undefined) {
            processDoc.edges = edges.map(edge => {
                const isMsg =
                    edge.flowType === 'message' ||
                    edge.type === 'message-flow' ||
                    edge.type === 'message' ||
                    (typeof edge.data === 'object' && (edge.data?.type === 'message-flow' || edge.data?.flowType === 'message'));
                const edgeLabel = edge.label || (typeof edge.data === 'object' ? edge.data?.label : '') || '';
                return {
                    id: edge.id || edge._id,
                    source: edge.source || edge.fromId || edge.from,
                    target: edge.target || edge.toId || edge.to,
                    type: edge.type || (isMsg ? 'message-flow' : 'sequence-flow'),
                    flowType: edge.flowType || (isMsg ? 'message' : 'sequence'),
                    label: edgeLabel,
                    data: typeof edge.data === 'object'
                        ? { ...edge.data, label: edgeLabel, type: isMsg ? 'message-flow' : (edge.data?.type || 'sequence-flow') }
                        : { label: edgeLabel }
                };
            });
        }

        if (layoutElements !== undefined) processDoc.layoutElements = layoutElements;
        if (simulationConfig !== undefined) processDoc.simulationConfig = simulationConfig;
        if (goal !== undefined) processDoc.goal = goal;

        // Run full validator on base process at save/update time when diagram is modified
        if (nodes !== undefined || edges !== undefined || resources !== undefined) {
            const validateBpmn = await getValidateBpmn();
            const validation = validateBpmn({
                nodes: processDoc.nodes,
                edges: processDoc.edges,
                resources: processDoc.resources || []
            });
            if (Array.isArray(validation.errors) && validation.errors.length > 0) {
                return res.status(400).json({
                    error: `BPMN validation failed with ${validation.errors.length} error(s):\n- ${validation.errors.join('\n- ')}`,
                    details: validation.errors
                });
            }
        }

        await processDoc.save();
        console.log('✅ Process updated! ID:', processDoc._id);
        res.json({ message: 'Process updated successfully!', process: processDoc });
    } catch (err) {
        console.error('❌ Update process error:', err.message);
        if (err.name === 'ValidationError') {
            return res.status(400).json({
                error: 'Validation failed: please check required process and resource fields.',
                detail: err.message,
                details: Object.values(err.errors || {}).map(e => e.message)
            });
        }
        if (err.status) return res.status(err.status).json({ error: err.message });
        const friendly = toFriendlyError(err);
        res.status(500).json({ error: friendly.userMessage, detail: friendly.detail });
    }
});

// ==================== DELETE PROCESS ====================
app.delete('/api/process/:id', requireAuth, async (req, res) => {
    try {
        const processDoc = await requireOwnedProcess(req, req.params.id);
        await Process.findByIdAndDelete(processDoc._id);
        await Scenario.deleteMany({ baseProcessId: processDoc._id, userId: req.user._id });
        await deleteRunsForProcess(processDoc._id, req.user._id);
        res.json({ message: 'Process deleted successfully' });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// ==================== DUPLICATE PROCESS ====================
app.post('/api/process/:id/duplicate', requireAuth, async (req, res) => {
    try {
        const source = await requireOwnedProcess(req, req.params.id);
        const dup = new Process({
            title: `${source.title || 'Untitled Process'} (Copy)`,
            userId: req.user._id,
            resources: source.resources || [],
            nodes: source.nodes || [],
            edges: source.edges || [],
            layoutElements: source.layoutElements || [],
            simulationConfig: source.simulationConfig || null,
            goal: source.goal || null
        });
        await dup.save();
        res.status(201).json({ message: 'Process duplicated successfully', process: dup });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        const friendly = toFriendlyError(err);
        res.status(500).json({ error: friendly.userMessage, detail: friendly.detail });
    }
});

const aiRoutes = require('./routes/ai');
app.use('/api/ai', requireAuth, aiRoutes);
const intakeRoutes = require('./routes/intake');
app.use('/api/intake', requireAuth, intakeRoutes);
// ==================== SIMULATION ROUTE ====================
app.post('/api/process/:id', requireAuth, async (req, res) => {
    try {
        const processDoc = await requireOwnedProcess(req, req.params.id);

        const { validateProcessDurations } = require('./utils/durationRules');
        const durationCheck = validateProcessDurations(processDoc.nodes);
        if (durationCheck.errors.length > 0) {
            const names = durationCheck.errors.map(e => `"${e.label}"`).join(', ');
            return res.status(400).json({
                error: 'Missing Task Duration',
                detail: `These steps need a duration: ${names}. Set a duration for each step before simulating.`,
                missingDurationTasks: durationCheck.errors
            });
        }

        // Pre-run check: tasks referencing unconfigured resources
        const knownResources = new Set(
            (processDoc.resources || [])
                .filter(r => (parseInt(r.quantity, 10) || 0) > 0)
                .flatMap(r => [
                    (r.name || '').trim().toLowerCase(),
                    (r.displayName || '').trim().toLowerCase(),
                    (r.id || '').trim().toLowerCase(),
                ].filter(Boolean))
        );

        for (const node of (processDoc.nodes || [])) {
            const d = node.data || {};
            const taskLabel = d.label || node.label || node.id;
            const resCandidates = [];
            if (d.resources && typeof d.resources === 'object') {
                Object.entries(d.resources).forEach(([k, qty]) => {
                    if (k && !k.startsWith('$') && !k.startsWith('_') && (parseInt(qty, 10) || 0) > 0) {
                        resCandidates.push(k);
                    }
                });
            }
            if (d.resource && typeof d.resource === 'string' && d.resource.trim()) {
                resCandidates.push(d.resource.trim());
            }

            for (const rName of resCandidates) {
                if (!knownResources.has(rName.trim().toLowerCase())) {
                    return res.status(400).json({
                        error: 'Missing Resource Setup',
                        detail: `Task "${taskLabel}" uses "${rName}", which isn't set up. Add it in Setup before simulating.`,
                        missingResource: rName,
                        taskId: node.id,
                        taskLabel
                    });
                }
            }
        }

        const simConfig = req.body || {};
        const payload = {
            process_json: processForSimulation(processDoc),
            config: {
                mode: simConfig.mode || 'deep',
                total_instances: simConfig.total_instances || 1000,
                arrival_rate: Number(simConfig.arrival_rate) || 1.0,
                seed: simConfig.seed != null ? Number(simConfig.seed) : 42,
                replications: simConfig.replications ? Number(simConfig.replications) : 1
            }
        };

        if (process.env.DEBUG) {
            console.log("🔄 Sending to Simulation Engine...");
            console.log("PAYLOAD:", JSON.stringify(payload).substring(0, 500));
        }

        const engineBase = (process.env.SIMULATION_ENGINE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
        const engineUrl = `${engineBase}/simulate`;
        const response = await requestSimulationEngine(engineUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'No error body');
            throw new Error(`Simulation engine error: ${response.status} - ${errorText}`);
        }

        const realResults = await response.json();

        // Save results back to the original Mongoose Document
        processDoc.simulationResults = realResults;
        await processDoc.save();

        // Save SimulationRun asynchronously without failing the simulation response
        try {
            await saveSimulationRun({
                userId: req.user._id,
                processId: processDoc._id,
                scenarioId: null,
                title: processDoc.title || 'Baseline',
                config: payload.config,
                results: realResults,
            });
        } catch (runErr) {
            console.warn('[SimulationRun] Failed to save simulation run:', runErr.message);
        }

        console.log("✅ Simulation completed!");
        res.json({ 
            message: 'Simulation completed!', 
            results: realResults 
        });

    } catch (err) {
        console.error("❌ Simulation Error:", err.message);
        if (err.status) return res.status(err.status).json({ error: err.message });
        const friendly = toFriendlyError(err);
        res.status(500).json({ error: friendly.userMessage, detail: friendly.detail });
    }
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => res.json({ status: 'Server running' }));

const PORT = process.env.PORT || 5000;
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log('Test URLs:');
    console.log(`   → http://localhost:${PORT}/health`);
    console.log(`   → POST http://localhost:${PORT}/api/process`);
  });
}

module.exports = app;
