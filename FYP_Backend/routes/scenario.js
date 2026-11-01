const express = require('express');
const router = express.Router();
const Scenario = require('../models/Scenario');
const Process = require('../models/Process');
const { cloneProcessToScenario, normalizeEdges } = require('../utils/cloneProcessToScenario');
const { requireOwnedProcess, requireOwnedScenario } = require('../utils/ownership');
const { saveSimulationRun, deleteRunsForScenario } = require('../models/SimulationRun');

// 1. Base process ki copy bana ke scenario save karo
router.post('/:baseProcessId', async (req, res) => {
    try {
        // Base process fetch karo (ownership checked)
        const baseProcess = await requireOwnedProcess(req, req.params.baseProcessId);

        const existingScenarios = await Scenario.find({ 
            baseProcessId: req.params.baseProcessId,
            userId: req.user._id
        });

        const existingTitles = new Set(existingScenarios.map(s => s.title));
        let title = req.body.title || `Scenario ${existingScenarios.length + 1}`;
        if (existingTitles.has(title)) {
            const baseName = title.replace(/ \(\d+\)$/, '');
            let idx = 2;
            while (existingTitles.has(`${baseName} (${idx})`)) {
                idx++;
            }
            title = `${baseName} (${idx})`;
        }

        // Shared helper deep-clones all fields, applies overrides, normalizes edge data & validates BPMN
        const scenarioPayload = await cloneProcessToScenario(baseProcess, {
            ...req.body,
            title
        });

        const scenario = new Scenario({
            ...scenarioPayload,
            userId: req.user._id
        });
        await scenario.save();
        res.status(201).json({ message: 'Scenario created!', scenario });

    } catch (err) {
        console.error('Create scenario error:', err.message);
        if (err.status) return res.status(err.status).json({ error: err.message });
        if (err.name === 'BpmnValidationError') {
            return res.status(400).json({ error: err.message, details: err.errors });
        }
        res.status(500).json({ error: err.message });
    }
});

// 1.5. Scenario update karo
router.put('/:scenarioId', async (req, res) => {
    try {
        const scenario = await requireOwnedScenario(req, req.params.scenarioId);

        if (req.body.title !== undefined) scenario.title = req.body.title;
        if (req.body.nodes !== undefined) scenario.nodes = req.body.nodes;
        if (req.body.edges !== undefined) scenario.edges = normalizeEdges(req.body.edges);
        if (req.body.resources !== undefined) scenario.resources = req.body.resources;
        if (req.body.layoutElements !== undefined) scenario.layoutElements = req.body.layoutElements;

        await scenario.save();
        res.json({ message: 'Scenario updated!', scenario });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        res.status(500).json({ error: err.message });
    }
});


