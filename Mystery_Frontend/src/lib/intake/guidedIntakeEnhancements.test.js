import { describe, it } from 'node:test';
import assert from 'node:assert';
import { detectLanguage, t, formatDurationHint, validateCustomRange } from './i18n.js';
import {
  friendlyError,
  ensureDefaultBranchProbabilities,
  findHiddenStructuralIssues,
} from './friendlyErrors.js';
import { extractOrderedSteps } from './stepListHelper.js';
import { applyIntakeToRawDiagram } from './applyIntake.js';
import { validateDurationRules } from '../durationRules.js';
import { validateBpmn } from './validateBpmn.js';

describe('Guided Intake: Language Detection & i18n', () => {
  it('detects Roman Urdu process descriptions', () => {
    const text1 = 'Customer ata hai counter pe order deta hai aur payment karta hai, phir barista chai banata hai, customer parcel le jata hai.';
    assert.strictEqual(detectLanguage(text1), 'ur-roman');

    const text2 = 'Quality check karna aur saman pack karna';
    assert.strictEqual(detectLanguage(text2), 'ur-roman');

    const text3 = 'Customer ya to restaurant mein khata hai ya parcel le jata hai.';
    assert.strictEqual(detectLanguage(text3), 'ur-roman');
  });

  it('detects English process descriptions', () => {
    const text1 = 'Customer arrives at counter, places order, barista brews coffee, customer picks up drink.';
    assert.strictEqual(detectLanguage(text1), 'en');

    const text2 = 'Customer orders and pays at counter, barista prepares espresso drink.';
    assert.strictEqual(detectLanguage(text2), 'en');
  });

  it('detects Urdu script descriptions', () => {
    const text = 'کسٹمر آرڈر دیتا ہے اور ادائیگی کرتا ہے';
    assert.strictEqual(detectLanguage(text), 'ur');
  });

  it('translates static UI strings for ur-roman with fallback to English', () => {
    assert.strictEqual(t('confirm', 'ur-roman'), 'Confirm');
    assert.strictEqual(t('whatShouldChange', 'ur-roman'), 'Kya tabdeeli karni hai?');
    assert.strictEqual(t('startOver', 'ur-roman'), 'Nayi description ke sath dobara shuru karein');
    assert.strictEqual(t('showProcessBtn', 'ur-roman'), 'Mera process dikhayein');
    assert.strictEqual(t('processNeedsAdjustment', 'ur-roman'), 'Chalane se pehle ek cheez batani baqi hai');
    assert.strictEqual(t('confirmBlockedErrors', 'ur-roman'), 'Confirm (pehle upar wala sawal bharein)');
    assert.strictEqual(t('fixForMe', 'ur-roman'), 'Mere liye theek karo');

    // Fallback to English for unknown key or English language
    assert.strictEqual(t('confirm', 'en'), 'Confirm');
    assert.strictEqual(t('whatShouldChange', 'en'), 'What should change?');
    assert.strictEqual(t('confirmBlockedErrors', 'en'), 'Confirm (answer the question above first)');
    assert.strictEqual(t('fixForMe', 'en'), 'Fix for me');
  });
});

