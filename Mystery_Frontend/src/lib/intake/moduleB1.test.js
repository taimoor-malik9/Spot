import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateBpmn } from './validateBpmn.js';
import { compileBpmn } from './compileBpmn.js';

describe('Module B1: Single Path Gateways & Exclusive Split Rules', () => {
  it('Requirement 1: removes redundant gateway (1 in, 1 out), reconnects incoming to outgoing target, drops label, sets probability to 1, and records repair', () => {
    const rawDiagram = {
      nodes: [
        { id: 'start_1', type: 'start-event', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Start' } },
        { id: 'task_1', type: 'task', lane: 'lane_main', pool: 'pool_corp', data: { label: 'First Step', duration: 10 } },
        { id: 'gw_redundant', type: 'exclusive-gateway', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Single Path Gateway', gateway_type: 'exclusive' } },
        { id: 'task_2', type: 'task', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Second Step', duration: 10 } },
        { id: 'end_1', type: 'end-event', lane: 'lane_main', pool: 'pool_corp', data: { label: 'End' } },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'task_1', flowType: 'sequence' },
        { id: 'e2', source: 'task_1', target: 'gw_redundant', flowType: 'sequence' },
        { id: 'e3', source: 'gw_redundant', target: 'task_2', flowType: 'sequence', data: { label: 'Yes', probability: 0.8 } },
        { id: 'e4', source: 'task_2', target: 'end_1', flowType: 'sequence' },
      ],
      resources: [],
    };

    const result = validateBpmn(rawDiagram);

    // Errors must be empty
    assert.deepStrictEqual(result.errors, []);

    // Repair record must exist
    const repair = result.repairs.find((r) => r.rule === 'redundant-gateway');
    assert.ok(repair, 'Repair record for redundant gateway should exist');
    assert.strictEqual(repair.description, 'Removed an unnecessary decision point');
    assert.strictEqual(repair.nodeId, 'gw_redundant');

    // Gateway must be removed
    const foundGw = result.repaired.nodes.find((n) => n.id === 'gw_redundant');
    assert.strictEqual(foundGw, undefined, 'Redundant gateway should be removed from nodes');

    // Incoming flow must be reconnected to outgoing target
    const reconnectedEdge = result.repaired.edges.find((e) => e.source === 'task_1');
    assert.ok(reconnectedEdge, 'Edge from task_1 should exist');
    assert.strictEqual(reconnectedEdge.target, 'task_2', 'Incoming flow should now connect directly to task_2');
    assert.strictEqual(reconnectedEdge.data?.label, undefined, 'Edge label should be dropped');
    assert.strictEqual(reconnectedEdge.data?.probability, 1, 'Edge probability should be set to 1');
  });

  it('Requirement 1: flags an error if a gateway is neither a split (>=2 out) nor a join (>=2 in)', () => {
    // Gateway with 0 in and 1 out (cannot be auto-repaired)
    const rawDiagram = {
      nodes: [
        { id: 'start_1', type: 'start-event', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Start' } },
        { id: 'task_1', type: 'task', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Step 1', duration: 5 } },
        { id: 'gw_dead', type: 'exclusive-gateway', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Invalid Decision', gateway_type: 'exclusive' } },
        { id: 'end_1', type: 'end-event', lane: 'lane_main', pool: 'pool_corp', data: { label: 'End' } },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'task_1', flowType: 'sequence' },
        { id: 'e2', source: 'task_1', target: 'end_1', flowType: 'sequence' },
        { id: 'e3', source: 'gw_dead', target: 'end_1', flowType: 'sequence' },
      ],
      resources: [],
    };

    const result = validateBpmn(rawDiagram);
    assert.ok(
      result.errors.some((e) =>
        e.includes('Gateway "Invalid Decision" must be a split (>=2 outgoing sequence flows) or a join (>=2 incoming).')
      ),
      'Should report gateway must be a split or join'
    );
  });

  it('Requirement 2: exclusive split requires every outgoing flow to be labeled', () => {
    const rawDiagram = {
      nodes: [
        { id: 'start_1', type: 'start-event', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Start' } },
        { id: 'gw_split', type: 'exclusive-gateway', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Approved?', gateway_type: 'exclusive' } },
        { id: 'task_a', type: 'task', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Approved Task', duration: 5 } },
        { id: 'task_b', type: 'task', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Rejected Task', duration: 5 } },
        { id: 'end_1', type: 'end-event', lane: 'lane_main', pool: 'pool_corp', data: { label: 'End' } },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'gw_split', flowType: 'sequence' },
        { id: 'e2', source: 'gw_split', target: 'task_a', flowType: 'sequence', data: { label: 'Yes', probability: 0.7 } },
        { id: 'e3', source: 'gw_split', target: 'task_b', flowType: 'sequence', data: { probability: 0.3 } }, // unlabeled!
        { id: 'e4', source: 'task_a', target: 'end_1', flowType: 'sequence' },
        { id: 'e5', source: 'task_b', target: 'end_1', flowType: 'sequence' },
      ],
      resources: [],
    };

    const result = validateBpmn(rawDiagram);
    assert.ok(
      result.errors.some((e) =>
        e.includes('Exclusive split "Approved?" has an unlabeled branch. Every outgoing flow must be labeled.')
      ),
      'Should flag unlabeled branch on exclusive split'
    );
  });

  it('Requirement 2: exclusive split with missing probability outputs plain question "How often does each path happen?"', () => {
    const rawDiagram = {
      nodes: [
        { id: 'start_1', type: 'start-event', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Start' } },
        { id: 'gw_split', type: 'exclusive-gateway', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Check Stock', gateway_type: 'exclusive' } },
        { id: 'task_in', type: 'task', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Fulfill', duration: 5 } },
        { id: 'task_out', type: 'task', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Backorder', duration: 5 } },
        { id: 'end_1', type: 'end-event', lane: 'lane_main', pool: 'pool_corp', data: { label: 'End' } },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'gw_split', flowType: 'sequence' },
        { id: 'e2', source: 'gw_split', target: 'task_in', flowType: 'sequence', data: { label: 'In Stock' } }, // missing prob
        { id: 'e3', source: 'gw_split', target: 'task_out', flowType: 'sequence', data: { label: 'Out of Stock', probability: 0.2 } },
        { id: 'e4', source: 'task_in', target: 'end_1', flowType: 'sequence' },
        { id: 'e5', source: 'task_out', target: 'end_1', flowType: 'sequence' },
      ],
      resources: [],
    };

    const result = validateBpmn(rawDiagram);
    assert.ok(
      result.errors.some((e) =>
        e.includes('Exclusive split "Check Stock": How often does each path happen?')
      ),
      'Should ask plain question when probability is missing'
    );
  });

  it('Requirement 3: compileBpmn does not create a join gateway when only 1 branch rejoins and does not default rejoin to true', () => {
    const spec = {
      pools: [
        {
          name: 'Store',
          steps: [
            { id: 's1', label: 'Check Items', kind: 'task' },
            { id: 's2_avail', label: 'Pack Items', kind: 'task' },
            { id: 's2_unavail', label: 'Cancel Order', kind: 'task' },
            { id: 's3', label: 'Ship Package', kind: 'task' },
          ],
          branches: [
            {
              afterStepId: 's1',
              question: 'In Stock?',
              options: [
                { label: 'Yes', probability: 0.85, steps: ['s2_avail'], rejoin: true },
                { label: 'No', probability: 0.15, steps: ['s2_unavail'] }, // rejoin defaults to false (not true)
              ],
            },
          ],
        },
      ],
    };

    const compiled = compileBpmn(spec);

    // Split gateway should exist
    const splitNode = compiled.nodes.find((n) => n.type === 'exclusive-gateway' && n.id.includes('split'));
    assert.ok(splitNode, 'Split gateway should exist');

    // Join gateway should NOT exist because only 1 branch rejoins
    const joinNode = compiled.nodes.find((n) => n.type === 'exclusive-gateway' && n.id.includes('join'));
    assert.strictEqual(joinNode, undefined, 'Join gateway must NOT exist when only 1 branch rejoins');

    // s2_avail should connect directly to s3
    const directEdge = compiled.edges.find((e) => e.source === 's2_avail' && e.target === 's3');
    assert.ok(directEdge, 's2_avail should connect directly to s3 without an intervening join gateway');

    // s2_unavail terminates at its own branch end
    const unavailEndEdge = compiled.edges.find((e) => e.source === 's2_unavail' && e.target.startsWith('end_'));
    assert.ok(unavailEndEdge, 's2_unavail should terminate at its own end event');

    // Result validates cleanly
    const validation = validateBpmn(compiled);
    assert.deepStrictEqual(validation.errors, []);
  });

  it('Requirement 5: Tea-shop diagram test - "Patience Maintained?" keeps both branches, "Rejoin" (1 in, 1 out, labeled Yes) is removed, diagram validates, and flow Receive Order -> Complete Process is intact', () => {
    // Structure of tea-shop diagram with the redundant Rejoin gateway:
    const teaShopDiagram = {
      nodes: [
        { id: 'start_tea', type: 'start-event', lane: 'Barista', pool: 'Tea Shop', data: { label: 'Customer Arrives' } },
        { id: 'task_greet', type: 'task', lane: 'Barista', pool: 'Tea Shop', data: { label: 'Greet Customer', duration: 1 } },
        { id: 'gw_patience', type: 'exclusive-gateway', lane: 'Barista', pool: 'Tea Shop', data: { label: 'Patience Maintained?', gateway_type: 'exclusive' } },
        { id: 'task_leave', type: 'task', lane: 'Barista', pool: 'Tea Shop', data: { label: 'Customer Leaves', duration: 1 } },
        { id: 'end_left', type: 'end-event', lane: 'Barista', pool: 'Tea Shop', data: { label: 'Customer Left' } },
        { id: 'task_receive_order', type: 'task', lane: 'Barista', pool: 'Tea Shop', data: { label: 'Receive Order', duration: 2 } },
        { id: 'gw_rejoin', type: 'exclusive-gateway', lane: 'Barista', pool: 'Tea Shop', data: { label: 'Rejoin', gateway_type: 'exclusive' } },
        { id: 'task_complete', type: 'task', lane: 'Barista', pool: 'Tea Shop', data: { label: 'Complete Process', duration: 0, origin: 'structural' } },
        { id: 'end_tea', type: 'end-event', lane: 'Barista', pool: 'Tea Shop', data: { label: 'Service Finished' } },
      ],
      edges: [
        { id: 'e1', source: 'start_tea', target: 'task_greet', flowType: 'sequence' },
        { id: 'e2', source: 'task_greet', target: 'gw_patience', flowType: 'sequence' },
        // "Patience Maintained?" splits into two branches:
        { id: 'e_no', source: 'gw_patience', target: 'task_leave', flowType: 'sequence', data: { label: 'No', probability: 0.15 } },
        { id: 'e_yes', source: 'gw_patience', target: 'task_receive_order', flowType: 'sequence', data: { label: 'Yes', probability: 0.85 } },
        // Branch 1 ends:
        { id: 'e_leave_end', source: 'task_leave', target: 'end_left', flowType: 'sequence' },
        // Branch 2 flows into redundant Rejoin gateway (1 in, 1 out, labeled Yes):
        { id: 'e_recv_rejoin', source: 'task_receive_order', target: 'gw_rejoin', flowType: 'sequence' },
        { id: 'e_rejoin_complete', source: 'gw_rejoin', target: 'task_complete', flowType: 'sequence', data: { label: 'Yes' } },
        // Complete process to end:
        { id: 'e_complete_end', source: 'task_complete', target: 'end_tea', flowType: 'sequence' },
      ],
      resources: [],
    };

    const result = validateBpmn(teaShopDiagram);

    // 1. Validates with 0 errors
    assert.deepStrictEqual(result.errors, []);

    // 2. "Patience Maintained?" keeps both branches
    const patienceGw = result.repaired.nodes.find((n) => n.id === 'gw_patience');
    assert.ok(patienceGw, 'Patience Maintained? gateway must be kept');
    const patienceOutEdges = result.repaired.edges.filter((e) => e.source === 'gw_patience');
    assert.strictEqual(patienceOutEdges.length, 2, 'Patience Maintained? must keep both branches');
    const branchTargets = patienceOutEdges.map((e) => e.target).sort();
    assert.deepStrictEqual(branchTargets, ['task_leave', 'task_receive_order'].sort());

    // 3. "Rejoin" (1 in, 1 out, labeled Yes) is removed
    const rejoinGw = result.repaired.nodes.find((n) => n.id === 'gw_rejoin');
    assert.strictEqual(rejoinGw, undefined, 'Rejoin gateway must be removed');

    // 4. Repair record
    const repairRecord = result.repairs.find((r) => r.nodeId === 'gw_rejoin');
    assert.ok(repairRecord, 'Repair record for Rejoin should exist');
    assert.strictEqual(repairRecord.description, 'Removed an unnecessary decision point');

    // 5. Flow Receive Order -> Complete Process is intact
    const intactFlow = result.repaired.edges.find(
      (e) => e.source === 'task_receive_order' && e.target === 'task_complete'
    );
    assert.ok(intactFlow, 'Flow from Receive Order to Complete Process must be intact');
    assert.strictEqual(intactFlow.data?.label, undefined, 'Outgoing edge label must be dropped');
    assert.strictEqual(intactFlow.data?.probability, 1, 'Probability must be set to 1');
  });
});
