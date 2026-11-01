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
  const validatorPath = path.resolve(__dirname, '../../Mystery_Frontend/src/lib/intake/validateBpmn.js');
  return await import(require('url').pathToFileURL(path.resolve(validatorPath)).href);
}

describe('Module G2b: Domain-Independent Generator & Modeling Rules Test Suite', { timeout: 180000 }, () => {
  for (const item of descriptions) {
    it(`Domain [${item.domain}]: validates, simulates without deadlock, no duplicates, no placeholders, no same-pool message flows, active cost > 0, unresolved gateways listed`, async () => {
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
