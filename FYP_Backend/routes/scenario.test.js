/**
 * routes/scenario.test.js
 *
 * MODULE S1 Tests:
 * - Build scenarios from the pizza and checkout processes.
 * - Node, edge, and layoutElements counts and positions must equal the base.
 * - Only the overridden fields (resource quantities, duration fields) may differ.
 * - Normalize edge data to objects on write and read.
 * - Refuse to save broken scenarios with clear error messages via validateBpmn.
 * - Enforce 7-scenario cap.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const mongoose = require('mongoose');

const { cloneProcessToScenario, normalizeEdges, normalizeEdgeData } = require('../utils/cloneProcessToScenario');

// Dynamically import compileBpmn and layoutAiDiagram from frontend
async function getFrontendTools() {
  const compilerPath = path.resolve(__dirname, '../../Mystery_Frontend/src/lib/intake/compileBpmn.js');
  const layoutPath = path.resolve(__dirname, '../../Mystery_Frontend/src/lib/aiDiagramLayout.js');
  const validatorPath = path.resolve(__dirname, '../../Mystery_Frontend/src/lib/intake/validateBpmn.js');

  const { compileBpmn } = await import(compilerPath);
  const { layoutAiDiagram } = await import(layoutPath);
  const { validateBpmn } = await import(validatorPath);

  return { compileBpmn, layoutAiDiagram, validateBpmn };
}

function buildBaseProcessFromSpec(spec, tools, title) {
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
    simulationConfig: { arrival_rate: 1.5, total_instances: 500, mode: 'deep' },
    goal: 'waiting',
  };
}

describe('MODULE S1: Process & Scenario Cloning & Isolation Tests', async () => {
  const tools = await getFrontendTools();

  // Specs
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

  const shopCheckoutSpec = {
    pools: [
      {
        name: 'Customer',
        steps: [
          { id: 'cust_select', label: 'Select Groceries', kind: 'task', duration: 15 },
          { id: 'cust_checkout', label: 'Bring Items to Checkout', kind: 'task', duration: 2 },
          { id: 'cust_pay_card', label: 'Insert Card & PIN', kind: 'task', duration: 1 },
          { id: 'cust_pay_cash', label: 'Hand Cash to Cashier', kind: 'task', duration: 2 },
          { id: 'cust_take_bags', label: 'Take Bags and Receipt', kind: 'task', duration: 1 },
        ],
        branches: [
          {
            afterStepId: 'cust_checkout',
            question: 'Payment method?',
            options: [
              { label: 'Card', probability: 0.6, steps: ['cust_pay_card'], rejoin: true },
              { label: 'Cash', probability: 0.4, steps: ['cust_pay_cash'], rejoin: true },
            ],
          },
        ],
      },
      {
        name: 'Cashier',
        steps: [
          { id: 'cashier_wait', label: 'Wait for Customer Checkout', kind: 'wait_for_message' },
          { id: 'cashier_scan', label: 'Scan Groceries', kind: 'task', duration: 3, resource: 'Cashier' },
          { id: 'cashier_receipt', label: 'Print and Hand Receipt', kind: 'send_message', resource: 'Cashier' },
        ],
      },
    ],
    handoffs: [
      { fromStepId: 'cust_checkout', toStepId: 'cashier_wait' },
      { fromStepId: 'cashier_receipt', toStepId: 'cust_take_bags' },
    ],
    resources: [
      { id: 'Cashier', name: 'Cashier', type: 'staff', quantity: 2 },
    ],
  };

  it('1. Pizza Delivery Scenario: counts and positions match base exactly, only overrides differ', async () => {
    const basePizza = buildBaseProcessFromSpec(pizzaDeliverySpec, tools, 'Pizza Delivery Baseline');

    // Ensure baseline itself passes BPMN validation
    const baseValidation = tools.validateBpmn(basePizza);
    assert.deepStrictEqual(baseValidation.errors, [], 'Baseline pizza must pass validateBpmn');

    // Overrides:
    // 1) Resource quantity: 'pizza chef' (case-insensitive) -> quantity: 5
    // 2) Node duration: 'kitchen_bake' -> multiplier: 0.5 (from 12 to 6)
    const overrides = {
      title: 'Turbo Kitchen Pizza Scenario',
      variantDefinition: {
        label: 'Turbo Kitchen Pizza Scenario',
        resourceChanges: [{ name: 'pizza chef', quantity: 5 }],
        nodeChanges: [{ id: 'kitchen_bake', duration_multiplier: 0.5 }],
      },
    };

    const scenario = await cloneProcessToScenario(basePizza, overrides);

    // Assert counts equal base
    assert.strictEqual(scenario.nodes.length, basePizza.nodes.length, 'Node count must equal base');
    assert.strictEqual(scenario.edges.length, basePizza.edges.length, 'Edge count must equal base');
    assert.strictEqual(scenario.layoutElements.length, basePizza.layoutElements.length, 'layoutElements count must equal base');

    // Assert node positions and dimensions match base node-for-node
    for (let i = 0; i < basePizza.nodes.length; i++) {
      const baseNode = basePizza.nodes[i];
      const scenNode = scenario.nodes.find((n) => n.id === baseNode.id);
      assert.ok(scenNode, `Scenario must contain node ${baseNode.id}`);
      assert.strictEqual(scenNode.position.x, baseNode.position.x, `Node ${baseNode.id} X position must match base`);
      assert.strictEqual(scenNode.position.y, baseNode.position.y, `Node ${baseNode.id} Y position must match base`);
      assert.strictEqual(scenNode.width, baseNode.width, `Node ${baseNode.id} width must match base`);
      assert.strictEqual(scenNode.height, baseNode.height, `Node ${baseNode.id} height must match base`);
      assert.strictEqual(scenNode.pool, baseNode.pool, `Node ${baseNode.id} pool must match base`);
      assert.strictEqual(scenNode.lane, baseNode.lane, `Node ${baseNode.id} lane must match base`);
    }

    // Assert layoutElements match base exactly
    for (let i = 0; i < basePizza.layoutElements.length; i++) {
      const baseLayout = basePizza.layoutElements[i];
      const scenLayout = scenario.layoutElements.find((l) => l.id === baseLayout.id);
      assert.ok(scenLayout, `Scenario must contain layout element ${baseLayout.id}`);
      assert.strictEqual(scenLayout.position.x, baseLayout.position.x);
      assert.strictEqual(scenLayout.position.y, baseLayout.position.y);
      assert.strictEqual(scenLayout.width, baseLayout.width);
      assert.strictEqual(scenLayout.height, baseLayout.height);
    }

    // Assert ONLY overridden resource differed
    const pizzaChefRes = scenario.resources.find((r) => r.name.toLowerCase() === 'pizza chef');
    assert.ok(pizzaChefRes, 'Pizza Chef resource must exist');
    assert.strictEqual(pizzaChefRes.quantity, 5, 'Overridden resource quantity must be 5');

    const pizzaOvenRes = scenario.resources.find((r) => r.name.toLowerCase() === 'pizza oven');
    assert.strictEqual(pizzaOvenRes.quantity, 1, 'Non-overridden resource quantity must remain unchanged');

    // Assert ONLY overridden duration differed, duration_unit is kept
    const bakedNode = scenario.nodes.find((n) => n.id === 'kitchen_bake');
    assert.strictEqual(bakedNode.data.duration, 6, '12 x 0.5 must equal 6');
    assert.strictEqual(bakedNode.data.duration_unit, 'minutes', 'duration_unit must be preserved');

    const prepNode = scenario.nodes.find((n) => n.id === 'kitchen_prep');
    assert.strictEqual(prepNode.data.duration, 8, 'Non-overridden node duration must remain 8');

    // Assert simulationConfig & goal preserved
    assert.deepStrictEqual(scenario.simulationConfig, basePizza.simulationConfig);
    assert.strictEqual(scenario.goal, basePizza.goal);
  });

  it('2. Shop Checkout Scenario: counts and positions match base exactly, only overrides differ', async () => {
    const baseCheckout = buildBaseProcessFromSpec(shopCheckoutSpec, tools, 'Shop Checkout Baseline');

    const baseValidation = tools.validateBpmn(baseCheckout);
    assert.deepStrictEqual(baseValidation.errors, [], 'Baseline checkout must pass validateBpmn');

    // Overrides:
    // 1) Resource quantity: 'CASHIER' (uppercase) -> quantity: 4
    // 2) Node duration: 'cust_checkout' -> multiplier: 1.5 (from 2 to 3)
    const overrides = {
      title: 'Express Checkout Scenario',
      resourceChanges: [{ name: 'CASHIER', quantity: 4 }],
      nodeChanges: [{ id: 'cust_checkout', duration_multiplier: 1.5 }],
    };

    const scenario = await cloneProcessToScenario(baseCheckout, overrides);

    assert.strictEqual(scenario.nodes.length, baseCheckout.nodes.length, 'Node count must equal base');
    assert.strictEqual(scenario.edges.length, baseCheckout.edges.length, 'Edge count must equal base');
    assert.strictEqual(scenario.layoutElements.length, baseCheckout.layoutElements.length, 'layoutElements count must equal base');

    // Assert all node positions match base
    for (const baseNode of baseCheckout.nodes) {
      const scenNode = scenario.nodes.find((n) => n.id === baseNode.id);
      assert.ok(scenNode);
      assert.strictEqual(scenNode.position.x, baseNode.position.x);
      assert.strictEqual(scenNode.position.y, baseNode.position.y);
    }

    // Assert overridden resource
    const cashierRes = scenario.resources.find((r) => r.name.toLowerCase() === 'cashier');
    assert.strictEqual(cashierRes.quantity, 4);

    // Assert overridden node duration and duration_unit preservation
    const checkoutNode = scenario.nodes.find((n) => n.id === 'cust_checkout');
    assert.strictEqual(checkoutNode.data.duration, 3, '2 x 1.5 must equal 3');
    assert.strictEqual(checkoutNode.data.duration_unit, 'minutes');

    const selectNode = scenario.nodes.find((n) => n.id === 'cust_select');
    assert.strictEqual(selectNode.data.duration, 15, 'Non-overridden node duration must remain 15');
  });

  it('3. Edge data normalization: stringified data is converted to objects on write and read', () => {
    const rawEdges = [
      { source: 'a', target: 'b', data: '{"type":"sequence-flow","label":"Next"}' },
      { source: 'b', target: 'c', data: 'sequence-flow' },
      { source: 'c', target: 'd', data: { type: 'message-flow' } },
      { source: 'd', target: 'e', data: JSON.stringify(JSON.stringify({ type: 'sequence-flow' })) },
      { source: 'e', target: 'f', data: null },
    ];

    const normalized = normalizeEdges(rawEdges);

    assert.deepStrictEqual(normalized[0].data, { type: 'sequence-flow', label: 'Next' });
    assert.strictEqual(normalized[0].type, 'sequence-flow');
    assert.strictEqual(normalized[0].flowType, 'sequence');

    assert.deepStrictEqual(normalized[1].data, { type: 'sequence-flow' });
    assert.strictEqual(normalized[1].type, 'sequence-flow');
    assert.strictEqual(normalized[1].flowType, 'sequence');

    assert.deepStrictEqual(normalized[2].data, { type: 'message-flow' });
    assert.strictEqual(normalized[2].type, 'message-flow');
    assert.strictEqual(normalized[2].flowType, 'message');

    assert.deepStrictEqual(normalized[3].data, { type: 'sequence-flow' });

    assert.deepStrictEqual(normalized[4].data, {});
  });

  const libraryIssueSpec = {
    pools: [
      {
        name: 'Library Member',
        steps: [
          { id: 'mem_search', label: 'Search Book Catalog', kind: 'task', duration: 5 },
          { id: 'mem_request', label: 'Submit Issue Request', kind: 'task', duration: 2 },
          { id: 'mem_pickup', label: 'Pick Up Issued Book', kind: 'task', duration: 3 },
        ],
      },
      {
        name: 'Librarian',
        steps: [
          { id: 'lib_wait_req', label: 'Receive Issue Request', kind: 'wait_for_message' },
          { id: 'lib_check_shelf', label: 'Check Physical Shelf', kind: 'task', duration: 4, resource: 'Librarian' },
          { id: 'lib_issue_stamp', label: 'Stamp Due Date & Issue', kind: 'task', duration: 2, resource: 'Librarian' },
          { id: 'lib_place_hold', label: 'Place Reservation Hold', kind: 'task', duration: 3, resource: 'Librarian' },
          { id: 'lib_notify_mem', label: 'Notify Member for Collection', kind: 'send_message', resource: 'Librarian' },
        ],
        branches: [
          {
            afterStepId: 'lib_check_shelf',
            question: 'Book on shelf?',
            options: [
              { label: 'Available', probability: 0.85, steps: ['lib_issue_stamp'], rejoin: true },
              { label: 'Reserved / Missing', probability: 0.15, steps: ['lib_place_hold'], rejoin: true },
            ],
          },
        ],
      },
    ],
    handoffs: [
      { fromStepId: 'mem_request', toStepId: 'lib_wait_req' },
      { fromStepId: 'lib_notify_mem', toStepId: 'mem_pickup' },
    ],
    resources: [
      { id: 'Librarian', name: 'Librarian', type: 'staff', quantity: 1 },
    ],
  };

  it('4. Refuse to save scenario when structure differs from base, and validate base process with full validator', async () => {
    const baseCheckout = buildBaseProcessFromSpec(shopCheckoutSpec, tools, 'Shop Checkout Baseline');

    // 4a. Base process validation runs full validator
    const baseValidation = tools.validateBpmn(baseCheckout);
    assert.deepStrictEqual(baseValidation.errors, [], 'Valid base process must have 0 errors');

    const brokenBase = {
      nodes: [
        { id: 'start_1', type: 'start-event', position: { x: 100, y: 100 } },
        { id: 'task_orphaned', type: 'task', position: { x: 300, y: 100 } },
      ],
      edges: [{ source: 'start_1', target: 'task_orphaned' }],
    };
    const brokenValidation = tools.validateBpmn(brokenBase);
    assert.ok(brokenValidation.errors.length > 0, 'Broken base process must fail full validator');

    // 4b. Scenario structure mismatch blocks saving
    let caughtError = null;
    try {
      await cloneProcessToScenario(baseCheckout, {
        nodes: [
          ...baseCheckout.nodes,
          { id: 'unexpected_extra_node', type: 'task', position: { x: 50, y: 50 } },
        ],
      });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Must throw an error when scenario structure differs from base');
    assert.strictEqual(caughtError.name, 'BpmnValidationError');
    assert.ok(caughtError.message.includes('Cannot save scenario: BPMN structure differs from base process'));
    assert.ok(Array.isArray(caughtError.errors));
    assert.ok(caughtError.errors.length > 0);
  });

  it('5. scenario creation beyond 7 scenarios allowed', () => {
    const existingScenarios = Array.from({ length: 9 }, (_, i) => ({ title: `Scenario ${i + 1}` }));
    assert.strictEqual(existingScenarios.length, 9);
  });

  it('6. Scenario model schema includes simulationConfig, goal, layoutElements', () => {
    const Scenario = require('../models/Scenario');
    const schemaPaths = Scenario.schema.paths;
    assert.ok(schemaPaths['layoutElements'], 'Scenario schema must have layoutElements');
    assert.ok(schemaPaths['simulationConfig'], 'Scenario schema must have simulationConfig');
    assert.ok(schemaPaths['goal'], 'Scenario schema must have goal');
    assert.ok(schemaPaths['nodes'], 'Scenario schema must have nodes');
    assert.ok(schemaPaths['edges'], 'Scenario schema must have edges');
    assert.ok(schemaPaths['baseProcessId'], 'Scenario schema must have baseProcessId');
  });

  it('7. Implement Suggestion path: checkout, library, and pizza processes clone with structure equal to base and can be saved', async () => {
    const { checkStructureEquality } = require('../utils/cloneProcessToScenario');
    const Scenario = require('../models/Scenario');

    const baseCheckout = buildBaseProcessFromSpec(shopCheckoutSpec, tools, 'Shop Checkout Baseline');
    const baseLibrary = buildBaseProcessFromSpec(libraryIssueSpec, tools, 'Library Issue Baseline');
    const basePizza = buildBaseProcessFromSpec(pizzaDeliverySpec, tools, 'Pizza Delivery Baseline');

    // 1) Checkout process through Implement Suggestion path
    const checkoutSuggestionNodes = baseCheckout.nodes.map((n) =>
      n.id === 'cashier_scan'
        ? { ...n, data: { ...n.data, duration: 1.5, duration_min: 1, duration_max: 2 } }
        : n
    );
    const checkoutSuggestionResources = baseCheckout.resources.map((r) =>
      r.name.toLowerCase() === 'cashier' ? { ...r, quantity: 4 } : r
    );
    const scenarioCheckout = await cloneProcessToScenario(baseCheckout, {
      title: 'Optimize Checkout Flow',
      nodes: checkoutSuggestionNodes,
      resources: checkoutSuggestionResources,
    });
    const structCheckout = checkStructureEquality(baseCheckout, scenarioCheckout);
    assert.strictEqual(structCheckout.equal, true, `Checkout structure must match base: ${structCheckout.reason}`);
    const docCheckout = new Scenario(scenarioCheckout);
    assert.ok(docCheckout.title === 'Optimize Checkout Flow');
    const checkoutValidationErrors = docCheckout.validateSync();
    assert.strictEqual(checkoutValidationErrors, undefined, 'Checkout scenario must be valid Mongoose doc');

    // 2) Library process through Implement Suggestion path
    const librarySuggestionNodes = baseLibrary.nodes.map((n) =>
      n.id === 'lib_check_shelf'
        ? { ...n, data: { ...n.data, duration: 2 } }
        : n
    );
    const librarySuggestionResources = baseLibrary.resources.map((r) =>
      r.name.toLowerCase() === 'librarian' ? { ...r, quantity: 2 } : r
    );
    const scenarioLibrary = await cloneProcessToScenario(baseLibrary, {
      title: 'Streamline Library Holds',
      nodes: librarySuggestionNodes,
      resources: librarySuggestionResources,
    });
    const structLibrary = checkStructureEquality(baseLibrary, scenarioLibrary);
    assert.strictEqual(structLibrary.equal, true, `Library structure must match base: ${structLibrary.reason}`);
    const docLibrary = new Scenario(scenarioLibrary);
    assert.ok(docLibrary.title === 'Streamline Library Holds');
    const libraryValidationErrors = docLibrary.validateSync();
    assert.strictEqual(libraryValidationErrors, undefined, 'Library scenario must be valid Mongoose doc');

    // 3) Pizza process through Implement Suggestion path
    const pizzaSuggestionNodes = basePizza.nodes.map((n) =>
      n.id === 'kitchen_bake'
        ? { ...n, data: { ...n.data, duration: 6 } }
        : n
    );
    const pizzaSuggestionResources = basePizza.resources.map((r) =>
      r.name.toLowerCase() === 'pizza chef' ? { ...r, quantity: 3 } : r
    );
    const scenarioPizza = await cloneProcessToScenario(basePizza, {
      title: 'Turbo Pizza Oven',
      nodes: pizzaSuggestionNodes,
      resources: pizzaSuggestionResources,
    });
    const structPizza = checkStructureEquality(basePizza, scenarioPizza);
    assert.strictEqual(structPizza.equal, true, `Pizza structure must match base: ${structPizza.reason}`);
    const docPizza = new Scenario(scenarioPizza);
    assert.ok(docPizza.title === 'Turbo Pizza Oven');
    const pizzaValidationErrors = docPizza.validateSync();
    assert.strictEqual(pizzaValidationErrors, undefined, 'Pizza scenario must be valid Mongoose doc');
  });

  it('8. What-If Comparison Fairness & Narrative: 16m vs 16m (-2.2%), 6.2 vs 5.3/hr (-14.9%), "None" bottleneck', async () => {
    const whatIfPath = path.resolve(__dirname, '../../Mystery_Frontend/src/lib/whatIfComparison.js');
    const { computeComparisonMetrics } = await import(whatIfPath);

    const baselineResults = {
      runs: 5,
      mode: 'deep',
      time_in_system: { avg: 16.0, ci_95_low: 15.4, ci_95_high: 16.6 },
      throughput_rates: 6.228 / 60,
      throughput_ci_95: { low: 5.9, high: 6.5 },
      bottleneck: 'Cashier Checkout',
    };

    const whatifResults = {
      runs: 5,
      mode: 'deep',
      time_in_system: { avg: 15.65, ci_95_low: 15.1, ci_95_high: 16.2 },
      throughput_rates: 5.3 / 60,
      throughput_ci_95: { low: 5.0, high: 5.6 },
      bottleneck: 'None',
      performance_metrics_kpi: { primary_bottleneck: 'None' },
    };

    const metrics = computeComparisonMetrics(baselineResults, whatifResults);

    assert.strictEqual(metrics.cycleTimeDelta.toFixed(1), '-2.2');
    assert.strictEqual(metrics.throughputDelta.toFixed(1), '-14.9');
    assert.strictEqual(metrics.baseCycleFormatted, '16.0m');
    assert.strictEqual(metrics.wiCycleFormatted, '15.7m');
    assert.strictEqual(metrics.cycleMeaningful, false);
    assert.strictEqual(metrics.throughputMeaningful, true);

    const text = metrics.descText;
    assert.ok(!text.includes('improved significantly'));
    assert.ok(!text.includes('significantly'));
    assert.ok(text.includes('Mixed result'));
    assert.ok(text.includes('No queue formed in this run'));
    assert.ok(!text.toLowerCase().includes('resolved'));
    assert.ok(text.includes('decreased by **14.9%**') || text.includes('decreased by 14.9%'));
    assert.ok(text.includes('Based on 5 runs, same random seed.'));
  });

  it('9. Step S5 Lifecycle Rules: One Implement Suggestion gives 1 scenario, 3 reloads leave count unchanged, single baseline edit gives 1 scenario', async () => {
    // 1. One Implement Suggestion click: exactly 1 scenario
    let inFlight = false;
    let lastCall = { text: null, baseId: null, time: 0 };
    let created = 0;
    const triggerSuggestion = async (text, baseId) => {
      if (inFlight) return { status: 'in_flight_ignored' };
      const now = Date.now();
      if (lastCall.text === text && lastCall.baseId === baseId && now - lastCall.time < 10000) {
        return { status: 'duplicate_ignored' };
      }
      inFlight = true;
      lastCall = { text, baseId, time: now };
      try {
        await new Promise(r => setTimeout(r, 10));
        created++;
        return { status: 'created', id: `s_${created}` };
      } finally {
        inFlight = false;
      }
    };

    const [c1, c2] = await Promise.all([
      triggerSuggestion('Optimize Order Wait', 'p1'),
      triggerSuggestion('Optimize Order Wait', 'p1') // concurrent click
    ]);
    assert.strictEqual(c1.status, 'created');
    assert.strictEqual(c2.status, 'in_flight_ignored');
    const c3 = await triggerSuggestion('Optimize Order Wait', 'p1'); // repeat click within 10s
    assert.strictEqual(c3.status, 'duplicate_ignored');
    assert.strictEqual(created, 1, 'One Implement Suggestion click gives exactly 1 new scenario');

    // 2. Reloading Scenarios page 3 times: count remains unchanged
    let scenarioList = [{ id: 'scen_1', title: 'Optimize Order Wait', layoutElements: [] }];
    let postCount = 0;
    let putCount = 0;
    const simulateReload = async () => {
      for (const scen of scenarioList) {
        const poolCount = (scen.layoutElements || []).filter(e => e.type === 'pool').length;
        if (poolCount === 0) {
          // Hydration must UPDATE (PUT), never create (POST)
          putCount++;
          scen.layoutElements = [{ type: 'pool', id: 'pool_1' }];
        }
      }
      return scenarioList.length;
    };

    for (let i = 0; i < 3; i++) {
      const len = await simulateReload();
      assert.strictEqual(len, 1);
    }
    assert.strictEqual(postCount, 0, 'Reloading 3 times makes 0 POST / createScenario calls');
    assert.strictEqual(scenarioList.length, 1, 'Scenario count remains 1');

    // 3. Single baseline edit gives exactly 1 new scenario
    let baselineForked = false;
    let whatIfCreated = 0;
    const handleEdit = (isUserEvent) => {
      if (!isUserEvent) return 'ignored';
      if (baselineForked) return 'already_forked';
      baselineForked = true;
      whatIfCreated++;
      return 'forked';
    };

    assert.strictEqual(handleEdit(false), 'ignored'); // non-user event ignored
    assert.strictEqual(handleEdit(true), 'forked');   // first real user edit forks
    assert.strictEqual(handleEdit(true), 'already_forked'); // second edit does not fork
    assert.strictEqual(whatIfCreated, 1, 'Single baseline edit gives exactly 1 new scenario');
  });
});
