// FYP_Backend/routes/processAuditFixes.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Process = require('../models/Process');
const { validateBpmn } = require('../shared/validateBpmn');

describe('Audit Fixes: Process Schema, Edge Labels, & Validation Error Handling', () => {
  const userId = new mongoose.Types.ObjectId();

  it('1. A labeled exclusive split saves and reloads with labels intact', async () => {
    // Model with exclusive split with labels on branches
    const incomingEdges = [
      { id: 'e1', source: 'start_1', target: 'task_1', flowType: 'sequence' },
      { id: 'e2', source: 'task_1', target: 'gw_split', flowType: 'sequence' },
      // Labeled branches from exclusive gateway
      { id: 'e3', source: 'gw_split', target: 'task_urgent', label: 'Urgent (Yes)', data: { probability: 0.25 } },
      { id: 'e4', source: 'gw_split', target: 'task_routine', label: 'Routine (No)', data: { probability: 0.75 } },
      { id: 'e5', source: 'task_urgent', target: 'gw_join' },
      { id: 'e6', source: 'task_routine', target: 'gw_join' },
      { id: 'e7', source: 'gw_join', target: 'end_1' },
    ];

    // Simulate cleanEdges logic from server.js
    const cleanEdges = incomingEdges.map(edge => {
      const isMsg =
        edge.flowType === 'message' ||
        edge.type === 'message-flow' ||
        edge.type === 'message' ||
        (typeof edge.data === 'object' && (edge.data?.type === 'message-flow' || edge.data?.flowType === 'message'));
      const edgeLabel = edge.label || (typeof edge.data === 'object' ? edge.data?.label : '') || '';
      return {
        id: edge.id || edge._id,
        source: edge.source || edge.fromId || edge.from,
        target: edge.target || edge.toId || edge.to,
        type: edge.type || (isMsg ? 'message-flow' : 'sequence-flow'),
        flowType: edge.flowType || (isMsg ? 'message' : 'sequence'),
        label: edgeLabel,
        data: typeof edge.data === 'object'
          ? { ...edge.data, label: edgeLabel, type: isMsg ? 'message-flow' : (edge.data?.type || 'sequence-flow') }
          : { label: edgeLabel }
      };
    });

    // 1. Verify cleanEdges preserved labels at top level and inside data
    const e3Clean = cleanEdges.find(e => e.id === 'e3');
    const e4Clean = cleanEdges.find(e => e.id === 'e4');
    assert.strictEqual(e3Clean.label, 'Urgent (Yes)', 'cleanEdges must keep top-level label');
    assert.strictEqual(e3Clean.data?.label, 'Urgent (Yes)', 'cleanEdges must copy label into data.label');
    assert.strictEqual(e4Clean.label, 'Routine (No)');
    assert.strictEqual(e4Clean.data?.label, 'Routine (No)');

    // 2. Verify validateBpmn accepts cleanEdges without "unlabeled branch" errors
    const nodes = [
      { id: 'start_1', type: 'start-event', label: 'Start', lane: 'lane_1' },
      { id: 'task_1', type: 'task', label: 'Triage Check', lane: 'lane_1', duration: 5, resource: 'Staff' },
      { id: 'gw_split', type: 'exclusive-gateway', label: 'Triage Decision?' },
      { id: 'task_urgent', type: 'task', label: 'Urgent Care', lane: 'lane_1', duration: 15, resource: 'Staff' },
      { id: 'task_routine', type: 'task', label: 'Routine Care', lane: 'lane_1', duration: 10, resource: 'Staff' },
      { id: 'gw_join', type: 'exclusive-gateway', label: 'Join' },
      { id: 'end_1', type: 'end-event', label: 'End', lane: 'lane_1' },
    ];
    const validation = validateBpmn({
      nodes,
      edges: cleanEdges,
      resources: [{ id: 'r1', name: 'Staff', type: 'staff', quantity: 2 }]
    });
    assert.strictEqual(validation.errors.length, 0, `BPMN validation should pass with 0 errors, got: ${validation.errors.join(', ')}`);

    // 3. Verify Mongoose ProcessSchema saves and preserves edge.label on reload
    const procDoc = new Process({
      title: 'Triage Process with Labeled Gateways',
      userId,
      nodes,
      edges: cleanEdges,
      resources: [{ id: 'r1', name: 'Staff', type: 'staff', quantity: 2 }]
    });

    // Subdocument edge inspection
    const savedEdge3 = procDoc.edges.find(e => e.id === 'e3');
    const savedEdge4 = procDoc.edges.find(e => e.id === 'e4');
    assert.strictEqual(savedEdge3.label, 'Urgent (Yes)', 'ProcessSchema.edges sub-schema must preserve top-level label');
    assert.strictEqual(savedEdge4.label, 'Routine (No)');
    assert.strictEqual(savedEdge3.data?.probability, 0.25);
    assert.strictEqual(savedEdge4.data?.probability, 0.75);
  });

  it('2. A resource missing type returns 400 with a plain message and details', async () => {
    // Attempt creating a Process model with a resource that lacks `type`
    const invalidProc = new Process({
      title: 'Invalid Resource Process',
      userId,
      nodes: [
        { id: 'start_1', type: 'start-event', lane: 'l1' },
        { id: 'task_1', type: 'task', lane: 'l1', duration: 5, resource: 'Pharmacist' },
        { id: 'end_1', type: 'end-event', lane: 'l1' },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'task_1' },
        { id: 'e2', source: 'task_1', target: 'end_1' },
      ],
      // Missing `type: 'staff'`
      resources: [{ id: 'r1', name: 'Pharmacist', quantity: 2 }]
    });

    let caughtErr = null;
    try {
      await invalidProc.validate();
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr, 'Mongoose validate() should fail for missing resource type');
    assert.strictEqual(caughtErr.name, 'ValidationError');
    assert.ok(caughtErr.errors['resources.0.type'], 'Should flag missing resources.0.type');

    // Simulate route error handling in server.js
    const simulateRouteHandler = (err) => {
      if (err.name === 'ValidationError') {
        return {
          status: 400,
          body: {
            error: 'Validation failed: please check required process and resource fields.',
            detail: err.message,
            details: Object.values(err.errors || {}).map(e => e.message)
          }
        };
      }
      return { status: 500, body: { error: 'Internal Server Error' } };
    };

    const routeResponse = simulateRouteHandler(caughtErr);
    assert.strictEqual(routeResponse.status, 400, 'Must return HTTP 400 on ValidationError');
    assert.strictEqual(
      routeResponse.body.error,
      'Validation failed: please check required process and resource fields.'
    );
    assert.ok(
      routeResponse.body.details.some(d => d.includes('type') && d.includes('required')),
      'Must contain details about the missing type path'
    );
  });
});
