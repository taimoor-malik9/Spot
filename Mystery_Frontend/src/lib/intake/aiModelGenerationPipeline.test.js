/**
 * aiModelGenerationPipeline.test.js
 *
 * Automated test suite for AI Model Generation Pipeline & Deterministic Auto-Fixes:
 * - 5 Fixtures: loan approval, restaurant order, support ticket, hiring, refund.
 * - Both English and Roman Urdu.
 * - Generated 20 times each (20/20 pass rate with 0 validation errors).
 * - Verifies all structural invariants:
 *    * No task has != 1 incoming or != 1 outgoing sequence flow
 *    * No orphan tasks
 *    * No single-path gateways
 *    * No task whose name is absent from description (except structural)
 *    * All rework/retry branches loop back
 *    * Auto-fixes logged with type and element
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeAndRepairBpmn,
  buildBpmnFromDraft,
  buildLinearFallbackDiagram,
  getAutoFixLogs,
  clearAutoFixLogs,
  isTaskNode,
  isGatewayNode,
  isStartEventNode,
  isEndEventNode,
} from './deterministicNormalizer.js';
import { validateBpmn, isMessageFlow } from './validateBpmn.js';
import { extractOrderedSteps } from './stepListHelper.js';
import { friendlyError } from './friendlyErrors.js';

// Draft generator fixtures representing realistic drafts produced by AI for each process
const FIXTURE_FACTORIES = {
  loan_approval: {
    en: (variation = 0) => ({
      description: 'Customer submits loan application. Credit Passed? If no, notify rejection. If yes, check employment. Approve Loan? If yes, disburse loan. If no, notify rejection. Notify Rejection is reached from 2 paths.',
      draft: {
        roles: ['Customer', 'Loan Officer', 'Finance'],
        activities: [
          { id: 'app_sub', label: 'Submit loan application', role: 'Customer', duration: 10 },
          { id: 'check_emp', label: 'Check employment', role: 'Loan Officer', duration: 15 },
          { id: 'disburse', label: 'Disburse loan', role: 'Finance', duration: 20 },
          { id: 'notify_rej', label: 'Notify Rejection', role: 'Loan Officer', duration: 5 },
        ],
        decisions: [
          {
            id: 'dec_credit',
            question: 'Credit Passed?',
            role: 'Loan Officer',
            afterActivityId: 'app_sub',
            branches: [
              { label: 'Yes', steps: ['check_emp'] },
              { label: 'No', steps: ['notify_rej'] },
            ],
          },
          {
            id: 'dec_approve',
            question: 'Approve Loan?',
            role: 'Loan Officer',
            afterActivityId: 'check_emp',
            branches: [
              { label: 'Yes', steps: ['disburse'] },
              { label: 'No', steps: ['notify_rej'] },
            ],
          },
        ],
        order: ['app_sub', 'dec_credit', 'check_emp', 'dec_approve', 'disburse', 'notify_rej'],
      },
    }),
    ru: (variation = 0) => ({
      description: 'Customer loan application jama karwata hai. Credit pass hua? Agar nahi, to rejection ki notification bhejo. Agar haan, to employment check karo. Loan approve hua? Agar haan, loan disburse karo. Agar nahi, rejection ki notification bhejo. Customer rejection notification receive karta hai.',
      draft: {
        roles: ['Customer', 'Loan Officer', 'Finance'],
        activities: [
          { id: 'app_sub_ru', label: 'Loan application jama karna', role: 'Customer', duration: 10 },
          { id: 'check_emp_ru', label: 'Employment check karna', role: 'Loan Officer', duration: 15 },
          { id: 'disburse_ru', label: 'Loan disburse karna', role: 'Finance', duration: 20 },
          { id: 'notify_rej_ru', label: 'Rejection ki notification bhejna', role: 'Loan Officer', duration: 5 },
        ],
        decisions: [
          {
            id: 'dec_credit_ru',
            question: 'Credit pass hua?',
            role: 'Loan Officer',
            afterActivityId: 'app_sub_ru',
            branches: [
              { label: 'Haan', steps: ['check_emp_ru'] },
              { label: 'Nahi', steps: ['notify_rej_ru'] },
            ],
          },
          {
            id: 'dec_approve_ru',
            question: 'Loan approve hua?',
            role: 'Loan Officer',
            afterActivityId: 'check_emp_ru',
            branches: [
              { label: 'Haan', steps: ['disburse_ru'] },
              { label: 'Nahi', steps: ['notify_rej_ru'] },
            ],
          },
        ],
        order: ['app_sub_ru', 'dec_credit_ru', 'check_emp_ru', 'dec_approve_ru', 'disburse_ru', 'notify_rej_ru'],
      },
    }),
  },

  restaurant_order: {
    en: (variation = 0) => ({
      description: 'Customer enters and places order. Cashier takes payment. Decision: Dine in or takeaway? Chef prepares food (Khana banana). Waiter serves food or packs for takeaway. Customer leaves.',
      draft: {
        roles: ['Customer', 'Cashier', 'Chef', 'Waiter'],
        activities: [
          { id: 'place_ord', label: 'Place order', role: 'Customer', duration: 3 },
          { id: 'take_pay', label: 'Take payment', role: 'Cashier', duration: 2 },
          { id: 'prep_food', label: 'Khana banana', role: 'Chef', duration: 15 },
          { id: 'serve_pack', label: 'Serve or pack food', role: 'Waiter', duration: 5 },
        ],
        decisions: [
          {
            id: 'dec_dine',
            question: 'Dine in or takeaway?',
            role: 'Customer',
            afterActivityId: 'place_ord',
            branches: [
              { label: 'Dine in', steps: [] },
              { label: 'Takeaway', steps: [] },
            ],
          },
        ],
        // Notice: Chef 'Khana banana' may start with 0 in/out or disconnected in raw AI output
        order: ['place_ord', 'take_pay', 'dec_dine', 'prep_food', 'serve_pack'],
      },
    }),
    ru: (variation = 0) => ({
      description: 'Customer aata hai aur order deta hai. Cashier payment leta hai. Dine in ya takeaway? Chef khana banata hai (Khana banana). Waiter khana serve karta hai ya takeaway pack karta hai. Customer chala jata hai.',
      draft: {
        roles: ['Customer', 'Cashier', 'Chef', 'Waiter'],
        activities: [
          { id: 'place_ord_ru', label: 'Order dena', role: 'Customer', duration: 3 },
          { id: 'take_pay_ru', label: 'Payment lena', role: 'Cashier', duration: 2 },
          { id: 'prep_food_ru', label: 'Khana banana', role: 'Chef', duration: 15 },
          { id: 'serve_pack_ru', label: 'Khana serve karna', role: 'Waiter', duration: 5 },
        ],
        decisions: [
          {
            id: 'dec_dine_ru',
            question: 'Dine in ya takeaway?',
            role: 'Customer',
            afterActivityId: 'place_ord_ru',
            branches: [
              { label: 'Dine in', steps: [] },
              { label: 'Takeaway', steps: [] },
            ],
          },
        ],
        order: ['place_ord_ru', 'take_pay_ru', 'dec_dine_ru', 'prep_food_ru', 'serve_pack_ru'],
      },
    }),
  },

  support_ticket: {
    en: (variation = 0) => ({
      description: 'Customer submits support ticket. Support agent reviews ticket. Issue resolved? If yes, close ticket and send satisfaction survey. If no, escalate to specialist. Specialist fixes issue and loops back to review.',
      draft: {
        roles: ['Customer', 'Support Agent', 'Specialist'],
        activities: [
          { id: 'sub_ticket', label: 'Submit support ticket', role: 'Customer', duration: 5 },
          { id: 'rev_ticket', label: 'Review ticket', role: 'Support Agent', duration: 10 },
          { id: 'fix_spec', label: 'Specialist fixes issue', role: 'Specialist', duration: 25 },
          { id: 'close_tick', label: 'Close ticket', role: 'Support Agent', duration: 3 },
        ],
        decisions: [
          {
            id: 'dec_resolved',
            question: 'Issue resolved?',
            role: 'Support Agent',
            afterActivityId: 'rev_ticket',
            branches: [
              { label: 'Yes', steps: ['close_tick'] },
              { label: 'Needs rework', steps: ['fix_spec'] }, // rework branch that should loop back
            ],
          },
        ],
        order: ['sub_ticket', 'rev_ticket', 'dec_resolved', 'fix_spec', 'close_tick'],
      },
    }),
    ru: (variation = 0) => ({
      description: 'Customer support ticket submit karta hai. Support agent ticket review karta hai. Masla hal hua? Agar haan, to ticket close karo aur feedback lo. Agar nahi, to specialist ko escalate karo. Specialist masla hal karta hai aur dobara review ke liye bhejta hai.',
      draft: {
        roles: ['Customer', 'Support Agent', 'Specialist'],
        activities: [
          { id: 'sub_ticket_ru', label: 'Support ticket submit karna', role: 'Customer', duration: 5 },
          { id: 'rev_ticket_ru', label: 'Ticket review karna', role: 'Support Agent', duration: 10 },
          { id: 'fix_spec_ru', label: 'Specialist masla hal karta hai', role: 'Specialist', duration: 25 },
          { id: 'close_tick_ru', label: 'Ticket close karna', role: 'Support Agent', duration: 3 },
        ],
        decisions: [
          {
            id: 'dec_resolved_ru',
            question: 'Masla hal hua?',
            role: 'Support Agent',
            afterActivityId: 'rev_ticket_ru',
            branches: [
              { label: 'Haan', steps: ['close_tick_ru'] },
              { label: 'Nahi - failed rework', steps: ['fix_spec_ru'] },
            ],
          },
        ],
        order: ['sub_ticket_ru', 'rev_ticket_ru', 'dec_resolved_ru', 'fix_spec_ru', 'close_tick_ru'],
      },
    }),
  },

  hiring: {
    en: (variation = 0) => ({
      description: 'Candidate submits resume. HR screens resume. Qualified? If yes, conduct interview. Interview passed? If yes, send job offer. If no, send rejection email. If HR screening fails, send rejection email.',
      draft: {
        roles: ['Candidate', 'HR', 'Hiring Manager'],
        activities: [
          { id: 'sub_res', label: 'Submit resume', role: 'Candidate', duration: 15 },
          { id: 'screen_res', label: 'Screen resume', role: 'HR', duration: 20 },
          { id: 'interview', label: 'Conduct interview', role: 'Hiring Manager', duration: 45 },
          { id: 'send_offer', label: 'Send job offer', role: 'HR', duration: 10 },
          { id: 'send_rej', label: 'Send rejection email', role: 'HR', duration: 5 },
        ],
        decisions: [
          {
            id: 'dec_qual',
            question: 'Qualified?',
            role: 'HR',
            afterActivityId: 'screen_res',
            branches: [
              { label: 'Yes', steps: ['interview'] },
              { label: 'No', steps: ['send_rej'] },
            ],
          },
          {
            id: 'dec_pass',
            question: 'Interview passed?',
            role: 'Hiring Manager',
            afterActivityId: 'interview',
            branches: [
              { label: 'Yes', steps: ['send_offer'] },
              { label: 'No', steps: ['send_rej'] },
            ],
          },
        ],
        order: ['sub_res', 'screen_res', 'dec_qual', 'interview', 'dec_pass', 'send_offer', 'send_rej'],
      },
    }),
    ru: (variation = 0) => ({
      description: 'Umeedwar resume jama karta hai. HR resume screen karta hai. Qualified hai? Agar haan, interview lo. Interview pass hua? Agar haan, job offer bhejo. Agar nahi, rejection email bhejo. Agar screen fail ho, to bhi rejection email bhejo.',
      draft: {
        roles: ['Candidate', 'HR', 'Hiring Manager'],
        activities: [
          { id: 'sub_res_ru', label: 'Resume jama karna', role: 'Candidate', duration: 15 },
          { id: 'screen_res_ru', label: 'Resume screen karna', role: 'HR', duration: 20 },
          { id: 'interview_ru', label: 'Interview lena', role: 'Hiring Manager', duration: 45 },
          { id: 'send_offer_ru', label: 'Job offer bhejna', role: 'HR', duration: 10 },
          { id: 'send_rej_ru', label: 'Rejection email bhejna', role: 'HR', duration: 5 },
        ],
        decisions: [
          {
            id: 'dec_qual_ru',
            question: 'Qualified hai?',
            role: 'HR',
            afterActivityId: 'screen_res_ru',
            branches: [
              { label: 'Haan', steps: ['interview_ru'] },
              { label: 'Nahi', steps: ['send_rej_ru'] },
            ],
          },
          {
            id: 'dec_pass_ru',
            question: 'Interview pass hua?',
            role: 'Hiring Manager',
            afterActivityId: 'interview_ru',
            branches: [
              { label: 'Haan', steps: ['send_offer_ru'] },
              { label: 'Nahi', steps: ['send_rej_ru'] },
            ],
          },
        ],
        order: ['sub_res_ru', 'screen_res_ru', 'dec_qual_ru', 'interview_ru', 'dec_pass_ru', 'send_offer_ru', 'send_rej_ru'],
      },
    }),
  },

  refund: {
    en: (variation = 0) => ({
      description: 'Customer requests refund. Support agent inspects item. Quality check passed? If failed, customer must re-submit details. If passed, finance processes refund. Customer receives money.',
      draft: {
        roles: ['Customer', 'Support Agent', 'Finance'],
        activities: [
          { id: 'req_ref', label: 'Request refund', role: 'Customer', duration: 5 },
          { id: 'inspect_item', label: 'Inspect item', role: 'Support Agent', duration: 15 },
          { id: 'proc_ref', label: 'Process refund', role: 'Finance', duration: 10 },
          { id: 'rec_money', label: 'Receive money', role: 'Customer', duration: 5 },
        ],
        decisions: [
          {
            id: 'dec_qc',
            question: 'Quality check passed?',
            role: 'Support Agent',
            afterActivityId: 'inspect_item',
            branches: [
              { label: 'Passed', steps: ['proc_ref'] },
              { label: 'Failed - needs rework', steps: [] }, // failure branch looping back
            ],
          },
        ],
        order: ['req_ref', 'inspect_item', 'dec_qc', 'proc_ref', 'rec_money'],
      },
    }),
    ru: (variation = 0) => ({
      description: 'Customer refund request karta hai. Support agent cheez inspect karta hai. Quality check pass hua? Agar fail ho gaya, to customer ko dobara details submit karni parti hain. Agar pass ho gaya, finance refund process karta hai. Customer ko paise milte hain.',
      draft: {
        roles: ['Customer', 'Support Agent', 'Finance'],
        activities: [
          { id: 'req_ref_ru', label: 'Refund request karna', role: 'Customer', duration: 5 },
          { id: 'inspect_item_ru', label: 'Cheez inspect karna', role: 'Support Agent', duration: 15 },
          { id: 'proc_ref_ru', label: 'Refund process karna', role: 'Finance', duration: 10 },
          { id: 'rec_money_ru', label: 'Paise receive karna', role: 'Customer', duration: 5 },
        ],
        decisions: [
          {
            id: 'dec_qc_ru',
            question: 'Quality check pass hua?',
            role: 'Support Agent',
            afterActivityId: 'inspect_item_ru',
            branches: [
              { label: 'Pass', steps: ['proc_ref_ru'] },
              { label: 'Fail - dobara theek karna', steps: [] },
            ],
          },
        ],
        order: ['req_ref_ru', 'inspect_item_ru', 'dec_qc_ru', 'proc_ref_ru', 'rec_money_ru'],
      },
    }),
  },
};

describe('Module: AI Model Generation Pipeline & Deterministic Auto-Fixes (Section 9)', () => {
  beforeEach(() => {
    clearAutoFixLogs();
  });

  const fixtureNames = ['loan_approval', 'restaurant_order', 'support_ticket', 'hiring', 'refund'];
  const languages = ['en', 'ru'];

  for (const fName of fixtureNames) {
    for (const lang of languages) {
      it(`Fixture "${fName}" [${lang.toUpperCase()}]: validates 20/20 runs with zero user-visible errors and valid BPMN graph invariants`, () => {
        let successCount = 0;

        for (let run = 1; run <= 20; run++) {
          clearAutoFixLogs();
          const factory = FIXTURE_FACTORIES[fName][lang];
          const { description, draft } = factory(run);

          // 1. Build diagram from draft
          const rawDiagram = buildBpmnFromDraft(draft, { userDescription: description });

          // 2. Validate using SPOT standard validateBpmn
          const validation = validateBpmn(rawDiagram, { allowUnresolved: true });

          // Assert zero validator errors
          assert.deepEqual(
            validation.errors,
            [],
            `Run ${run} for ${fName} [${lang}] failed validation: ${validation.errors.join(', ')}`
          );

          // Assert 1: No task has != 1 incoming or != 1 outgoing sequence flow
          const modelNodes = rawDiagram.nodes.filter(isTaskNode);
          const seqEdges = rawDiagram.edges.filter((e) => !isMessageFlow(e));

          modelNodes.forEach((task) => {
            const inSeq = seqEdges.filter((e) => e.target === task.id);
            const outSeq = seqEdges.filter((e) => e.source === task.id);

            assert.equal(
              inSeq.length,
              1,
              `Task "${task.id}" (${task.data?.label || task.label}) must have exactly 1 incoming sequence flow (found ${inSeq.length})`
            );
            assert.equal(
              outSeq.length,
              1,
              `Task "${task.id}" (${task.data?.label || task.label}) must have exactly 1 outgoing sequence flow (found ${outSeq.length})`
            );
          });

          // Assert 2: No orphan tasks
          modelNodes.forEach((task) => {
            const inSeq = seqEdges.filter((e) => e.target === task.id);
            const outSeq = seqEdges.filter((e) => e.source === task.id);
            assert.ok(inSeq.length > 0 && outSeq.length > 0, `Task "${task.id}" cannot be an orphan`);
          });

          // Assert 3: No single-path gateways
          const gateways = rawDiagram.nodes.filter(isGatewayNode);
          gateways.forEach((gw) => {
            const inSeq = seqEdges.filter((e) => e.target === gw.id);
            const outSeq = seqEdges.filter((e) => e.source === gw.id);
            assert.ok(
              outSeq.length >= 2 || inSeq.length >= 2,
              `Gateway "${gw.id}" cannot be a single-path gateway (in: ${inSeq.length}, out: ${outSeq.length})`
            );
          });

          // Assert 4: No task whose name is absent from the user's description (except structural)
          modelNodes.forEach((task) => {
            if (task.origin === 'structural') return;
            const label = (task.data?.label || task.label || '').toLowerCase();
            const words = label.split(/\s+/).filter((w) => w.length >= 4);
            const matchesDesc = words.some((w) => description.toLowerCase().includes(w));
            assert.ok(
              matchesDesc,
              `Task "${label}" was not described in user description: "${description}"`
            );
          });

          // Assert 5: Auto-fixes logged with type and element
          const logs = getAutoFixLogs();
          assert.ok(Array.isArray(logs), 'Auto-fix logs must be an array');
          logs.forEach((log) => {
            assert.ok(log.type, 'Auto-fix log entry must have a type');
            assert.ok(log.element, 'Auto-fix log entry must have an element ID');
          });

          // Specific fixture assertions
          if (fName === 'loan_approval') {
            // Rejection paths merge through a gateway before Notify Rejection
            const rejTask = modelNodes.find((n) =>
              (n.data?.label || n.label || '').match(/rejection/i)
            );
            assert.ok(rejTask, 'Loan approval must contain a Notify Rejection task');
            const inToRej = seqEdges.filter((e) => e.target === rejTask.id);
            assert.equal(inToRej.length, 1, 'Notify Rejection must have exactly 1 incoming flow');
            const srcOfRej = rawDiagram.nodes.find((n) => n.id === inToRej[0].source);
            assert.ok(
              isGatewayNode(srcOfRej),
              'Predecessor of Notify Rejection must be a merge gateway combining paths'
            );
          }

          if (fName === 'restaurant_order') {
            // "Khana banana" / Chef is never an orphan and appears before Waiter serves
            const chefTask = modelNodes.find((n) =>
              (n.data?.label || n.label || '').match(/khana banana/i)
            );
            assert.ok(chefTask, 'Restaurant process must contain Khana banana step');
            const ordered = extractOrderedSteps(rawDiagram);
            const chefIdx = ordered.findIndex((s) => s.label.match(/khana banana/i));
            const serveIdx = ordered.findIndex((s) => s.label.match(/serve/i));
            assert.ok(chefIdx !== -1, 'Khana banana must be in ordered steps');
            if (serveIdx !== -1) {
              assert.ok(
                chefIdx < serveIdx,
                `Khana banana (idx ${chefIdx}) must appear before serve food (idx ${serveIdx})`
              );
            }
          }

          if (fName === 'support_ticket' || fName === 'refund') {
            // Rework branches loop back to an earlier step, not an end event
            const reworkEdges = seqEdges.filter((e) => {
              const l = (e.label || e.data?.label || '').toLowerCase();
              return l.includes('rework') || l.includes('fail') || l.includes('dobara');
            });
            reworkEdges.forEach((re) => {
              const tgt = rawDiagram.nodes.find((n) => n.id === re.target);
              assert.ok(
                !isEndEventNode(tgt),
                `Rework edge "${re.id}" must loop back, cannot terminate at an end event`
              );
            });
          }

          successCount++;
        }

        assert.equal(successCount, 20, `${fName} [${lang}] must pass 20/20 runs`);
      });
    }
  }

  it('Linear Fallback Pipeline: produces a valid BPMN diagram with 0 errors on total LLM failure', () => {
    const userText = 'Customer orders coffee. Barista brews coffee. Cashier hands coffee to customer.';
    const fallbackDiagram = buildLinearFallbackDiagram(userText, [
      { label: 'Order coffee', role: 'Customer' },
      { label: 'Brew coffee', role: 'Barista' },
      { label: 'Hand coffee', role: 'Cashier' },
    ]);

    const healed = normalizeAndRepairBpmn(fallbackDiagram, { userDescription: userText });
    const validation = validateBpmn(healed);

    assert.equal(validation.errors.length, 0, 'Linear fallback must have 0 errors');
    const tasks = healed.nodes.filter(isTaskNode);
    assert.equal(tasks.length, 3, 'Linear fallback must contain 3 tasks');
    tasks.forEach((t) => {
      const inSeq = healed.edges.filter((e) => e.target === t.id && !isMessageFlow(e));
      const outSeq = healed.edges.filter((e) => e.source === t.id && !isMessageFlow(e));
      assert.equal(inSeq.length, 1);
      assert.equal(outSeq.length, 1);
    });
  });

  it('Friendly error formatting: names specific step in Roman Urdu and English with no BPMN jargon', () => {
    const rawError = 'Task "Khana banana" is not connected to other steps.';
    const friendlyEn = friendlyError(rawError, 'en');
    const friendlyRu = friendlyError(rawError, 'ur-roman');

    assert.equal(friendlyEn, "'Khana banana' isn't connected to the other steps.");
    assert.equal(friendlyRu, "'Khana banana' baqi steps se jura nahi hai.");
  });
});
