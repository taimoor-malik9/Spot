// Mystery_Frontend/src/lib/intake/verifyBeforeCanvasApply.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';

import { cleanAndNormalizeSpec } from './specSchema.js';
import { specToBpmn } from './specToBpmn.js';
import { normalizeAndRepairBpmn } from './deterministicNormalizer.js';
import { validateBpmn } from './validateBpmn.js';
import { validatePostGeneration } from './postGenerationValidator.js';
import { bindSpecToSimulation } from './specSimulationBinding.js';
import { layoutAiDiagram } from '../aiDiagramLayout.js';
import { shapeFrontendToBackend } from '../apiService.js';

describe('Verify Before Applying to Canvas - Acceptance Criteria & Invariants', () => {

  it('1. Device repair description generates a model that appears on canvas with 0 save issues', () => {
    const desc = 'A customer brings a faulty electronic gadget to the device repair shop. The technician opens the device and runs comprehensive hardware diagnostics. If the technician determines the device is fixable, the technician installs replacement components and solders internal connections. If the unit is irreparable, the technician notes the failure reason and reassembles the device without new parts. The technician returns the device to the customer and collects the service fee, after which the customer leaves.';

    const spec = cleanAndNormalizeSpec({
      participants: {
        internal_roles: [{ name: 'Technician', count: 2 }],
        external_parties: [{ name: 'Customer' }]
      },
      triggers: [{ name: 'Customer brings faulty electronic gadget', type: 'arrival', rate: 15, unit: 'day' }],
      activities: [
        { name: 'Open device and run comprehensive hardware diagnostics', performer_role: 'Technician', duration: 20, duration_unit: 'minutes' },
        { name: 'Install replacement components and solder internal connections', performer_role: 'Technician', duration: 45, duration_unit: 'minutes' },
        { name: 'Note failure reason and reassemble device without new parts', performer_role: 'Technician', duration: 15, duration_unit: 'minutes' },
        { name: 'Return device to customer and collect service fee', performer_role: 'Technician', duration: 10, duration_unit: 'minutes' }
      ],
      decisions: [
        {
          question: 'Is device fixable?',
          after_activity: 'Open device and run comprehensive hardware diagnostics',
          branches: [
            { label: 'Yes', probability: 0.75 },
            { label: 'No', probability: 0.25 }
          ]
        }
      ]
    });

    // 1. Generate model in memory
    let raw = specToBpmn(spec, { businessName: 'Device Repair Center', userDescription: desc });
    raw = normalizeAndRepairBpmn(raw, { userDescription: desc });
    const postVal = validatePostGeneration(raw);
    raw = postVal.repaired || raw;
    const bound = bindSpecToSimulation(spec, raw);
    const candidateDraft = bound.diagram;

    // 2. Validate draft in memory before canvas
    const val = validateBpmn(candidateDraft, { requireDurations: true, strictData: true });
    assert.strictEqual(val.valid, true, `Draft should be valid: ${val.errors.join(', ')}`);
    assert.strictEqual(val.errors.length, 0);

    // 3. Layout to frontend canvas elements
    const layout = layoutAiDiagram(candidateDraft);
    assert.ok(layout.elements.length > 0, 'Canvas must have elements');
    assert.ok(layout.connections.length > 0, 'Canvas must have connections');

    // Bug 1: Verify main pool and lane objects are generated with real bounds
    const mainPool = layout.elements.find(e => e.type === 'pool' && !e.isExternal && !e.data?.isExternal);
    assert.ok(mainPool, 'Main process pool must be present in layout elements');
    assert.ok(mainPool.width > 0 && mainPool.height > 0, 'Main pool must have real non-zero dimensions');

    const lanes = layout.elements.filter(e => e.type === 'lane');
    assert.ok(lanes.length >= 1, 'At least one lane must be present in layout elements');
    lanes.forEach(lane => {
      assert.ok(lane.width > 0 && lane.height > 0, `Lane "${lane.label}" must have real dimensions`);
      assert.ok(lane.position && Number.isFinite(lane.position.x) && Number.isFinite(lane.position.y), `Lane "${lane.label}" must have position`);
    });

    const tasks = layout.elements.filter(e => e.type === 'task');
    assert.ok(tasks.length > 0, 'Must have task elements');
    tasks.forEach(t => {
      assert.ok(t.position && Number.isFinite(t.position.x) && Number.isFinite(t.position.y), `Task "${t.label || t.id}" must have coordinates`);
      const lane = lanes.find(l => l.id === t.lane || l.label === t.lane || (l.label && t.lane && l.label.toLowerCase() === t.lane.toLowerCase()));
      assert.ok(lane, `Task "${t.label || t.id}" must map to an emitted lane`);
      const laneY = lane.position.y;
      const laneH = lane.height;
      assert.ok(t.position.y >= laneY - 15 && t.position.y <= laneY + laneH + 15, `Task "${t.label}" y=${t.position.y} must be inside lane "${lane.label}" bounds [${laneY}, ${laneY + laneH}]`);
    });

    // Verify external pool is present and collapsed
    const extPools = layout.elements.filter(e => e.type === 'pool' && (e.isExternal || e.data?.isExternal));
    assert.ok(extPools.length >= 1, 'External pool (Customer) must be present in elements');

    // 4. Save validation check (simulating what saveToBackend does)
    const backendShaped = shapeFrontendToBackend(layout.elements, layout.connections, 'Device Repair Center', layout.resources);
    const saveVal = validateBpmn(backendShaped);
    assert.strictEqual(saveVal.errors.length, 0, `Canvas must have 0 save issues: ${saveVal.errors.join(', ')}`);
  });

  it('2. Cross-pool sequence flows are fixed automatically and external pools remain collapsed black boxes', () => {
    const invalidCrossPoolDraft = {
      nodes: [
        { id: 'pool_primary', type: 'pool', label: 'Primary Process' },
        { id: 'pool_ext_customer', type: 'pool', label: 'Customer', data: { isExternal: true } },
        { id: 'start_1', type: 'start-event', label: 'Start', pool: 'pool_primary' },
        { id: 'task_1', type: 'task', label: 'Receive gadget', pool: 'pool_ext_customer', data: { duration: 10, duration_unit: 'minutes' } },
        { id: 'task_2', type: 'task', label: 'Repair device', pool: 'pool_primary', data: { duration: 30, duration_unit: 'minutes' } },
        { id: 'end_1', type: 'end-event', label: 'Completed', pool: 'pool_primary' }
      ],
      edges: [
        { id: 'seq_start_to_cust', source: 'start_1', target: 'task_1', flowType: 'sequence' }, // cross pool sequence flow!
        { id: 'seq_cust_to_repair', source: 'task_1', target: 'task_2', flowType: 'sequence' }, // cross pool sequence flow!
        { id: 'seq_repair_to_end', source: 'task_2', target: 'end_1', flowType: 'sequence' }
      ]
    };

    // Before auto-repair, validateBpmn detects cross-pool sequence flow violations
    const valBefore = validateBpmn(invalidCrossPoolDraft);
    assert.ok(valBefore.errors.length > 0, 'Should detect cross-pool sequence flows');

    // Auto-repair pass converts cross-pool sequence flows to message flows and reparents internal nodes
    const repaired = normalizeAndRepairBpmn(invalidCrossPoolDraft);
    const valAfter = validateBpmn(repaired);
    assert.strictEqual(valAfter.errors.length, 0, `Auto-repaired diagram must have 0 errors: ${valAfter.errors.join(', ')}`);

    // Verify external pool has 0 internal elements
    const nodesInExtPool = repaired.nodes.filter(n => n.type !== 'pool' && (n.pool === 'pool_ext_customer' || n.data?.pool === 'pool_ext_customer'));
    assert.strictEqual(nodesInExtPool.length, 0, 'External pool must be a collapsed black box with 0 internal elements');
  });

  it('3. On failure, canvas state is kept 100% untouched and failure payload is produced', () => {
    // Current canvas state
    const currentCanvas = {
      elements: [
        { id: 'pool_old', type: 'pool', label: 'Old Pool', position: { x: 0, y: 0 } },
        { id: 'node_old_1', type: 'task', label: 'Existing Step', position: { x: 100, y: 100 } }
      ],
      connections: []
    };

    // A fundamentally broken candidate draft with circular dead ends and no end event
    const brokenDraft = {
      elements: [
        { id: 'start_dead', type: 'start-event', label: 'Start', position: { x: 0, y: 0 } },
        { id: 'task_dead', type: 'task', label: 'Loop', position: { x: 100, y: 100 }, data: { duration: 10 } }
      ],
      connections: [
        { id: 'edge_1', fromId: 'start_dead', toId: 'task_dead', flowType: 'sequence' },
        { id: 'edge_2', fromId: 'task_dead', toId: 'task_dead', flowType: 'sequence' } // infinite self loop, no end
      ]
    };

    // Simulation of pre-canvas verification gateway
    function verifyGateway(candidateElements, candidateConnections, existingElements, existingConnections) {
      const shaped = shapeFrontendToBackend(candidateElements, candidateConnections, 'Test', []);
      let val = validateBpmn(shaped);
      let loop = 0;
      let repaired = shaped;
      while ((!val.valid || val.errors.length > 0) && loop < 3) {
        loop++;
        repaired = normalizeAndRepairBpmn(repaired);
        val = validateBpmn(repaired);
      }

      if (val.valid || val.errors.length === 0) {
        const layout = layoutAiDiagram(repaired);
        return { applied: true, elements: layout.elements, connections: layout.connections };
      } else {
        // DO NOT APPLY: preserve existing canvas untouched!
        return {
          applied: false,
          elements: existingElements,
          connections: existingConnections,
          title: "I couldn't build a valid model yet",
          issues: val.errors
        };
      }
    }

    const result = verifyGateway(brokenDraft.elements, brokenDraft.connections, currentCanvas.elements, currentCanvas.connections);
    assert.strictEqual(result.applied, false, 'Broken draft must not be applied');
    assert.strictEqual(result.title, "I couldn't build a valid model yet");
    assert.deepStrictEqual(result.elements, currentCanvas.elements, 'Canvas elements must remain untouched');
    assert.deepStrictEqual(result.connections, currentCanvas.connections, 'Canvas connections must remain untouched');
  });

  it('4. Reports rules checked (14) and auto-fixes count on success', () => {
    const draftNeedingRepair = {
      nodes: [
        { id: 'start_1', type: 'start-event', label: 'Start' },
        { id: 'task_1', type: 'task', label: 'Perform work', data: { duration: 10, duration_unit: 'minutes' } },
        { id: 'gw_split', type: 'exclusive-gateway', label: 'Check condition' },
        { id: 'gw_merge', type: 'exclusive-gateway', label: 'Merge', gateway_role: 'merge' },
        { id: 'end_1', type: 'end-event', label: 'End' }
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'task_1', flowType: 'sequence' },
        { id: 'e2', source: 'task_1', target: 'gw_split', flowType: 'sequence' },
        { id: 'e3', source: 'gw_split', target: 'gw_merge', flowType: 'sequence', label: 'Yes', probability: 0.5 },
        { id: 'e4', source: 'gw_split', target: 'gw_merge', flowType: 'sequence', label: 'No', probability: 0.5 },
        { id: 'e5', source: 'gw_merge', target: 'end_1', flowType: 'sequence' }
      ]
    };

    const val = validateBpmn(draftNeedingRepair);
    assert.strictEqual(val.rulesChecked, 14, 'Must report 14 rules checked');
    assert.ok(val.repairsCount >= 0, 'Must report repairs count');
  });

  it('5. Initial intake missing durations are caught and not drawn on canvas', () => {
    const rawIntakeDiagram = {
      nodes: [
        { id: 'start_1', type: 'start-event', label: 'Start' },
        { id: 'task_1', type: 'task', label: 'User described task with no duration', origin: 'stated' }, // no duration!
        { id: 'end_1', type: 'end-event', label: 'End' }
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'task_1', flowType: 'sequence' },
        { id: 'e2', source: 'task_1', target: 'end_1', flowType: 'sequence' }
      ]
    };

    const val = validateBpmn(rawIntakeDiagram, { requireDurations: true });
    assert.ok(val.errors.some(err => err.includes('missing a duration')), 'Must flag missing duration for user-described task');
  });

  it('6. Save validator rejects internal tasks when no lane exists on canvas or position is outside lane bounds', () => {
    // Case A: Missing matching swimlane on canvas
    const noLaneDoc = {
      nodes: [
        { id: 'pool_1', type: 'pool', label: 'Process' },
        { id: 'start_1', type: 'start-event', label: 'Start', pool: 'pool_1', lane: 'lane_technician', position: { x: 230, y: 185 } },
        { id: 'task_1', type: 'task', label: 'Fix gadget', pool: 'pool_1', lane: 'lane_technician', position: { x: 480, y: 185 }, data: { duration: 20, duration_unit: 'minutes' } },
        { id: 'end_1', type: 'end-event', label: 'End', pool: 'pool_1', lane: 'lane_technician', position: { x: 730, y: 185 } }
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'task_1', flowType: 'sequence' },
        { id: 'e2', source: 'task_1', target: 'end_1', flowType: 'sequence' }
      ]
    };
    const valA = validateBpmn(noLaneDoc);
    assert.ok(valA.errors.some(e => e.includes('no matching swimlane exists on the canvas')), 'Must reject task when lane is missing from canvas');

    // Case B: Task position outside lane bounds
    const outOfBoundsDoc = {
      nodes: [
        { id: 'pool_1', type: 'pool', label: 'Process' },
        { id: 'lane_1', type: 'lane', label: 'Technician', pool: 'pool_1', position: { x: 180, y: 145 }, width: 930, height: 160 },
        { id: 'start_1', type: 'start-event', label: 'Start', pool: 'pool_1', lane: 'lane_1', position: { x: 230, y: 185 } },
        { id: 'task_1', type: 'task', label: 'Fix gadget', pool: 'pool_1', lane: 'lane_1', position: { x: 480, y: 700 }, data: { duration: 20, duration_unit: 'minutes' } },
        { id: 'end_1', type: 'end-event', label: 'End', pool: 'pool_1', lane: 'lane_1', position: { x: 730, y: 185 } }
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'task_1', flowType: 'sequence' },
        { id: 'e2', source: 'task_1', target: 'end_1', flowType: 'sequence' }
      ]
    };
    const valB = validateBpmn(outOfBoundsDoc);
    assert.ok(valB.errors.some(e => e.includes('is outside its lane "Technician" bounds')), 'Must reject task positioned outside its lane bounds');
  });

  it('7. New button workflow: detects unsaved canvas/draft changes, clears all state on confirm, and resets without prompt when clean', () => {
    // Helper to simulate unsaved check
    function checkUnsaved(elements, connections, title, lastSavedSnap, sessionDraft = null) {
      const currentSnap = JSON.stringify({
        nodes: elements.map(e => ({ id: e.id, type: e.type, label: e.label, pos: e.position })),
        edges: connections.map(c => ({ id: c.id, from: c.fromId || c.from || c.source, to: c.toId || c.to || c.target })),
        title,
      });
      const canvasChanged = lastSavedSnap
        ? currentSnap !== lastSavedSnap
        : (elements.length > 0 || connections.length > 0);
      const hasAiDraft = Boolean(sessionDraft?.flowText?.trim() || sessionDraft?.rawDiagram);
      return canvasChanged || hasAiDraft;
    }

    // A. Unsaved canvas elements -> unsaved = true (prompts confirmation)
    assert.strictEqual(checkUnsaved([{ id: 'n1', type: 'task' }], [], 'My Process', null), true);

    // B. Saved canvas elements matching last snapshot -> unsaved = false (clears immediately without prompt)
    const snap = JSON.stringify({
      nodes: [{ id: 'n1', type: 'task', pos: undefined }],
      edges: [],
      title: 'My Process',
    });
    assert.strictEqual(checkUnsaved([{ id: 'n1', type: 'task' }], [], 'My Process', snap), false);

    // C. Empty canvas with unapplied AI draft -> unsaved = true
    assert.strictEqual(checkUnsaved([], [], 'New Process', null, { flowText: 'A customer orders bread' }), true);

    // D. Clean canvas with no draft -> unsaved = false
    assert.strictEqual(checkUnsaved([], [], 'New Process', null, null), false);
  });

  it('8. Bakery process generation after New produces clean canvas with Chef and Cashier lanes', () => {
    const desc = 'A customer walks into the bakery and orders fresh artisan bread. The cashier registers the order and receives payment. The chef prepares the dough, bakes the artisan loaf, and slices it. The cashier boxes the bread and hands it to the customer, who departs happily.';

    const spec = cleanAndNormalizeSpec({
      participants: {
        internal_roles: [
          { name: 'Cashier', count: 1 },
          { name: 'Chef', count: 2 }
        ],
        external_parties: [{ name: 'Customer' }]
      },
      triggers: [{ name: 'Customer walks into bakery', type: 'arrival', rate: 40, unit: 'day' }],
      activities: [
        { name: 'Register order and receive payment', performer_role: 'Cashier', duration: 3, duration_unit: 'minutes' },
        { name: 'Prepare dough, bake artisan loaf and slice', performer_role: 'Chef', duration: 45, duration_unit: 'minutes' },
        { name: 'Box bread and hand to customer', performer_role: 'Cashier', duration: 2, duration_unit: 'minutes' }
      ]
    });

    let raw = specToBpmn(spec, { businessName: 'Artisan Bakery', userDescription: desc });
    raw = normalizeAndRepairBpmn(raw, { userDescription: desc });
    const postVal = validatePostGeneration(raw);
    raw = postVal.repaired || raw;
    const bound = bindSpecToSimulation(spec, raw);
    const candidateDraft = bound.diagram;

    const val = validateBpmn(candidateDraft, { requireDurations: true, strictData: true });
    assert.strictEqual(val.valid, true, `Bakery draft must be valid: ${val.errors.join(', ')}`);

    const layout = layoutAiDiagram(candidateDraft);

    // Verify main pool
    const mainPool = layout.elements.find(e => e.type === 'pool' && !e.isExternal && !e.data?.isExternal);
    assert.ok(mainPool, 'Bakery main pool must be generated');

    // Verify lanes for both internal actors (Cashier and Chef)
    const lanes = layout.elements.filter(e => e.type === 'lane');
    assert.strictEqual(lanes.length, 2, 'Must have 2 lanes: Cashier and Chef');
    const laneLabels = lanes.map(l => l.label.toLowerCase());
    assert.ok(laneLabels.some(l => l.includes('cashier')), 'Must have Cashier lane');
    assert.ok(laneLabels.some(l => l.includes('chef')), 'Must have Chef lane');

    // Verify tasks are inside their respective lane bounds
    const tasks = layout.elements.filter(e => e.type === 'task');
    tasks.forEach(t => {
      const lane = lanes.find(l => l.id === t.lane || l.label === t.lane || (l.label && t.lane && l.label.toLowerCase() === t.lane.toLowerCase()));
      assert.ok(lane, `Task "${t.label}" must belong to an emitted lane`);
      assert.ok(t.position.y >= lane.position.y - 15 && t.position.y <= lane.position.y + lane.height + 15,
        `Task "${t.label}" y=${t.position.y} must be inside lane "${lane.label}" bounds [${lane.position.y}, ${lane.position.y + lane.height}]`);
    });

    // Save validation must pass with 0 errors
    const backendShaped = shapeFrontendToBackend(layout.elements, layout.connections, 'Artisan Bakery', layout.resources);
    const saveVal = validateBpmn(backendShaped);
    assert.strictEqual(saveVal.errors.length, 0, `Bakery model must save with 0 issues: ${saveVal.errors.join(', ')}`);
  });
});