describe('Guided Intake: Plain-Language Validation Messages (friendlyError)', () => {
  it('converts missing branch probabilities to layman question using branch labels', () => {
    const diagram = {
      nodes: [
        { id: 'gw_1', type: 'exclusive-gateway', data: { label: 'Order Type??' } },
      ],
      edges: [
        { id: 'e1', source: 'gw_1', target: 't1', label: 'dine in' },
        { id: 'e2', source: 'gw_1', target: 't2', label: 'take away' },
      ],
    };

    const err = 'Exclusive split "Order Type??": How often does each path happen?';

    // English
    const enMsg = friendlyError(err, 'en', diagram);
    assert.strictEqual(
      enMsg,
      'Customers either dine in or take away. Roughly what % choose each? (e.g. 60% / 40%)'
    );

    // Roman Urdu
    const ruMsg = friendlyError(err, 'ur-roman', diagram);
    assert.strictEqual(
      ruMsg,
      'Customer ya to dine in ya take away. Kitne % log kaunsa lete hain? (jaise 60% / 40%)'
    );
  });

  it('converts structural BPMN errors into friendly sentences without jargon', () => {
    const rawErrors = [
      'Task "Prepare Food" must have exactly 1 incoming sequence flow (found 0).',
      'Sequence flow crosses pools ("Customer" -> "Store"). Sequence flows cannot cross pools.',
      'Node "task_1" is not reachable from any start event.',
      'Diagram must have at least one start event.',
    ];

    rawErrors.forEach((rawErr) => {
      const en = friendlyError(rawErr, 'en');
      assert.strictEqual(en, "Some steps aren't connected properly.");
      assert.ok(!en.includes('sequence flow'));
      assert.ok(!en.includes('pool'));
      assert.ok(!en.includes('BPMN'));

      const ru = friendlyError(rawErr, 'ur-roman');
      assert.strictEqual(ru, 'Kuch steps aapas mein jurre nahi hain.');
      assert.ok(!ru.includes('gateway'));
      assert.ok(!ru.includes('flow'));
    });
  });

  it('handles unresolved gateway object directly', () => {
    const unresolved = {
      type: 'unresolved-gateway',
      gatewayId: 'gw_1',
      branches: [
        { label: 'restaurant mein khata hai' },
        { label: 'parcel le jata hai' },
      ],
    };

    const ruMsg = friendlyError(unresolved, 'ur-roman');
    assert.strictEqual(
      ruMsg,
      'Customer ya to restaurant mein khata hai ya parcel le jata hai. Kitne % log kaunsa lete hain? (jaise 60% / 40%)'
    );
  });
});

describe('Guided Intake: Step List Order and Labels', () => {
  it('lists cards in flow order with decision branches grouped and Prepare Food in correct order (not last)', () => {
    // Process:
    // Start -> Order Food -> Decision [Order Type??]
    //   Branch 1: Dine in -> Find Table
    //   Branch 2: Take away -> Wait at Counter
    // Both join at Rejoin gateway -> Prepare Food -> Customer picks up food -> End
    const diagram = {
      nodes: [
        { id: 'start_1', type: 'start-event', label: 'Start' },
        { id: 'task_order', type: 'task', label: 'Order Food', lane: 'Customer' },
        { id: 'gw_split', type: 'exclusive-gateway', label: 'Order Type??', data: { label: 'Order Type??' } },
        { id: 'task_table', type: 'task', label: 'Find Table', lane: 'Customer' },
        { id: 'task_counter', type: 'task', label: 'Wait at Counter', lane: 'Customer' },
        { id: 'gw_join', type: 'exclusive-gateway', label: 'Rejoin', data: { label: 'Rejoin' } },
        { id: 'task_prepare', type: 'task', label: 'Prepare Food', lane: 'Kitchen' },
        { id: 'task_pickup', type: 'task', label: 'Pick up Food', lane: 'Customer' },
        { id: 'end_1', type: 'end-event', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'task_order' },
        { id: 'e2', source: 'task_order', target: 'gw_split' },
        { id: 'e3', source: 'gw_split', target: 'task_table', label: 'Dine in' },
        { id: 'e4', source: 'gw_split', target: 'task_counter', label: 'Take away' },
        { id: 'e5', source: 'task_table', target: 'gw_join' },
        { id: 'e6', source: 'task_counter', target: 'gw_join' },
        { id: 'e7', source: 'gw_join', target: 'task_prepare' },
        { id: 'e8', source: 'task_prepare', target: 'task_pickup' },
        { id: 'e9', source: 'task_pickup', target: 'end_1' },
      ],
    };

    const steps = extractOrderedSteps(diagram);
    const labels = steps.map((s) => s.label);

    // Verify Prepare Food is NOT last!
    assert.strictEqual(labels[0], 'Order Food');
    // Branches grouped under decision
    assert.strictEqual(labels[1], 'Find Table');
    assert.strictEqual(labels[2], 'Wait at Counter');
    // Prepare Food follows the join
    assert.strictEqual(labels[3], 'Prepare Food');
    assert.strictEqual(labels[4], 'Pick up Food');
    assert.strictEqual(labels[labels.length - 1], 'Pick up Food');

    // Verify double question marks are stripped
    assert.ok(steps[1].branchCondition.includes('Order Type? Dine in'));
    assert.ok(!steps[1].branchCondition.includes('??'));
    assert.ok(steps[2].branchCondition.includes('Order Type? Take away'));
    assert.ok(!steps[2].branchCondition.includes('??'));

    // Verify "Rejoin" is replaced with plain continuation and never mentions "Rejoin"
    const prepareStep = steps.find((s) => s.id === 'task_prepare');
    assert.ok(prepareStep.branchCondition.includes('Both paths continue here'));
    assert.ok(!prepareStep.branchCondition.toLowerCase().includes('rejoin'));
  });

  it('renders Roman Urdu continuation label when lang is ur-roman', () => {
    const diagram = {
      nodes: [
        { id: 'start_1', type: 'start-event', label: 'Start' },
        { id: 'gw_split', type: 'exclusive-gateway', label: 'Order Type', data: { label: 'Order Type' } },
        { id: 't1', type: 'task', label: 'Dine in task' },
        { id: 't2', type: 'task', label: 'Take away task' },
        { id: 'gw_join', type: 'exclusive-gateway', label: 'Rejoin' },
        { id: 't3', type: 'task', label: 'Prepare Food' },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'gw_split' },
        { id: 'e2', source: 'gw_split', target: 't1', label: 'Dine in' },
        { id: 'e3', source: 'gw_split', target: 't2', label: 'Take away' },
        { id: 'e4', source: 't1', target: 'gw_join' },
        { id: 'e5', source: 't2', target: 'gw_join' },
        { id: 'e6', source: 'gw_join', target: 't3' },
      ],
    };

    const steps = extractOrderedSteps(diagram, { lang: 'ur-roman' });
    const postJoinStep = steps.find((s) => s.id === 't3');
    assert.strictEqual(postJoinStep.branchCondition, 'Dono raaste yahan milte hain');
  });
});

