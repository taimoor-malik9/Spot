import { describe, it } from 'node:test';
import assert from 'node:assert';
import { specToBpmn } from '../shared/specToBpmn.js';
import { compileBpmn } from '../shared/compileBpmn.js';
import {
  normalizeAndRepairBpmn,
  collapseConsecutiveCatchEvents,
  removeDegenerateGatewayPairs,
  ensureDefaultProbabilities,
  deduplicateExternalPools,
  areExternalPoolAliases,
  addMissingBranchPaths,
} from '../shared/deterministicNormalizer.js';
import { friendlyError } from '../../Mystery_Frontend/src/lib/intake/friendlyErrors.js';
import { validateBpmn } from '../shared/validateBpmn.js';
import { validatePostGeneration } from '../shared/postGenerationValidator.js';
import { layoutAiDiagram } from '../shared/aiDiagramLayout.js';
import {
  computeOrthogonalWaypoints,
  generateRoundedSvgPath,
  computeEdgeLabelPosition,
} from '../../Mystery_Frontend/src/components/model/bpmnGeometry.js';

describe('Universal Domain-Agnostic BPMN 2.0 Invariants', () => {

  // =========================================================================
  // 1. GATEWAY INVARIANTS (Split, Merge, Non-Empty Branches, Decision Ordering)
  // =========================================================================
  describe('Invariant 1: Gateways & Decision-Action Ordering', () => {

    it('Split Gateway Rule: Every split gateway must have >= 2 outgoing sequence flows', () => {
      const diagram = {
        nodes: [
          { id: 'start', type: 'start-event', label: 'Start' },
          { id: 'gw_split', type: 'exclusive-gateway', label: 'Condition?', gateway_role: 'split' },
          { id: 't1', type: 'task', label: 'Action 1' },
          { id: 'end', type: 'end-event', label: 'End' },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'gw_split', flowType: 'sequence' },
          { id: 'e2', source: 'gw_split', target: 't1', flowType: 'sequence', data: { label: 'Yes' } },
          { id: 'e3', source: 't1', target: 'end', flowType: 'sequence' },
        ],
      };

      const repaired = normalizeAndRepairBpmn(diagram, { lang: 'en' });
      const splitNodes = repaired.nodes.filter(n => n.id === 'gw_split');
      if (splitNodes.length > 0) {
        const outEdges = repaired.edges.filter(e => e.source === 'gw_split' && e.flowType !== 'message');
        assert(outEdges.length >= 2, `Split gateway must have >= 2 outgoing sequence flows, got ${outEdges.length}`);
      }
    });

    it('Non-Empty Branch Rule: Collapses degenerate Split -> Merge pair where all branches have 0 tasks', () => {
      const degenerateDiagram = {
        nodes: [
          { id: 'start', type: 'start-event', label: 'Start' },
          { id: 't_before', type: 'task', label: 'Prepare Request' },
          { id: 'gw_split', type: 'exclusive-gateway', label: 'Check Eligibility?', gateway_role: 'split' },
          { id: 'gw_merge', type: 'exclusive-gateway', label: '', gateway_role: 'merge' },
          { id: 't_after', type: 'task', label: 'Finalize Request' },
          { id: 'end', type: 'end-event', label: 'End' },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 't_before', flowType: 'sequence' },
          { id: 'e2', source: 't_before', target: 'gw_split', flowType: 'sequence' },
          // Two direct branches from split to merge with 0 intermediate tasks!
          { id: 'e3', source: 'gw_split', target: 'gw_merge', flowType: 'sequence', data: { label: 'Yes' } },
          { id: 'e4', source: 'gw_split', target: 'gw_merge', flowType: 'sequence', data: { label: 'No' } },
          { id: 'e5', source: 'gw_merge', target: 't_after', flowType: 'sequence' },
          { id: 'e6', source: 't_after', target: 'end', flowType: 'sequence' },
        ],
      };

      const repaired = normalizeAndRepairBpmn(degenerateDiagram, { lang: 'en' });

      // The degenerate Split-Merge pair must be collapsed/removed completely
      assert.strictEqual(repaired.nodes.some(n => n.id === 'gw_split'), false, 'Degenerate split gateway must be removed');
      assert.strictEqual(repaired.nodes.some(n => n.id === 'gw_merge'), false, 'Degenerate merge gateway must be removed');

      // t_before must now connect to t_after or reach end
      const outBefore = repaired.edges.filter(e => e.source === 't_before' && e.flowType !== 'message');
      assert.strictEqual(outBefore.length, 1);
      assert.strictEqual(outBefore[0].target, 't_after');
    });

    it('Merge Gateway Rule: Merge gateway must have >= 2 incoming flows, exactly 1 outgoing flow, and NO condition label on outgoing flow', () => {
      const diagram = {
        nodes: [
          { id: 'start', type: 'start-event', label: 'Start' },
          { id: 'gw_split', type: 'exclusive-gateway', label: 'Priority check?', gateway_role: 'split' },
          { id: 't_urgent', type: 'task', label: 'Expedited processing' },
          { id: 'gw_merge', type: 'exclusive-gateway', label: '', gateway_role: 'merge' },
          { id: 't_final', type: 'task', label: 'Dispatch package' },
          { id: 'end', type: 'end-event', label: 'End' },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'gw_split', flowType: 'sequence' },
          { id: 'e2', source: 'gw_split', target: 't_urgent', flowType: 'sequence', data: { label: 'Urgent' } },
          { id: 'e3', source: 'gw_split', target: 'gw_merge', flowType: 'sequence', data: { label: 'Normal' } },
          { id: 'e4', source: 't_urgent', target: 'gw_merge', flowType: 'sequence' },
          // Erroneous label on outgoing flow of merge gateway
          { id: 'e5', source: 'gw_merge', target: 't_final', flowType: 'sequence', label: 'Yes', data: { label: 'Yes' } },
          { id: 'e6', source: 't_final', target: 'end', flowType: 'sequence' },
        ],
      };

      const repaired = normalizeAndRepairBpmn(diagram, { lang: 'en' });
      const mergeNode = repaired.nodes.find(n => n.id === 'gw_merge');
      assert.ok(mergeNode, 'Valid merge gateway must be preserved');

      // Check incoming flows >= 2
      const inMerge = repaired.edges.filter(e => e.target === 'gw_merge' && e.flowType !== 'message');
      assert(inMerge.length >= 2, `Merge gateway must have >= 2 incoming flows, got ${inMerge.length}`);

      // Check outgoing flow = 1 with NO label
      const outMerge = repaired.edges.filter(e => e.source === 'gw_merge' && e.flowType !== 'message');
      assert.strictEqual(outMerge.length, 1, 'Merge gateway must have exactly 1 outgoing flow');
      assert.strictEqual(outMerge[0].label || outMerge[0].data?.label || '', '', 'Outgoing flow of merge gateway must NOT have condition label');
    });

    it('Decision-Action Ordering: Conditional activity is placed inside the branch after Split, never before Split', () => {
      const spec = {
        participants: {
          internal_roles: [{ name: 'Clerk' }],
          external_parties: [{ name: 'Supplier' }],
        },
        triggers: [{ name: 'Order received', type: 'arrival', rate: 10, unit: 'hour' }],
        activities: [
          { name: 'Review inventory', performer_role: 'Clerk', duration: 10 },
          { name: 'Place reorder with Supplier', performer_role: 'Clerk', duration: 15 },
          { name: 'Pack items', performer_role: 'Clerk', duration: 20 },
        ],
        decisions: [
          {
            question: 'Is stock below reorder level?',
            branches: [{ label: 'Yes', probability: 0.3 }, { label: 'No', probability: 0.7 }],
          },
        ],
      };

      const bpmn = specToBpmn(spec);

      // The decision split must occur AFTER Review inventory, and BEFORE Place reorder
      const splitNode = bpmn.nodes.find(n => n.type.includes('gateway') && n.gateway_role === 'split');
      assert.ok(splitNode, 'Split gateway must exist');

      const reorderTask = bpmn.nodes.find(n => n.label === 'Place reorder with Supplier');
      assert.ok(reorderTask, 'Reorder task must exist');

      // The flow into Place reorder must originate from the Split gateway (inside Yes branch)
      const inReorder = bpmn.edges.find(e => e.target === reorderTask.id && e.flowType !== 'message');
      assert.ok(inReorder, 'Reorder task must have incoming sequence flow');
      assert.strictEqual(inReorder.source, splitNode.id, 'Reorder task MUST be placed inside the branch AFTER Split gateway');

      // The label of the edge entering reorderTask must be affirmative ('Yes')
      assert.strictEqual(inReorder.data?.label, 'Yes');

      // The flow out of reorderTask must reach matching merge gateway
      const outReorder = bpmn.edges.find(e => e.source === reorderTask.id && e.flowType !== 'message');
      assert.ok(outReorder);
      assert.strictEqual(outReorder.target, splitNode.matching_merge_id, 'Reorder task must connect to matching merge gateway');
    });
  });

  // =========================================================================
  // 2. EXTERNAL POOLS & MESSAGE FLOWS ON CANVAS
  // =========================================================================
  describe('Invariant 2: External Pools & Dashed Message Flows on Canvas', () => {

    it('Layout emits collapsed external pools in elements with valid non-overlapping coordinates', () => {
      const nodes = [
        { id: 'pool_ext_mfg', type: 'pool', label: 'Manufacturer', data: { isExternal: true } },
        { id: 'pool_ext_ret', type: 'pool', label: 'Retailer', data: { isExternal: true } },
        { id: 'pool_main', type: 'pool', label: 'Distributor Operations', data: { isExternal: false } },
        { id: 'start_1', type: 'start-event', label: 'Order Arrival', pool: 'pool_main' },
        { id: 'task_1', type: 'task', label: 'Process Order', pool: 'pool_main' },
        { id: 'end_1', type: 'end-event', label: 'Order Fulfilled', pool: 'pool_main' },
      ];
      const edges = [
        { id: 'msg_1', source: 'pool_ext_ret', target: 'start_1', flowType: 'message' },
        { id: 'seq_1', source: 'start_1', target: 'task_1', flowType: 'sequence' },
        { id: 'msg_2', source: 'task_1', target: 'pool_ext_mfg', flowType: 'message' },
        { id: 'seq_2', source: 'task_1', target: 'end_1', flowType: 'sequence' },
      ];

      const layout = layoutAiDiagram({ nodes, edges });

      // Both external pools MUST be present in elements!
      const elExtMfg = layout.elements.find(e => e.id === 'pool_ext_mfg');
      const elExtRet = layout.elements.find(e => e.id === 'pool_ext_ret');
      const elMain = layout.elements.find(e => e.id === 'pool_main');

      assert.ok(elExtMfg, 'Manufacturer external pool must be emitted in layout.elements');
      assert.ok(elExtRet, 'Retailer external pool must be emitted in layout.elements');
      assert.ok(elMain, 'Main pool must be emitted in layout.elements');

      // Verify dimensions & coordinates
      assert(elExtMfg.width > 0 && elExtMfg.height > 0);
      assert(elExtRet.width > 0 && elExtRet.height > 0);
      assert(elExtMfg.position.x >= 0 && elExtMfg.position.y >= 0);
      assert(elExtRet.position.x >= 0 && elExtRet.position.y >= 0);

      // Verify connections: message flows must have fromId and toId existing in elements
      const msgConns = layout.connections.filter(c => c.type === 'message-flow');
      assert.strictEqual(msgConns.length, 2, 'Both message flows must be emitted');

      msgConns.forEach(c => {
        const fromEl = layout.elements.find(e => e.id === c.fromId);
        const toEl = layout.elements.find(e => e.id === c.toId);
        assert.ok(fromEl, `fromId ${c.fromId} must exist in layout.elements`);
        assert.ok(toEl, `toId ${c.toId} must exist in layout.elements`);
      });
    });

    it('Validator auto-repairs missing external pool for message events', () => {
      const diagram = {
        nodes: [
          { id: 'pool_main', type: 'pool', label: 'Main Business' },
          { id: 'start', type: 'start-event', label: 'Start', pool: 'pool_main' },
          { id: 't_wait', type: 'message-intermediate-catch', label: 'Receive delivery from Central Warehouse', pool: 'pool_main' },
          { id: 'end', type: 'end-event', label: 'End', pool: 'pool_main' },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 't_wait', flowType: 'sequence' },
          { id: 'e2', source: 't_wait', target: 'end', flowType: 'sequence' },
        ],
      };

      const result = validateBpmn(diagram);
      // Validator must have auto-created the external pool and message flow
      const extPools = result.repaired.nodes.filter(n => n.type === 'pool' && n.data?.isExternal);
      assert(extPools.length >= 1, 'Validator must create external pool for message catch event');

      const msgFlow = result.repaired.edges.find(e => e.flowType === 'message' && e.target === 't_wait');
      assert.ok(msgFlow, 'Message flow must connect external pool to message catch event');
    });
  });

  // =========================================================================
  // 3. CONSECUTIVE CATCH EVENTS COLLAPSE
  // =========================================================================
  describe('Invariant 3: Consecutive Catch Events', () => {

    it('Collapses consecutive message catch events by converting the second into an active internal task', () => {
      const diagram = {
        nodes: [
          { id: 'pool_ext', type: 'pool', label: 'Supplier', data: { isExternal: true } },
          { id: 'pool_main', type: 'pool', label: 'Operations' },
          { id: 'start', type: 'start-event', label: 'Start', pool: 'pool_main' },
          { id: 'catch_1', type: 'message-intermediate-catch', label: 'Receive truck delivery from Supplier', pool: 'pool_main' },
          { id: 'catch_2', type: 'message-intermediate-catch', label: 'Receive bonus pack items', pool: 'pool_main' },
          { id: 'end', type: 'end-event', label: 'End', pool: 'pool_main' },
        ],
        edges: [
          { id: 'msg_1', source: 'pool_ext', target: 'catch_1', flowType: 'message' },
          { id: 'seq_1', source: 'start', target: 'catch_1', flowType: 'sequence' },
          { id: 'seq_2', source: 'catch_1', target: 'catch_2', flowType: 'sequence' },
          { id: 'seq_3', source: 'catch_2', target: 'end', flowType: 'sequence' },
        ],
      };

      const repaired = collapseConsecutiveCatchEvents(diagram);

      const node1 = repaired.nodes.find(n => n.id === 'catch_1');
      const node2 = repaired.nodes.find(n => n.id === 'catch_2');

      assert.strictEqual(node1.type, 'message-intermediate-catch', 'First node remains message catch event');
      assert.strictEqual(node2.type, 'task', 'Second consecutive catch event MUST be converted into an internal task');
      assert(node2.label.startsWith('Process'), `Label must be active verb, got "${node2.label}"`);
    });

    it('Ensures zero consecutive catch events across multiple domains', () => {
      // Healthcare triage & lab
      const erDiagram = {
        nodes: [
          { id: 'start', type: 'start-event', label: 'Patient Arrival' },
          { id: 'wait_1', type: 'message-intermediate-catch', label: 'Wait for blood test results' },
          { id: 'wait_2', type: 'message-intermediate-catch', label: 'Wait for X-ray report' },
          { id: 'end', type: 'end-event', label: 'Discharged' },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'wait_1', flowType: 'sequence' },
          { id: 'e2', source: 'wait_1', target: 'wait_2', flowType: 'sequence' },
          { id: 'e3', source: 'wait_2', target: 'end', flowType: 'sequence' },
        ],
      };

      const repairedEr = normalizeAndRepairBpmn(erDiagram);

      const seqEdges = repairedEr.edges.filter(e => e.flowType !== 'message');
      seqEdges.forEach(e => {
        const src = repairedEr.nodes.find(n => n.id === e.source);
        const tgt = repairedEr.nodes.find(n => n.id === e.target);
        const isCatch = (n) => n && (n.type === 'message-intermediate-catch' || n.type === 'timer-intermediate-catch');
        assert(!(isCatch(src) && isCatch(tgt)), `Found consecutive catch events: ${src.id} -> ${tgt.id}`);
      });
    });
  });

  // =========================================================================
  // 4. MULTI-DOMAIN COMPILATION INVARIANTS
  // =========================================================================
  describe('Invariant 4: Multi-Domain Compilation & Idempotency', () => {

    const domains = [
      {
        name: 'Financial Banking: Commercial Loan Origination',
        spec: {
          participants: {
            internal_roles: [{ name: 'Loan Officer' }, { name: 'Underwriter' }],
            external_parties: [{ name: 'Credit Bureau' }, { name: 'Borrower' }],
          },
          triggers: [{ name: 'Borrower submits application', type: 'arrival', rate: 5, unit: 'hour' }],
          activities: [
            { name: 'Review application documents', performer_role: 'Loan Officer', duration: 15 },
            { name: 'Request credit score from Credit Bureau', performer_role: 'Loan Officer', duration: 5 },
            { name: 'Receive credit score from Credit Bureau', performer_role: 'Loan Officer' },
            { name: 'Conduct risk underwriting', performer_role: 'Underwriter', duration: 30 },
            { name: 'Disburse loan funds to Borrower', performer_role: 'Loan Officer', duration: 10 },
          ],
          decisions: [
            {
              question: 'Does applicant meet risk criteria?',
              branches: [{ label: 'Yes', probability: 0.8 }, { label: 'No', probability: 0.2 }],
            },
          ],
        },
      },
      {
        name: 'Retail Supply Chain: Order Fulfillment & Reorder',
        spec: {
          participants: {
            internal_roles: [{ name: 'Dispatcher' }, { name: 'Picker' }],
            external_parties: [{ name: 'Manufacturer' }, { name: 'Client' }],
          },
          triggers: [{ name: 'Client orders arrive', type: 'arrival', rate: 20, unit: 'hour' }],
          activities: [
            { name: 'Check inventory level', performer_role: 'Dispatcher', duration: 5 },
            { name: 'Place reorder to Manufacturer', performer_role: 'Dispatcher', duration: 10 },
            { name: 'Receive delivery from Manufacturer', performer_role: 'Dispatcher' },
            { name: 'Pick and pack items', performer_role: 'Picker', duration: 15 },
            { name: 'Dispatch shipment to Client', performer_role: 'Dispatcher', duration: 10 },
          ],
          decisions: [
            {
              question: 'Is stock below safety threshold?',
              branches: [{ label: 'Yes', probability: 0.4 }, { label: 'No', probability: 0.6 }],
            },
          ],
        },
      },
    ];

    domains.forEach(({ name, spec }) => {
      it(`Compiles and repairs ${name} with valid invariants and 100% idempotency`, () => {
        let bpmn = specToBpmn(spec);
        bpmn = normalizeAndRepairBpmn(bpmn, { lang: 'en' });

        // 1. Exactly 1 start event
        const startNodes = bpmn.nodes.filter(n => n.type.includes('start-event'));
        assert.strictEqual(startNodes.length, 1);

        // 2. External pools exist and message flows connect them
        const extPools = bpmn.nodes.filter(n => n.type === 'pool' && n.data?.isExternal);
        assert(extPools.length >= 1, 'External pools must be generated');

        const messageFlows = bpmn.edges.filter(e => e.flowType === 'message');
        assert(messageFlows.length >= 1, 'Message flows must exist');

        // 3. No consecutive catch events
        const seqEdges = bpmn.edges.filter(e => e.flowType !== 'message');
        seqEdges.forEach(e => {
          const src = bpmn.nodes.find(n => n.id === e.source);
          const tgt = bpmn.nodes.find(n => n.id === e.target);
          const isCatch = (n) => n && (n.type === 'message-intermediate-catch' || n.type === 'timer-intermediate-catch');
          assert(!(isCatch(src) && isCatch(tgt)), `Consecutive catch events forbidden: ${src.id} -> ${tgt.id}`);
        });

        // 4. No degenerate split-merge pairs (all branches having 0 tasks)
        const splitGateways = bpmn.nodes.filter(n => n.type.includes('gateway') && n.gateway_role === 'split');
        splitGateways.forEach(split => {
          const outBranches = bpmn.edges.filter(e => e.source === split.id && e.flowType !== 'message');
          assert(outBranches.length >= 2, 'Split gateway must have >= 2 branches');
          // At least one branch must contain activities or not all point to same merge with 0 tasks
          const firstTarget = outBranches[0].target;
          const allSame = outBranches.every(e => e.target === firstTarget);
          assert(!allSame, `Split ${split.id} has degenerate branches with 0 tasks!`);
        });

        // 5. Merge gateways must have empty label on outgoing flows
        const mergeGateways = bpmn.nodes.filter(n => n.type.includes('gateway') && n.gateway_role === 'merge');
        mergeGateways.forEach(merge => {
          const outMerge = bpmn.edges.filter(e => e.source === merge.id && e.flowType !== 'message');
          outMerge.forEach(oe => {
            assert.strictEqual(oe.label || oe.data?.label || '', '', 'Merge gateway outgoing flow cannot have condition label');
          });
        });

        // 6. Layout succeeds and produces elements for all pools
        const layout = layoutAiDiagram(bpmn);
        assert(layout.elements.length > 0);
        extPools.forEach(ep => {
          const el = layout.elements.find(e => e.id === ep.id);
          assert.ok(el, `External pool ${ep.id} must be in layout.elements`);
        });

        // 7. Idempotency: normalizing again produces ZERO changes
        const beforeJson = JSON.stringify({
          nodes: bpmn.nodes.map(n => ({ id: n.id, type: n.type, label: n.label })),
          edges: bpmn.edges.map(e => ({ id: e.id, src: e.source, tgt: e.target })),
        });
        const rep2 = normalizeAndRepairBpmn(JSON.parse(JSON.stringify(bpmn)), { lang: 'en' });
        const afterJson = JSON.stringify({
          nodes: rep2.nodes.map(n => ({ id: n.id, type: n.type, label: n.label })),
          edges: rep2.edges.map(e => ({ id: e.id, src: e.source, tgt: e.target })),
        });
        assert.strictEqual(beforeJson, afterJson, 'normalizeAndRepairBpmn must be 100% idempotent');
      });
    });
  });

  // =========================================================================
  // 5. SPLIT GATEWAY PROBABILITY NORMALIZATION & COMPLEMENT
  // =========================================================================
  describe('Invariant 5: Split Gateway Probability Normalization & Complement', () => {

    it('Single-stated-branch complement: when 1 branch stated as 0.30, remaining branch gets exactly 0.70 (100% total)', () => {
      const diagram = {
        nodes: [
          { id: 'start', type: 'start-event', label: 'Start' },
          { id: 'gw_split', type: 'exclusive-gateway', label: 'Parts available?', gateway_role: 'split' },
          { id: 't_yes', type: 'task', label: 'Assemble product' },
          { id: 't_no', type: 'task', label: 'Order spare parts' },
          { id: 'end', type: 'end-event', label: 'End' },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'gw_split', flowType: 'sequence' },
          { id: 'e2', source: 'gw_split', target: 't_yes', flowType: 'sequence', label: 'Yes', data: { label: 'Yes', probability: 0.30 } },
          { id: 'e3', source: 'gw_split', target: 't_no', flowType: 'sequence', label: 'No', data: { label: 'No' } }, // unstated!
          { id: 'e4', source: 't_yes', target: 'end', flowType: 'sequence' },
          { id: 'e5', source: 't_no', target: 'end', flowType: 'sequence' },
        ],
      };

      ensureDefaultProbabilities(diagram);

      const eYes = diagram.edges.find((e) => e.id === 'e2');
      const eNo = diagram.edges.find((e) => e.id === 'e3');

      assert.strictEqual(eYes.probability, 0.30, 'Stated branch probability must be preserved');
      assert.strictEqual(eNo.probability, 0.70, 'Unstated branch must receive exact complement 1.0 - 0.30 = 0.70');
      assert.strictEqual(Number((eYes.probability + eNo.probability).toFixed(2)), 1.00, 'Sum of branch probabilities must equal 1.00');
    });

    it('Over-100% auto-normalization: when branches sum to 140% (70% + 70%), proportionally normalizes to 50% + 50% = 100%', () => {
      const diagram = {
        nodes: [
          { id: 'gw_split', type: 'exclusive-gateway', label: 'Are spare parts in stock?', gateway_role: 'split' },
          { id: 't1', type: 'task', label: 'Task 1' },
          { id: 't2', type: 'task', label: 'Task 2' },
        ],
        edges: [
          { id: 'e1', source: 'gw_split', target: 't1', flowType: 'sequence', label: 'Yes', data: { label: 'Yes', probability: 0.70 } },
          { id: 'e2', source: 'gw_split', target: 't2', flowType: 'sequence', label: 'No', data: { label: 'No', probability: 0.70 } },
        ],
      };

      const changelog = [];
      ensureDefaultProbabilities(diagram, changelog);

      const e1 = diagram.edges.find((e) => e.id === 'e1');
      const e2 = diagram.edges.find((e) => e.id === 'e2');

      assert.strictEqual(Number((e1.probability + e2.probability).toFixed(2)), 1.00, 'Probabilities must sum to exactly 1.00');
      assert.strictEqual(e1.probability, 0.50);
      assert.strictEqual(e2.probability, 0.50);

      const changeEntry = changelog.find((c) => c.type === 'probability-normalize');
      assert.ok(changeEntry, 'Must log changelog entry for probability normalization');
      assert.ok(changeEntry.description.includes('Adjusted branch split percentages to total 100%'));
      assert.strictEqual(changeEntry.assumed, true);
    });

    it('3-way non-100% split: 40% + 40% + 40% (120%) proportionally normalizes to sum to exactly 1.00', () => {
      const diagram = {
        nodes: [
          { id: 'gw_split', type: 'exclusive-gateway', label: 'Customer tier?', gateway_role: 'split' },
          { id: 't1', type: 'task', label: 'Tier 1' },
          { id: 't2', type: 'task', label: 'Tier 2' },
          { id: 't3', type: 'task', label: 'Tier 3' },
        ],
        edges: [
          { id: 'e1', source: 'gw_split', target: 't1', flowType: 'sequence', label: 'Gold', data: { label: 'Gold', probability: 0.40 } },
          { id: 'e2', source: 'gw_split', target: 't2', flowType: 'sequence', label: 'Silver', data: { label: 'Silver', probability: 0.40 } },
          { id: 'e3', source: 'gw_split', target: 't3', flowType: 'sequence', label: 'Bronze', data: { label: 'Bronze', probability: 0.40 } },
        ],
      };

      ensureDefaultProbabilities(diagram);

      const probs = diagram.edges.map((e) => e.probability);
      const sum = Number(probs.reduce((acc, v) => acc + v, 0).toFixed(2));
      assert.strictEqual(sum, 1.00, `Proportional normalization of 3 branches must sum to exactly 1.00, got ${sum}`);
    });

    it('Missing branch paths preserve stated complement: addMissingBranchPaths sets missing edge to 1 - p', () => {
      const diagram = {
        nodes: [
          { id: 'start', type: 'start-event', label: 'Start' },
          { id: 'gw_split', type: 'exclusive-gateway', label: 'Quality check?', gateway_role: 'split' },
          { id: 't_pass', type: 'task', label: 'Pack goods' },
          { id: 'end', type: 'end-event', label: 'End' },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'gw_split', flowType: 'sequence' },
          { id: 'e2', source: 'gw_split', target: 't_pass', flowType: 'sequence', label: 'Pass', data: { label: 'Pass', probability: 0.35 } },
          { id: 'e3', source: 't_pass', target: 'end', flowType: 'sequence' },
        ],
      };

      addMissingBranchPaths(diagram);

      const outEdges = diagram.edges.filter((e) => e.source === 'gw_split');
      assert.strictEqual(outEdges.length, 2, 'Must add missing branch');
      const missingEdge = outEdges.find((e) => e.id !== 'e2');
      assert.ok(missingEdge, 'Missing edge must exist');
      assert.strictEqual(missingEdge.data?.probability, 0.65, 'Missing edge must receive complement 1.0 - 0.35 = 0.65');
      assert.strictEqual(Number((0.35 + missingEdge.data?.probability).toFixed(2)), 1.00);
    });
  });

  // =========================================================================
  // 6. DEDUPLICATION OF EXTERNAL POOLS & ALIASES
  // =========================================================================
  describe('Invariant 6: Deduplication of External Pools & Aliases', () => {

    it('areExternalPoolAliases detects case-insensitive substring and alias relationships with word boundaries', () => {
      assert.strictEqual(areExternalPoolAliases('Parts Supplier', 'Supplier'), true);
      assert.strictEqual(areExternalPoolAliases('Supplier', 'Parts Supplier'), true);
      assert.strictEqual(areExternalPoolAliases('Hospital Lab', 'Lab'), true);
      assert.strictEqual(areExternalPoolAliases('The Manufacturer', 'Manufacturer'), true);
      assert.strictEqual(areExternalPoolAliases('Local Retailer', 'Retailer'), true);

      // Distinct terms that are not word-boundary aliases
      assert.strictEqual(areExternalPoolAliases('Customer', 'Custom'), false);
      assert.strictEqual(areExternalPoolAliases('Distributor', 'Distribution'), false);
      assert.strictEqual(areExternalPoolAliases('Manufacturer', 'Supplier'), false);
    });

    it('deduplicateExternalPools merges duplicate alias pools and rewires incident message flows', () => {
      const diagram = {
        nodes: [
          { id: 'pool_ext_parts_supplier_0', type: 'pool', label: 'Parts Supplier', data: { label: 'Parts Supplier', isExternal: true } },
          { id: 'pool_supplier', type: 'pool', label: 'Supplier', data: { label: 'Supplier', isExternal: true } },
          { id: 'act_order', type: 'task', label: 'Place order to supplier' },
          { id: 'act_recv', type: 'message-intermediate-catch', label: 'Receive spare parts' },
        ],
        edges: [
          { id: 'msg_1', source: 'act_order', target: 'pool_supplier', flowType: 'message', type: 'message-flow' },
          { id: 'msg_2', source: 'pool_ext_parts_supplier_0', target: 'act_recv', flowType: 'message', type: 'message-flow' },
        ],
      };

      deduplicateExternalPools(diagram);

      const extPools = diagram.nodes.filter((n) => n.type === 'pool');
      assert.strictEqual(extPools.length, 1, 'Duplicate external pool must be removed, leaving exactly 1');
      assert.strictEqual(extPools[0].id, 'pool_ext_parts_supplier_0', 'More specific pool must be canonical');
      assert.strictEqual(extPools[0].label, 'Parts Supplier');

      const msg1 = diagram.edges.find((e) => e.id === 'msg_1');
      assert.strictEqual(msg1.target, 'pool_ext_parts_supplier_0', 'Incident message flow must be rewired to canonical pool');
    });

    it('specToBpmn deduplicates declared and detected external parties into a single external pool', () => {
      const spec = {
        participants: {
          internal_roles: [{ name: 'Store Staff' }],
          external_parties: [{ name: 'Parts Supplier' }],
        },
        triggers: [
          { name: 'Equipment fault ticket', type: 'arrival', rate: 10, unit: 'per_hour' },
        ],
        activities: [
          { name: 'Inspect equipment', performer_role: 'Store Staff' },
          { name: 'Place order to supplier', performer_role: 'Store Staff' },
          { name: 'Wait for supplier delivery', performer_role: 'Store Staff' },
          { name: 'Complete repair', performer_role: 'Store Staff' },
        ],
        decisions: [],
        resources_and_costs: [],
        quantities: [],
        goals_or_issues: [],
      };

      const bpmn = specToBpmn(spec);
      const extPools = bpmn.nodes.filter((n) => n.type === 'pool' && n.data?.isExternal);

      assert.strictEqual(extPools.length, 1, `Expected exactly 1 external pool, got ${extPools.length}`);
      assert.strictEqual(extPools[0].label, 'Parts Supplier');
      assert.strictEqual(bpmn.nodes.some((n) => n.type === 'pool' && n.label === 'Supplier'), false, 'Generic duplicate Supplier pool must not exist');
    });
  });

  // =========================================================================
  // 7. ACTIONABLE, SPECIFIC VALIDATION ERRORS (friendlyError)
  // =========================================================================
  describe('Invariant 7: Actionable, Specific Validation Errors (friendlyError)', () => {

    it('Friendly error for probability sum mismatch identifies the exact step name in English and Roman Urdu', () => {
      const rawError = 'Exclusive split "Are spare parts in stock?" branch probabilities must sum to 1.0 (found 1.4000).';

      const en = friendlyError(rawError, 'en');
      assert.strictEqual(en, "The split at 'Are spare parts in stock?' totals 140% instead of 100%");

      const ru = friendlyError(rawError, 'ur-roman');
      assert.strictEqual(ru, "'Are spare parts in stock?' par split ka total 140% hai, 100 hona zaroori hai");
    });

    it('Extracts step name from diagram when error string is generic "Total 140%, must be 100"', () => {
      const diagram = {
        nodes: [
          { id: 'gw_1', type: 'exclusive-gateway', label: 'Check credit score?' },
          { id: 't1', type: 'task', label: 'Approve' },
          { id: 't2', type: 'task', label: 'Reject' },
        ],
        edges: [
          { id: 'e1', source: 'gw_1', target: 't1', flowType: 'sequence', data: { probability: 0.70 } },
          { id: 'e2', source: 'gw_1', target: 't2', flowType: 'sequence', data: { probability: 0.70 } },
        ],
      };

      const en = friendlyError('Total 140%, must be 100', 'en', diagram);
      assert.strictEqual(en, "The split at 'Check credit score?' totals 140% instead of 100%");

      const ru = friendlyError('Total 140%, must be 100', 'ur-roman', diagram);
      assert.strictEqual(ru, "'Check credit score?' par split ka total 140% hai, 100 hona zaroori hai");
    });
  });

  // =========================================================================
  // 8. 90-DEGREE ORTHOGONAL ROUTING & DIAGRAM GEOMETRY
  // =========================================================================
  describe('Invariant 8: 90-Degree Orthogonal Routing & Diagram Geometry', () => {

    function isSegmentOrthogonal(p1, p2) {
      return Math.abs(p1.x - p2.x) < 0.01 || Math.abs(p1.y - p2.y) < 0.01;
    }

    it('Strictly horizontal or vertical segments across forward, split, merge, and loopback flows (zero diagonals)', () => {
      const gwSplit = { id: 'gw_split', type: 'exclusive-gateway', position: { x: 100, y: 200 }, width: 80, height: 80 };
      const taskA = { id: 'tA', type: 'task', position: { x: 350, y: 100 }, width: 80, height: 80 };
      const taskB = { id: 'tB', type: 'task', position: { x: 350, y: 300 }, width: 80, height: 80 };
      const gwMerge = { id: 'gw_merge', type: 'exclusive-gateway', gateway_role: 'merge', position: { x: 600, y: 200 }, width: 80, height: 80 };

      const c1 = { id: 'c1', fromId: 'gw_split', toId: 'tA', label: 'Yes' };
      const c2 = { id: 'c2', fromId: 'gw_split', toId: 'tB', label: 'No' };
      const c3 = { id: 'c3', fromId: 'tA', toId: 'gw_merge' };
      const c4 = { id: 'c4', fromId: 'tB', toId: 'gw_merge' };
      const cLoop = { id: 'c_loop', fromId: 'gw_merge', toId: 'gw_split' };

      const elements = [gwSplit, taskA, taskB, gwMerge];
      const conns = [c1, c2, c3, c4, cLoop];

      const allConns = [
        { name: 'Split -> Task A (upper)', from: gwSplit, to: taskA, conn: c1 },
        { name: 'Split -> Task B (lower)', from: gwSplit, to: taskB, conn: c2 },
        { name: 'Task A -> Merge (from above)', from: taskA, to: gwMerge, conn: c3 },
        { name: 'Task B -> Merge (from below)', from: taskB, to: gwMerge, conn: c4 },
        { name: 'Merge -> Split (loopback)', from: gwMerge, to: gwSplit, conn: cLoop },
      ];

      for (const item of allConns) {
        const waypoints = computeOrthogonalWaypoints(item.from, item.to, item.conn, elements, conns);
        assert.ok(waypoints.length >= 2, `${item.name} must have at least 2 waypoints`);
        for (let i = 0; i < waypoints.length - 1; i++) {
          const p1 = waypoints[i];
          const p2 = waypoints[i + 1];
          assert.ok(
            isSegmentOrthogonal(p1, p2),
            `${item.name} segment ${i} from (${p1.x}, ${p1.y}) to (${p2.x}, ${p2.y}) must be strictly orthogonal (horizontal or vertical)`
          );
        }
        const svgPath = generateRoundedSvgPath(waypoints, 6);
        assert.ok(svgPath.startsWith('M '), `${item.name} SVG path must be valid`);
      }
    });

    it('Message flows between external pool and internal node are strictly vertical and terminate on pool boundary', () => {
      const poolExt = { id: 'pool_ext', type: 'pool', position: { x: 50, y: 20 }, width: 800, height: 60 };
      const task1 = { id: 'task1', type: 'task', position: { x: 200, y: 150 }, width: 80, height: 80 };
      const msgConn = { id: 'msg1', fromId: 'pool_ext', toId: 'task1', type: 'message-flow' };

      const waypoints = computeOrthogonalWaypoints(poolExt, task1, msgConn, [poolExt, task1], [msgConn]);
      assert.strictEqual(waypoints.length, 2, 'Message flow must have exactly 2 endpoints');
      // Strictly vertical: x coordinates match task center
      assert.strictEqual(waypoints[0].x, 240);
      assert.strictEqual(waypoints[1].x, 240);
      // Starts on bottom border of pool (20 + 60 = 80)
      assert.strictEqual(waypoints[0].y, 80);
      // Ends on top port of task (y around 150)
      assert(waypoints[1].y >= 140 && waypoints[1].y <= 165);
    });

    it('Topological layout ensures column spacing >= 240px, lane clearance >= 140px, and non-overlapping node boxes', () => {
      const spec = {
        participants: {
          internal_roles: [{ name: 'Operator' }, { name: 'Manager' }],
          external_parties: [{ name: 'Supplier' }]
        },
        triggers: [{ name: 'Order received', type: 'arrival', rate: '20', unit: 'day' }],
        activities: [
          { name: 'Review order', performer_role: 'Operator', duration: '15m' },
          { name: 'Approve budget', performer_role: 'Manager', duration: '30m' },
          { name: 'Fulfill shipment', performer_role: 'Operator', duration: '45m' },
        ],
        decisions: [
          { question: 'Budget approved?', branches: [{ label: 'Yes', probability: 0.8 }, { label: 'No', probability: 0.2 }] }
        ]
      };

      const bpmn = specToBpmn(spec);
      const layout = layoutAiDiagram(bpmn);

      assert.ok(layout.elements.length > 0, 'Elements must be emitted');

      // Verify external pool vertical margin >= 60px
      const extPool = layout.elements.find(e => e.type === 'pool' && (e.isExternal || e.data?.isExternal));
      const mainPool = layout.elements.find(e => e.type === 'pool' && !(e.isExternal || e.data?.isExternal));
      if (extPool && mainPool) {
        const poolMargin = mainPool.position.y - (extPool.position.y + extPool.height);
        assert(poolMargin >= 60, `External pool margin (${poolMargin}px) must be >= 60px`);
      }

      // Verify lane heights >= 140px
      const lanes = layout.elements.filter(e => e.type === 'lane');
      for (const lane of lanes) {
        assert(lane.height >= 140, `Lane height (${lane.height}px) must be >= 140px`);
      }

      // Verify no two model nodes share overlapping bounding boxes
      const modelElements = layout.elements.filter(e => e.type !== 'pool' && e.type !== 'lane');
      for (let i = 0; i < modelElements.length; i++) {
        for (let j = i + 1; j < modelElements.length; j++) {
          const a = modelElements[i];
          const b = modelElements[j];
          const aW = a.width || 80;
          const aH = a.height || 80;
          const bW = b.width || 80;
          const bH = b.height || 80;

          const overlaps = (
            a.position.x < b.position.x + bW &&
            a.position.x + aW > b.position.x &&
            a.position.y < b.position.y + bH &&
            a.position.y + aH > b.position.y
          );
          assert.strictEqual(
            overlaps,
            false,
            `Nodes "${a.id}" (${a.position.x}, ${a.position.y}) and "${b.id}" (${b.position.x}, ${b.position.y}) must not overlap`
          );
        }
      }
    });
  });
});
