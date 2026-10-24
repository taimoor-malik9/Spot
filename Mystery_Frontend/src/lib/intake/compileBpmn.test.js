/**
 * lib/intake/compileBpmn.test.js
 *
 * Unit tests for BPMN SPEC compiler and structural validation.
 * Run with: node --test src/lib/intake/compileBpmn.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileBpmn, validateSpec, getStartEventLabel, getEndEventLabel } from './compileBpmn.js';
import { validateBpmn } from './validateBpmn.js';
import { layoutAiDiagram } from '../aiDiagramLayout.js';
import { poolLanes } from '../../components/model/bpmnGeometry.js';

describe('compileBpmn unit tests', () => {
  it('detects incomplete SPEC with branch having no steps and asks plain question', () => {
    const spec = {
      pools: [
        {
          name: 'Store',
          steps: [{ id: 's1', label: 'Check Stock', kind: 'task' }],
          branches: [
            {
              afterStepId: 's1',
              question: 'In stock?',
              options: [
                { label: 'Yes', steps: [] }, // empty steps!
                { label: 'No', steps: ['s2'] },
              ],
            },
          ],
        },
      ],
    };

    const res = validateSpec(spec);
    assert.strictEqual(res.valid, false);
    assert.match(res.question, /In stock/);
  });

  it('detects incomplete SPEC with handoff to missing step and asks plain question', () => {
    const spec = {
      pools: [
        {
          name: 'Customer',
          steps: [{ id: 'c1', label: 'Send Order', kind: 'send_message' }],
        },
        {
          name: 'Store',
          steps: [{ id: 's1', label: 'Prepare Item', kind: 'task' }],
        },
      ],
      handoffs: [{ fromStepId: 'c1', toStepId: 's_missing_step' }],
    };

    const res = validateSpec(spec);
    assert.strictEqual(res.valid, false);
    assert.match(res.question, /handoff/i);
  });

  it('compiles message start and message end events correctly', () => {
    const spec = {
      pools: [
        {
          name: 'Customer',
          steps: [
            { id: 'c1', label: 'Order Item', kind: 'task' },
            { id: 'c2', label: 'Send Payment Info', kind: 'send_message' },
          ],
        },
        {
          name: 'Store',
          steps: [
            { id: 's1', label: 'Wait for Payment', kind: 'wait_for_message' },
            { id: 's2', label: 'Fulfill Order', kind: 'task' },
          ],
        },
      ],
      handoffs: [{ fromStepId: 'c2', toStepId: 's1' }],
    };

    const compiled = compileBpmn(spec);
    const s1Node = compiled.nodes.find((n) => n.id === 's1');
    assert.strictEqual(s1Node.type, 'message-start-event');

    const c2Node = compiled.nodes.find((n) => n.id === 'c2');
    assert.strictEqual(c2Node.type, 'message-end-event');

    const validation = validateBpmn(compiled);
    assert.deepStrictEqual(validation.errors, []);
  });

  it('applies inferred-step zero-time rule and lane assignment', () => {
    const spec = {
      pools: [
        {
          name: 'Support Team',
          steps: [
            { id: 't1', label: 'User submits ticket', kind: 'task', origin: 'stated', duration: 15 },
            { id: 't2', label: 'Log ticket in CRM', kind: 'task', origin: 'inferred', duration: 10 },
          ],
        },
      ],
    };

    const compiled = compileBpmn(spec);
    const t2Node = compiled.nodes.find((n) => n.id === 't2');
    assert.strictEqual(t2Node.data.duration, 0);
    assert.strictEqual(t2Node.lane, 'Support Team');

    const validation = validateBpmn(compiled);
    assert.deepStrictEqual(validation.errors, []);
  });

  it('compiles exclusive gateway with rejoin: true correctly', () => {
    const spec = {
      pools: [
        {
          name: 'Claims',
          steps: [
            { id: 'c1', label: 'Assess Claim', kind: 'task' },
            { id: 'c2_fast', label: 'Fast-Track Processing', kind: 'task' },
            { id: 'c2_std', label: 'Standard Review', kind: 'task' },
            { id: 'c3', label: 'Send Payout', kind: 'task' },
          ],
          branches: [
            {
              afterStepId: 'c1',
              question: 'Claim under $500?',
              options: [
                { label: 'Yes', probability: 0.7, steps: ['c2_fast'], rejoin: true },
                { label: 'No', probability: 0.3, steps: ['c2_std'], rejoin: true },
              ],
            },
          ],
        },
      ],
    };

    const compiled = compileBpmn(spec);
    const splitNode = compiled.nodes.find((n) => n.type === 'exclusive-gateway' && n.id.includes('split'));
    const joinNode = compiled.nodes.find((n) => n.type === 'exclusive-gateway' && n.id.includes('join'));

    assert.ok(splitNode, 'Split gateway should exist');
    assert.ok(joinNode, 'Join gateway should exist');

    const validation = validateBpmn(compiled);
    assert.deepStrictEqual(validation.errors, []);
  });

  it('compiles branch with rejoin: false to separate end event', () => {
    const spec = {
      pools: [
        {
          name: 'Applications',
          steps: [
            { id: 'a1', label: 'Review Application', kind: 'task' },
            { id: 'a2_approve', label: 'Approve & Issue ID', kind: 'task' },
            { id: 'a2_reject', label: 'Reject & Notify', kind: 'task' },
          ],
          branches: [
            {
              afterStepId: 'a1',
              question: 'Meets criteria?',
              options: [
                { label: 'Approved', probability: 0.8, steps: ['a2_approve'], rejoin: false },
                { label: 'Rejected', probability: 0.2, steps: ['a2_reject'], rejoin: false },
              ],
            },
          ],
        },
      ],
    };

    const compiled = compileBpmn(spec);
    const endNodes = compiled.nodes.filter((n) => n.type === 'end-event');
    assert.strictEqual(endNodes.length, 2, 'Should create 2 end events for non-rejoining branches');

    const validation = validateBpmn(compiled);
    assert.deepStrictEqual(validation.errors, []);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SAMPLE DESCRIPTION 1: Shop Checkout
  // ───────────────────────────────────────────────────────────────────────────
  it('compiles Sample Description 1: Shop Checkout and passes validateBpmn with 0 errors', () => {
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

    const compiled = compileBpmn(shopCheckoutSpec);
    const validation = validateBpmn(compiled);
    assert.deepStrictEqual(validation.errors, []);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SAMPLE DESCRIPTION 2: Library Issue
  // ───────────────────────────────────────────────────────────────────────────
  it('compiles Sample Description 2: Library Issue and passes validateBpmn with 0 errors', () => {
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

    const compiled = compileBpmn(libraryIssueSpec);
    const validation = validateBpmn(compiled);
    assert.deepStrictEqual(validation.errors, []);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SAMPLE DESCRIPTION 3: Pizza Delivery
  // ───────────────────────────────────────────────────────────────────────────
  it('compiles Sample Description 3: Pizza Delivery and passes validateBpmn with 0 errors', () => {
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

    const compiled = compileBpmn(pizzaDeliverySpec);
    const validation = validateBpmn(compiled);
    assert.deepStrictEqual(validation.errors, []);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // MODULE I2h: Compiler + Rendering Tests
  // ───────────────────────────────────────────────────────────────────────────
  describe('Module I2h: Compiler & Rendering Unit Tests', () => {
    // Helper to assert no overlapping nodes
    function assertNoOverlappingNodes(elements, label = '') {
      const processNodes = elements.filter(
        (e) => e.type !== 'pool' && e.type !== 'lane'
      );
      const nw = 80;
      const nh = 80;

      for (let i = 0; i < processNodes.length; i++) {
        for (let j = i + 1; j < processNodes.length; j++) {
          const a = processNodes[i];
          const b = processNodes[j];
          const ax = a.position?.x ?? 0;
          const ay = a.position?.y ?? 0;
          const bx = b.position?.x ?? 0;
          const by = b.position?.y ?? 0;

          const overlaps =
            ax < bx + nw &&
            ax + nw > bx &&
            ay < by + nh &&
            ay + nh > by;

          assert.strictEqual(
            overlaps,
            false,
            `Nodes "${a.id}" (${a.label}) and "${b.id}" (${b.label}) overlap at [${ax},${ay}] vs [${bx},${by}] in ${label}`
          );
        }
      }
    }

    it('Requirement 1 & 5: A pool with no real sub-lanes renders as ONE pool band with a single title and NO duplicate pool/lane labels', () => {
      const spec = {
        pools: [
          {
            name: 'Store',
            steps: [
              { id: 's1', label: 'Take Order', kind: 'task' },
              { id: 's2', label: 'Pack Item', kind: 'task' },
            ],
          },
        ],
      };

      const compiled = compileBpmn(spec);
      // Logical lane = pool name for validation & resource mapping, flagged implicitLane: true
      const logicalLane = compiled.nodes.find((n) => n.type === 'lane');
      assert.ok(logicalLane, 'Logical lane node must exist for validation');
      assert.strictEqual(logicalLane.label, 'Store');
      assert.strictEqual(logicalLane.implicitLane, true);

      const layout = layoutAiDiagram(compiled);
      const poolElements = layout.elements.filter((e) => e.type === 'pool');
      const laneElements = layout.elements.filter((e) => e.type === 'lane');

      // Exactly 1 pool element, 0 lane elements in layout
      assert.strictEqual(poolElements.length, 1);
      assert.strictEqual(poolElements[0].label, 'Store');
      assert.strictEqual(laneElements.length, 0, 'No lane element should be rendered for implicit lane');

      // No duplicate pool/lane labels
      const headers = layout.elements
        .filter((e) => e.type === 'pool' || e.type === 'lane')
        .map((e) => e.label);
      assert.deepStrictEqual(headers, ['Store'], 'Single title for the pool band, no duplicate "Store" label');

      // poolLanes returns [] so DiagramCanvas draws no lane headers
      const canvasLanes = poolLanes(layout.elements, poolElements[0].id);
      assert.strictEqual(canvasLanes.length, 0);

      // No overlapping nodes
      assertNoOverlappingNodes(layout.elements, 'Single Pool Implicit Lane');
    });

    it('Requirement 1 & 5: Draw lane headers only when a pool has 2+ explicit lanes', () => {
      const spec = {
        pools: [
          {
            name: 'Store',
            steps: [
              { id: 's1', label: 'Order Counter', kind: 'task', lane: 'Cashier' },
              { id: 's2', label: 'Prepare Pizza', kind: 'task', lane: 'Kitchen' },
            ],
          },
        ],
      };

      const compiled = compileBpmn(spec);
      const lanes = compiled.nodes.filter((n) => n.type === 'lane');
      assert.strictEqual(lanes.length, 2);
      assert.strictEqual(lanes[0].implicitLane, false);
      assert.strictEqual(lanes[1].implicitLane, false);

      const layout = layoutAiDiagram(compiled);
      const poolElements = layout.elements.filter((e) => e.type === 'pool');
      const laneElements = layout.elements.filter((e) => e.type === 'lane');

      assert.strictEqual(poolElements.length, 1);
      assert.strictEqual(laneElements.length, 2);

      const canvasLanes = poolLanes(layout.elements, poolElements[0].id);
      assert.strictEqual(canvasLanes.length, 2);
      assert.deepStrictEqual(canvasLanes.map((l) => l.label).sort(), ['Cashier', 'Kitchen']);

      // Check no duplicate labels between pool and lanes
      const poolLabels = poolElements.map((p) => p.label);
      const laneLabels = laneElements.map((l) => l.label);
      laneLabels.forEach((l) => {
        assert.ok(!poolLabels.includes(l), `Lane label "${l}" should not duplicate pool label`);
      });

      assertNoOverlappingNodes(layout.elements, 'Explicit Lanes Pool');
    });

    it('Requirement 2: Align all pool widths to the widest pool', () => {
      const spec = {
        pools: [
          {
            name: 'Customer',
            steps: [
              { id: 'c1', label: 'Browse Menu', kind: 'task' },
            ],
          },
          {
            name: 'Kitchen',
            steps: [
              { id: 'k1', label: 'Receive Order', kind: 'wait_for_message' },
              { id: 'k2', label: 'Prep Ingredients', kind: 'task' },
              { id: 'k3', label: 'Bake Pizza', kind: 'task' },
              { id: 'k4', label: 'Slice Pizza', kind: 'task' },
              { id: 'k5', label: 'Box Order', kind: 'send_message' },
            ],
          },
        ],
        handoffs: [{ fromStepId: 'c1', toStepId: 'k1' }],
      };

      const compiled = compileBpmn(spec);
      const layout = layoutAiDiagram(compiled);

      const poolElements = layout.elements.filter((e) => e.type === 'pool');
      assert.strictEqual(poolElements.length, 2);

      const [pool1, pool2] = poolElements;
      assert.ok(pool1.width > 700);
      assert.ok(pool2.width > 700);
      // Crucial check: All pool widths are strictly equal to the widest pool
      assert.strictEqual(
        pool1.width,
        pool2.width,
        `All pool widths must align to the widest pool: pool1(${pool1.width}) vs pool2(${pool2.width})`
      );

      assertNoOverlappingNodes(layout.elements, 'Multi-Pool Width Alignment');
    });

    it('Requirement 3: Name start/end events from spec: "<Role> arrives" / "<Role> leaves", else "Start" / "End", never "Start Customer"', () => {
      // Role actor: Customer
      const custPool = { name: 'Customer', steps: [{ id: 'c1', label: 'Order', kind: 'task' }] };
      assert.strictEqual(getStartEventLabel(custPool), 'Customer arrives');
      assert.strictEqual(getEndEventLabel(custPool), 'Customer leaves');

      // Role actor: Delivery Driver
      const driverPool = { name: 'Delivery Driver', steps: [{ id: 'd1', label: 'Drive', kind: 'task' }] };
      assert.strictEqual(getStartEventLabel(driverPool), 'Delivery Driver arrives');
      assert.strictEqual(getEndEventLabel(driverPool), 'Delivery Driver leaves');

      // Organization / place: Store
      const storePool = { name: 'Store', steps: [{ id: 's1', label: 'Sell', kind: 'task' }] };
      assert.strictEqual(getStartEventLabel(storePool), 'Start');
      assert.strictEqual(getEndEventLabel(storePool), 'End');

      // Guard: Input with "Start Customer" or "End Customer" is sanitized
      const dirtyPool = { name: 'Customer', startEventLabel: 'Start Customer', endEventLabel: 'End Customer' };
      assert.strictEqual(getStartEventLabel(dirtyPool), 'Customer arrives');
      assert.strictEqual(getEndEventLabel(dirtyPool), 'Customer leaves');

      // In compiled diagram:
      const spec = { pools: [custPool, storePool] };
      const compiled = compileBpmn(spec);
      const startCust = compiled.nodes.find((n) => n.id.startsWith('start_customer'));
      const endCust = compiled.nodes.find((n) => n.id.startsWith('end_customer'));
      const startStore = compiled.nodes.find((n) => n.id.startsWith('start_store'));
      const endStore = compiled.nodes.find((n) => n.id.startsWith('end_store'));

      assert.strictEqual(startCust.label, 'Customer arrives');
      assert.notStrictEqual(startCust.label, 'Start Customer');
      assert.strictEqual(endCust.label, 'Customer leaves');
      assert.notStrictEqual(endCust.label, 'End Customer');

      assert.strictEqual(startStore.label, 'Start');
      assert.strictEqual(endStore.label, 'End');
    });

    it('Requirement 4: Message START event (first step wait_for_message) and message END event (last step send_message), intermediate message events stay double-ring', () => {
      const spec = {
        pools: [
          {
            name: 'Customer',
            steps: [
              { id: 'c1', label: 'Order Item', kind: 'task' },
              { id: 'c2', label: 'Send Payment Info', kind: 'send_message' },
              { id: 'c3', label: 'Receive Receipt', kind: 'wait_for_message' },
            ],
          },
          {
            name: 'Store',
            steps: [
              { id: 's1', label: 'Receive Order', kind: 'wait_for_message' },
              { id: 's2', label: 'Wait for Customer Signoff', kind: 'wait_for_message' },
              { id: 's3', label: 'Send Receipt', kind: 'send_message' },
            ],
          },
        ],
        handoffs: [
          { fromStepId: 'c2', toStepId: 's1' },
          { fromStepId: 's3', toStepId: 'c3' },
        ],
      };

      const compiled = compileBpmn(spec);

      // First step of Store is wait_for_message -> message-start-event
      const s1 = compiled.nodes.find((n) => n.id === 's1');
      assert.strictEqual(s1.type, 'message-start-event');

      // Intermediate step wait_for_message -> message-intermediate-catch
      const s2 = compiled.nodes.find((n) => n.id === 's2');
      assert.strictEqual(s2.type, 'message-intermediate-catch');

      // Intermediate step send_message in Customer -> message-intermediate-throw (stays double ring)
      const c2 = compiled.nodes.find((n) => n.id === 'c2');
      assert.strictEqual(c2.type, 'message-intermediate-throw');

      // Last step of Store is send_message -> message-end-event
      const s3 = compiled.nodes.find((n) => n.id === 's3');
      assert.strictEqual(s3.type, 'message-end-event');

      const validation = validateBpmn(compiled);
      assert.deepStrictEqual(validation.errors, []);
    });

    it('Requirement 5: Tests no overlapping nodes across multiple complex topologies', () => {
      // Topology 1: Branch with rejoin: true
      const specBranchRejoin = {
        pools: [
          {
            name: 'Claims',
            steps: [
              { id: 'c1', label: 'Assess Claim', kind: 'task' },
              { id: 'c2_fast', label: 'Fast-Track Processing', kind: 'task' },
              { id: 'c2_std', label: 'Standard Review', kind: 'task' },
              { id: 'c3', label: 'Send Payout', kind: 'task' },
            ],
            branches: [
              {
                afterStepId: 'c1',
                question: 'Claim under $500?',
                options: [
                  { label: 'Yes', probability: 0.7, steps: ['c2_fast'], rejoin: true },
                  { label: 'No', probability: 0.3, steps: ['c2_std'], rejoin: true },
                ],
              },
            ],
          },
        ],
      };
      const compiled1 = compileBpmn(specBranchRejoin);
      const layout1 = layoutAiDiagram(compiled1);
      assertNoOverlappingNodes(layout1.elements, 'Topology 1: Branch Rejoin');

      // Topology 2: Branch with rejoin: false
      const specBranchSplitEnd = {
        pools: [
          {
            name: 'Approvals',
            steps: [
              { id: 'a1', label: 'Review Document', kind: 'task' },
              { id: 'a2_app', label: 'Stamp Approval', kind: 'task' },
              { id: 'a2_rej', label: 'Send Rejection Note', kind: 'task' },
              { id: 'a3', label: 'Archive Record', kind: 'task' },
            ],
            branches: [
              {
                afterStepId: 'a1',
                question: 'Approved?',
                options: [
                  { label: 'Yes', steps: ['a2_app'], rejoin: true },
                  { label: 'No', steps: ['a2_rej'], rejoin: false },
                ],
              },
            ],
          },
        ],
      };
      const compiled2 = compileBpmn(specBranchSplitEnd);
      const layout2 = layoutAiDiagram(compiled2);
      assertNoOverlappingNodes(layout2.elements, 'Topology 2: Branch Split End');

      // Topology 3: 3-Pool Pizza Delivery process
      const pizzaSpec = {
        pools: [
          {
            name: 'Customer',
            steps: [
              { id: 'co', label: 'Place Order', kind: 'task' },
              { id: 'cr', label: 'Receive Pizza', kind: 'task' },
            ],
          },
          {
            name: 'Kitchen',
            steps: [
              { id: 'kw', label: 'Receive Order in Kitchen', kind: 'wait_for_message' },
              { id: 'kp', label: 'Prepare Pizza', kind: 'task' },
              { id: 'kb', label: 'Bake Pizza', kind: 'task' },
              { id: 'ks', label: 'Box Pizza', kind: 'send_message' },
            ],
          },
          {
            name: 'Delivery Driver',
            steps: [
              { id: 'dw', label: 'Wait for Boxed Pizza', kind: 'wait_for_message' },
              { id: 'dd', label: 'Drive to Customer', kind: 'task' },
              { id: 'dh', label: 'Handover Pizza', kind: 'send_message' },
            ],
          },
        ],
        handoffs: [
          { fromStepId: 'co', toStepId: 'kw' },
          { fromStepId: 'ks', toStepId: 'dw' },
          { fromStepId: 'dh', toStepId: 'cr' },
        ],
      };
      const compiled3 = compileBpmn(pizzaSpec);
      const layout3 = layoutAiDiagram(compiled3);
      assertNoOverlappingNodes(layout3.elements, 'Topology 3: Pizza 3-Pool');

      // Also assert all 3 pools in pizzaSpec have identical aligned width
      const pools3 = layout3.elements.filter((e) => e.type === 'pool');
      assert.strictEqual(pools3.length, 3);
      assert.strictEqual(pools3[0].width, pools3[1].width);
      assert.strictEqual(pools3[1].width, pools3[2].width);
    });
  });
});
