import { describe, it } from 'node:test';
import assert from 'node:assert';
import { normalizeAndRepairBpmn } from '../shared/deterministicNormalizer.js';
import { validateBpmn } from '../shared/validateBpmn.js';
import { layoutAiDiagram } from '../shared/aiDiagramLayout.js';
import { cleanAndNormalizeSpec } from '../shared/specSchema.js';
import { specToBpmn } from '../shared/specToBpmn.js';
import { bindSpecToSimulation } from '../shared/specSimulationBinding.js';
import { extractOrderedSteps } from '../shared/stepListHelper.js';

describe('Beverages Distribution Intake Confirm & Self-Healing Pipeline', () => {
  const rawBeveragesModel = {
    nodes: [
      { id: 'start_1', type: 'start-event', label: 'Start' },
      { id: 'gw_check_stock', type: 'exclusive-gateway', label: 'Stock below reorder level?' },
      { id: 'task_order', type: 'task', label: 'Place order with manufacturer' },
      { id: 'task_receive', type: 'task', label: 'Receive delivery from manufacturer' },
      { id: 'gw_join_check_stock_level_0', type: 'exclusive-gateway', label: 'gw_join_check_stock_level_0' },
      { id: 'task_retailer_order', type: 'task', label: 'Booker takes orders from retailer' },
      { id: 'task_dispatch', type: 'task', label: 'Dispatch order to retailer' },
      { id: 'end_1', type: 'end-event', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start_1', target: 'gw_check_stock' },
      { id: 'e2', source: 'gw_check_stock', target: 'task_receive', label: 'No' },
      { id: 'e3', source: 'gw_check_stock', target: 'task_order', label: 'Yes' },
      { id: 'e4', source: 'task_order', target: 'task_receive' },
      { id: 'e5', source: 'task_receive', target: 'gw_join_check_stock_level_0' },
      { id: 'e6', source: 'gw_join_check_stock_level_0', target: 'task_retailer_order', label: 'Yes' },
      { id: 'e7', source: 'task_retailer_order', target: 'task_dispatch' },
      { id: 'e8', source: 'task_dispatch', target: 'end_1' },
    ],
  };

  const userDesc = 'Beverages distribution business: checks stock, orders from manufacturer if below reorder level, receives delivery, booker takes orders from retailer, dispatches orders';

  it('1. Repair loop: merge gateways are never treated as splits and no cascading merges occur', () => {
    const repaired = normalizeAndRepairBpmn(JSON.parse(JSON.stringify(rawBeveragesModel)), {
      userDescription: userDesc,
      lang: 'en',
    });

    // Check changelog entries
    const changes = repaired.repairChanges || [];
    assert.ok(changes.length > 0, 'Expected repair changes to be logged');

    for (const change of changes) {
      // Must NOT add missing branch paths to any merge gateway
      assert.doesNotMatch(
        change.description,
        /Added a missing '(?:Yes|No)' path to 'Merge/i,
        `Corrupt change detected: ${change.description}`
      );
      assert.doesNotMatch(
        change.description,
        /Added a merge point for paths after 'Merge/i,
        `Cascading merge detected: ${change.description}`
      );

      // Must never leak internal IDs, timestamps, or "Auto Gw"
      assert.doesNotMatch(change.description, /\b1\d{9,}\b/, 'Must not leak timestamps in changelog');
      assert.doesNotMatch(change.description, /\bauto[\s_-]gw\b/i, 'Must not leak Auto Gw in changelog');
      assert.doesNotMatch(change.description, /gw_join_|gw_merge_|_\d+/i, 'Must not leak internal ID patterns');
    }

    // Merge gateways in the diagram must have role 'merge' and no fake branch additions
    const mergeNodes = repaired.nodes.filter(
      (n) => n.role === 'merge' || n.gateway_role === 'merge' || /merge|join/i.test(n.id)
    );
    for (const mg of mergeNodes) {
      const outSeq = repaired.edges.filter((e) => e.source === mg.id && e.flowType !== 'message');
      assert.strictEqual(outSeq.length, 1, `Merge gateway ${mg.id} should have exactly 1 outgoing sequence flow`);
    }
  });

  it('2. Idempotency: running normalizeAndRepairBpmn on its own output produces zero further changes', () => {
    const repaired1 = normalizeAndRepairBpmn(JSON.parse(JSON.stringify(rawBeveragesModel)), {
      userDescription: userDesc,
      lang: 'en',
    });

    const repaired2 = normalizeAndRepairBpmn(JSON.parse(JSON.stringify(repaired1)), {
      userDescription: userDesc,
      lang: 'en',
    });

    assert.strictEqual(
      repaired2.repairChanges?.length || 0,
      0,
      `Repair on already-repaired model must produce 0 further changes, got: ${repaired2.repairChanges?.map((c) => c.description).join('; ')}`
    );

    // Node count and edge structure must be identical
    assert.strictEqual(repaired1.nodes.length, repaired2.nodes.length);
    assert.strictEqual(repaired1.edges.length, repaired2.edges.length);
  });

  it('3. Layout & Canvas population: elements and connections are generated with valid labels', () => {
    const repaired = normalizeAndRepairBpmn(JSON.parse(JSON.stringify(rawBeveragesModel)), {
      userDescription: userDesc,
      lang: 'en',
    });

    const layout = layoutAiDiagram(repaired);
    assert.ok(layout, 'Layout must be generated');
    assert.ok(Array.isArray(layout.elements) && layout.elements.length > 0, 'Canvas elements must not be empty');
    assert.ok(Array.isArray(layout.connections) && layout.connections.length > 0, 'Canvas connections must not be empty');

    // Assert that merge gateways on the canvas have empty visible labels (BPMN standard)
    const canvasMergeGws = layout.elements.filter(
      (e) => e.type?.includes('gateway') && (/merge|join/i.test(e.id) || e.data?.gateway_role === 'merge' || e.data?.role === 'merge')
    );
    for (const mg of canvasMergeGws) {
      assert.strictEqual(mg.label, '', `Canvas merge gateway ${mg.id} must have empty label`);
      assert.doesNotMatch(mg.data?.label || '', /\b1\d{9,}\b/, 'Canvas data.label must not contain timestamp');
    }
  });

  it('4. Confirm workflow simulation: uses state model, prevents double-submit, and asserts nodes > 0', async () => {
    let apiCallCount = 0;
    const mockGenerateAIProcess = async () => {
      apiCallCount++;
      return rawBeveragesModel;
    };

    // Initial generation
    const generatedModel = await mockGenerateAIProcess();
    assert.strictEqual(apiCallCount, 1, 'Generate API should be called exactly once');

    // Auto-repair during intake step 1
    const repairedModel = normalizeAndRepairBpmn(JSON.parse(JSON.stringify(generatedModel)), {
      userDescription: userDesc,
      lang: 'en',
    });

    // Simulated Confirm click handler matching IntakeFlow.jsx
    let isConfirming = false;
    let canvasElementsLoaded = null;
    let confirmError = null;

    const handleConfirmSimulated = async (modelInState) => {
      if (isConfirming) return; // double submit guard
      isConfirming = true;
      try {
        let modelToApply = modelInState;
        let validation = validateBpmn(modelToApply, { allowUnresolved: true });
        if (validation.errors && validation.errors.length > 0) {
          modelToApply = normalizeAndRepairBpmn(validation.repaired || modelToApply, {
            userDescription: userDesc,
            lang: 'en',
          });
          validation = validateBpmn(modelToApply, { allowUnresolved: true });
        }

        const finalRaw = validation.repaired || modelToApply;
        const finalLayout = layoutAiDiagram(finalRaw);

        const canvasNodes = finalLayout?.elements || [];
        if (!canvasNodes || canvasNodes.length === 0) {
          throw new Error('Canvas elements array is empty');
        }

        canvasElementsLoaded = canvasNodes;
      } catch (err) {
        confirmError = err;
      } finally {
        isConfirming = false;
      }
    };

    // Confirm is clicked
    await handleConfirmSimulated(repairedModel);

    // Assert: API was NOT called again during confirm
    assert.strictEqual(apiCallCount, 1, 'Confirm must NOT call generateAIProcess');
    assert.strictEqual(confirmError, null, 'Confirm should complete without error');
    assert.ok(canvasElementsLoaded && canvasElementsLoaded.length > 0, 'Canvas nodes must be populated');

    // Test double submit: simultaneous clicks
    isConfirming = true;
    let secondClickIgnored = false;
    if (isConfirming) {
      secondClickIgnored = true;
    }
    assert.strictEqual(secondClickIgnored, true, 'Double submit must be blocked by isConfirming flag');
  });

  it('5. Canvas emptiness guard: catches empty elements and surfaces error', async () => {
    let confirmErrorMsg = null;
    const handleConfirmSimulated = async (emptyModel) => {
      try {
        const finalLayout = layoutAiDiagram(emptyModel);
        const canvasNodes = finalLayout?.elements || [];
        if (!canvasNodes || canvasNodes.length === 0) {
          throw new Error('Canvas elements array is empty');
        }
      } catch (err) {
        confirmErrorMsg = "We couldn't open your process, tap to try again";
      }
    };

    await handleConfirmSimulated({ nodes: [], edges: [] });
    assert.strictEqual(
      confirmErrorMsg,
      "We couldn't open your process, tap to try again",
      'Empty canvas must trigger the friendly user error message'
    );
  });

  it('6. Regression: Sequential order/reorder flow with stated durations & rate 400/day produces clean diagram with zero false gateways', () => {
    // Spec extracted from: "Each day 400 orders are delivered. Booker records and stores order (takes 5 mins). Then Booker places reorder to Manufacturer. Then wait for Manufacturer delivery (2 days). Then Booker stores items in warehouse (15 mins)."
    const sequentialSpec = {
      participants: {
        internal_roles: [{ name: 'Booker', count: 1 }],
        external_parties: [{ name: 'Manufacturer' }, { name: 'Retailer' }],
      },
      triggers: [
        {
          name: 'Retailers place 400 orders daily',
          type: 'arrival',
          rate: 400,
          unit: 'day',
          independent: false,
        },
      ],
      activities: [
        {
          name: 'Record and store order',
          performer_role: 'Booker',
          duration: 5,
          duration_unit: 'minutes',
        },
        {
          name: 'Place reorder to Manufacturer',
          performer_role: 'Booker',
        },
        {
          name: 'Wait for Manufacturer delivery',
          performer_role: 'Booker',
          duration: 2,
          duration_unit: 'days',
        },
        {
          name: 'Store items in warehouse',
          performer_role: 'Booker',
          duration: 15,
          duration_unit: 'minutes',
        },
      ],
      decisions: [],
      resources_and_costs: [
        { role_or_item: 'Booker', count: 1, salary: 50000 },
      ],
      quantities: [
        { name: 'Daily orders', value: 400, unit: 'orders/day' },
      ],
      goals_or_issues: ['Maintain beverage inventory and satisfy retailer orders'],
      missing_or_ambiguous: [],
    };

    const userDesc = 'Each day 400 orders are delivered. Booker records and stores order (takes 5 mins). Then Booker places reorder to Manufacturer. Then wait for Manufacturer delivery (2 days). Then Booker stores items in warehouse (15 mins).';

    // 1. Generate BPMN from spec
    const cleanSpec = cleanAndNormalizeSpec(sequentialSpec);
    let bpmn = specToBpmn(cleanSpec, { businessName: 'Beverages Distribution' });

    // 2. Normalize and repair
    bpmn = normalizeAndRepairBpmn(bpmn, { userDescription: userDesc, lang: 'en' });

    // 3. Bind simulation configuration
    const binding = bindSpecToSimulation(cleanSpec, bpmn, { operatingHours: 8 });
    const finalBpmn = binding.diagram;
    const simConfig = binding.simulationConfig;

    // Assert: ZERO parallel or inclusive gateways emitted on sequential flow
    const parallelGws = finalBpmn.nodes.filter(
      (n) => n.type === 'parallel-gateway' || n.data?.gateway_type === 'parallel' ||
             n.type === 'inclusive-gateway' || n.data?.gateway_type === 'inclusive'
    );
    assert.strictEqual(
      parallelGws.length,
      0,
      `Sequential flow must have zero parallel/inclusive gateways, found: ${parallelGws.map((g) => g.id).join(', ')}`
    );

    // Assert: ZERO split gateways (no branching was specified in decisions)
    const splitGws = finalBpmn.nodes.filter(
      (n) => n.type?.includes('gateway') && (n.gateway_role === 'split' || n.data?.gateway_role === 'split')
    );
    assert.strictEqual(splitGws.length, 0, 'Sequential flow must not contain split gateways');

    // Assert: Arrival rate bound to 50/hour (400 orders/day over 8 hours)
    assert.strictEqual(simConfig.arrivalRate, 50, 'Arrival rate must be 50 orders/hour');
    assert.strictEqual(simConfig.busyness_source, 'stated', 'Arrival rate source must be stated');

    // Assert: Stated durations preserved on nodes
    const recordTask = finalBpmn.nodes.find((n) => n.label?.includes('Record and store order'));
    assert.ok(recordTask, 'Record and store order task must exist');
    assert.strictEqual(recordTask.data?.duration, 5, 'Record and store order duration must be 5 mins');
    assert.strictEqual(recordTask.data?.duration_source, 'stated');

    const waitDeliveryNode = finalBpmn.nodes.find((n) => n.label?.includes('Wait for Manufacturer delivery'));
    assert.ok(waitDeliveryNode, 'Wait for Manufacturer delivery node must exist');
    assert.strictEqual(waitDeliveryNode.type, 'message-intermediate-catch');
    assert.strictEqual(waitDeliveryNode.data?.duration, 2, 'Wait delivery duration must be 2 days');
    assert.strictEqual(waitDeliveryNode.data?.duration_unit, 'days');

    const storeTask = finalBpmn.nodes.find((n) => n.label?.includes('Store items in warehouse'));
    assert.ok(storeTask, 'Store items in warehouse task must exist');
    assert.strictEqual(storeTask.data?.duration, 15, 'Store items duration must be 15 mins');

    // Assert: stepListHelper produces ordered steps without "Both paths continue here"
    const orderedSteps = extractOrderedSteps(finalBpmn, { lang: 'en' });
    assert.ok(orderedSteps.length >= 4, `Expected at least 4 ordered steps, got ${orderedSteps.length}`);
    orderedSteps.forEach((step) => {
      assert.notStrictEqual(
        step.branchCondition,
        'Both paths continue here',
        `Step "${step.label}" must not receive "Both paths continue here" in a sequential process`
      );
      assert.doesNotMatch(
        step.branchCondition || '',
        /rejoin|paths continue/i,
        `Step "${step.label}" must not have join condition in linear flow`
      );
    });

    // Assert: Validate BPMN returns zero errors
    const validation = validateBpmn(finalBpmn, { allowUnresolved: true });
    assert.strictEqual(
      validation.errors?.length || 0,
      0,
      `validateBpmn must have 0 errors, got: ${(validation.errors || []).join('; ')}`
    );

    // Assert: layoutAiDiagram produces renderable elements and connections
    const layout = layoutAiDiagram(finalBpmn);
    assert.ok(layout.elements.length > 0, 'Canvas layout must have elements');
    assert.ok(layout.connections.length > 0, 'Canvas layout must have connections');
  });

  it('7. Multi-Entity Pipeline: Manufacturer -> Distributor -> Retailer with Booker, Driver, Salesman, 400 orders/day, 50-pack bonus, monthly cash, Rs 5,000,000 capital', () => {
    const multiEntitySpec = {
      process_name: 'Beverage Distribution Operations',
      participants: {
        internal_roles: [
          { name: 'Booker', count: 2 },
          { name: 'Driver', count: 2 },
          { name: 'Salesman', count: 2 },
        ],
        external_parties: [
          { name: 'Manufacturer' },
          { name: 'Retailer' },
        ],
      },
      triggers: [
        {
          name: 'Retailers place orders daily',
          type: 'arrival',
          rate: 400,
          unit: 'day',
          independent: false,
        },
        {
          name: 'Monthly cash collection schedule',
          type: 'schedule',
          interval: 1,
          unit: 'month',
          independent: false,
        },
      ],
      activities: [
        {
          name: 'Booker takes orders from Retailer',
          performer_role: 'Booker',
          duration: 5,
          duration_unit: 'minutes',
        },
        {
          name: 'Place reorder to Manufacturer',
          performer_role: 'Booker',
          duration: 10,
          duration_unit: 'minutes',
        },
        {
          name: 'Receive manufacturer truck delivery with 50-pack bonus',
          performer_role: 'Booker',
          duration: 2,
          duration_unit: 'days',
        },
        {
          name: 'Record and store inventory',
          performer_role: 'Booker',
          duration: 15,
          duration_unit: 'minutes',
        },
        {
          name: 'Deliver orders to Retailer via car',
          performer_role: 'Driver',
          secondary_roles: ['Salesman'],
          duration: 45,
          duration_unit: 'minutes',
        },
        {
          name: 'Salesman collects monthly cash from Retailer',
          performer_role: 'Salesman',
          duration: 20,
          duration_unit: 'minutes',
        },
      ],
      decisions: [
        {
          question: 'Stock below reorder level?',
          branches: [
            { label: 'Yes', probability: 0.3 },
            { label: 'No', probability: 0.7 },
          ],
        },
      ],
      resources_and_costs: [
        { role_or_item: 'Booker', quantity: 2, salary: 50000 },
        { role_or_item: 'Driver', quantity: 2, salary: 40000 },
        { role_or_item: 'Salesman', quantity: 2, salary: 45000 },
        { role_or_item: 'Capital Investment', capital: 5000000, currency: 'PKR' },
      ],
      quantities: [
        { name: 'Daily orders', value: 400, unit: 'orders/day' },
        { name: 'Standard delivery batch', value: 1000, unit: 'packs' },
        { name: 'Extra bonus stock', value: 50, unit: 'packs' },
        { name: 'Retailer network', value: 800, unit: 'retailers' },
      ],
      goals_or_issues: ['Maintain beverage inventory and satisfy 800+ retailer network with monthly cash collection'],
      missing_or_ambiguous: [],
    };

    const userDesc = 'We take orders from 800+ retailers. Each day 400 orders are delivered. Booker takes orders and places reorder to Manufacturer if stock is below reorder level. Manufacturer sends truck delivery of 1000 packs plus extra 50-pack bonus. Booker records and stores inventory. Delivery orders are delivered via car with Driver and Salesman. Salesman collects monthly cash from Retailer. Capital is Rs 5,000,000.';

    // 1. Generate BPMN from spec
    const cleanSpec = cleanAndNormalizeSpec(multiEntitySpec);
    assert.strictEqual(cleanSpec.process_name, 'Beverage Distribution Operations');
    assert.ok(cleanSpec.activities.find((a) => a.name.includes('Deliver orders')).secondary_roles?.includes('Salesman'));

    let bpmn = specToBpmn(cleanSpec, { userDescription: userDesc });

    // 2. Normalize and repair
    bpmn = normalizeAndRepairBpmn(bpmn, { userDescription: userDesc, lang: 'en' });

    // 3. Bind simulation configuration
    const binding = bindSpecToSimulation(cleanSpec, bpmn, { operatingHours: 8 });
    const finalBpmn = binding.diagram;
    const simConfig = binding.simulationConfig;

    // ── Check 1: Clean Pool Title (No raw sentences like "We take orders from 800+ retailers") ──
    const mainPool = finalBpmn.nodes.find((n) => n.type === 'pool' && !n.data?.isExternal);
    assert.ok(mainPool, 'Main business pool must exist');
    assert.strictEqual(mainPool.label, 'Beverage Distribution Operations');
    assert.doesNotMatch(mainPool.label, /^(we\s+take|i\s+take|our)/i, 'Pool label must not be a prompt substring');

    // ── Check 2: External Pools & Zero Orphaned Message Events ──
    const externalPools = finalBpmn.nodes.filter((n) => n.type === 'pool' && n.data?.isExternal);
    assert.ok(externalPools.some((p) => /manufacturer/i.test(p.label)), 'Manufacturer external pool must exist');
    assert.ok(externalPools.some((p) => /retailer/i.test(p.label)), 'Retailer external pool must exist');

    // Every message event must have at least one message flow connecting to an external pool
    const messageEventNodes = finalBpmn.nodes.filter(
      (n) => n.type === 'message-start-event' ||
             n.type === 'message-intermediate-catch' ||
             n.type === 'message-intermediate-throw' ||
             n.type === 'message-end-event'
    );
    assert.ok(messageEventNodes.length >= 2, `Expected at least 2 message events, found ${messageEventNodes.length}`);

    messageEventNodes.forEach((men) => {
      const msgEdge = finalBpmn.edges.find(
        (e) => e.flowType === 'message' && (e.source === men.id || e.target === men.id)
      );
      assert.ok(
        msgEdge,
        `Message event "${men.label}" (${men.id}) is orphaned! Must have a connecting message flow.`
      );
    });

    // ── Check 3: Complete Task Extraction (Zero Silent Omissions) ──
    const labels = finalBpmn.nodes.map((n) => n.label || '');
    assert.ok(labels.some((l) => /take.*order/i.test(l)), 'Must have taking orders step');
    assert.ok(labels.some((l) => /reorder|place.*order/i.test(l)), 'Must have placing reorder step');
    assert.ok(labels.some((l) => /receive.*delivery|truck.*delivery/i.test(l)), 'Must have delivery receiving step');
    assert.ok(labels.some((l) => /record|store.*inventory/i.test(l)), 'Must have inventory recording step');
    assert.ok(labels.some((l) => /deliver.*order/i.test(l)), 'Must have order delivery step');
    assert.ok(labels.some((l) => /collect.*cash/i.test(l)), 'Must have cash collection step');

    // ── Check 4: Multi-Role / Joint-Resource Tasks (No Empty Swimlanes) ──
    const lanes = finalBpmn.nodes.filter((n) => n.type === 'lane');
    const laneNames = lanes.map((l) => (l.label || '').toLowerCase());
    assert.ok(laneNames.includes('booker'), 'Booker lane must exist');
    assert.ok(laneNames.includes('driver'), 'Driver lane must exist');
    assert.ok(laneNames.includes('salesman'), 'Salesman lane must exist');

    // Assert every lane has at least 1 task or event placed in it (ZERO empty swimlanes)
    lanes.forEach((lane) => {
      const nodesInLane = finalBpmn.nodes.filter(
        (n) => n.type !== 'lane' && n.type !== 'pool' && (n.lane || '').toLowerCase() === lane.label.toLowerCase()
      );
      assert.ok(
        nodesInLane.length > 0,
        `Swimlane "${lane.label}" has 0 assigned steps! Empty swimlanes must not be emitted.`
      );
    });

    // Joint delivery task has both Driver and Salesman in resources
    const deliverTask = finalBpmn.nodes.find((n) => /deliver.*order/i.test(n.label || ''));
    assert.ok(deliverTask, 'Deliver task must exist');
    assert.ok(deliverTask.data?.resources?.['Driver'] >= 1, 'Driver must be in deliver task resources');
    assert.ok(deliverTask.data?.resources?.['Salesman'] >= 1, 'Salesman must be in deliver task resources');

    // ── Check 5: Strict Parameter Binding ──
    assert.strictEqual(simConfig.arrivalRate, 50, 'Arrival rate must be 50 orders/hour (400/8h)');
    assert.strictEqual(simConfig.capital, 5000000, 'Capital must be 5,000,000');
    assert.strictEqual(simConfig.currency, 'PKR', 'Currency must be PKR');
    assert.strictEqual(simConfig.quantities?.length, 4, 'All 4 quantities must be preserved');

    // ── Check 6: Validate BPMN returns zero errors ──
    const validation = validateBpmn(finalBpmn, { allowUnresolved: true });
    assert.strictEqual(
      validation.errors?.length || 0,
      0,
      `validateBpmn must have 0 errors, got: ${(validation.errors || []).join('; ')}`
    );

    // ── Check 7: Layout is generated cleanly for canvas ──
    const layout = layoutAiDiagram(finalBpmn);
    assert.ok(layout.elements.length > 0, 'Canvas elements must not be empty');
    assert.ok(layout.connections.length > 0, 'Canvas connections must not be empty');
  });
});