// 2. Scenario simulate karo
router.post('/simulate/:scenarioId', async (req, res) => {
    try {
        const scenario = await requireOwnedScenario(req, req.params.scenarioId);

        // FIX: req.body.config || {defaults} only falls back when config is
        // undefined/null. An *empty* object {} — which is exactly what an
        // unconfigured caller sends — is truthy in JS, so it slipped past
        // this fallback entirely and forwarded an unconfigured request
        // straight to the simulation engine (silently reintroducing the
        // arrival_rate-defaults-to-1.0/min bug). Defaulting per-field
        // instead means a missing, empty, or partial config always ends up
        // safe, regardless of what any given caller sends.
        const { validateProcessDurations } = require('../utils/durationRules');
        const durationCheck = validateProcessDurations(scenario.nodes);
        if (durationCheck.errors.length > 0) {
            const names = durationCheck.errors.map(e => `"${e.label}"`).join(', ');
            return res.status(400).json({
                error: 'Missing Task Duration',
                detail: `These steps need a duration: ${names}. Set a duration for each step before simulating.`,
                missingDurationTasks: durationCheck.errors
            });
        }

        const incomingConfig = req.body.config || {};
        const payload = {
            process_json: { nodes: scenario.nodes, edges: scenario.edges, resources: scenario.resources },
            config: {
                mode: incomingConfig.mode || 'deep',
                total_instances: incomingConfig.total_instances || 1000,
                arrival_rate: Number(incomingConfig.arrival_rate) || 1.0,
                seed: incomingConfig.seed != null ? Number(incomingConfig.seed) : 42,
                replications: incomingConfig.replications ? Number(incomingConfig.replications) : 1
            }
        };
        const primaryEngineUrl = `${(process.env.SIMULATION_ENGINE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')}/simulate`;

        let response;
        try {
            response = await fetch(primaryEngineUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                const errorText = await response.text().catch(() => 'No error body');
                throw new Error(`Simulation engine error: ${response.status} (${errorText})`);
            }
        } catch (fetchErr) {
            if (!primaryEngineUrl.includes('127.0.0.1') && !primaryEngineUrl.includes('localhost')) {
                const fallbackUrl = 'http://127.0.0.1:8000/simulate';
                response = await fetch(fallbackUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!response.ok) {
                    const errorText = await response.text().catch(() => 'No error body');
                    throw new Error(`Fallback engine error: ${response.status} (${errorText})`);
                }
            } else {
                throw fetchErr;
            }
        }

        const realResults = await response.json();
        scenario.simulationResults = realResults;
        await scenario.save();

        // Save SimulationRun asynchronously without failing the simulation response
        try {
            await saveSimulationRun({
                userId: req.user._id,
                processId: scenario.baseProcessId,
                scenarioId: scenario._id,
                title: scenario.title || 'Scenario',
                config: payload.config,
                results: realResults,
            });
        } catch (runErr) {
            console.warn('[SimulationRun] Failed to save scenario simulation run:', runErr.message);
        }

        res.json({ message: 'Scenario simulated!', results: realResults });

    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// 2.5 List scenarios for current user (supports all=true or limit, populates baseProcessId with resources & nodes, attaches lastRun)
router.get('/', async (req, res) => {
    try {
        const queryFilter = { userId: req.user._id };
        if (req.query.baseProcessId) {
            queryFilter.baseProcessId = req.query.baseProcessId;
        }

        let query = Scenario.find(queryFilter).sort({ updatedAt: -1, createdAt: -1 });

        if (req.query.all !== 'true' && req.query.limit) {
            const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 500);
            query = query.limit(limit);
        } else if (!req.query.all && !req.query.limit) {
            query = query.limit(500);
        }

        const scenarios = await query
            .populate('baseProcessId', 'title resources nodes')
            .lean();

        const scenIds = scenarios.map(s => s._id);
        let runMap = {};
        if (scenIds.length > 0) {
            try {
                const latestRuns = await SimulationRun.aggregate([
                    { $match: { scenarioId: { $in: scenIds }, userId: req.user._id } },
                    { $sort: { createdAt: -1 } },
                    { $group: {
                        _id: '$scenarioId',
                        lastRunId: { $first: '$_id' },
                        title: { $first: '$title' },
                        config: { $first: '$config' },
                        summary: { $first: '$summary' },
                        createdAt: { $first: '$createdAt' }
                    }}
                ]);
                latestRuns.forEach(r => {
                    if (r._id) runMap[r._id.toString()] = r;
                });
            } catch (err) {
                console.warn('Failed to aggregate scenario runs:', err.message);
            }
        }

        const enriched = scenarios.map(s => {
            const sIdStr = s._id.toString();
            const runInfo = runMap[sIdStr];

            let lastRun = null;
            if (runInfo) {
                lastRun = {
                    runId: runInfo.lastRunId,
                    title: runInfo.title,
                    config: runInfo.config,
                    summary: runInfo.summary,
                    createdAt: runInfo.createdAt
                };
            } else if (s.simulationResults) {
                const sr = s.simulationResults;
                lastRun = {
                    title: 'Scenario Simulation',
                    config: s.simulationConfig || {},
                    summary: {
                        avg_cycle_time: sr.time_in_system?.avg != null ? Number(sr.time_in_system.avg) : null,
                        avg_wait_time: sr.time_in_system?.avg_wait_time != null ? Number(sr.time_in_system.avg_wait_time) : null,
                        throughput_rate: sr.throughput_rates != null ? (
                            typeof sr.throughput_rates === 'object'
                                ? (sr.throughput_rates.mean ?? sr.throughput_rates.system)
                                : sr.throughput_rates
                        ) : null,
                        total_cost: sr.financial_summary?.total_cost != null ? Number(sr.financial_summary.total_cost) : null
                    },
                    createdAt: s.updatedAt || s.createdAt
                };
            }

            return {
                ...s,
                lastRun
            };
        });

        res.json(enriched);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// 2.6 Duplicate a scenario
router.post('/:scenarioId/duplicate', async (req, res) => {
    try {
        const source = await requireOwnedScenario(req, req.params.scenarioId);
        const dup = new Scenario({
            baseProcessId: source.baseProcessId,
            title: `${source.title || 'Untitled Scenario'} (Copy)`,
            userId: req.user._id,
            nodes: source.nodes || [],
            edges: source.edges || [],
            layoutElements: source.layoutElements || [],
            resources: source.resources || [],
            simulationConfig: source.simulationConfig || null,
            goal: source.goal || null
        });
        await dup.save();
        res.status(201).json({ message: 'Scenario duplicated successfully', scenario: dup });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// 3. Sab scenarios dekho ek base process ke
router.get('/:baseProcessId', async (req, res) => {
    try {
        await requireOwnedProcess(req, req.params.baseProcessId);
        const scenarios = await Scenario.find({ 
            baseProcessId: req.params.baseProcessId,
            userId: req.user._id
        });
        const normalizedScenarios = scenarios.map(s => {
            const doc = s.toObject ? s.toObject() : s;
            doc.edges = normalizeEdges(doc.edges);
            return doc;
        });
        res.json(normalizedScenarios);

    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// 4. Compare karo base process aur sab scenarios
router.get('/compare/:baseProcessId', async (req, res) => {
    try {
        // Base process fetch karo (ownership checked)
        const baseProcess = await requireOwnedProcess(req, req.params.baseProcessId);
        
        // Sab scenarios fetch karo
        const scenarios = await Scenario.find({ 
            baseProcessId: req.params.baseProcessId,
            userId: req.user._id
        });

        // Compare results
        const comparison = {
            baseProcess: {
                title: baseProcess.title,
                totalTime: baseProcess.simulationResults?.totalTime || null
            },
            scenarios: scenarios.map(s => ({
                title: s.title,
                totalTime: s.simulationResults?.totalTime || null,
                bottlenecks: s.simulationResults?.bottlenecks || []
            }))
        };

        res.json(comparison);

    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// 5. What-if scenario analysis - compare all scenarios at once, or create what-if scenario
router.post('/what-if/:baseProcessId', async (req, res) => {
    try {
        const baseProcess = await requireOwnedProcess(req, req.params.baseProcessId);

        // Creation path: if creation flag or overrides are passed
        if (req.body && (req.body.create || req.body.overrides || req.body.resourceChanges || req.body.nodeChanges || req.body.variantDefinition)) {
            const existingScenarios = await Scenario.find({ 
                baseProcessId: req.params.baseProcessId,
                userId: req.user._id
            });
            const existingTitles = new Set(existingScenarios.map(s => s.title));
            let title = req.body.title || `What-If Scenario ${existingScenarios.length + 1}`;
            if (existingTitles.has(title)) {
                const baseName = title.replace(/ \(\d+\)$/, '');
                let idx = 2;
                while (existingTitles.has(`${baseName} (${idx})`)) {
                    idx++;
                }
                title = `${baseName} (${idx})`;
            }

            const scenarioPayload = await cloneProcessToScenario(baseProcess, {
                ...req.body,
                title
            });
            const scenario = new Scenario({
                ...scenarioPayload,
                userId: req.user._id
            });
            await scenario.save();
            return res.status(201).json({ message: 'What-if scenario created!', scenario });
        }

        const scenarios = await Scenario.find({ 
            baseProcessId: req.params.baseProcessId,
            userId: req.user._id
        });

        if (scenarios.length === 0) {
            return res.status(400).json({ error: 'No scenarios found for this process' });
        }

        const whatIfPayload = {
            scenarios: scenarios.map(s => ({
                name: s.title,
                process: {
                    nodes: s.nodes,
                    edges: normalizeEdges(s.edges),
                    resources: s.resources
                }
            }))
        };

        const response = await fetch(`${process.env.SIMULATION_ENGINE_URL}/what_if_scenario`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(whatIfPayload)
        });

        if (!response.ok) {
            throw new Error(`Simulation engine error: ${response.status}`);
        }

        const results = await response.json();
        res.json(results);

    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        if (err.name === 'BpmnValidationError') {
            return res.status(400).json({ error: err.message, details: err.errors });
        }
        res.status(500).json({ error: err.message });
    }
});

// 6. Scenario delete karo
router.delete('/:scenarioId', async (req, res) => {
    try {
        const scenario = await requireOwnedScenario(req, req.params.scenarioId);
        await Scenario.findByIdAndDelete(scenario._id);
        await deleteRunsForScenario(scenario._id, req.user._id);
        res.json({ message: 'Scenario deleted!' });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// 7. Repair a broken scenario from its base process (Module S1 repair endpoint)
router.post('/repair/:scenarioId', async (req, res) => {
    try {
        const scenario = await requireOwnedScenario(req, req.params.scenarioId);
        const baseProcess = await requireOwnedProcess(req, scenario.baseProcessId);

        // Extract overrides (resource quantities and duration multipliers)
        const baseResources = Array.isArray(baseProcess.resources) ? baseProcess.resources : [];
        const scenResources = Array.isArray(scenario.resources) ? scenario.resources : [];
        const resourceChanges = [];
        for (const sRes of scenResources) {
            const sName = String(sRes.name || '').trim().toLowerCase();
            const bRes = baseResources.find(r => String(r.name || '').trim().toLowerCase() === sName);
            if (bRes && Number(sRes.quantity) !== Number(bRes.quantity)) {
                resourceChanges.push({ name: sRes.name, quantity: sRes.quantity });
            }
        }

        const baseNodes = Array.isArray(baseProcess.nodes) ? baseProcess.nodes : [];
        const scenNodes = Array.isArray(scenario.nodes) ? scenario.nodes : [];
        const nodeChanges = [];
        for (const sNode of scenNodes) {
            const bNode = baseNodes.find(n => String(n.id) === String(sNode.id));
            if (!bNode) continue;
            const sData = sNode.data && typeof sNode.data === 'object' ? sNode.data : sNode;
            const bData = bNode.data && typeof bNode.data === 'object' ? bNode.data : bNode;
            const sDur = Number(sData.duration);
            const bDur = Number(bData.duration);
            if (Number.isFinite(sDur) && Number.isFinite(bDur) && sDur !== bDur && bDur > 0) {
                nodeChanges.push({ id: sNode.id, duration_multiplier: Number((sDur / bDur).toFixed(4)) });
            }
        }

        const repairedPayload = await cloneProcessToScenario(baseProcess, {
            title: scenario.title,
            resourceChanges,
            nodeChanges,
        });

        scenario.nodes = repairedPayload.nodes;
        scenario.edges = repairedPayload.edges;
        scenario.resources = repairedPayload.resources;
        scenario.layoutElements = repairedPayload.layoutElements;
        scenario.simulationConfig = repairedPayload.simulationConfig;
        scenario.goal = repairedPayload.goal;
        await scenario.save();

        res.json({ message: 'Scenario repaired successfully', scenario });
    } catch (err) {
        console.error('Repair scenario error:', err);
        if (err.status) return res.status(err.status).json({ error: err.message });
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;