describe('Guided Intake: Custom Duration Editing (Step 2)', () => {
  it('validates custom duration ranges with plain-language errors', () => {
    // min <= 0
    assert.strictEqual(
      validateCustomRange(0, 10, 'en'),
      'Minimum time must be greater than 0.'
    );
    assert.strictEqual(
      validateCustomRange(0, 10, 'ur-roman'),
      'Kam se kam waqt 0 se bara hona chahiye.'
    );
    assert.strictEqual(
      validateCustomRange('', 10, 'en'),
      'Minimum time must be greater than 0.'
    );

    // max < min
    assert.strictEqual(
      validateCustomRange(10, 5, 'en'),
      'Maximum time cannot be less than minimum.'
    );
    assert.strictEqual(
      validateCustomRange(10, 5, 'ur-roman'),
      'Zyada se zyada waqt kam se kam waqt se kam nahi ho sakta.'
    );

    // Valid range
    assert.strictEqual(validateCustomRange(10, 15, 'en'), null);
    assert.strictEqual(validateCustomRange(10, 15, 'ur-roman'), null);

    // Fixed duration (min == max) is valid
    assert.strictEqual(validateCustomRange(10, 10, 'en'), null);
    assert.strictEqual(validateCustomRange(10, 10, 'ur-roman'), null);
  });

  it('formats plain-language hints for range and fixed durations', () => {
    // Range (min < max)
    assert.strictEqual(
      formatDurationHint(10, 15, 'minutes', 'en'),
      'Usually takes between 10 and 15 minutes.'
    );
    assert.strictEqual(
      formatDurationHint(10, 15, 'minutes', 'ur-roman'),
      'Taqreeban 10 se 15 minute lagte hain.'
    );

    // Fixed (min == max)
    assert.strictEqual(
      formatDurationHint(10, 10, 'minutes', 'en'),
      'Usually takes 10 minutes.'
    );
    assert.strictEqual(
      formatDurationHint(10, 10, 'minutes', 'ur-roman'),
      'Taqreeban 10 minute lagte hain.'
    );

    // Custom units (seconds, hours)
    assert.strictEqual(
      formatDurationHint(30, 45, 'seconds', 'en'),
      'Usually takes between 30 and 45 seconds.'
    );
    assert.strictEqual(
      formatDurationHint(1, 2, 'hours', 'en'),
      'Usually takes between 1 and 2 hours.'
    );
    assert.strictEqual(
      formatDurationHint(1, 2, 'hours', 'ur-roman'),
      'Taqreeban 1 se 2 ghante lagte hain.'
    );
  });

  it('saves custom duration into model with source: custom and stated duration_source', () => {
    const raw = {
      nodes: [
        { id: 'start_1', type: 'start-event' },
        { id: 't1', type: 'task', label: 'Bake Pizza', origin: 'stated' },
        { id: 'end_1', type: 'end-event' },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 't1' },
        { id: 'e2', source: 't1', target: 'end_1' },
      ],
    };

    const answers = {
      steps: {
        t1: {
          speed: { value: 'custom', source: 'typed', estimated: false },
          duration_min: 10,
          duration_max: 15,
          duration_unit: 'minutes',
          source: 'custom',
        },
      },
    };

    const { patched } = applyIntakeToRawDiagram(raw, answers);
    const node = patched.nodes.find((n) => n.id === 't1');

    assert.strictEqual(node.data.duration_min, 10);
    assert.strictEqual(node.data.duration_max, 15);
    assert.strictEqual(node.data.duration, 13); // round((10+15)/2)
    assert.strictEqual(node.data.duration_unit, 'minutes');
    assert.strictEqual(node.data.duration_source, 'stated');
    assert.strictEqual(node.data.source, 'custom');
    assert.strictEqual(node.data.estimated, false);

    // Also verify root node properties
    assert.strictEqual(node.duration_min, 10);
    assert.strictEqual(node.duration_max, 15);
    assert.strictEqual(node.source, 'custom');
  });

  it('treats min == max as fixed duration in model', () => {
    const raw = {
      nodes: [
        { id: 'start_1', type: 'start-event' },
        { id: 't1', type: 'task', label: 'Scan Ticket', origin: 'stated' },
        { id: 'end_1', type: 'end-event' },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 't1' },
        { id: 'e2', source: 't1', target: 'end_1' },
      ],
    };

    const answers = {
      steps: {
        t1: {
          speed: { value: 'custom', source: 'typed', estimated: false },
          duration_min: 5,
          duration_max: 5,
          duration_unit: 'seconds',
          source: 'custom',
        },
      },
    };

    const { patched } = applyIntakeToRawDiagram(raw, answers);
    const node = patched.nodes.find((n) => n.id === 't1');

    assert.strictEqual(node.data.duration_min, 5);
    assert.strictEqual(node.data.duration_max, 5);
    assert.strictEqual(node.data.duration, 5); // fixed duration
    assert.strictEqual(node.data.duration_unit, 'seconds');
    assert.strictEqual(node.data.source, 'custom');
  });

  it('preserves source: bucket for standard buckets and source: estimated for Not sure', () => {
    const raw = {
      nodes: [
        { id: 'start_1', type: 'start-event' },
        { id: 't1', type: 'task', label: 'Quick Step', origin: 'stated' },
        { id: 't2', type: 'task', label: 'Unsure Step', origin: 'stated' },
        { id: 'end_1', type: 'end-event' },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 't1' },
        { id: 'e2', source: 't1', target: 't2' },
        { id: 'e3', source: 't2', target: 'end_1' },
      ],
    };

    const answers = {
      steps: {
        t1: {
          speed: { value: 'quick', source: 'tap', estimated: false },
          source: 'bucket',
        },
        t2: {
          speed: { value: 'normal', source: 'tap', estimated: true },
          source: 'estimated',
        },
      },
    };

    const { patched } = applyIntakeToRawDiagram(raw, answers);
    const node1 = patched.nodes.find((n) => n.id === 't1');
    const node2 = patched.nodes.find((n) => n.id === 't2');

    assert.strictEqual(node1.data.source, 'bucket');
    assert.strictEqual(node1.data.duration_source, 'stated');
    assert.strictEqual(node1.data.duration_min, 1);
    assert.strictEqual(node1.data.duration_max, 2);

    assert.strictEqual(node2.data.source, 'estimated');
    assert.strictEqual(node2.data.duration_source, 'assumed');
    assert.strictEqual(node2.data.estimated, true);
  });

  it('keeps duration rules intact: stated task with no duration errors while structural task is exempt', () => {
    // Task with no duration
    const userNodes = [
      { id: 't1', type: 'task', label: 'No Duration Task', origin: 'stated', data: {} },
    ];
    const userValidation = validateDurationRules(userNodes);
    assert.strictEqual(userValidation.errors.length, 1);
    assert.ok(userValidation.errors[0].message.includes('needs a duration'));

    // Structural BPMN-repair task with zero duration is exempt
    const structuralNodes = [
      { id: 't_repair', type: 'task', label: 'Repair Task', origin: 'structural', data: { duration: 0 } },
    ];
    const structuralValidation = validateDurationRules(structuralNodes);
    assert.strictEqual(structuralValidation.errors.length, 0);
  });
});

