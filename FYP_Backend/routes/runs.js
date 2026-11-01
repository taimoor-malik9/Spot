const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { SimulationRun } = require('../models/SimulationRun');

// GET /api/runs?processId&scenarioId&limit&cursor
router.get('/', async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { processId, scenarioId, limit = 20, cursor } = req.query;

    const filter = { userId };

    if (processId) {
      if (!mongoose.Types.ObjectId.isValid(processId)) {
        return res.status(400).json({ error: 'Invalid processId' });
      }
      filter.processId = processId;
    }

    if (scenarioId !== undefined) {
      if (scenarioId === 'null' || scenarioId === '' || scenarioId === 'baseline') {
        filter.scenarioId = null;
      } else if (mongoose.Types.ObjectId.isValid(scenarioId)) {
        filter.scenarioId = scenarioId;
      }
    }

    if (cursor) {
      if (mongoose.Types.ObjectId.isValid(cursor)) {
        filter._id = { $lt: cursor };
      } else {
        const cursorDate = new Date(cursor);
        if (!isNaN(cursorDate.getTime())) {
          filter.createdAt = { $lt: cursorDate };
        }
      }
    }

    const pageSize = Math.min(Math.max(1, parseInt(limit, 10) || 20), 50);

    // Return summaries without the full results JSON
    const runs = await SimulationRun.find(filter)
      .sort({ createdAt: -1 })
      .limit(pageSize + 1)
      .select('-results');

    let nextCursor = null;
    if (runs.length > pageSize) {
      const nextItem = runs.pop();
      nextCursor = nextItem._id;
    }

    res.json({
      runs,
      nextCursor,
    });
  } catch (err) {
    console.error('List runs error:', err.message);
    res.status(500).json({ error: 'Failed to list simulation runs' });
  }
});

// GET /api/runs/:id (full run; 404 if not owned)
router.get('/:id', async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ error: 'Simulation run not found' });
    }

    const run = await SimulationRun.findOne({ _id: id, userId });
    if (!run) {
      return res.status(404).json({ error: 'Simulation run not found' });
    }

    res.json(run);
  } catch (err) {
    console.error('Get run error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve simulation run' });
  }
});

// DELETE /api/runs/:id (404 if not owned)
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ error: 'Simulation run not found' });
    }

    const run = await SimulationRun.findOneAndDelete({ _id: id, userId });
    if (!run) {
      return res.status(404).json({ error: 'Simulation run not found' });
    }

    res.json({ message: 'Simulation run deleted successfully' });
  } catch (err) {
    console.error('Delete run error:', err.message);
    res.status(500).json({ error: 'Failed to delete simulation run' });
  }
});

module.exports = router;
