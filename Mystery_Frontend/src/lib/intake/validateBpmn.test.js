/**
 * lib/intake/validateBpmn.test.js
 *
 * Unit tests for BPMN structural validation and targeted auto-repairs.
 * Run with: node --test src/lib/intake/validateBpmn.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateBpmn, isMessageFlow } from './validateBpmn.js';
import { shapeFrontendToBackend, shapeBackendToFrontend } from '../apiService.js';

function createValidDiagram() {
  return {
    type: 'diagram',
    nodes: [
      { id: 'start_1', type: 'start-event', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Start Request' } },
      { id: 'task_review', type: 'task', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Review Document', duration: 10, duration_min: 5, duration_max: 15 } },
      { id: 'end_1', type: 'end-event', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Request Completed' } },
    ],
    edges: [
      { id: 'e1', source: 'start_1', target: 'task_review', flowType: 'sequence', data: {} },
      { id: 'e2', source: 'task_review', target: 'end_1', flowType: 'sequence', data: {} },
    ],
    resources: [],
  };
}

describe('BPMN Validation Rules', () => {
  it('validates a correct BPMN diagram with zero errors and zero repairs', () => {
    const raw = createValidDiagram();
    const result = validateBpmn(raw);

    assert.equal(result.errors.length, 0);
    assert.equal(result.repairs.length, 0);
  });

  it('Rule 1: requires at least one start event', () => {
    const raw = createValidDiagram();
    raw.nodes = raw.nodes.filter((n) => n.id !== 'start_1');
    raw.edges = raw.edges.filter((e) => e.source !== 'start_1');

    const result = validateBpmn(raw);
    assert.ok(result.errors.some((e) => e.includes('Diagram must have at least one start event')));
  });

  it('Rule 1: forbids incoming sequence flows into start events', () => {
    const raw = createValidDiagram();
    raw.edges.push({ id: 'e_invalid_start_in', source: 'task_review', target: 'start_1', flowType: 'sequence' });

    const result = validateBpmn(raw);
    assert.ok(result.errors.some((e) => e.includes('Start event "start_1" cannot have incoming sequence flows')));
  });

  it('Rule 1: forbids outgoing sequence flows from end events', () => {
    const raw = createValidDiagram();
    raw.edges.push({ id: 'e_invalid_end_out', source: 'end_1', target: 'task_review', flowType: 'sequence' });

    const result = validateBpmn(raw);
    assert.ok(result.errors.some((e) => e.includes('End event "end_1" cannot have outgoing sequence flows')));
  });

  it('Rule 1 auto-repair: auto-repairs missing end event using zero-time node', () => {
    const raw = createValidDiagram();
    raw.nodes = raw.nodes.filter((n) => n.id !== 'end_1');
    raw.edges = raw.edges.filter((e) => e.target !== 'end_1');

    const result = validateBpmn(raw);
    assert.equal(result.errors.length, 0);
    assert.ok(result.repairs.some((r) => r.rule === 'missing-end-event'));

    const repairedEnd = result.repaired.nodes.find((n) => n.type === 'end-event');
    assert.ok(repairedEnd);
    assert.equal(repairedEnd.origin, 'inferred');
    assert.equal(repairedEnd.data?.duration, 0);
  });

  it('Rule 2: flags nodes not reachable from start event', () => {
    const raw = createValidDiagram();
    raw.nodes.push({ id: 'task_orphan', type: 'task', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Orphan Step' } });
    raw.edges.push({ id: 'e_orphan', source: 'task_orphan', target: 'end_1', flowType: 'sequence' });

    const result = validateBpmn(raw);
    assert.ok(result.errors.some((e) => e.includes('is not reachable from any start event')));
  });

  it('Rule 2: flags nodes unable to reach any end event', () => {
    const raw = createValidDiagram();
    raw.nodes.push({ id: 'task_deadend', type: 'task', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Dead End' } });
    raw.edges.push({ id: 'e_to_deadend', source: 'task_review', target: 'task_deadend', flowType: 'sequence' });

    const result = validateBpmn(raw);
    assert.ok(result.errors.some((e) => e.includes('cannot reach any end event')));
  });

  it('Rule 3: flags duplicate node IDs and dangling edges', () => {
    const raw = createValidDiagram();
    raw.nodes.push({ id: 'task_review', type: 'task', lane: 'lane_main', data: { label: 'Duplicate Node' } });
    raw.edges.push({ id: 'e_dangling', source: 'non_existent_node', target: 'end_1', flowType: 'sequence' });

    const result = validateBpmn(raw);
    assert.ok(result.errors.some((e) => e.includes('Duplicate node IDs found')));
    assert.ok(result.errors.some((e) => e.includes('references non-existent source node')));
  });

  it('Rule 4: enforces tasks have exactly 1 incoming and 1 outgoing sequence flow', () => {
    const raw = createValidDiagram();
    // Add extra incoming sequence flow to task_review
    raw.nodes.push({ id: 'start_2', type: 'start-event', lane: 'lane_main', data: { label: 'Start 2' } });
    raw.edges.push({ id: 'e_extra_in', source: 'start_2', target: 'task_review', flowType: 'sequence' });

    const result = validateBpmn(raw);
    assert.ok(result.errors.some((e) => e.includes('Task "Review Document" must have exactly 1 incoming sequence flow')));
  });

  it('Rule 5: enforces exclusive split probabilities sum to 1.0 within tolerance 0.001', () => {
    const raw = createValidDiagram();
    raw.nodes.push(
      { id: 'gw_split', type: 'exclusive-gateway', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Approved?', gateway_type: 'exclusive' } },
      { id: 'task_b', type: 'task', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Task B' } }
    );
    raw.edges = [
      { id: 'e1', source: 'start_1', target: 'task_review', flowType: 'sequence' },
      { id: 'e2', source: 'task_review', target: 'gw_split', flowType: 'sequence' },
      { id: 'e3', source: 'gw_split', target: 'end_1', flowType: 'sequence', data: { probability: 0.6 } },
      { id: 'e4', source: 'gw_split', target: 'task_b', flowType: 'sequence', data: { probability: 0.2 } }, // sum is 0.8 != 1.0
      { id: 'e5', source: 'task_b', target: 'end_1', flowType: 'sequence' },
    ];

    const result = validateBpmn(raw);
    assert.ok(result.errors.some((e) => e.includes('branch probabilities must sum to 1.0')));
  });

  it('Rule 6 auto-repair: auto-repairs missing parallel join gateway using zero-time node', () => {
    const raw = createValidDiagram();
    raw.nodes.push(
      { id: 'gw_fork', type: 'parallel-gateway', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Split Work', gateway_type: 'parallel' } },
      { id: 'task_branch2', type: 'task', lane: 'lane_main', pool: 'pool_corp', data: { label: 'Branch 2' } }
    );
    // Fork splits into task_review and task_branch2, but both go directly to end_1 without a join gateway
    raw.edges = [
      { id: 'e1', source: 'start_1', target: 'gw_fork', flowType: 'sequence' },
      { id: 'e2', source: 'gw_fork', target: 'task_review', flowType: 'sequence' },
      { id: 'e3', source: 'gw_fork', target: 'task_branch2', flowType: 'sequence' },
      { id: 'e4', source: 'task_review', target: 'end_1', flowType: 'sequence' },
      { id: 'e5', source: 'task_branch2', target: 'end_1', flowType: 'sequence' },
    ];

    const result = validateBpmn(raw);
    assert.equal(result.errors.length, 0);
    assert.ok(result.repairs.some((r) => r.rule === 'missing-join-gateway'));

    const joinNode = result.repaired.nodes.find((n) => n.id.startsWith('gw_join_auto_'));
    assert.ok(joinNode);
    assert.equal(joinNode.type, 'parallel-gateway');
    assert.equal(joinNode.data?.duration, 0);
    assert.equal(joinNode.origin, 'inferred');
  });

  it('Rule 7: forbids sequence flows crossing pools and requires message flows between different pools', () => {
    const raw = createValidDiagram();
    raw.nodes.push(
      { id: 'start_customer', type: 'start-event', pool: 'pool_customer', lane: 'lane_c', data: { label: 'Customer Start' } },
      { id: 'task_customer', type: 'task', pool: 'pool_customer', lane: 'lane_c', data: { label: 'Order Items' } },
      { id: 'end_customer', type: 'end-event', pool: 'pool_customer', lane: 'lane_c', data: { label: 'Customer End' } }
    );
    // Invalid: sequence flow between pool_customer and pool_corp
    raw.edges.push({ id: 'e_invalid_seq', source: 'task_customer', target: 'task_review', flowType: 'sequence' });
    // Invalid: message flow within same pool_corp
    raw.edges.push({ id: 'e_invalid_msg', source: 'start_1', target: 'task_review', flowType: 'message' });

    const result = validateBpmn(raw);
    assert.ok(result.errors.some((e) => e.includes('Sequence flow "e_invalid_seq" crosses pools')));
    assert.ok(result.errors.some((e) => e.includes('Message flow "e_invalid_msg" must only connect nodes across different pools')));
  });

  it('Rule 8: requires every task to have an assigned lane', () => {
    const raw = createValidDiagram();
    raw.nodes[1].lane = null;
    raw.nodes[1].data.lane = null;

    const result = validateBpmn(raw);
    assert.ok(result.errors.some((e) => e.includes('must be assigned to a swimlane')));
  });

  it('Rule 9: requires non-empty labels for nodes', () => {
    const raw = createValidDiagram();
    raw.nodes[1].label = '';
    raw.nodes[1].data.label = '   ';

    const result = validateBpmn(raw);
    assert.ok(result.errors.some((e) => e.includes('has an empty label')));
  });

  it('Rule 10: validates duration bounds duration_min <= duration <= duration_max', () => {
    const raw = createValidDiagram();
    // duration 20 is greater than duration_max 15
    raw.nodes[1].data.duration = 20;
    raw.nodes[1].data.duration_min = 5;
    raw.nodes[1].data.duration_max = 15;

    const result = validateBpmn(raw);
    assert.ok(result.errors.some((e) => e.includes('must be between duration_min')));
  });

  it('Message Start Event: valid when 0 incoming sequence flows and >=1 incoming message flow', () => {
    const raw = {
      type: 'diagram',
      nodes: [
        { id: 'start_1', type: 'start-event', lane: 'Customer', pool: 'Customer', data: { label: 'Start Cust' } },
        { id: 'task_send', type: 'task', lane: 'Customer', pool: 'Customer', data: { label: 'Send Request', duration: 5 } },
        { id: 'end_cust', type: 'end-event', lane: 'Customer', pool: 'Customer', data: { label: 'Customer Done' } },
        { id: 'msg_start_store', type: 'message-start-event', lane: 'Store', pool: 'Store', data: { label: 'Order Message Arrived' } },
        { id: 'task_process', type: 'task', lane: 'Store', pool: 'Store', data: { label: 'Process Order', duration: 10 } },
        { id: 'end_store', type: 'end-event', lane: 'Store', pool: 'Store', data: { label: 'Store Done' } },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'task_send', flowType: 'sequence' },
        { id: 'e2', source: 'task_send', target: 'end_cust', flowType: 'sequence' },
        { id: 'e_msg', source: 'task_send', target: 'msg_start_store', flowType: 'message' },
        { id: 'e3', source: 'msg_start_store', target: 'task_process', flowType: 'sequence' },
        { id: 'e4', source: 'task_process', target: 'end_store', flowType: 'sequence' },
      ],
      resources: [],
    };

    const result = validateBpmn(raw);
    assert.equal(result.errors.length, 0);
  });

  it('Message Start Event: flags error if 0 incoming message flows', () => {
    const raw = {
      type: 'diagram',
      nodes: [
        { id: 'msg_start', type: 'message-start-event', lane: 'Store', pool: 'Store', data: { label: 'Order Arrived' } },
        { id: 'task_process', type: 'task', lane: 'Store', pool: 'Store', data: { label: 'Process Order', duration: 10 } },
        { id: 'end_store', type: 'end-event', lane: 'Store', pool: 'Store', data: { label: 'Done' } },
      ],
      edges: [
        { id: 'e1', source: 'msg_start', target: 'task_process', flowType: 'sequence' },
        { id: 'e2', source: 'task_process', target: 'end_store', flowType: 'sequence' },
      ],
      resources: [],
    };

    const result = validateBpmn(raw);
    assert.ok(result.errors.some((e) => e.includes('must have at least 1 incoming message flow')));
  });

  it('Message End Event: valid when 0 outgoing sequence flows and >=1 outgoing message flow', () => {
    const raw = {
      type: 'diagram',
      nodes: [
        { id: 'start_1', type: 'start-event', lane: 'Store', pool: 'Store', data: { label: 'Start Store' } },
        { id: 'task_process', type: 'task', lane: 'Store', pool: 'Store', data: { label: 'Process', duration: 10 } },
        { id: 'msg_end', type: 'message-end-event', lane: 'Store', pool: 'Store', data: { label: 'Receipt Sent' } },
        { id: 'start_cust', type: 'start-event', lane: 'Customer', pool: 'Customer', data: { label: 'Start Cust' } },
        { id: 'catch_event', type: 'message-intermediate-catch', lane: 'Customer', pool: 'Customer', data: { label: 'Receipt Received', duration: 1 } },
        { id: 'end_cust', type: 'end-event', lane: 'Customer', pool: 'Customer', data: { label: 'End Cust' } },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'task_process', flowType: 'sequence' },
        { id: 'e2', source: 'task_process', target: 'msg_end', flowType: 'sequence' },
        { id: 'e_msg', source: 'msg_end', target: 'catch_event', flowType: 'message' },
        { id: 'e3', source: 'start_cust', target: 'catch_event', flowType: 'sequence' },
        { id: 'e4', source: 'catch_event', target: 'end_cust', flowType: 'sequence' },
      ],
      resources: [],
    };

    const result = validateBpmn(raw);
    assert.equal(result.errors.length, 0);
  });

  it('Message End Event: flags error if 0 outgoing message flows', () => {
    const raw = {
      type: 'diagram',
      nodes: [
        { id: 'start_1', type: 'start-event', lane: 'Store', pool: 'Store', data: { label: 'Start' } },
        { id: 'msg_end', type: 'message-end-event', lane: 'Store', pool: 'Store', data: { label: 'Order Sent' } },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'msg_end', flowType: 'sequence' },
      ],
      resources: [],
    };

    const result = validateBpmn(raw);
    assert.ok(result.errors.some((e) => e.includes('must have at least 1 outgoing message flow')));
  });

  it('Regression: Valid two-pool Coffee Shop process with message flows passes validation', () => {
    const coffeeShopProcess = {
      nodes: [
        { id: 'start_customer_0', type: 'start-event', pool: 'pool_customer_0', lane: 'Customer', data: { label: 'Customer arrives' } },
        { id: 'order_and_pay', type: 'task', pool: 'pool_customer_0', lane: 'Customer', data: { label: 'Order And Pay', duration: 2 } },
        { id: 'send_order', type: 'message-intermediate-throw', pool: 'pool_customer_0', lane: 'Customer', data: { label: 'Send Order' } },
        { id: 'wait_for_pickup', type: 'message-intermediate-catch', pool: 'pool_customer_0', lane: 'Customer', data: { label: 'Wait For Pickup' } },
        { id: 'pickup_drink', type: 'task', pool: 'pool_customer_0', lane: 'Customer', data: { label: 'Pick Up Drink', duration: 1 } },
        { id: 'end_customer_0', type: 'end-event', pool: 'pool_customer_0', lane: 'Customer', data: { label: 'Customer leaves' } },
        { id: 'receive_order', type: 'message-start-event', pool: 'pool_coffee_shop_1', lane: 'Coffee Shop', data: { label: 'Receive Order' } },
        { id: 'prepare_espresso', type: 'task', pool: 'pool_coffee_shop_1', lane: 'Coffee Shop', data: { label: 'Prepare Espresso Drink', duration: 4 } },
        { id: 'notify_ready', type: 'message-end-event', pool: 'pool_coffee_shop_1', lane: 'Coffee Shop', data: { label: 'Notify Drink Ready' } }
      ],
      edges: [
        { id: 'e1', source: 'start_customer_0', target: 'order_and_pay', data: { type: 'sequence-flow' } },
        { id: 'e2', source: 'order_and_pay', target: 'send_order', data: { type: 'sequence-flow' } },
        { id: 'e3', source: 'send_order', target: 'wait_for_pickup', data: { type: 'sequence-flow' } },
        { id: 'e4', source: 'wait_for_pickup', target: 'pickup_drink', data: { type: 'sequence-flow' } },
        { id: 'e5', source: 'pickup_drink', target: 'end_customer_0', data: { type: 'sequence-flow' } },
        { id: 'e6', source: 'receive_order', target: 'prepare_espresso', data: { type: 'sequence-flow' } },
        { id: 'e7', source: 'prepare_espresso', target: 'notify_ready', data: { type: 'sequence-flow' } },
        // Stored format where message flow is indicated inside edge.data.type
        { id: 'e8', source: 'send_order', target: 'receive_order', data: { type: 'message-flow' } },
        { id: 'e9', source: 'notify_ready', target: 'wait_for_pickup', data: { type: 'message-flow' } }
      ],
      resources: [{ id: 'barista', name: 'Barista', type: 'staff', quantity: 2 }]
    };

    const res = validateBpmn(coffeeShopProcess);
    assert.deepStrictEqual(res.errors, [], `Coffee shop process must pass validation without errors. Got: ${JSON.stringify(res.errors)}`);
  });

  it('Regression: Sequence flow crossing pools is rejected while message flow is accepted', () => {
    const invalidProcess = {
      nodes: [
        { id: 's1', type: 'start-event', pool: 'p1', lane: 'l1', data: { label: 'Start' } },
        { id: 't1', type: 'task', pool: 'p1', lane: 'l1', data: { label: 'Task 1', duration: 5 } },
        { id: 't2', type: 'task', pool: 'p2', lane: 'l2', data: { label: 'Task 2', duration: 5 } },
        { id: 'e2', type: 'end-event', pool: 'p2', lane: 'l2', data: { label: 'End' } }
      ],
      edges: [
        { id: 'e1', source: 's1', target: 't1', flowType: 'sequence' },
        // Invalid sequence flow crossing pools
        { id: 'e_cross', source: 't1', target: 't2', flowType: 'sequence' },
        { id: 'e2', source: 't2', target: 'e2', flowType: 'sequence' }
      ]
    };

    const res = validateBpmn(invalidProcess);
    assert.ok(res.errors.some((err) => err.includes('crosses pools')), 'Must report sequence flow crossing pools error');
  });

  it('Regression: Message flows connected to intermediate events are not counted as sequence flows', () => {
    const validWithMsgIntermediate = {
      nodes: [
        { id: 's1', type: 'start-event', pool: 'p1', lane: 'l1', data: { label: 'Start' } },
        { id: 'throw1', type: 'message-intermediate-throw', pool: 'p1', lane: 'l1', data: { label: 'Send Msg' } },
        { id: 'e1', type: 'end-event', pool: 'p1', lane: 'l1', data: { label: 'End' } },
        { id: 's2', type: 'message-start-event', pool: 'p2', lane: 'l2', data: { label: 'Recv Start' } },
        { id: 'e2', type: 'end-event', pool: 'p2', lane: 'l2', data: { label: 'Done' } }
      ],
      edges: [
        { id: 'e1', source: 's1', target: 'throw1', flowType: 'sequence' },
        { id: 'e2', source: 'throw1', target: 'e1', flowType: 'sequence' },
        // Message flow from throw1 to s2 in other pool
        { id: 'msg1', source: 'throw1', target: 's2', flowType: 'message' },
        { id: 'e3', source: 's2', target: 'e2', flowType: 'sequence' }
      ]
    };

    const res = validateBpmn(validWithMsgIntermediate);
    assert.deepStrictEqual(res.errors, [], 'Intermediate event with 1 sequence flow + 1 message flow must have exactly 1 sequence flow');
  });

  it('Regression: Serialization roundtrip preserves message flow types across Model, Scenarios, and Simulate', () => {
    const elements = [
      { id: 'pool_customer', type: 'pool', label: 'Customer', position: { x: 0, y: 0 }, width: 800, height: 200 },
      { id: 'pool_store', type: 'pool', label: 'Store', position: { x: 0, y: 300 }, width: 800, height: 200 },
      { id: 'start_c', type: 'start-event', pool: 'pool_customer', lane: 'Customer', label: 'Arrive', data: { label: 'Arrive' } },
      { id: 'throw_c', type: 'message-intermediate-throw', pool: 'pool_customer', lane: 'Customer', label: 'Order', data: { label: 'Order' } },
      { id: 'end_c', type: 'end-event', pool: 'pool_customer', lane: 'Customer', label: 'Leave', data: { label: 'Leave' } },
      { id: 'start_s', type: 'message-start-event', pool: 'pool_store', lane: 'Store', label: 'Order In', data: { label: 'Order In' } },
      { id: 'end_s', type: 'end-event', pool: 'pool_store', lane: 'Store', label: 'Done', data: { label: 'Done' } }
    ];

    const connections = [
      { id: 'c1', fromId: 'start_c', toId: 'throw_c', type: 'sequence-flow' },
      { id: 'c2', fromId: 'throw_c', toId: 'end_c', type: 'sequence-flow' },
      { id: 'c3', fromId: 'throw_c', toId: 'start_s', type: 'message-flow' },
      { id: 'c4', fromId: 'start_s', toId: 'end_s', type: 'sequence-flow' }
    ];

    // Frontend -> Backend
    const backendData = shapeFrontendToBackend(elements, connections, 'Cross-Pool Test', []);
    const msgEdge = backendData.edges.find(e => e.source === 'throw_c' && e.target === 'start_s');
    assert.strictEqual(msgEdge.type, 'message-flow');
    assert.strictEqual(msgEdge.flowType, 'message');
    assert.strictEqual(msgEdge.data.type, 'message-flow');

    // Validation on backend shaped data
    const backendValidation = validateBpmn(backendData);
    assert.deepStrictEqual(backendValidation.errors, []);

    // Backend -> Frontend (used by Scenarios and Model)
    const frontendData = shapeBackendToFrontend(backendData);
    const roundtripMsgConn = frontendData.connections.find(c => c.fromId === 'throw_c' && c.toId === 'start_s');
    assert.strictEqual(roundtripMsgConn.type, 'message-flow');

    // Validation on frontend roundtrip data
    const roundtripValidation = validateBpmn({
      nodes: frontendData.elements.filter(e => !['pool', 'lane'].includes(e.type)),
      connections: frontendData.connections
    });
    assert.deepStrictEqual(roundtripValidation.errors, []);
  });
});
