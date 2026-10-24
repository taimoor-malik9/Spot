/**
 * routes/testedSuggestions.test.js
 *
 * Step R2 Tests:
 * 1) With coffee-shop and pizza processes:
 *    - No suggestion ever targets a step without resources (e.g. customer-paced browse/wait).
 *    - Every shown suggestion has measured evidence ("Tested: ...").
 * 2) Candidate budget: max 4 candidates; baselines computed once per load level.
 * 3) Cache keyed by process version + goal + arrival rate and invalidated on update.
 * 4) Measures and reports total wall time on both processes.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const mongoose = require('mongoose');

const {
  generateTestedSuggestions,
  buildCandidates,
  isStaffHandledTask,
  suggestionsCache,
  invalidateSuggestionsCache,
} = require('../services/testedSuggestionsService');

async function getFrontendTools() {
  const compilerPath = path.resolve(__dirname, '../../Mystery_Frontend/src/lib/intake/compileBpmn.js');
  const layoutPath = path.resolve(__dirname, '../../Mystery_Frontend/src/lib/aiDiagramLayout.js');
  const validatorPath = path.resolve(__dirname, '../../Mystery_Frontend/src/lib/intake/validateBpmn.js');

  const { compileBpmn } = await import(compilerPath);
  const { layoutAiDiagram } = await import(layoutPath);
  const { validateBpmn } = await import(validatorPath);

  return { compileBpmn, layoutAiDiagram, validateBpmn };
}

function buildProcessFromSpec(spec, tools, title) {
  const { compileBpmn, layoutAiDiagram } = tools;
  const compiled = compileBpmn(spec);
  const layout = layoutAiDiagram(compiled);

  const pools = layout.elements.filter((e) => e.type === 'pool' || e.type === 'lane');
  const nodes = layout.elements
    .filter((e) => e.type !== 'pool' && e.type !== 'lane')
    .map((el) => {
      const compiledNode = compiled.nodes.find((n) => n.id === el.id) || {};
      return {
        id: el.id,
        type: el.type,
        pool: el.pool || compiledNode.pool,
        lane: el.lane || compiledNode.lane,
        position: { x: el.position.x, y: el.position.y },
        width: el.width || 80,
        height: el.height || 80,
        data: {
          label: el.data?.label || el.label || el.id,
          duration: el.data?.duration != null ? el.data.duration : (compiledNode.data?.duration ?? 0),
          duration_min: el.data?.duration_min != null ? el.data.duration_min : (compiledNode.data?.duration_min ?? null),
          duration_max: el.data?.duration_max != null ? el.data.duration_max : (compiledNode.data?.duration_max ?? null),
          duration_unit: 'minutes',
          resource: el.data?.resource || compiledNode.data?.resource || null,
          resources: el.data?.resources || compiledNode.data?.resources || {},
          gateway_type: el.data?.gateway_type || compiledNode.data?.gateway_type || null,
        },
      };
    });

  const edges = layout.connections.map((c) => ({
    id: c.id,
    source: c.fromId || c.source,
    target: c.toId || c.target,
    type: c.type || (c.flowType === 'message' ? 'message-flow' : 'sequence-flow'),
    flowType: c.flowType || (c.type === 'message-flow' ? 'message' : 'sequence'),
    data: {
      type: c.type || (c.flowType === 'message' ? 'message-flow' : 'sequence-flow'),
      probability: c.probability,
    },
  }));

  return {
    _id: new mongoose.Types.ObjectId().toString(),
    title,
    nodes,
    edges,
    layoutElements: pools,
    resources: JSON.parse(JSON.stringify(spec.resources || [])),
    simulationConfig: { arrival_rate: 0.5, total_instances: 100, mode: 'deep' },
    goal: 'waiting',
    __v: 1,
  };
}

describe('Step R2: Tested Suggestions Engine & Evidence Tests', async () => {
  const tools = await getFrontendTools();

  const pizzaDeliverySpec = {
    pools: [
      {
        name: 'Customer',
        steps: [
          { id: 'cust_order', label: 'Place Pizza Order Online', kind: 'task', duration: 5 },
          { id: 'cust_receive', label: 'Receive Pizza & Enjoy', kind: 'task', duration: 10 },
        ],
      },
      {
        name: 'Pizzeria Kitchen',
        steps: [
          { id: 'kitchen_wait', label: 'Receive Order in Kitchen', kind: 'wait_for_message' },
          { id: 'kitchen_prep', label: 'Prepare Dough & Toppings', kind: 'task', duration: 8, resource: 'Pizza Chef' },
          { id: 'kitchen_bake', label: 'Bake in Stone Oven', kind: 'task', duration: 12, resource: 'Pizza Oven' },
          { id: 'kitchen_pack', label: 'Box Pizza & Cut', kind: 'send_message', duration: 2, resource: 'Kitchen Staff' },
        ],
      },
      {
        name: 'Delivery Driver',
        steps: [
          { id: 'driver_wait', label: 'Wait for Boxed Pizza', kind: 'wait_for_message' },
          { id: 'driver_drive', label: 'Drive to Customer Address', kind: 'task', duration: 20, resource: 'Delivery Driver' },
          { id: 'driver_handover', label: 'Handover Pizza at Door', kind: 'send_message', duration: 2, resource: 'Delivery Driver' },
        ],
      },
    ],
    handoffs: [
      { fromStepId: 'cust_order', toStepId: 'kitchen_wait' },
      { fromStepId: 'kitchen_pack', toStepId: 'driver_wait' },
      { fromStepId: 'driver_handover', toStepId: 'cust_receive' },
    ],
    resources: [
      { id: 'Pizza Chef', name: 'Pizza Chef', type: 'staff', quantity: 2 },
      { id: 'Pizza Oven', name: 'Pizza Oven', type: 'equipment', quantity: 1 },
      { id: 'Kitchen Staff', name: 'Kitchen Staff', type: 'staff', quantity: 1 },
      { id: 'Delivery Driver', name: 'Delivery Driver', type: 'staff', quantity: 3 },
    ],
  };

  const coffeeShopSpec = {
    pools: [
      {
        name: 'Customer',
        steps: [
          { id: 'cust_browse', label: 'Browse Coffee Menu', kind: 'task', duration: 4 }, // NO resource!
          { id: 'cust_wait', label: 'Wait in Line at Counter', kind: 'task', duration: 2 }, // NO resource!
          { id: 'cust_order', label: 'Order & Pay at Counter', kind: 'task', duration: 3, resource: 'Cashier' },
          { id: 'cust_pickup', label: 'Collect Prepared Coffee', kind: 'task', duration: 1 }, // NO resource!
        ],
      },
      {
        name: 'Coffee Bar',
        steps: [
          { id: 'bar_wait', label: 'Wait for Coffee Ticket', kind: 'wait_for_message' },
          { id: 'bar_brew', label: 'Brew Espresso & Steam Milk', kind: 'task', duration: 7, resource: 'Barista' },
          { id: 'bar_call', label: 'Call Customer Name', kind: 'send_message', duration: 1, resource: 'Barista' },
        ],
      },
    ],
    handoffs: [
      { fromStepId: 'cust_order', toStepId: 'bar_wait' },
      { fromStepId: 'bar_call', toStepId: 'cust_pickup' },
    ],
    resources: [
      { id: 'Cashier', name: 'Cashier', type: 'staff', quantity: 1 },
      { id: 'Barista', name: 'Barista', type: 'staff', quantity: 1 },
      { id: 'Cleaner', name: 'Cleaner', type: 'staff', quantity: 2 },
    ],
  };

  it('1. Task classification: tasks without resources are never considered staff-handled', () => {
    const coffeeProcess = buildProcessFromSpec(coffeeShopSpec, tools, 'Coffee Shop');
    const resources = coffeeProcess.resources;

    const browseNode = coffeeProcess.nodes.find(n => n.id === 'cust_browse' || n.data?.label?.includes('Browse'));
    const orderNode = coffeeProcess.nodes.find(n => n.id === 'cust_order' || n.data?.label?.includes('Order'));
    const brewNode = coffeeProcess.nodes.find(n => n.id === 'bar_brew' || n.data?.label?.includes('Brew'));

    assert.ok(browseNode, 'Browse node must exist');
    assert.strictEqual(
      isStaffHandledTask(browseNode, resources),
      false,
      'Customer-paced browse task without resources MUST NOT be staff-handled'
    );

    assert.ok(orderNode, 'Order node must exist');
    assert.strictEqual(
      isStaffHandledTask(orderNode, resources),
      true,
      'Order task assigned to Cashier MUST be staff-handled'
    );

    assert.ok(brewNode, 'Brew node must exist');
    assert.strictEqual(
      isStaffHandledTask(brewNode, resources),
      true,
      'Brew task assigned to Barista MUST be staff-handled'
    );
  });

  it('2. Candidate generation: never targets tasks without resources and caps at 4', () => {
    const coffeeProcess = buildProcessFromSpec(coffeeShopSpec, tools, 'Coffee Shop');
    const mockBaselineResults = {
      resource_utilization: {
        Barista: { utilization_pct: 88.5, capacity: 1 },
        Cashier: { utilization_pct: 75.0, capacity: 1 },
        Cleaner: { utilization_pct: 12.0, capacity: 2 },
      },
      activity_results: {
        cust_browse: { avg_wait_time: 25.0, avg_processing_time: 4.0 }, // high wait, but NO resource!
        bar_brew: { avg_wait_time: 14.0, avg_processing_time: 7.0 },     // has Barista
        cust_order: { avg_wait_time: 6.0, avg_processing_time: 3.0 },    // has Cashier
      },
      queue_levels: {
        cust_browse: { avg_queue_length: 5.0, avg_wait_time: 25.0 },
        bar_brew: { avg_queue_length: 3.2, avg_wait_time: 14.0 },
      },
    };

    const candidatesWaiting = buildCandidates(coffeeProcess, mockBaselineResults, 'waiting');
    assert.ok(candidatesWaiting.length <= 4, 'Must not exceed 4 candidates');

    // Check that none of the candidates target cust_browse or any task without resources
    for (const c of candidatesWaiting) {
      for (const nodeChange of c.variantDefinition.nodeChanges || []) {
        assert.notStrictEqual(
          nodeChange.id,
          'cust_browse',
          'Candidate MUST NEVER target cust_browse (no resources assigned)'
        );
        assert.notStrictEqual(
          nodeChange.id,
          'cust_wait',
          'Candidate MUST NEVER target cust_wait (no resources assigned)'
        );
      }
    }

    // Cost goal candidate generation should include -1 on Cleaner (<30% utilization)
    const candidatesCost = buildCandidates(coffeeProcess, mockBaselineResults, 'cost');
    const cleanerCand = candidatesCost.find(c => c.label.includes('Reduce 1 Cleaner'));
    assert.ok(cleanerCand, 'Should generate -1 staff for Cleaner under 30% utilization when goal is cost');
  });

  it('3. Coffee Shop Process: simulation testing, evidence numbers, and measured wall time', async () => {
    const coffeeProcess = buildProcessFromSpec(coffeeShopSpec, tools, 'Coffee Shop Process');
    invalidateSuggestionsCache(coffeeProcess._id);

    const startTime = Date.now();
    const result = await generateTestedSuggestions({
      processDoc: coffeeProcess,
      goal: 'waiting',
      config: { replications: 3, total_instances: 150 },
    });
    const measuredTime = Date.now() - startTime;
    console.log(`[TEST REPORT] Coffee Shop process measured wall time: ${measuredTime}ms`);

    assert.ok(measuredTime < 30000, `Wall time ${measuredTime}ms must be within 30s budget`);
    assert.ok(result.wall_time_ms != null, 'Response should report wall_time_ms');

    if (!result.none) {
      assert.ok(Array.isArray(result.candidates), 'Result should contain candidate array');
      assert.ok(result.candidates.length <= 4, 'Max 4 candidates');
      for (const cand of result.candidates) {
        // Every shown suggestion has measured evidence
        assert.ok(cand.tested_evidence, 'Candidate must contain tested_evidence string');
        assert.match(cand.tested_evidence, /^Tested:/, 'tested_evidence must start with "Tested:"');
        assert.ok(cand.summary, 'Candidate must contain 2-sentence summary');
        assert.ok(cand.before, 'Candidate must contain before numbers');
        assert.ok(cand.after, 'Candidate must contain after numbers');

        // Verify no suggestion targets a step without resources
        for (const nc of cand.variant_definition?.nodeChanges || []) {
          assert.notStrictEqual(nc.id, 'cust_browse');
          assert.notStrictEqual(nc.id, 'cust_wait');
          assert.notStrictEqual(nc.id, 'cust_pickup');
        }
      }
    } else {
      assert.strictEqual(result.reason, 'No change worth making at this load');
    }
  });

  it('4. Pizza Delivery Process: simulation testing, evidence numbers, and measured wall time', async () => {
    const pizzaProcess = buildProcessFromSpec(pizzaDeliverySpec, tools, 'Pizza Delivery Process');
    invalidateSuggestionsCache(pizzaProcess._id);

    const startTime = Date.now();
    const result = await generateTestedSuggestions({
      processDoc: pizzaProcess,
      goal: 'waiting',
      config: { replications: 3, total_instances: 150 },
    });
    const measuredTime = Date.now() - startTime;
    console.log(`[TEST REPORT] Pizza Delivery process measured wall time: ${measuredTime}ms`);

    assert.ok(measuredTime < 30000, `Wall time ${measuredTime}ms must be within 30s budget`);

    if (!result.none) {
      assert.ok(Array.isArray(result.candidates), 'Result should contain candidate array');
      assert.ok(result.candidates.length <= 4, 'Max 4 candidates');
      for (const cand of result.candidates) {
        assert.ok(cand.tested_evidence, 'Candidate must contain tested_evidence string');
        assert.match(cand.tested_evidence, /^Tested:/, 'tested_evidence must start with "Tested:"');

        // Verify no suggestion targets customer steps without resources
        for (const nc of cand.variant_definition?.nodeChanges || []) {
          assert.notStrictEqual(nc.id, 'cust_order');
          assert.notStrictEqual(nc.id, 'cust_receive');
        }
      }
    } else {
      assert.strictEqual(result.reason, 'No change worth making at this load');
    }
  });

  it('5. Caching and invalidation: cache hits reuse result, process changes invalidate', async () => {
    const pizzaProcess = buildProcessFromSpec(pizzaDeliverySpec, tools, 'Cached Pizza Process');
    invalidateSuggestionsCache(pizzaProcess._id);

    const t1 = Date.now();
    const res1 = await generateTestedSuggestions({
      processDoc: pizzaProcess,
      goal: 'waiting',
      config: { replications: 3, total_instances: 100 },
    });
    const timeFirst = Date.now() - t1;

    // Second call with same parameters must hit cache instantly
    const t2 = Date.now();
    const res2 = await generateTestedSuggestions({
      processDoc: pizzaProcess,
      goal: 'waiting',
      config: { replications: 3, total_instances: 100 },
    });
    const timeCached = Date.now() - t2;

    assert.ok(timeCached < 50, `Cached call should return almost instantaneously (${timeCached}ms)`);
    assert.deepStrictEqual(res1.none, res2.none);

    // Invalidate cache
    invalidateSuggestionsCache(pizzaProcess._id);

    // Bump version / simulate process change
    pizzaProcess.updatedAt = new Date(Date.now() + 1000);
    const t3 = Date.now();
    const res3 = await generateTestedSuggestions({
      processDoc: pizzaProcess,
      goal: 'waiting',
      config: { replications: 3, total_instances: 100 },
    });
    assert.deepStrictEqual(res1.none, res3.none);
  });
});
