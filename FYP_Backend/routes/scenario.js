const express = require('express');
const router = express.Router();
const Scenario = require('../models/Scenario');
const Process = require('../models/Process');
const { cloneProcessToScenario, normalizeEdges } = require('../utils/cloneProcessToScenario');

// 1. Base process ki copy bana ke scenario save karo
router.post('/:baseProcessId', async (req, res) => {
    try {
        // Base process fetch karo
        const baseProcess = await Process.findById(req.params.baseProcessId);
        if (!baseProcess) {
            return res.status(404).json({ error: 'Base process not found' });
        }

        const existingScenarios = await Scenario.find({ 
            baseProcessId: req.params.baseProcessId 
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

        const scenario = new Scenario(scenarioPayload);
        await scenario.save();
        res.status(201).json({ message: 'Scenario created!', scenario });

    } catch (err) {
        console.error('Create scenario error:', err.message);
        if (err.name === 'BpmnValidationError') {
            return res.status(400).json({ error: err.message, details: err.errors });
        }
        res.status(500).json({ error: err.message });
    }
});

// 1.5. Scenario update karo
router.put('/:scenarioId', async (req, res) => {
    try {
        const scenario = await Scenario.findById(req.params.scenarioId);
        if (!scenario) {
            return res.status(404).json({ error: 'Scenario not found' });
        }

        if (req.body.title !== undefined) scenario.title = req.body.title;
        if (req.body.nodes !== undefined) scenario.nodes = req.body.nodes;
        if (req.body.edges !== undefined) scenario.edges = normalizeEdges(req.body.edges);
        if (req.body.resources !== undefined) scenario.resources = req.body.resources;
        if (req.body.layoutElements !== undefined) scenario.layoutElements = req.body.layoutElements;

        await scenario.save();
        res.json({ message: 'Scenario updated!', scenario });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// 2. Scenario simulate karo
router.post('/simulate/:scenarioId', async (req, res) => {
    try {
        const scenario = await Scenario.findById(req.params.scenarioId);
        if (!scenario) {
            return res.status(404).json({ error: 'Scenario not found' });
        }

        // FIX: req.body.config || {defaults} only falls back when config is
        // undefined/null. An *empty* object {} — which is exactly what an
        // unconfigured caller sends — is truthy in JS, so it slipped past
        // this fallback entirely and forwarded an unconfigured request
        // straight to the simulation engine (silently reintroducing the
        // arrival_rate-defaults-to-1.0/min bug). Defaulting per-field
        // instead means a missing, empty, or partial config always ends up
        // safe, regardless of what any given caller sends.
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

        res.json({ message: 'Scenario simulated!', results: realResults });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Sab scenarios dekho ek base process ke
router.get('/:baseProcessId', async (req, res) => {
    try {
        const scenarios = await Scenario.find({ 
            baseProcessId: req.params.baseProcessId 
        });
        const normalizedScenarios = scenarios.map(s => {
            const doc = s.toObject ? s.toObject() : s;
            doc.edges = normalizeEdges(doc.edges);
            return doc;
        });
        res.json(normalizedScenarios);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Compare karo base process aur sab scenarios
router.get('/compare/:baseProcessId', async (req, res) => {
    try {
        // Base process fetch karo
        const baseProcess = await Process.findById(req.params.baseProcessId);
        
        // Sab scenarios fetch karo
        const scenarios = await Scenario.find({ 
            baseProcessId: req.params.baseProcessId 
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
        res.status(500).json({ error: err.message });
    }
});

// 5. What-if scenario analysis - compare all scenarios at once, or create what-if scenario
router.post('/what-if/:baseProcessId', async (req, res) => {
    try {
        // Creation path: if creation flag or overrides are passed
        if (req.body && (req.body.create || req.body.overrides || req.body.resourceChanges || req.body.nodeChanges || req.body.variantDefinition)) {
            const baseProcess = await Process.findById(req.params.baseProcessId);
            if (!baseProcess) {
                return res.status(404).json({ error: 'Base process not found' });
            }
            const existingScenarios = await Scenario.find({ 
                baseProcessId: req.params.baseProcessId 
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
            const scenario = new Scenario(scenarioPayload);
            await scenario.save();
            return res.status(201).json({ message: 'What-if scenario created!', scenario });
        }

        const scenarios = await Scenario.find({ 
            baseProcessId: req.params.baseProcessId 
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
        if (err.name === 'BpmnValidationError') {
            return res.status(400).json({ error: err.message, details: err.errors });
        }
        res.status(500).json({ error: err.message });
    }
});

// 6. Scenario delete karo
// This was missing entirely — the frontend's trash-icon button only ever
// cleared local browser state, so every "deleted" scenario stayed in
// MongoDB forever, kept counting against the 7-scenario cap, and silently
// reappeared on next page load.
router.delete('/:scenarioId', async (req, res) => {
    try {
        const scenario = await Scenario.findByIdAndDelete(req.params.scenarioId);
        if (!scenario) {
            return res.status(404).json({ error: 'Scenario not found' });
        }
        res.json({ message: 'Scenario deleted!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 7. Repair a broken scenario from its base process (Module S1 repair endpoint)
router.post('/repair/:scenarioId', async (req, res) => {
    try {
        const scenario = await Scenario.findById(req.params.scenarioId);
        if (!scenario) {
            return res.status(404).json({ error: 'Scenario not found' });
        }
        const baseProcess = await Process.findById(scenario.baseProcessId);
        if (!baseProcess) {
            return res.status(404).json({ error: 'Base process not found' });
        }

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
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;