describe('Guided Intake: Confirm Button & Branch Probability Validation', () => {
  it('prefills missing branch probabilities with valid 50/50 estimated defaults so Confirm is enabled and error card is gone', () => {
    const raw = {
      nodes: [
        { id: 'start_1', type: 'start-event', label: 'Start' },
        { id: 'task_order', type: 'task', label: 'Order Food', lane: 'Customer' },
        { id: 'gw_split', type: 'exclusive-gateway', label: 'Order Type?', data: { label: 'Order Type?' } },
        { id: 'task_dine', type: 'task', label: 'Dine in', lane: 'Customer' },
        { id: 'task_take', type: 'task', label: 'Take away', lane: 'Customer' },
        { id: 'end_1', type: 'end-event', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'task_order' },
        { id: 'e2', source: 'task_order', target: 'gw_split' },
        { id: 'e3', source: 'gw_split', target: 'task_dine', label: 'Dine in' }, // missing probability
        { id: 'e4', source: 'gw_split', target: 'task_take', label: 'Take away' }, // missing probability
        { id: 'e5', source: 'task_dine', target: 'end_1' },
        { id: 'e6', source: 'task_take', target: 'end_1' },
      ],
    };

    // Before: validateBpmn flags missing probabilities
    const beforeValidation = validateBpmn(raw);
    assert.ok(beforeValidation.unresolvedGateways?.length > 0 || beforeValidation.errors?.some((e) => e.includes('How often')));

    // Apply ensureDefaultBranchProbabilities
    const prefilled = ensureDefaultBranchProbabilities(raw);
    const edgeDine = prefilled.edges.find((e) => e.id === 'e3');
    const edgeTake = prefilled.edges.find((e) => e.id === 'e4');

    // Values are 50/50 and flagged estimated
    assert.strictEqual(edgeDine.probability, 0.5);
    assert.strictEqual(edgeDine.data.probabilityEstimated, true);
    assert.strictEqual(edgeTake.probability, 0.5);
    assert.strictEqual(edgeTake.data.probabilityEstimated, true);

    // After: validateBpmn has ZERO probability errors, enabling Confirm immediately
    const afterValidation = validateBpmn(prefilled);
    const probErrors = afterValidation.errors.filter((e) => e.includes('probability') || e.includes('How often'));
    assert.strictEqual(probErrors.length, 0);
  });

  it('entering 70/40 flags Total 110%, must be 100 and keeps Confirm disabled with that reason', () => {
    const raw = {
      nodes: [
        { id: 'start_1', type: 'start-event', label: 'Start' },
        { id: 'task_order', type: 'task', label: 'Order Food', lane: 'Customer' },
        { id: 'gw_split', type: 'exclusive-gateway', label: 'Order Type?', data: { label: 'Order Type?' } },
        { id: 'task_dine', type: 'task', label: 'Dine in', lane: 'Customer' },
        { id: 'task_take', type: 'task', label: 'Take away', lane: 'Customer' },
        { id: 'end_1', type: 'end-event', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'task_order' },
        { id: 'e2', source: 'task_order', target: 'gw_split' },
        { id: 'e3', source: 'gw_split', target: 'task_dine', label: 'Dine in', probability: 0.7, data: { probability: 0.7 } },
        { id: 'e4', source: 'gw_split', target: 'task_take', label: 'Take away', probability: 0.4, data: { probability: 0.4 } }, // 0.7 + 0.4 = 1.10 = 110%
        { id: 'e5', source: 'task_dine', target: 'end_1' },
        { id: 'e6', source: 'task_take', target: 'end_1' },
      ],
    };

    const val = validateBpmn(raw);
    assert.ok(val.errors.some((e) => e.includes('branch probabilities must sum to 1.0')));

    const rawError = val.errors.find((e) => e.includes('branch probabilities must sum to 1.0'));
    const friendlyEn = friendlyError(rawError, 'en');
    assert.strictEqual(friendlyEn, 'Total 110%, must be 100');

    const friendlyRu = friendlyError(rawError, 'ur-roman');
    assert.strictEqual(friendlyRu, 'Total 110%, 100 hona zaroori hai');

    // Button disabled label
    const btnLabelEn = `Confirm (${friendlyEn})`;
    assert.strictEqual(btnLabelEn, 'Confirm (Total 110%, must be 100)');
    const btnLabelRu = `Confirm (${friendlyRu})`;
    assert.strictEqual(btnLabelRu, 'Confirm (Total 110%, 100 hona zaroori hai)');
  });

  it('detects hidden structural error: failed quality check ending at End Event and provides friendly message', () => {
    const raw = {
      nodes: [
        { id: 'start_1', type: 'start-event', label: 'Start' },
        { id: 'task_prep', type: 'task', label: 'Khana banana', lane: 'Kitchen' },
        { id: 'gw_qc', type: 'exclusive-gateway', label: 'Quality check pass?', data: { label: 'Quality check pass?' } },
        { id: 'task_serve', type: 'task', label: 'Khana serve karna', lane: 'Waiter' },
        { id: 'end_fail', type: 'end-event', label: 'Failed End' },
        { id: 'end_success', type: 'end-event', label: 'Success End' },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'task_prep' },
        { id: 'e2', source: 'task_prep', target: 'gw_qc' },
        { id: 'e3', source: 'gw_qc', target: 'task_serve', label: 'Pass', probability: 0.9, data: { probability: 0.9 } },
        { id: 'e4', source: 'gw_qc', target: 'end_fail', label: 'Fail / Kharab', probability: 0.1, data: { probability: 0.1 } }, // ends at end event!
        { id: 'e5', source: 'task_serve', target: 'end_success' },
      ],
    };

    const issues = findHiddenStructuralIssues(raw);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].type, 'quality-check-dead-end');
    assert.strictEqual(issues[0].loopBackTargetId, 'task_prep');
    assert.strictEqual(
      issues[0].messageEn,
      'The failed quality check ends the process instead of looping back to try again.'
    );
    assert.strictEqual(
      issues[0].messageRu,
      'Quality check fail hone par process khatam ho raha hai jabke dobara theek karne ke liye wapas jana chahiye.'
    );
  });
});

