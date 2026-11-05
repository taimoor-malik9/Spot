/**
 * lib/intake/intakeRunSimulation.test.js
 *
 * Verification of the full handoff flow:
 * AI-generated model -> Run simulation -> Simulate page receives the same activities and resources.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { layoutAiDiagram } from '../aiDiagramLayout.js';
import { shapeBackendToFrontend, shapeFrontendToBackend } from '../apiService.js';
import { validateBpmn } from './validateBpmn.js';

// Mock localStorage for test environment
class MockLocalStorage {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

describe('AI Guided Intake -> Run Simulation -> Simulate page handoff', () => {
  it('persists generated model and ensures Simulate page receives identical activities and resources', async () => {
    const mockStorage = new MockLocalStorage();
    global.localStorage = mockStorage;

    // 1. Given an AI-generated BPMN draft model
    const generatedRawDiagram = {
      type: 'diagram',
      title: 'Customer Order & Delivery Process',
      resources: [
        { id: 'Barista', name: 'Barista', displayName: 'Barista', type: 'staff', quantity: 2 },
        { id: 'Courier', name: 'Courier', displayName: 'Courier', type: 'staff', quantity: 3 },
      ],
      nodes: [
        {
          id: 'start_1',
          type: 'start-event',
          lane: 'Barista',
          data: { label: 'Order Received' },
        },
        {
          id: 'task_prep',
          type: 'task',
          lane: 'Barista',
          data: {
            label: 'Prepare Order',
            duration: 8,
            duration_unit: 'minutes',
            resource: 'Barista',
            resources: { Barista: 1 },
          },
        },
        {
          id: 'task_package',
          type: 'task',
          lane: 'Barista',
          data: {
            label: 'Package Order',
            duration: 4,
            duration_unit: 'minutes',
            resource: 'Barista',
            resources: { Barista: 1 },
          },
        },
        {
          id: 'task_deliver',
          type: 'task',
          lane: 'Courier',
          data: {
            label: 'Deliver to Customer',
            duration: 25,
            duration_unit: 'minutes',
            resource: 'Courier',
            resources: { Courier: 1 },
          },
        },
        {
          id: 'end_1',
          type: 'end-event',
          lane: 'Courier',
          data: { label: 'Order Completed' },
        },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'task_prep', flowType: 'sequence', data: {} },
        { id: 'e2', source: 'task_prep', target: 'task_package', flowType: 'sequence', data: {} },
        { id: 'e3', source: 'task_package', target: 'task_deliver', flowType: 'sequence', data: {} },
        { id: 'e4', source: 'task_deliver', target: 'end_1', flowType: 'sequence', data: {} },
      ],
    };

    // Verify valid BPMN
    const validation = validateBpmn(generatedRawDiagram);
    assert.equal(validation.errors.length, 0, 'Generated diagram should pass BPMN validation');

    // 2. Perform layout (what handleRunSimulation does)
    const layout = layoutAiDiagram(generatedRawDiagram);
    assert.ok(layout.elements && layout.elements.length > 0, 'Layout must produce elements');

    // 3. Sanitize resources (matching handleRunSimulation)
    const rawRes = layout.resources || generatedRawDiagram.resources || [];
    const sanitizedResources = rawRes.map((r) => {
      const cleanName = r.displayName || r.name || r.id || 'Staff / Specialist';
      return {
        ...r,
        id: cleanName,
        name: cleanName,
        displayName: cleanName,
        payloadKey: cleanName,
        type: r.type || 'staff',
        quantity: Number(r.quantity) || 1,
      };
    });

    // 4. Simulate handleRunSimulation writing to storage
    mockStorage.setItem(
      'spot:model:nodes',
      JSON.stringify({ nodes: layout.elements, connections: layout.connections })
    );
    mockStorage.setItem('spot:globalResources', JSON.stringify(sanitizedResources));
    mockStorage.setItem('spot:processTitle', generatedRawDiagram.title);

    // 5. Simulate backend persistence
    let backendSavedId = null;
    const mockSaveToBackend = async (payload) => {
      // Simulate backend ID generation and persistence
      backendSavedId = 'proc_test_998877';
      return backendSavedId;
    };

    const savedId = await mockSaveToBackend({
      elements: layout.elements,
      connections: layout.connections,
      title: generatedRawDiagram.title,
      resources: sanitizedResources,
    });
    assert.equal(savedId, 'proc_test_998877');
    mockStorage.setItem('spot:processId', savedId);

    // Navigation target URL
    const targetUrl = `/simulate?processId=${savedId}&autorun=true`;
    assert.ok(targetUrl.includes('processId=proc_test_998877'));
    assert.ok(targetUrl.includes('autorun=true'));

    // 6. Simulate page reading from localStorage (Case A: localStorage direct)
    const storedModel = JSON.parse(mockStorage.getItem('spot:model:nodes'));
    const storedResources = JSON.parse(mockStorage.getItem('spot:globalResources'));

    const simulateTasksA = storedModel.nodes.filter(
      (n) => n.type === 'task' || n.data?.type === 'task'
    );
    assert.equal(simulateTasksA.length, 3, 'Simulate page must receive all 3 task activities');
    const taskLabelsA = simulateTasksA.map((t) => t.data?.label || t.label);
    assert.deepEqual(taskLabelsA, ['Prepare Order', 'Package Order', 'Deliver to Customer']);

    assert.equal(storedResources.length, 2, 'Simulate page must receive both resources');
    assert.equal(storedResources[0].name, 'Barista');
    assert.equal(storedResources[0].quantity, 2);
    assert.equal(storedResources[1].name, 'Courier');
    assert.equal(storedResources[1].quantity, 3);

    // 7. Simulate page reading from backend (Case B: localStorage empty, fetched by processId)
    // Create backend document representation via shapeFrontendToBackend
    const backendDoc = shapeFrontendToBackend(
      layout.elements,
      layout.connections,
      generatedRawDiagram.title,
      sanitizedResources
    );
    backendDoc._id = savedId;

    // Simulate backend roundtrip hydration via shapeBackendToFrontend
    const hydratedFromBackend = shapeBackendToFrontend(backendDoc);
    const simulateTasksB = hydratedFromBackend.elements.filter(
      (n) => n.type === 'task' || n.data?.type === 'task'
    );
    assert.equal(
      simulateTasksB.length,
      3,
      'Simulate page hydrated from backend must receive all 3 task activities'
    );
    const taskLabelsB = simulateTasksB.map((t) => t.data?.label || t.label);
    assert.deepEqual(taskLabelsB, ['Prepare Order', 'Package Order', 'Deliver to Customer']);

    // Check task durations are intact
    const taskDurations = simulateTasksB.map((t) => t.data?.duration);
    assert.deepEqual(taskDurations, [8, 4, 25]);

    // Check task resources are intact
    const taskResourceAssignments = simulateTasksB.map(
      (t) => t.data?.resources || t.data?.resource
    );
    assert.deepEqual(taskResourceAssignments, [
      { Barista: 1 },
      { Barista: 1 },
      { Courier: 1 },
    ]);
  });
});
