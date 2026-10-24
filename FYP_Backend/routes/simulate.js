const express = require('express');
const router = express.Router();
const Process = require('../models/Process');

// ================== SIMULATION ROUTE (POST /api/process/:id) ==================
router.post('/:id', async (req, res) => {
    try {
        const processData = await Process.findById(req.params.id);
        if (!processData) {
            return res.status(404).json({ error: 'Process not found' });
        }

        const payload = {
            resources: processData.resources || [],
            nodes: processData.nodes,
            edges: processData.edges,
            config: {
                arrival_rate: processData.arrival_rate || 1.0,
                simulation_duration: processData.simulation_duration || null,
                time_unit: processData.time_unit || "minutes",
                total_instances: processData.total_instances || 1000
            }
        };

        const engineBase = (process.env.SIMULATION_ENGINE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
        const response = await fetch(`${engineBase}/simulate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)        // ← yahan change hua hai
        });
        
        if (!response.ok) {
            throw new Error(`Simulation engine error: ${response.status}`);
        }
        
        const realResults = await response.json();
        
        processData.simulationResults = realResults;
        await processData.save();
console.log(JSON.stringify(realResults, null, 2));
        res.json({ 
            message: 'Simulation completed!', 
            results: realResults 
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;