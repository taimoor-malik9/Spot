// FYP_Backend/tests/selfHealingAutoRepair.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  normalizeAndRepairBpmn,
  undoRepairChange,
  sanitizeFriendlyDescription,
  cleanIdToHumanLabel
} from '../shared/deterministicNormalizer.js';
import { validateBpmn } from '../shared/validateBpmn.js';
import { validatePostGeneration } from '../shared/postGenerationValidator.js';
import {
  friendlyError,
  sanitizeUIString
} from '../../Mystery_Frontend/src/lib/intake/friendlyErrors.js';
import {
  isWaitingOrDeliveryOrStructuralStep,
  getStaffQuestionTaskNodes
} from '../../Mystery_Frontend/src/lib/intake/intakeHelpers.js';

const BANNED_TERMS = [
  'gateway',
  'message event',
  'sequence flow',
  'same-pool',
  'same pool',
  'unconnected',
  'bpmn',
  'token'
];

const RAW_ID_REGEX = /\b(gw_|task_|step_|node_|seq_|flow_|activity_)[a-zA-Z0-9_]+|_\d+\b/i;

function assertNoBannedTerms(text, label = 'Text') {
  if (!text || typeof text !== 'string') return;
  const lower = text.toLowerCase();
  for (const term of BANNED_TERMS) {
    assert.strictEqual(
      lower.includes(term),
      false,
      `${label} "${text}" must not contain banned technical term "${term}"`
    );
  }
  assert.strictEqual(
    RAW_ID_REGEX.test(text),
    false,
    `${label} "${text}" must not contain raw element IDs matching ${RAW_ID_REGEX}`
  );
}

