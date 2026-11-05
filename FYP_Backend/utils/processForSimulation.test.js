const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { processForSimulation } = require('./processForSimulation');

describe('processForSimulation: multi-pool models & resilience', () => {
  it('safely handles null, undefined, empty object or malformed input without throwing or returning null', () => {
    assert.deepEqual(processForSimulation(null), { resources: [], nodes: [], edges: [] });
    assert.deepEqual(processForSimulation(undefined), { resources: [], nodes: [], edges: [] });
    assert.deepEqual(processForSimulation(123), { resources: [], nodes: [], edges: [] });
    assert.deepEqual(processForSimulation({}), { resources: [], nodes: [], edges: [] });
  });

  it('accepts multi-pool pizza + courier model and preserves pools, start/end events, and cross-pool message flows', () => {
    const multiPoolDoc = {
      title: 'Pizza Delivery with Courier',
      resources: [
        { id: 'chef', name: 'Chef', displayName: 'Chef', type: 'staff', quantity: 2 },
        { id: 'courier', name: 'Courier', displayName: 'Courier', type: 'staff', quantity: 3 },
      ],
      nodes: [
        // Pool 1: Pizzeria
        { id: 'start_pizzeria', type: 'start', pool: 'Pizzeria', data: { label: 'Order Placed' } },
        {
          id: 'task_bake',
          type: 'task',
          pool: 'Pizzeria',
          data: {
            label: 'Bake Pizza',
            duration: 15,
            duration_unit: 'minutes',
            resource: 'Chef',
            resources: { Chef: 1 },
          },
        },
        {
          id: 'task_handover',
          type: 'task',
          pool: 'Pizzeria',
          data: {
            label: 'Handover to Courier',
            duration: 2,
            duration_unit: 'minutes',
            resource: 'Chef',
            resources: { Chef: 1 },
          },
        },
        { id: 'end_pizzeria', type: 'end', pool: 'Pizzeria', data: { label: 'Order Handed Over' } },

        // Pool 2: Courier
        { id: 'start_courier', type: 'start', pool: 'Courier', data: { label: 'Courier Dispatched' } },
        {
          id: 'task_receive',
          type: 'task',
          pool: 'Courier',
          data: {
            label: 'Receive Pizza',
            duration: 2,
            duration_unit: 'minutes',
            resource: 'Courier',
            resources: { Courier: 1 },
          },
        },
        {
          id: 'task_deliver',
          type: 'task',
          pool: 'Courier',
          data: {
            label: 'Deliver to Customer',
            duration: 20,
            duration_unit: 'minutes',
            resource: 'Courier',
            resources: { Courier: 1 },
          },
        },
        { id: 'end_courier', type: 'end', pool: 'Courier', data: { label: 'Delivery Complete' } },
      ],
      edges: [
        // Pizzeria sequence flows
        { source: 'start_pizzeria', target: 'task_bake' },
        { source: 'task_bake', target: 'task_handover' },
        { source: 'task_handover', target: 'end_pizzeria' },

        // Courier sequence flows
        { source: 'start_courier', target: 'task_receive' },
        { source: 'task_receive', target: 'task_deliver' },
        { source: 'task_deliver', target: 'end_courier' },

        // Cross-pool message flow
        {
          source: 'task_handover',
          target: 'task_receive',
          flowType: 'message',
          type: 'message-flow',
          data: { flowType: 'message' },
        },
      ],
    };

    const simDoc = processForSimulation(multiPoolDoc);
    assert.ok(simDoc !== null && typeof simDoc === 'object', 'Result must not be null');
    assert.equal(simDoc.nodes.length, 8, 'All 8 nodes across both pools must be preserved');
    assert.equal(simDoc.resources.length, 2, 'Both resources must be preserved');

    const startNodes = simDoc.nodes.filter(n => n.type === 'start');
    const endNodes = simDoc.nodes.filter(n => n.type === 'end');
    assert.equal(startNodes.length, 2, 'Both start events (one per pool) must be preserved');
    assert.equal(endNodes.length, 2, 'Both end events (one per pool) must be preserved');

    const pizzeriaNodes = simDoc.nodes.filter(n => n.pool === 'Pizzeria');
    const courierNodes = simDoc.nodes.filter(n => n.pool === 'Courier');
    assert.equal(pizzeriaNodes.length, 4, 'Pool Pizzeria should have 4 nodes');
    assert.equal(courierNodes.length, 4, 'Pool Courier should have 4 nodes');

    // Check cross-pool message flow in edges
    const crossPoolEdge = simDoc.edges.find(
      e => e.source === 'task_handover' && e.target === 'task_receive'
    );
    assert.ok(crossPoolEdge, 'Cross-pool message flow must be preserved');
    assert.equal(crossPoolEdge.data?.flowType, 'message');
  });
});
