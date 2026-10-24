import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Simulation endpoint
app.post('/api/simulate', (req, res) => {
  const { resources, nodes, edges, config } = req.body;
  
  if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
    return res.status(400).json({ error: 'No process nodes provided' });
  }

  // Simulate basic DES
  const results = simulateProcess(nodes, edges, resources, config);
  res.json(results);
});

// Compare scenarios endpoint
app.post('/api/compare', (req, res) => {
  const { scenarios } = req.body;
  
  if (!scenarios || !Array.isArray(scenarios) || scenarios.length < 2) {
    return res.status(400).json({ error: 'At least 2 scenarios required for comparison' });
  }

  const comparisonResults = scenarios.map((scenario, idx) => {
    const { nodes, edges, resources } = scenario;
    const results = simulateProcess(nodes, edges, resources, {});
    return { scenarioId: idx + 1, ...results };
  });

  res.json({ comparisons: comparisonResults });
});

// Simple DES simulation function
function simulateProcess(nodes, edges, globalResources, config = {}) {
  const simDuration = config.duration || 100;
  const instances = config.instances || 100;
  const simType = config.type || 'DES';
  
  // Build node map
  const nodeMap = {};
  nodes.forEach(n => {
    nodeMap[n.id] = {
      ...n,
      duration: n.data?.duration || 5,
      resources: n.data?.resources || {}
    };
  });
  
  // Find start and end nodes
  const startNode = nodes.find(n => n.type === 'start' || n.id.startsWith('start'));
  const endNodes = nodes.filter(n => n.type === 'end' || n.id.startsWith('end')).map(n => n.id);
  
  if (!startNode) {
    return { error: 'No start node found' };
  }

  // Simulate instances
  const results = {
    type: simType,
    instances,
    duration: simDuration,
    metrics: {
      total_cases: instances,
      completed: 0,
      average_cycle_time: 0,
      average_cost: 0,
      throughput: 0,
      bottlenecks: []
    },
    task_stats: {},
    resources_used: {}
  };

  // Run simulation for each instance
  for (let i = 0; i < instances; i++) {
    let current = startNode.id;
    let cycleTime = 0;
    const path = [current];
    
    while (!endNodes.includes(current)) {
      const node = nodeMap[current];
      if (!node) break;
      
      // Calculate duration (DES or Monte Carlo)
      let taskDuration = node.duration;
      if (simType === 'Monte Carlo' && node.data?.duration_max) {
        const min = node.data.duration_min || 1;
        const max = node.data.duration_max || node.duration;
        taskDuration = Math.floor(Math.random() * (max - min + 1)) + min;
      }
      
      cycleTime += taskDuration;
      
      // Find next node
      const outgoing = edges.filter(e => e.source === current);
      if (outgoing.length === 0) break;
      
      // Handle XOR gateway
      if (outgoing.length > 1) {
        const random = Math.random();
        let cumulative = 0;
        for (const edge of outgoing) {
          cumulative += edge.data?.probability || (1 / outgoing.length);
          if (random <= cumulative) {
            current = edge.target;
            break;
          }
        }
      } else {
        current = outgoing[0].target;
      }
      
      path.push(current);
      
      // Safety check
      if (path.length > nodes.length * 2) break;
    }
    
    if (endNodes.includes(current)) {
      results.metrics.completed++;
      results.metrics.average_cycle_time += cycleTime;
    }
  }

  // Calculate averages
  if (results.metrics.completed > 0) {
    results.metrics.average_cycle_time /= results.metrics.completed;
  }
  results.metrics.throughput = results.metrics.completed / simDuration;
  
  // Calculate resource usage
  const resourceUsage = {};
  nodes.forEach(n => {
    if (n.data?.resources) {
      Object.entries(n.data.resources).forEach(([res, qty]) => {
        resourceUsage[res] = (resourceUsage[res] || 0) + qty;
      });
    }
  });
  results.resources_used = resourceUsage;

  // Find bottlenecks (tasks with high utilization)
  const bottleneckThreshold = 0.8;
  Object.entries(globalResources || {}).forEach(([res, available]) => {
    const used = resourceUsage[res] || 0;
    if (available > 0 && used / available > bottleneckThreshold) {
      results.metrics.bottlenecks.push({ resource: res, utilization: used / available });
    }
  });

  return results;
}

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(join(__dirname, 'dist'));
}

app.listen(PORT, () => {
  console.log(`Simulation server running on port ${PORT}`);
});

export default app;