describe('Guided Intake: Next-Step CTA & Restaurant Flow Ordering', () => {
  it('sorts restaurant process in diagram flow order: Khana banana (Chef) appears before Khana serve karna and before payment', () => {
    // Process:
    // Customer: Start -> Order place karna -> Dine in or Take away split
    //   Branch 1: Dine in -> Table dhoondna
    //   Branch 2: Take away -> Counter par intezar
    // Both join at merge task -> Khana banana (Chef) -> Khana serve karna -> Khana khana -> Bill pay karna -> Customer leaves
    const diagram = {
      nodes: [
        { id: 'start_cust', type: 'start-event', label: 'Start', lane: 'Customer' },
        { id: 't_order', type: 'task', label: 'Order place karna', lane: 'Customer' },
        { id: 'gw_split', type: 'exclusive-gateway', label: 'Order Type?', data: { label: 'Order Type?' } },
        { id: 't_dine', type: 'task', label: 'Table dhoondna', lane: 'Customer' },
        { id: 't_take', type: 'task', label: 'Counter par intezar', lane: 'Customer' },
        { id: 'gw_join', type: 'exclusive-gateway', label: 'Rejoin', data: { label: 'Rejoin' } },
        { id: 't_cook', type: 'task', label: 'Khana banana', lane: 'Chef' },
        { id: 't_serve', type: 'task', label: 'Khana serve karna', lane: 'Waiter' },
        { id: 't_eat', type: 'task', label: 'Khana khana', lane: 'Customer' },
        { id: 't_pay', type: 'task', label: 'Bill pay karna', lane: 'Customer' },
        { id: 'end_cust', type: 'end-event', label: 'Customer leaves', lane: 'Customer' },
      ],
      edges: [
        { id: 'e1', source: 'start_cust', target: 't_order' },
        { id: 'e2', source: 't_order', target: 'gw_split' },
        { id: 'e3', source: 'gw_split', target: 't_dine', label: 'Dine in' },
        { id: 'e4', source: 'gw_split', target: 't_take', label: 'Take away' },
        { id: 'e5', source: 't_dine', target: 'gw_join' },
        { id: 'e6', source: 't_take', target: 'gw_join' },
        { id: 'e7', source: 'gw_join', target: 't_cook' },
        { id: 'e8', source: 't_cook', target: 't_serve' },
        { id: 'e9', source: 't_serve', target: 't_eat' },
        { id: 'e10', source: 't_eat', target: 't_pay' },
        { id: 'e11', source: 't_pay', target: 'end_cust' },
      ],
    };

    const steps = extractOrderedSteps(diagram, { lang: 'ur-roman' });
    const labels = steps.map((s) => s.label);

    const cookIdx = labels.indexOf('Khana banana');
    const serveIdx = labels.indexOf('Khana serve karna');
    const payIdx = labels.indexOf('Bill pay karna');

    // Acceptance requirement: Khana banana before Khana serve karna, and both before payment
    assert.ok(cookIdx !== -1, 'Khana banana must be in steps');
    assert.ok(serveIdx !== -1, 'Khana serve karna must be in steps');
    assert.ok(payIdx !== -1, 'Bill pay karna must be in steps');

    assert.ok(cookIdx < serveIdx, 'Khana banana must appear BEFORE Khana serve karna');
    assert.ok(serveIdx < payIdx, 'Khana serve karna must appear BEFORE Bill pay karna');

    // Decision branches grouped under decision
    const dineIdx = labels.indexOf('Table dhoondna');
    const takeIdx = labels.indexOf('Counter par intezar');
    assert.ok(dineIdx < cookIdx, 'Branches must appear before post-merge task');
    assert.ok(takeIdx < cookIdx, 'Branches must appear before post-merge task');
  });

  it('formats next-step summary CTA strings for English and Roman Urdu', () => {
    // English summary
    const summaryEn = t('processReadySummary', 'en', 6, 1, 3);
    assert.strictEqual(summaryEn, 'Your process is ready. 6 steps, 1 decisions, 3 roles.');
    assert.strictEqual(t('runSimulation', 'en'), 'Run simulation');
    assert.strictEqual(t('editProcess', 'en'), 'Edit process');
    assert.strictEqual(t('runSimulationHint', 'en'), 'See where customers wait and where you can save time.');
    assert.strictEqual(t('estimatesNote', 'en'), 'Some numbers are estimates. You can refine them later.');

    // Roman Urdu summary
    const summaryRu = t('processReadySummary', 'ur-roman', 6, 1, 3);
    assert.strictEqual(summaryRu, 'Aapka process tayyar hai. 6 steps, 1 faislay, 3 log/roles.');
    assert.strictEqual(t('runSimulation', 'ur-roman'), 'Simulation chalayein');
    assert.strictEqual(t('editProcess', 'ur-roman'), 'Process theek karein');
    assert.strictEqual(
      t('runSimulationHint', 'ur-roman'),
      'Dekhein ke customers kahan intezar karte hain aur kahan waqt bach sakta hai.'
    );
    assert.strictEqual(
      t('estimatesNote', 'ur-roman'),
      'Kuch numbers andaze hain. Baad mein theek kar sakte hain.'
    );
  });
});
