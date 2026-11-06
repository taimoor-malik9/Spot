const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Process = require('./models/Process');
const { toFriendlyError } = require('./utils/friendlyError');
const { processForSimulation } = require('./utils/processForSimulation');
require('dotenv').config();

const app = express();

console.log("🚀 Starting minimal server...");

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

// MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected!'))
  .catch(err => console.error('❌ MongoDB Error:', err));

const { requireAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

app.use('/api/scenario', requireAuth, require('./routes/scenario'));
app.use('/api/scenarios', requireAuth, require('./routes/scenario'));
const { getValidateBpmn } = require('./utils/cloneProcessToScenario');

function assignLanesToNodes(nodes, layoutElements) {
    const lanes = (layoutElements || []).filter(el => el && el.type === 'lane');
    const pools = (layoutElements || []).filter(el => el && el.type === 'pool');
    const NODE_W = 80;
    const NODE_H = 80;

    return (nodes || []).map(node => {
        let lane = node.lane || node.data?.lane;
        let pool = node.pool || node.data?.pool;

        if (!lane && node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)) {
            const cx = node.position.x + (node.width || NODE_W) / 2;
            const cy = node.position.y + (node.height || NODE_H) / 2;

            const hitLane = lanes.find(l => {
                const lx = l.position?.x ?? 0;
                const ly = l.position?.y ?? 0;
                const lw = l.width ?? 540;
                const lh = l.height ?? 150;
                return cx >= lx && cx <= lx + lw && cy >= ly && cy <= ly + lh;
            });

            if (hitLane) {
                lane = hitLane.label || hitLane.id;
                if (!pool && hitLane.poolId) pool = hitLane.poolId;
            } else {
                const hitPool = pools.find(p => {
                    const px = p.position?.x ?? 0;
                    const py = p.position?.y ?? 0;
                    const pw = p.width ?? 600;
                    const ph = p.height ?? 220;
                    return cx >= px && cx <= px + pw && cy >= py && cy <= py + ph;
                });

                if (hitPool) {
                    pool = pool || hitPool.id;
                    const poolSubLanes = lanes.filter(l => l.poolId === hitPool.id);
                    if (poolSubLanes.length > 0) {
                        const vLane = poolSubLanes.find(l => {
                            const ly = l.position?.y ?? 0;
                            const lh = l.height ?? 150;
                            return cy >= ly && cy <= ly + lh;
                        }) || poolSubLanes[0];
                        lane = vLane.label || vLane.id;
                    } else {
                        lane = hitPool.label || hitPool.id || 'Default Lane';
                    }
                }
            }
        }

        if (!lane && pool) {
            lane = pool;
        }

        return {
            ...node,
            pool: pool || node.pool || null,
            lane: lane || node.lane || null,
            data: typeof node.data === 'object'
                ? { ...node.data, ...(lane ? { lane } : {}), ...(pool ? { pool } : {}) }
                : (node.data || {})
        };
    });
}

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
            return {
                id: edge.id || edge._id,
                source: edge.source || edge.fromId || edge.from,
                target: edge.target || edge.toId || edge.to,
                type: edge.type || (isMsg ? 'message-flow' : 'sequence-flow'),
                flowType: edge.flowType || (isMsg ? 'message' : 'sequence'),
                data: typeof edge.data === 'object'
                    ? { ...edge.data, type: isMsg ? 'message-flow' : (edge.data?.type || 'sequence-flow') }
                    : (edge.data || {})
            };
        });

        const cleanNodes = assignLanesToNodes(nodes, layoutElements);

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
        const friendly = toFriendlyError(err);
        res.status(500).json({ error: friendly.userMessage, detail: friendly.detail });
    }
});

app.get('/api/process', requireAuth, async (req, res) => {
    try {
        const processes = await Process.find();
        res.json(processes);
    } catch (err) {
        const friendly = toFriendlyError(err);
        res.status(500).json({ error: friendly.userMessage, detail: friendly.detail });
    }
});

app.get('/api/process/:id', requireAuth, async (req, res) => {
    try {
        const process = await Process.findById(req.params.id);
        if (!process) return res.status(404).json({ error: 'Process not found' });
        res.json(process);
    } catch (err) {
        const friendly = toFriendlyError(err);
        res.status(500).json({ error: friendly.userMessage, detail: friendly.detail });
    }
});

// ==================== UPDATE PROCESS ====================
app.put('/api/process/:id', requireAuth, async (req, res) => {
    try {
        const { title, resources, nodes, edges, layoutElements, simulationConfig, goal } = req.body;
        const processDoc = await Process.findById(req.params.id);
        if (!processDoc) return res.status(404).json({ error: 'Process not found' });

        if (title !== undefined) processDoc.title = title;
        if (resources !== undefined) processDoc.resources = resources;

        const effectiveLayout = layoutElements !== undefined ? layoutElements : processDoc.layoutElements;
        if (nodes !== undefined) {
            // Preserve positions, dimensions, pool/lane assignment, and BPMN
            // type metadata as well as the simulation data.
            processDoc.nodes = assignLanesToNodes(nodes, effectiveLayout);
        }

        if (edges !== undefined) {
            processDoc.edges = edges.map(edge => {
                const isMsg =
                    edge.flowType === 'message' ||
                    edge.type === 'message-flow' ||
                    edge.type === 'message' ||
                    (typeof edge.data === 'object' && (edge.data?.type === 'message-flow' || edge.data?.flowType === 'message'));
                return {
                    id: edge.id || edge._id,
                    source: edge.source || edge.fromId || edge.from,
                    target: edge.target || edge.toId || edge.to,
                    type: edge.type || (isMsg ? 'message-flow' : 'sequence-flow'),
                    flowType: edge.flowType || (isMsg ? 'message' : 'sequence'),
                    data: typeof edge.data === 'object'
                        ? { ...edge.data, type: isMsg ? 'message-flow' : (edge.data?.type || 'sequence-flow') }
                        : (edge.data || {})
                };
            });
        }

        if (layoutElements !== undefined) processDoc.layoutElements = layoutElements;
        if (simulationConfig !== undefined) processDoc.simulationConfig = simulationConfig;
        if (goal !== undefined) processDoc.goal = goal;

        // Run full validator on base process at save/update time
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

        await processDoc.save();
        console.log('✅ Process updated! ID:', processDoc._id);
        res.json({ message: 'Process updated successfully!', process: processDoc });
    } catch (err) {
        console.error('❌ Update process error:', err.message);
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
        const processDoc = await Process.findById(req.params.id);
        if (!processDoc) {
            return res.status(404).json({ error: 'Process not found' });
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

        console.log("🔄 Sending to Simulation Engine...");
        console.log("PAYLOAD:", JSON.stringify(payload).substring(0, 500));

        const engineBase = (process.env.SIMULATION_ENGINE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
        const engineUrl = `${engineBase}/simulate`;
        const response = await fetch(engineUrl, {
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

        console.log("✅ Simulation completed!");
        res.json({ 
            message: 'Simulation completed!', 
            results: realResults 
        });

    } catch (err) {
        console.error("❌ Simulation Error:", err.message);
        const friendly = toFriendlyError(err);
        res.status(500).json({ error: friendly.userMessage, detail: friendly.detail });
    }
});

// ==================== ROOT & HEALTH CHECK ====================
app.get('/', (req, res) => res.json({
  status: 'online',
  message: 'SPOT Backend API is operational',
  health: '/health'
}));
app.get('/health', (req, res) => res.json({ status: 'Server running' }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log('Test URLs:');
  console.log(`   → http://localhost:${PORT}/health`);
  console.log(`   → POST http://localhost:${PORT}/api/process`);
});