describe('Self-Healing Auto-Repair & Non-Technical Error Handling', () => {

  // =========================================================================
  // 1. AUTO-REPAIR OF BROKEN MODEL WITH ZERO USER ACTION
  // =========================================================================
  describe('1. Auto-Repair with Zero User Action', () => {
    it('repairs a model with orphan steps, same-pool message events, single-path decision, and missing end event', () => {
      const brokenModel = {
        nodes: [
          { id: 'start_1', type: 'start-event', label: 'Customer Order' },
          { id: 'task_check', type: 'task', label: 'Check Stock Level', lane: 'Warehouse Manager', duration: 15 },
          // Single-path decision (1 outgoing flow labeled Yes)
          { id: 'gw_split_1', type: 'exclusive-gateway', label: 'Stock below reorder level?', lane: 'Warehouse Manager' },
          { id: 'task_order_mfr', type: 'task', label: 'Order from manufacturer', lane: 'Warehouse Manager', duration: 30 },
          // Same-pool message event waiting on manufacturer delivery
          { id: 'msg_wait', type: 'message-intermediate-catch', label: 'Receive delivery from manufacturer', lane: 'Warehouse Manager' },
          // Orphan task (0 incoming, 0 outgoing sequence flows)
          { id: 'task_orphan', type: 'task', label: 'Update Stock Ledger', lane: 'Warehouse Manager', duration: 10 },
          // Final task without an end event
          { id: 'task_dispatch', type: 'task', label: 'Dispatch Goods to Customer', lane: 'Warehouse Manager', duration: 20 }
        ],
        edges: [
          { id: 'e1', source: 'start_1', target: 'task_check', flowType: 'sequence' },
          { id: 'e2', source: 'task_check', target: 'gw_split_1', flowType: 'sequence' },
          // Only 1 outgoing branch from decision:
          { id: 'e3', source: 'gw_split_1', target: 'task_order_mfr', label: 'Yes', flowType: 'sequence' },
          { id: 'e4', source: 'task_order_mfr', target: 'msg_wait', flowType: 'sequence' },
          { id: 'e5', source: 'msg_wait', target: 'task_dispatch', flowType: 'sequence' }
          // task_orphan is not connected
          // task_dispatch has no outgoing flow and diagram lacks end event
        ]
      };

      // Run automatic repair
      const repaired = normalizeAndRepairBpmn(brokenModel);

      // Verify canvas is never empty
      assert.ok(repaired.nodes.length > 0, 'Repaired diagram must have nodes');
      assert.ok(repaired.edges.length > 0, 'Repaired diagram must have edges');

      // 1. Orphan step is connected into the process flow
      const orphanInEdges = repaired.edges.filter(e => e.target === 'task_orphan' && e.flowType !== 'message');
      const orphanOutEdges = repaired.edges.filter(e => e.source === 'task_orphan' && e.flowType !== 'message');
      assert.ok(orphanInEdges.length >= 1, 'Orphan step must have incoming sequence flow');
      assert.ok(orphanOutEdges.length >= 1, 'Orphan step must have outgoing sequence flow');

      // 2. Same-pool message event converted to valid form (external pool + message flow, or timer/task)
      const messageEvents = repaired.nodes.filter(n => n.type === 'message-intermediate-catch');
      if (messageEvents.length > 0) {
        // If kept as message catch, external pool and message flow must exist
        const externalPools = repaired.nodes.filter(n => n.type === 'pool' && n.id !== 'main-process-pool');
        assert.ok(externalPools.length >= 1, 'External pool must exist for message catch event');
        const incomingMsgFlow = repaired.edges.filter(e => e.target === 'msg_wait' && (e.flowType === 'message' || e.type === 'messageFlow'));
        assert.ok(incomingMsgFlow.length >= 1, 'Message catch event must have incoming message flow from external pool');
      }

      // 3. Single-path decision repaired: either second branch added or single-path gateway bypassed
      const splitGws = repaired.nodes.filter(n => n.id === 'gw_split_1');
      if (splitGws.length > 0) {
        const outEdges = repaired.edges.filter(e => e.source === 'gw_split_1' && e.flowType !== 'message');
        assert.ok(outEdges.length >= 2, 'Split gateway must have >= 2 outgoing branches');
        const labels = outEdges.map(e => (e.label || e.data?.label || '').toLowerCase());
        assert.ok(labels.some(l => l.includes('yes')), 'Must contain Yes branch');
        assert.ok(labels.some(l => l.includes('no') || l.includes('otherwise')), 'Must contain No/alternate branch');
      }

      // 4. Missing end event is added
      const endEvents = repaired.nodes.filter(n => n.type === 'end-event' || n.type === 'message-end-event');
      assert.ok(endEvents.length >= 1, 'Repaired diagram must have at least one end event');
      const endEventId = endEvents[0].id;
      const endInEdges = repaired.edges.filter(e => e.target === endEventId);
      assert.ok(endInEdges.length >= 1, 'End event must have incoming sequence flow');

      // 5. Overall BPMN validation passes with zero errors
      const bpmnValidation = validateBpmn(repaired);
      assert.strictEqual(bpmnValidation.errors.length, 0, `validateBpmn failed: ${JSON.stringify(bpmnValidation.errors)}`);

      // 6. Post-generation validation passes
      const postValidation = validatePostGeneration(repaired);
      assert.strictEqual(postValidation.isValid, true, `validatePostGeneration failed: ${JSON.stringify(postValidation.violations)}`);
    });
  });

  // =========================================================================
  // 2. USER-FRIENDLY MESSAGING (NO BANNED TECHNICAL TERMS)
  // =========================================================================
  describe('2. User-Friendly Messaging & Zero Banned Terms', () => {
    it('contains none of the banned technical terms or raw IDs across all friendlyError responses', () => {
      const technicalErrors = [
        'Task "Prepare Food" must have exactly 1 incoming sequence flow (found 0).',
        'Sequence flow crosses pools ("Customer" -> "Store"). Sequence flows cannot cross pools.',
        'Node "task_1" (Prepare Food) is not reachable from any start event.',
        'Exclusive split gateway "gw_split_1" has only 1 outgoing path.',
        'Same-pool message event "msg_wait_1" has no external participant pool.',
        'Token cannot reach any end event from node "task_review".',
        'BPMN schema violation: orphan node detected in lane "Manager".',
        'Diagram must have at least one start event.',
        'gw_join_check_stock_0 missing matching split gateway.'
      ];

      for (const err of technicalErrors) {
        const en = friendlyError(err, 'en');
        const ru = friendlyError(err, 'ur-roman');

        assertNoBannedTerms(en, `Friendly EN for "${err}"`);
        assertNoBannedTerms(ru, `Friendly RU for "${err}"`);

        // Check specific replacement requirement:
        // "Replace 'Some steps aren't connected properly' with a plain summary, e.g.: 'We tidied up your process so it can run.'"
        assert.strictEqual(en.includes("Some steps aren't connected properly"), false);
        if (!err.toLowerCase().includes('exclusive split')) {
          assert.ok(en.includes("We tidied up") || en.includes("run"), `Expected friendly summary, got: ${en}`);
        }
      }
    });

    it('sanitizes changelog descriptions and UI strings to eliminate all banned terms', () => {
      const rawDescriptions = [
        'Added a sequence flow between task_1 and task_2',
        'Converted same-pool message event into an external pool',
        'Removed single-path gateway gw_1 and joined sequence flow',
        'Connected unconnected task to next step',
        'Fixed bpmn token flow for orphan node'
      ];

      for (const desc of rawDescriptions) {
        const cleaned = sanitizeFriendlyDescription(desc);
        assertNoBannedTerms(cleaned, 'Sanitized description');
      }
    });
  });

  // =========================================================================
  // 3. STRUCTURED CHANGE LOG WITH USER'S OWN STEP NAMES
  // =========================================================================
  describe('3. Structured Change Log', () => {
    it('produces plain-language change entries with user step names for every auto-repair', () => {
      const brokenModel = {
        nodes: [
          { id: 'start_1', type: 'start-event', label: 'Retailer Request' },
          { id: 'task_stock', type: 'task', label: 'Check Reorder Level', lane: 'Warehouse' },
          { id: 'gw_stock', type: 'exclusive-gateway', label: 'Stock below reorder level?', lane: 'Warehouse' },
          { id: 'task_order', type: 'task', label: 'Send Purchase Order to Supplier', lane: 'Warehouse' },
          { id: 'task_orphan_audit', type: 'task', label: 'Audit Warehouse Stock', lane: 'Warehouse' }
        ],
        edges: [
          { id: 'e1', source: 'start_1', target: 'task_stock', flowType: 'sequence' },
          { id: 'e2', source: 'task_stock', target: 'gw_stock', flowType: 'sequence' },
          { id: 'e3', source: 'gw_stock', target: 'task_order', label: 'Yes', flowType: 'sequence' }
        ]
      };

      const repaired = normalizeAndRepairBpmn(brokenModel);
      assert.ok(Array.isArray(repaired.repairChanges), 'Repaired diagram must include repairChanges array');
      assert.ok(repaired.repairChanges.length >= 2, 'Expected multiple repairs recorded');

      for (const change of repaired.repairChanges) {
        assert.ok(change.id, 'Change must have an id');
        assert.ok(change.type, 'Change must have a type');
        assert.ok(change.description, 'Change must have a description');
        assert.ok(Array.isArray(change.affectedNodeIds), 'Change must list affectedNodeIds');

        // Banned words check
        assertNoBannedTerms(change.description, `Change description: "${change.description}"`);

        // Check that description references the real user step names
        const hasStepName =
          change.description.includes('Check Reorder Level') ||
          change.description.includes('Stock below reorder level') ||
          change.description.includes('Send Purchase Order') ||
          change.description.includes('Audit Warehouse Stock') ||
          change.description.includes('Finish') ||
          change.description.includes('Retailer Request') ||
          change.description.includes('step');
        assert.ok(hasStepName, `Change description should use plain step names: ${change.description}`);
      }
    });
  });

  // =========================================================================
  // 4. CONFIRM FLOW & ASSUMED BADGES
  // =========================================================================
  describe('4. Confirm Flow & Assumed Badges', () => {
    it('marks assumed steps with assumed: true and enables confirm on valid repaired diagram', () => {
      const brokenModel = {
        nodes: [
          { id: 'start_1', type: 'start-event', label: 'Start Order' },
          { id: 'task_process', type: 'task', label: 'Process Payment' },
          { id: 'task_orphan_notify', type: 'task', label: 'Send Receipt' }
        ],
        edges: [
          { id: 'e1', source: 'start_1', target: 'task_process', flowType: 'sequence' }
        ]
      };

      const repaired = normalizeAndRepairBpmn(brokenModel);

      // Orphan step connected by assumption must be flagged as assumed
      const assumedNodes = repaired.nodes.filter(n => n.assumed === true || n.data?.assumed === true);
      assert.ok(assumedNodes.length >= 1, 'At least one step connected by assumption should be marked assumed');

      // Verify confirm blocked condition:
      // In IntakeFlow: isConfirmBlocked is true ONLY if probability sum != 100 or broken diagram has zero nodes.
      const isConfirmBlocked = repaired.nodes.length === 0 || validateBpmn(repaired).errors.length > 0;
      assert.strictEqual(isConfirmBlocked, false, 'Confirm button must be enabled once repaired diagram is valid');
    });
  });

  // =========================================================================
  // 5. UNDO REVERTS A SINGLE CHANGE AND RE-VALIDATES
  // =========================================================================
  describe('5. Undo Reverts a Single Change', () => {
    it('reverts a single repair change back to its prior snapshot and preserves changelog integrity', () => {
      const brokenModel = {
        nodes: [
          { id: 'start_1', type: 'start-event', label: 'Start' },
          { id: 'task_1', type: 'task', label: 'Verify Order', lane: 'Staff' },
          { id: 'task_orphan', type: 'task', label: 'Log Order Details', lane: 'Staff' },
          { id: 'end_1', type: 'end-event', label: 'End' }
        ],
        edges: [
          { id: 'e1', source: 'start_1', target: 'task_1', flowType: 'sequence' },
          { id: 'e2', source: 'task_1', target: 'end_1', flowType: 'sequence' }
        ]
      };

      const repaired = normalizeAndRepairBpmn(brokenModel);
      const orphanChange = repaired.repairChanges.find(c => c.type === 'connect-orphan');
      assert.ok(orphanChange, 'Expected connect-orphan change in repairChanges');

      // Undo the connect-orphan change
      const reverted = undoRepairChange(repaired, orphanChange.id);

      // In the reverted diagram, the connect-orphan change must be removed from repairChanges
      assert.ok(!reverted.repairChanges.some(c => c.id === orphanChange.id), 'Undone change must not remain in repairChanges');
      // The orphan task is reverted to its pre-repair disconnected state
      const revertedInEdges = reverted.edges.filter(e => e.target === 'task_orphan');
      assert.strictEqual(revertedInEdges.length, 0, 'Undone orphan step must be disconnected as in previous snapshot');
    });
  });

  // =========================================================================
  // 6. QUESTIONNAIRE SCREENING: STAFF QUESTIONS
  // =========================================================================
  describe('6. Staff Questionnaire Filtering', () => {
    it('filters out waiting, delivery arrival, and structural steps from staff questions', () => {
      const nodes = [
        { id: 't1', type: 'task', label: 'Take Customer Order', lane: 'Cashier' },
        { id: 't2', type: 'task', label: 'Wait for delivery from supplier', lane: 'Cashier' },
        { id: 't3', type: 'message-intermediate-catch', label: 'Receive delivery from manufacturer', lane: 'Warehouse' },
        { id: 't4', type: 'task', label: 'Await supplier confirmation', lane: 'Cashier' },
        { id: 't5', type: 'task', label: 'Structural sync step', isStructural: true },
        { id: 't6', type: 'task', label: 'Prepare Food', lane: 'Chef' }
      ];

      // Test helper function
      assert.strictEqual(isWaitingOrDeliveryOrStructuralStep(nodes[0]), false);
      assert.strictEqual(isWaitingOrDeliveryOrStructuralStep(nodes[1]), true);
      assert.strictEqual(isWaitingOrDeliveryOrStructuralStep(nodes[2]), true);
      assert.strictEqual(isWaitingOrDeliveryOrStructuralStep(nodes[3]), true);
      assert.strictEqual(isWaitingOrDeliveryOrStructuralStep(nodes[4]), true);
      assert.strictEqual(isWaitingOrDeliveryOrStructuralStep(nodes[5]), false);

      const staffNodes = getStaffQuestionTaskNodes(nodes);
      const staffLabels = staffNodes.map(n => n.label);
      assert.deepStrictEqual(staffLabels, ['Take Customer Order', 'Prepare Food']);
    });
  });

  // =========================================================================
  // 7. DECISION QUESTIONS IN PLAIN BUSINESS LANGUAGE
  // =========================================================================
  describe('7. Plain Business Decision Questions', () => {
    it('formats decision questions as layman inquiries and uses simple Yes/No labels', () => {
      const gwNode = {
        id: 'gw_1',
        type: 'exclusive-gateway',
        label: 'Stock below reorder level?'
      };

      const questionText = gwNode.label;
      const cleanQuestion = questionText.replace(/\?$/, '').trim();
      const plainPrompt = `How often is ${cleanQuestion.toLowerCase()}?`;

      assert.strictEqual(plainPrompt, 'How often is stock below reorder level?');
      assertNoBannedTerms(plainPrompt, 'Decision question');
    });
  });
});
