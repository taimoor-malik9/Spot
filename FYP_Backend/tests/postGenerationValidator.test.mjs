import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validatePostGeneration } from '../shared/postGenerationValidator.js';

describe('Post-Generation Validator & Semantic Event Rules', () => {

  describe('Rule 1: Start event has no incoming flows; End event has no outgoing flows', () => {
    it('detects and repairs start event with incoming sequence flows', () => {
      const diagram = {
        nodes: [
          { id: 'start_1', type: 'start-event', label: 'Start' },
          { id: 'task_1', type: 'task', label: 'Process Application' },
          { id: 'end_1', type: 'end-event', label: 'End' }
        ],
        edges: [
          { id: 'e1', source: 'start_1', target: 'task_1', flowType: 'sequence' },
          { id: 'e2', source: 'task_1', target: 'start_1', flowType: 'sequence' }, // Invalid cycle to start
          { id: 'e3', source: 'task_1', target: 'end_1', flowType: 'sequence' }
        ]
      };

      const result = validatePostGeneration(diagram);
      assert.strictEqual(result.isValid, false);
      const rule1Violations = result.violations.filter(v => v.ruleId === 1 && v.rule === 'start-no-incoming');
      assert.strictEqual(rule1Violations.length, 1);

      // Verify repair removed incoming edge into start_1
      const repairedInEdges = result.repaired.edges.filter(e => e.target === 'start_1');
      assert.strictEqual(repairedInEdges.length, 0);
    });

    it('detects and repairs end event with outgoing sequence flows', () => {
      const diagram = {
        nodes: [
          { id: 'start_1', type: 'start-event', label: 'Start' },
          { id: 'task_1', type: 'task', label: 'Handle Case' },
          { id: 'end_1', type: 'end-event', label: 'End' }
        ],
        edges: [
          { id: 'e1', source: 'start_1', target: 'task_1', flowType: 'sequence' },
          { id: 'e2', source: 'task_1', target: 'end_1', flowType: 'sequence' },
          { id: 'e3', source: 'end_1', target: 'task_1', flowType: 'sequence' } // Invalid outgoing from end
        ]
      };

      const result = validatePostGeneration(diagram);
      assert.strictEqual(result.isValid, false);
      const rule1Violations = result.violations.filter(v => v.ruleId === 1 && v.rule === 'end-no-outgoing');
      assert.strictEqual(rule1Violations.length, 1);

      // Verify repair removed outgoing edge from end_1
      const repairedOutEdges = result.repaired.edges.filter(e => e.source === 'end_1');
      assert.strictEqual(repairedOutEdges.length, 0);
    });
  });

  describe('Rule 2: Split gateways have >= 2 outgoing labeled flows & matching merge', () => {
    it('detects unlabeled branches on split gateways and assigns condition labels', () => {
      const diagram = {
        nodes: [
          { id: 'start_1', type: 'start-event', label: 'Start' },
          { id: 'gw_split', type: 'exclusive-gateway', label: 'Approved?' },
          { id: 'task_yes', type: 'task', label: 'Process Payment' },
          { id: 'task_no', type: 'task', label: 'Notify Rejection' },
          { id: 'gw_join', type: 'exclusive-gateway', label: '', gateway_role: 'merge' },
          { id: 'end_1', type: 'end-event', label: 'End' }
        ],
        edges: [
          { id: 'e1', source: 'start_1', target: 'gw_split', flowType: 'sequence' },
          { id: 'e2', source: 'gw_split', target: 'task_yes', flowType: 'sequence', data: { label: '' } }, // unlabeled!
          { id: 'e3', source: 'gw_split', target: 'task_no', flowType: 'sequence', data: { label: '' } },  // unlabeled!
          { id: 'e4', source: 'task_yes', target: 'gw_join', flowType: 'sequence' },
          { id: 'e5', source: 'task_no', target: 'gw_join', flowType: 'sequence' },
          { id: 'e6', source: 'gw_join', target: 'end_1', flowType: 'sequence' }
        ]
      };

      const result = validatePostGeneration(diagram);
      assert.strictEqual(result.isValid, false);
      const labelViolations = result.violations.filter(v => v.ruleId === 2 && v.rule === 'split-branch-labeled');
      assert.strictEqual(labelViolations.length, 2);

      // Check auto-repair assigned branch labels
      const repairedSplitOut = result.repaired.edges.filter(e => e.source === 'gw_split');
      assert.strictEqual(repairedSplitOut.length, 2);
      assert.strictEqual(repairedSplitOut[0].data?.label, 'Yes');
      assert.strictEqual(repairedSplitOut[1].data?.label, 'No');
    });

    it('detects split without matching merge and inserts a merge gateway', () => {
      const diagram = {
        nodes: [
          { id: 'start_1', type: 'start-event', label: 'Start' },
          { id: 'gw_split', type: 'exclusive-gateway', label: 'Priority Order?' },
          { id: 'task_expedite', type: 'task', label: 'Expedite Shipping' },
          { id: 'task_std', type: 'task', label: 'Standard Shipping' },
          { id: 'task_shared', type: 'task', label: 'Archive Order' }, // Branches converge directly into task!
          { id: 'end_1', type: 'end-event', label: 'End' }
        ],
        edges: [
          { id: 'e1', source: 'start_1', target: 'gw_split', flowType: 'sequence' },
          { id: 'e2', source: 'gw_split', target: 'task_expedite', flowType: 'sequence', data: { label: 'Yes' } },
          { id: 'e3', source: 'gw_split', target: 'task_std', flowType: 'sequence', data: { label: 'No' } },
          { id: 'e4', source: 'task_expedite', target: 'task_shared', flowType: 'sequence' },
          { id: 'e5', source: 'task_std', target: 'task_shared', flowType: 'sequence' },
          { id: 'e6', source: 'task_shared', target: 'end_1', flowType: 'sequence' }
        ]
      };

      const result = validatePostGeneration(diagram);
      assert.strictEqual(result.isValid, false);
      const mergeViolations = result.violations.filter(v => v.ruleId === 2 && v.rule === 'split-matching-merge');
      assert.strictEqual(mergeViolations.length, 1);

      // Check auto-repair inserted a merge gateway before task_shared
      const mergeNodes = result.repaired.nodes.filter(n => n.type === 'exclusive-gateway' && (n.gateway_role === 'merge' || n.id.includes('merge')));
      assert.ok(mergeNodes.length >= 1, 'Expected a merge gateway to be inserted');

      const mergeId = mergeNodes[0].id;
      const intoMerge = result.repaired.edges.filter(e => e.target === mergeId);
      assert.strictEqual(intoMerge.length, 2, 'Both branch paths should now route into the merge gateway');

      const fromMerge = result.repaired.edges.filter(e => e.source === mergeId && e.target === 'task_shared');
      assert.strictEqual(fromMerge.length, 1, 'Merge gateway should connect into task_shared');
    });

    it('flags split gateway with fewer than 2 outgoing flows', () => {
      const diagram = {
        nodes: [
          { id: 'start_1', type: 'start-event', label: 'Start' },
          { id: 'gw_split', type: 'exclusive-gateway', label: 'Needs Review?' },
          { id: 'end_1', type: 'end-event', label: 'End' }
        ],
        edges: [
          // Zero outgoing edges
          { id: 'e1', source: 'start_1', target: 'gw_split', flowType: 'sequence' }
        ]
      };

      const result = validatePostGeneration(diagram);
      assert.strictEqual(result.isValid, false);
      assert.ok(result.violations.some(v => v.ruleId === 2 && v.rule === 'split-min-two-branches'));
    });
  });

  describe('Rule 3: Gateway with 1 in and 1 out is invalid (remove or bypass)', () => {
    it('detects single-path gateway and removes it, connecting source directly to target', () => {
      const diagram = {
        nodes: [
          { id: 'start_1', type: 'start-event', label: 'Start' },
          { id: 'task_prep', type: 'task', label: 'Prepare Documents' },
          { id: 'gw_single', type: 'exclusive-gateway', label: 'Single Gateway' }, // 1 in, 1 out
          { id: 'task_submit', type: 'task', label: 'Submit Documents' },
          { id: 'end_1', type: 'end-event', label: 'End' }
        ],
        edges: [
          { id: 'e1', source: 'start_1', target: 'task_prep', flowType: 'sequence' },
          { id: 'e2', source: 'task_prep', target: 'gw_single', flowType: 'sequence' },
          { id: 'e3', source: 'gw_single', target: 'task_submit', flowType: 'sequence' },
          { id: 'e4', source: 'task_submit', target: 'end_1', flowType: 'sequence' }
        ]
      };

      const result = validatePostGeneration(diagram);
      assert.strictEqual(result.isValid, false);
      const rule3Violations = result.violations.filter(v => v.ruleId === 3);
      assert.strictEqual(rule3Violations.length, 1);

      // Verify gateway was removed
      const remainingNodeIds = result.repaired.nodes.map(n => n.id);
      assert.ok(!remainingNodeIds.includes('gw_single'), 'gw_single should be removed');

      // Verify task_prep connects directly to task_submit
      const directEdge = result.repaired.edges.find(e => e.source === 'task_prep' && e.target === 'task_submit');
      assert.ok(directEdge, 'Expected direct edge from task_prep to task_submit');
    });
  });

  describe('Rule 4: No element name may match an ID pattern', () => {
    it('detects ID-like labels on tasks and auto-generates human-readable names', () => {
      const diagram = {
        nodes: [
          { id: 'start_1', type: 'start-event', label: 'Start' },
          { id: 'task_1', type: 'task', label: 'task_check_inventory_0' },
          { id: 'end_1', type: 'end-event', label: 'End' }
        ],
        edges: [
          { id: 'e1', source: 'start_1', target: 'task_1', flowType: 'sequence' },
          { id: 'e2', source: 'task_1', target: 'end_1', flowType: 'sequence' }
        ]
      };

      const result = validatePostGeneration(diagram);
      assert.strictEqual(result.isValid, false);
      const rule4Violations = result.violations.filter(v => v.ruleId === 4);
      assert.strictEqual(rule4Violations.length, 1);

      const repairedTask = result.repaired.nodes.find(n => n.id === 'task_1');
      assert.strictEqual(repairedTask.data?.label, 'Check Inventory');
    });

    it('clears raw internal ID label from merge gateways', () => {
      const diagram = {
        nodes: [
          { id: 'start_1', type: 'start-event', label: 'Start' },
          { id: 'gw_split', type: 'exclusive-gateway', label: 'Decision?' },
          { id: 't1', type: 'task', label: 'Task 1' },
          { id: 't2', type: 'task', label: 'Task 2' },
          { id: 'gw_join_check_stock_level_0', type: 'exclusive-gateway', label: 'gw_join_check_stock_level_0', gateway_role: 'merge' },
          { id: 'end_1', type: 'end-event', label: 'End' }
        ],
        edges: [
          { id: 'e1', source: 'start_1', target: 'gw_split', flowType: 'sequence' },
          { id: 'e2', source: 'gw_split', target: 't1', flowType: 'sequence', data: { label: 'Yes' } },
          { id: 'e3', source: 'gw_split', target: 't2', flowType: 'sequence', data: { label: 'No' } },
          { id: 'e4', source: 't1', target: 'gw_join_check_stock_level_0', flowType: 'sequence' },
          { id: 'e5', source: 't2', target: 'gw_join_check_stock_level_0', flowType: 'sequence' },
          { id: 'e6', source: 'gw_join_check_stock_level_0', target: 'end_1', flowType: 'sequence' }
        ]
      };

      const result = validatePostGeneration(diagram);
      assert.strictEqual(result.isValid, false);
      const rule4Violations = result.violations.filter(v => v.ruleId === 4);
      assert.strictEqual(rule4Violations.length, 1);

      const repairedMerge = result.repaired.nodes.find(n => n.id === 'gw_join_check_stock_level_0');
      assert.strictEqual(repairedMerge.data?.label, '');
    });
  });

  describe('Rule 5: No dead ends or unreachable nodes', () => {
    it('detects unreachable nodes with no path from any start event', () => {
      const diagram = {
        nodes: [
          { id: 'start_1', type: 'start-event', label: 'Start' },
          { id: 'task_valid', type: 'task', label: 'Valid Task' },
          { id: 'task_orphan', type: 'task', label: 'Orphan Task' },
          { id: 'end_1', type: 'end-event', label: 'End' }
        ],
        edges: [
          { id: 'e1', source: 'start_1', target: 'task_valid', flowType: 'sequence' },
          { id: 'e2', source: 'task_valid', target: 'end_1', flowType: 'sequence' },
          { id: 'e3', source: 'task_orphan', target: 'end_1', flowType: 'sequence' } // task_orphan has no incoming
        ]
      };

      const result = validatePostGeneration(diagram);
      assert.strictEqual(result.isValid, false);
      const unreachViolations = result.violations.filter(v => v.rule === 'node-reachable-from-start');
      assert.strictEqual(unreachViolations.length, 1);
      assert.strictEqual(unreachViolations[0].elementId, 'task_orphan');
    });

    it('detects dead-end nodes that cannot reach any end event', () => {
      const diagram = {
        nodes: [
          { id: 'start_1', type: 'start-event', label: 'Start' },
          { id: 'task_ok', type: 'task', label: 'Normal Task' },
          { id: 'task_deadend', type: 'task', label: 'Dead End Task' },
          { id: 'end_1', type: 'end-event', label: 'End' }
        ],
        edges: [
          { id: 'e1', source: 'start_1', target: 'task_ok', flowType: 'sequence' },
          { id: 'e2', source: 'task_ok', target: 'end_1', flowType: 'sequence' },
          { id: 'e3', source: 'start_1', target: 'task_deadend', flowType: 'sequence' }
          // task_deadend has no path to end_1
        ]
      };

      const result = validatePostGeneration(diagram);
      assert.strictEqual(result.isValid, false);
      const deadEndViolations = result.violations.filter(v => v.rule === 'node-can-reach-end');
      assert.strictEqual(deadEndViolations.length, 1);
      assert.strictEqual(deadEndViolations[0].elementId, 'task_deadend');
    });
  });

  describe('Rule 6: Tasks waiting on external parties converted to message catch events', () => {
    it('converts "Receive delivery from manufacturer" following a send/place task to message-intermediate-catch', () => {
      const diagram = {
        nodes: [
          { id: 'start_1', type: 'start-event', label: 'Start' },
          { id: 't_order', type: 'task', label: 'Place Order to Manufacturer' },
          { id: 't_delivery', type: 'task', label: 'Receive Delivery from Manufacturer' },
          { id: 't_inspect', type: 'task', label: 'Inspect Goods' },
          { id: 'end_1', type: 'end-event', label: 'End' }
        ],
        edges: [
          { id: 'e1', source: 'start_1', target: 't_order', flowType: 'sequence' },
          { id: 'e2', source: 't_order', target: 't_delivery', flowType: 'sequence' },
          { id: 'e3', source: 't_delivery', target: 't_inspect', flowType: 'sequence' },
          { id: 'e4', source: 't_inspect', target: 'end_1', flowType: 'sequence' }
        ]
      };

      const result = validatePostGeneration(diagram);
      const convertedNode = result.repaired.nodes.find(n => n.id === 't_delivery');
      assert.strictEqual(convertedNode.type, 'message-intermediate-catch');
      assert.ok(result.warnings.some(w => w.rule === 'task-converted-to-message-catch'));
    });

    it('converts "Wait for supplier confirmation" to message-intermediate-catch', () => {
      const diagram = {
        nodes: [
          { id: 'start_1', type: 'start-event', label: 'Start' },
          { id: 't_send', type: 'task', label: 'Send Quote Request' },
          { id: 't_wait', type: 'task', label: 'Wait for Supplier Confirmation' },
          { id: 'end_1', type: 'end-event', label: 'End' }
        ],
        edges: [
          { id: 'e1', source: 'start_1', target: 't_send', flowType: 'sequence' },
          { id: 'e2', source: 't_send', target: 't_wait', flowType: 'sequence' },
          { id: 'e3', source: 't_wait', target: 'end_1', flowType: 'sequence' }
        ]
      };

      const result = validatePostGeneration(diagram);
      const convertedNode = result.repaired.nodes.find(n => n.id === 't_wait');
      assert.strictEqual(convertedNode.type, 'message-intermediate-catch');
    });
  });

  describe('Rule 7: Yes/No branch consistency (No must not route into Yes work)', () => {
    it('detects inverted Yes/No branches where "No" routes to "Place Order" and swaps them', () => {
      const diagram = {
        nodes: [
          { id: 'start_1', type: 'start-event', label: 'Start' },
          { id: 'gw_stock', type: 'exclusive-gateway', label: 'Stock below reorder level?' },
          { id: 'task_order', type: 'task', label: 'Place Order to Manufacturer' },
          { id: 'gw_merge', type: 'exclusive-gateway', label: '', gateway_role: 'merge' },
          { id: 'end_1', type: 'end-event', label: 'End' }
        ],
        edges: [
          { id: 'e1', source: 'start_1', target: 'gw_stock', flowType: 'sequence' },
          // Inverted wiring: "No" goes to Place Order, "Yes" bypasses to merge!
          { id: 'e_no', source: 'gw_stock', target: 'task_order', flowType: 'sequence', data: { label: 'No' } },
          { id: 'e_yes', source: 'gw_stock', target: 'gw_merge', flowType: 'sequence', data: { label: 'Yes' } },
          { id: 'e_after_order', source: 'task_order', target: 'gw_merge', flowType: 'sequence' },
          { id: 'e_final', source: 'gw_merge', target: 'end_1', flowType: 'sequence' }
        ]
      };

      const result = validatePostGeneration(diagram);
      assert.strictEqual(result.isValid, false);
      const rule7Violations = result.violations.filter(v => v.ruleId === 7);
      assert.strictEqual(rule7Violations.length, 1);

      // Verify labels were swapped so "Yes" triggers placing the order and "No" bypasses
      const toOrderEdge = result.repaired.edges.find(e => e.source === 'gw_stock' && e.target === 'task_order');
      const toMergeEdge = result.repaired.edges.find(e => e.source === 'gw_stock' && e.target === 'gw_merge');

      assert.strictEqual(toOrderEdge.data?.label, 'Yes', 'Edge routing to Place Order should now be labeled Yes');
      assert.strictEqual(toMergeEdge.data?.label, 'No', 'Edge bypassing Place Order should now be labeled No');
    });
  });

  describe('Integration Test: Beverages Distribution Business', () => {
    it('asserts: merge gateway exists after stock decision, "No" bypasses Place order, delivery wait is message catch event, no ID-like labels, and retailer order flow starts from its own start event', () => {
      // Simulate raw diagram generated from "Beverages Distribution Business"
      // containing the exact observed issues
      const rawBeveragesModel = {
        nodes: [
          // Flow 1: Restocking Flow (Warehouse Manager)
          { id: 'start_restock', type: 'conditional-start-event', lane: 'Warehouse Manager', data: { label: 'Stock Level Evaluation' } },
          { id: 'gw_decision', type: 'exclusive-gateway', lane: 'Warehouse Manager', data: { label: 'Stock below reorder level?' } },
          { id: 'task_place_order', type: 'task', lane: 'Warehouse Manager', data: { label: 'Place Order to Manufacturer' } },
          { id: 'task_receive_delivery', type: 'task', lane: 'Warehouse Manager', data: { label: 'Receive delivery from manufacturer' } },
          { id: 'gw_join_check_stock_level_0', type: 'exclusive-gateway', lane: 'Warehouse Manager', data: { label: 'gw_join_check_stock_level_0', gateway_role: 'merge' } },
          { id: 'end_restock', type: 'end-event', lane: 'Warehouse Manager', data: { label: 'Restock Flow Ended' } },

          // Flow 2: Independent Retailer Order Fulfilment Flow (Booker -> Warehouse -> Delivery Driver)
          { id: 'start_retailer_order', type: 'message-start-event', lane: 'Booker', data: { label: 'Booker takes orders from retailer' } },
          { id: 'task_process_order', type: 'task', lane: 'Booker', data: { label: 'Process Retailer Order' } },
          { id: 'task_pack_items', type: 'task', lane: 'Warehouse Manager', data: { label: 'Warehouse Packs Items' } },
          { id: 'task_deliver_retailer', type: 'task', lane: 'Delivery Driver', data: { label: 'Deliver Order to Retailer' } },
          { id: 'end_retailer_order', type: 'end-event', lane: 'Delivery Driver', data: { label: 'Order Delivered to Retailer' } }
        ],
        edges: [
          // Flow 1 edges - with inverted Yes/No branches
          { id: 'e1', source: 'start_restock', target: 'gw_decision', flowType: 'sequence' },
          { id: 'e_no', source: 'gw_decision', target: 'task_place_order', flowType: 'sequence', data: { label: 'No' } },
          { id: 'e_yes', source: 'gw_decision', target: 'gw_join_check_stock_level_0', flowType: 'sequence', data: { label: 'Yes' } },
          { id: 'e2', source: 'task_place_order', target: 'task_receive_delivery', flowType: 'sequence' },
          { id: 'e3', source: 'task_receive_delivery', target: 'gw_join_check_stock_level_0', flowType: 'sequence' },
          { id: 'e4', source: 'gw_join_check_stock_level_0', target: 'end_restock', flowType: 'sequence' },

          // Flow 2 edges - independent sequence
          { id: 'e5', source: 'start_retailer_order', target: 'task_process_order', flowType: 'sequence' },
          { id: 'e6', source: 'task_process_order', target: 'task_pack_items', flowType: 'sequence' },
          { id: 'e7', source: 'task_pack_items', target: 'task_deliver_retailer', flowType: 'sequence' },
          { id: 'e8', source: 'task_deliver_retailer', target: 'end_retailer_order', flowType: 'sequence' }
        ]
      };

      const result = validatePostGeneration(rawBeveragesModel, {
        confirmedStarts: ['Stock Level Evaluation', 'Booker takes orders from retailer']
      });

      // 1. Assert: a merge gateway exists after the stock decision
      const mergeGateways = result.repaired.nodes.filter(
        n => n.type === 'exclusive-gateway' && (n.gateway_role === 'merge' || n.id.includes('join') || n.id.includes('merge'))
      );
      assert.ok(mergeGateways.length >= 1, 'Expected at least one merge gateway after stock decision');
      const mergeGwId = mergeGateways[0].id;

      // 2. Assert: "No" bypasses Place order and connects to the merge gateway, while "Yes" routes to Place order
      const edgeToPlaceOrder = result.repaired.edges.find(e => e.source === 'gw_decision' && e.target === 'task_place_order');
      const edgeToMerge = result.repaired.edges.find(e => e.source === 'gw_decision' && e.target === mergeGwId);

      assert.ok(edgeToPlaceOrder, 'Expected edge from decision to Place order');
      assert.ok(edgeToMerge, 'Expected bypass edge from decision to merge gateway');
      assert.strictEqual(edgeToPlaceOrder.data?.label, 'Yes', '"Yes" must route to Place Order');
      assert.strictEqual(edgeToMerge.data?.label, 'No', '"No" must bypass Place Order');

      // 3. Assert: delivery wait is converted to / confirmed as a message catch event
      const deliveryNode = result.repaired.nodes.find(n => n.id === 'task_receive_delivery');
      assert.strictEqual(deliveryNode.type, 'message-intermediate-catch', 'Delivery wait must be a message-intermediate-catch event');

      // 4. Assert: no ID-like labels on any element
      result.repaired.nodes.forEach(node => {
        const lbl = String(node.data?.label ?? node.label ?? '');
        assert.ok(!/^gw_join_|^gw_split_|_\d+$/i.test(lbl), `Node ${node.id} has invalid ID-like label: "${lbl}"`);
      });

      // 5. Assert: retailer order flow starts from its own start event
      const startNodes = result.repaired.nodes.filter(n => n.type.includes('start'));
      assert.strictEqual(startNodes.length, 2, 'Expected 2 independent start events');

      const retailerStart = result.repaired.nodes.find(n => n.id === 'start_retailer_order');
      assert.ok(retailerStart, 'Retailer order flow must have its own start event');
      assert.strictEqual(retailerStart.type, 'message-start-event', 'Retailer order start should be message-start-event');
    });
  });

});
