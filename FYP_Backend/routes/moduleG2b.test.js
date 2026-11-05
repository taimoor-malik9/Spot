const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch (e) {}

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { generateProcess } = require('../services/aiService');
const { processForSimulation } = require('../utils/processForSimulation');
const descriptions = require('../tests/fixtures/moduleG2bDescriptions');

async function getValidator() {
  const validatorPath = path.resolve(__dirname, '../shared/validateBpmn.js');
  return await import(require('url').pathToFileURL(path.resolve(validatorPath)).href);
}

const isLiveAiEnabled = process.env.RUN_LIVE_AI_TESTS === '1';

describe('Module G2b: Domain-Independent Generator & Modeling Rules Test Suite', { timeout: 180000 }, () => {
  for (const item of descriptions) {
    it(
      `Domain [${item.domain}]: validates, simulates without deadlock, no duplicates, no placeholders, no same-pool message flows, active cost > 0, unresolved gateways listed`,
      { skip: !isLiveAiEnabled ? 'Skipping live AI test (set RUN_LIVE_AI_TESTS=1 to run)' : false },
      async () => {
      console.log(`\n======================================================`);
      console.log(`Testing Domain: ${item.domain}`);
      console.log(`======================================================`);

      // 1. Generate Process from Description
      const res = await generateProcess(item.description);
      assert.ok(res, `generateProcess returned no result for ${item.domain}`);

      // Handle clarification if returned
      if (res.type === 'clarification') {
        assert.fail(`generateProcess unexpectedly asked for clarification: "${res.question}"`);
      }

      const diagram = res.diagram || res;
      assert.ok(diagram.nodes && diagram.nodes.length > 0, `Diagram should have nodes for ${item.domain}`);
      assert.ok(diagram.edges && diagram.edges.length > 0, `Diagram should have edges for ${item.domain}`);

      // 2. PROPERTY: validates via validateBpmn
      const { validateBpmn, isMessageFlow } = await getValidator();
      const validation = validateBpmn(diagram, { allowUnresolved: true });
      const structuralErrors = (validation.errors || []).filter(
        (e) => !e.includes('How often does each path happen?')
      );
      assert.deepStrictEqual(
        structuralErrors,
        [],
        `Diagram for ${item.domain} should pass validation without structural errors: ${JSON.stringify(structuralErrors)}`
      );

      // 3. PROPERTY: every activity extracted appears once (zero duplicate activities)
      const duplicateWarnings = validation.duplicateWarnings || diagram.duplicateWarnings || [];
      assert.strictEqual(
        duplicateWarnings.length,
        0,
        `Expected zero duplicate activities across lanes in ${item.domain}, found: ${JSON.stringify(duplicateWarnings)}`
      );

      // 4. PROPERTY: zero placeholder tasks
      // (no tasks with duration 0 and no resources between split and join)
      const placeholderTasks = (diagram.nodes || []).filter((n) => {
        if (n.type !== 'task') return false;
        const dur = Number(n.data?.duration ?? n.duration ?? 0);
        const resObj = n.data?.resources || n.resources || {};
        const hasRes = Object.keys(resObj).length > 0 || Boolean(n.data?.resource || n.resource);
        const origin = n.origin || n.data?.origin;
        return dur === 0 && !hasRes && (origin === 'inferred' || origin === 'structural');
      });
      assert.strictEqual(
        placeholderTasks.length,
        0,
        `Expected zero placeholder tasks in ${item.domain}, found: ${JSON.stringify(placeholderTasks.map((t) => t.id))}`
      );

      // 5. PROPERTY: zero same-pool message flows
      const nodePoolMap = {};
      (diagram.nodes || []).forEach((n) => {
        nodePoolMap[n.id] = n.pool || n.data?.pool || null;
      });
      const samePoolMsgFlows = (diagram.edges || []).filter((e) => {
        const isMsg = isMessageFlow(e);
        const sp = nodePoolMap[e.source];
        const tp = nodePoolMap[e.target];
        return isMsg && sp && tp && sp === tp;
      });
      assert.strictEqual(
        samePoolMsgFlows.length,
        0,
        `Expected zero same-pool message flows in ${item.domain}, found: ${JSON.stringify(samePoolMsgFlows.map((e) => e.id))}`
      );

      // 6. PROPERTY: unresolved gateways listed
      const unresolved = validation.unresolvedGateways || diagram.unresolvedGateways || [];
      assert.ok(
        Array.isArray(unresolved),
        `unresolvedGateways must be an array for ${item.domain}`
      );
      console.log(`Unresolved gateways found (${item.domain}):`, unresolved.length);

      // 7. PROPERTY: simulates through POST /simulate without deadlock
      const engineBase = (process.env.SIMULATION_ENGINE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
      const simPayload = {
        process_json: processForSimulation(diagram),
        config: {
          total_instances: 50,
          arrival_rate: 1.0,
          seed: 42,
          replications: 1,
        },
      };

      const simRes = await fetch(`${engineBase}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(simPayload),
      });

      assert.strictEqual(
        simRes.status,
        200,
        `Simulation POST /simulate failed with HTTP ${simRes.status} for ${item.domain}`
      );

      const simData = await simRes.json();
      const completedCount =
        simData.financial_summary?.customers ??
        simData.kpis?.time_in_system?.count ??
        simData.time_in_system?.histogram?.reduce((acc, h) => acc + (h.count || 0), 0) ??
        0;

      assert.ok(
        completedCount > 0,
        `Simulation deadlock: expected > 0 completed cases in ${item.domain}, got ${completedCount}`
      );
      console.log(`Completed simulation cases (${item.domain}): ${completedCount}`);

      // 8. PROPERTY: every staff resource used has utilization > 0 and active cost > 0
      const usedStaffNames = new Set();
      (diagram.nodes || []).filter((n) => n.type === 'task').forEach((t) => {
        const resObj = t.data?.resources || t.resources || {};
        Object.keys(resObj).forEach((name) => {
          if (name && typeof name === 'string' && name.trim()) {
            usedStaffNames.add(name.trim().toLowerCase());
          }
        });
        const primary = t.data?.resource || t.resource;
        if (primary && typeof primary === 'string' && primary.trim()) {
          usedStaffNames.add(primary.trim().toLowerCase());
        }
      });

      console.log(`Used staff roles (${item.domain}):`, Array.from(usedStaffNames));
      assert.ok(
        usedStaffNames.size > 0,
        `Expected at least one staff resource used for tasks in ${item.domain}`
      );

      const simUtilization = simData.resource_utilization || {};
      const simFinancials = simData.financial_summary?.resources || {};

      for (const staffName of usedStaffNames) {
        // Find matching resource key in simUtilization or simFinancials
        const matchedUtilKey = Object.keys(simUtilization).find(
          (k) => k.toLowerCase() === staffName || k.toLowerCase().includes(staffName) || staffName.includes(k.toLowerCase())
        );
        const matchedFinKey = Object.keys(simFinancials).find(
          (k) => k.toLowerCase() === staffName || k.toLowerCase().includes(staffName) || staffName.includes(k.toLowerCase())
        );

        const utilVal = matchedUtilKey ? simUtilization[matchedUtilKey].utilization_pct : null;
        const activeCostVal = matchedFinKey ? simFinancials[matchedFinKey].active_cost : null;

        console.log(`  Staff [${staffName}]: utilization=${utilVal}%, active_cost=${activeCostVal}`);
        if (utilVal != null) {
          assert.ok(
            utilVal > 0,
            `Expected utilization > 0 for staff "${staffName}" in ${item.domain}, got ${utilVal}`
          );
        }
        if (activeCostVal != null) {
          assert.ok(
            activeCostVal > 0,
            `Expected active_cost > 0 for staff "${staffName}" in ${item.domain}, got ${activeCostVal}`
          );
        }
      }

      assert.ok(
        (simData.financial_summary?.total_active_cost || 0) > 0,
        `Expected total_active_cost > 0 in ${item.domain}, got ${simData.financial_summary?.total_active_cost}`
      );

      console.log(`✓ All properties verified successfully for domain: ${item.domain}`);
    });
  }
});

describe('Module G2b: Pizza Delivery with Courier Deterministic Regression Suite (No Network)', () => {
  const pizzaDeliveryDesc =
    'A customer submits a pizza order online to the pizzeria. Inside the pizzeria, the chef prepares the pizza dough, spreads sauce and toppings, and bakes the pizza in the oven. The chef boxes the baked pizza and sets it on the dispatch counter. An independent external courier service picks up the boxed pizza from the counter, drives by motorbike to the customer delivery address, and hands the pizza to the customer, who signs the delivery receipt.';

  const pizzaCourierDraft = {
    type: 'draft',
    roles: ['Customer', 'Chef', 'Courier'],
    activities: [
      { id: 'act_1', label: 'Submit Pizza Order Online', role: 'Customer', duration: 2 },
      { id: 'act_2', label: 'Prepare Pizza Dough and Toppings', role: 'Chef', duration: 10 },
      { id: 'act_3', label: 'Bake Pizza in Oven', role: 'Chef', duration: 15 },
      { id: 'act_4', label: 'Box Baked Pizza and Set on Dispatch Counter', role: 'Chef', duration: 3 },
      { id: 'act_5', label: 'Pick Up Boxed Pizza from Counter', role: 'Courier', duration: 5 },
      { id: 'act_6', label: 'Drive by Motorbike to Customer Address', role: 'Courier', duration: 20 },
      { id: 'act_7', label: 'Hand Pizza to Customer and Collect Signature', role: 'Courier', duration: 5 },
    ],
    decisions: [],
    order: ['act_1', 'act_2', 'act_3', 'act_4', 'act_5', 'act_6', 'act_7'],
  };

  const pizzaCourierSpec = {
    type: 'spec',
    pools: [
      {
        name: 'Pizzeria',
        steps: [
          { id: 'step_1', label: 'Submit pizza order online', lane: 'Customer', duration: 5, resource: null, resources: {} },
          { id: 'step_2', label: 'Prepare pizza dough and toppings', lane: 'Chef', duration: 10, resource: 'Chef', resources: { Chef: 1 } },
          { id: 'step_3', label: 'Bake pizza in oven', lane: 'Chef', duration: 15, resource: 'Chef', resources: { Chef: 1 } },
          { id: 'step_4', label: 'Box baked pizza and set on dispatch counter', lane: 'Chef', duration: 3, resource: 'Chef', resources: { Chef: 1 } },
        ],
      },
      {
        name: 'Independent External Courier Service',
        steps: [
          { id: 'step_5', label: 'Pick up boxed pizza from counter', lane: 'Courier', duration: 5, resource: 'Courier', resources: { Courier: 1 } },
          { id: 'step_6', label: 'Drive by motorbike to delivery address', lane: 'Courier', duration: 20, resource: 'Courier', resources: { Courier: 1 } },
          { id: 'step_7', label: 'Hand pizza to customer and get receipt signed', lane: 'Courier', duration: 5, resource: 'Courier', resources: { Courier: 1 } },
        ],
      },
    ],
    handoffs: [{ fromStepId: 'step_4', toStepId: 'step_5' }],
    resources: [
      { id: 'Chef', name: 'Chef', type: 'staff', quantity: 1, hours_per_day: 8, working_days_per_month: 22, monthly_salary: 60000 },
      { id: 'Courier', name: 'Courier', type: 'staff', quantity: 1, hours_per_day: 8, working_days_per_month: 22, monthly_salary: 50000 },
    ],
  };

  it('Regression 1: Pizza with courier multi-pool spec and draft pass main normalizer/validator pipeline without fallback', async () => {
    const { compileBpmn } = await import('../shared/compileBpmn.js');
    const { normalizeAndRepairBpmn, buildBpmnFromDraft } = await import('../shared/deterministicNormalizer.js');
    const { validateBpmn, isMessageFlow } = await getValidator();

    // 1. Test multi-pool spec pipeline
    const compiled = compileBpmn(pizzaCourierSpec);
    const normalized = normalizeAndRepairBpmn(compiled, { userDescription: pizzaDeliveryDesc });
    const validation = validateBpmn(normalized, { allowUnresolved: true });
    assert.deepStrictEqual(validation.errors, [], `Multi-pool spec should validate with 0 errors: ${JSON.stringify(validation.errors)}`);

    // Ensure no sequence flows cross pools
    const nodePoolMap = {};
    (normalized.nodes || []).forEach((n) => {
      nodePoolMap[n.id] = n.pool || n.data?.pool || null;
    });
    const crossSeqFlows = (normalized.edges || []).filter((e) => {
      const isMsg = isMessageFlow(e);
      const sp = nodePoolMap[e.source];
      const tp = nodePoolMap[e.target];
      return !isMsg && sp && tp && sp !== tp;
    });
    assert.strictEqual(crossSeqFlows.length, 0, 'No sequence flows should cross pools');

    // Ensure staff resources are preserved
    const staffRoles = new Set();
    (normalized.nodes || []).filter((n) => n.type === 'task').forEach((t) => {
      const primary = t.data?.resource || t.resource;
      if (primary && typeof primary === 'string' && primary.trim() && !/customer/i.test(primary)) {
        staffRoles.add(primary.toLowerCase());
      }
    });
    assert.ok(staffRoles.has('chef'), 'Chef staff role must be present');
    assert.ok(staffRoles.has('courier'), 'Courier staff role must be present');

    // 2. Test draft pipeline
    const draftDiagram = buildBpmnFromDraft(pizzaCourierDraft, { userDescription: pizzaDeliveryDesc });
    const draftVal = validateBpmn(draftDiagram, { allowUnresolved: true });
    assert.deepStrictEqual(draftVal.errors, [], `Draft should validate with 0 errors: ${JSON.stringify(draftVal.errors)}`);

    // Verify simulation payload can be generated
    const simPayload = processForSimulation(normalized);
    assert.ok(simPayload.nodes.length > 0);
    assert.ok(simPayload.edges.length > 0);
    assert.ok(simPayload.resources.length >= 2);
  });

  it('Regression 2: Linear fallback pipeline preserves roles, durations, and staff resources from draft and spec', async () => {
    const { buildLinearFallbackDiagram, normalizeAndRepairBpmn } = await import('../shared/deterministicNormalizer.js');
    const { validateBpmn } = await getValidator();

    // 1. Fallback with draft
    const fallbackFromDraft = buildLinearFallbackDiagram(pizzaDeliveryDesc, pizzaCourierDraft);
    const normalizedDraft = normalizeAndRepairBpmn(fallbackFromDraft, { userDescription: pizzaDeliveryDesc });
    const valDraft = validateBpmn(normalizedDraft, { allowUnresolved: true });
    assert.deepStrictEqual(valDraft.errors, [], `Draft fallback should validate with 0 errors: ${JSON.stringify(valDraft.errors)}`);

    const draftTasks = (normalizedDraft.nodes || []).filter((n) => n.type === 'task');
    assert.strictEqual(draftTasks.length, 7, 'Must preserve all 7 tasks from the draft');
    assert.strictEqual(draftTasks[0].lane, 'Customer');
    assert.strictEqual(draftTasks[0].data?.resource, null, 'Customer task must have no resource');
    assert.strictEqual(draftTasks[1].lane, 'Chef');
    assert.strictEqual(draftTasks[1].data?.duration, 10, 'Must preserve task duration from draft');
    assert.strictEqual(draftTasks[1].data?.resource, 'Chef');
    assert.strictEqual(draftTasks[4].lane, 'Courier');
    assert.strictEqual(draftTasks[4].data?.duration, 5);
    assert.strictEqual(draftTasks[4].data?.resource, 'Courier');

    const draftStaffNames = new Set();
    draftTasks.forEach((t) => {
      const r = t.data?.resource;
      if (r) draftStaffNames.add(r.toLowerCase());
    });
    assert.ok(draftStaffNames.has('chef'), 'Draft fallback must retain Chef resource');
    assert.ok(draftStaffNames.has('courier'), 'Draft fallback must retain Courier resource');
    assert.ok(normalizedDraft.resources.some((r) => r.name.toLowerCase() === 'chef'));
    assert.ok(normalizedDraft.resources.some((r) => r.name.toLowerCase() === 'courier'));

    // 2. Fallback with spec
    const fallbackFromSpec = buildLinearFallbackDiagram(pizzaDeliveryDesc, pizzaCourierSpec);
    const normalizedSpec = normalizeAndRepairBpmn(fallbackFromSpec, { userDescription: pizzaDeliveryDesc });
    const valSpec = validateBpmn(normalizedSpec, { allowUnresolved: true });
    assert.deepStrictEqual(valSpec.errors, [], `Spec fallback should validate with 0 errors: ${JSON.stringify(valSpec.errors)}`);

    const specStaffNames = new Set();
    (normalizedSpec.nodes || []).filter((n) => n.type === 'task').forEach((t) => {
      const r = t.data?.resource;
      if (r) specStaffNames.add(r.toLowerCase());
    });
    assert.ok(specStaffNames.has('chef'), 'Spec fallback must retain Chef resource');
    assert.ok(specStaffNames.has('courier'), 'Spec fallback must retain Courier resource');
  });
});
