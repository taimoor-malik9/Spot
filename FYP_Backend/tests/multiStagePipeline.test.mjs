// FYP_Backend/tests/multiStagePipeline.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateSpecJson, cleanAndNormalizeSpec } from '../shared/specSchema.js';
import { convertSpecToBpmn } from '../shared/specToBpmn.js';
import { validatePostGeneration } from '../shared/postGenerationValidator.js';
import { normalizeAndRepairBpmn } from '../shared/deterministicNormalizer.js';
import { bindSpecToSimulation, convertRateToPerHour, convertIntervalToMinutes } from '../shared/specSimulationBinding.js';
import { isScreenAnswered, initializeIntakeAnswers } from '../../Mystery_Frontend/src/lib/intake/intakeHelpers.js';
import { applyIntakeToRawDiagram } from '../../Mystery_Frontend/src/lib/intake/applyIntake.js';
import { friendlyError, sanitizeUIString } from '../../Mystery_Frontend/src/lib/intake/friendlyErrors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BANNED_TERMS = [
  /\bgateway\b/i,
  /\bmessage event\b/i,
  /\bsequence flow\b/i,
  /\bsame[- ]pool\b/i,
  /\bunconnected\b/i,
  /\bdangling edge\b/i,
  /\bbpmn\b/i,
  /\btoken\b/i,
  /\bvalidation failed\b/i,
  /\bgw_\w+/i,
  /\bauto[\s_-]gw\b/i,
];

describe('SPOT Multi-Stage AI Process Generation Pipeline', () => {

  // =========================================================================
  // DOMAIN 1: Distribution Business
  // =========================================================================
  describe('Domain 1: Beverages Distribution Business', () => {
    const rawSpec = {
      participants: {
        internal_roles: [
          { name: 'Warehouse Manager', count: 2 },
          { name: 'Order Booker', count: 3 }
        ],
        external_parties: [
          { name: 'Manufacturer' },
          { name: 'Retailer' }
        ]
      },
      triggers: [
        {
          name: 'Stock level falls below reorder point',
          type: 'condition',
          independent: false
        },
        {
          name: 'Retailers place orders daily',
          type: 'arrival',
          rate: 400,
          unit: 'day',
          independent: false
        }
      ],
      activities: [
        {
          name: 'Check stock level',
          performer_role: 'Warehouse Manager',
          duration: 5
        },
        {
          name: 'Send replenishment order to manufacturer',
          performer_role: 'Warehouse Manager',
          duration: 10
        },
        {
          name: 'Receive delivery from manufacturer',
          performer_role: 'Warehouse Manager'
        },
        {
          name: 'Stock inventory into warehouse',
          performer_role: 'Warehouse Manager',
          duration: 15
        },
        {
          name: 'Fulfill retailer order',
          performer_role: 'Order Booker'
          // duration missing intentionally
        }
      ],
      decisions: [
        {
          question: 'Is stock below reorder level?',
          branches: [
            { label: 'Yes', probability: 0.35 },
            { label: 'No', probability: 0.65 }
          ]
        }
      ],
      resources_and_costs: [
        { role_or_item: 'Warehouse Manager', count: 2, salary: 60000 },
        { role_or_item: 'Order Booker', count: 3, salary: 45000 },
        { role_or_item: 'Working Capital', capital: 150000, currency: 'USD' }
      ],
      quantities: [
        { name: 'Initial Cash Balance', value: 150000, unit: 'USD' }
      ],
      goals_or_issues: [
        'Reduce out of stock occurrences and fulfillment delays'
      ],
      missing_or_ambiguous: [
        { field: 'activities.duration', reason: 'Duration for Fulfill retailer order not stated' }
      ]
    };

    it('Stage 1: validates and normalizes the domain spec', () => {
      const validation = validateSpecJson(rawSpec);
      assert.strictEqual(validation.valid, true, `Spec must be valid: ${validation.errors.join('; ')}`);

      const normalized = cleanAndNormalizeSpec(rawSpec);
      assert.strictEqual(normalized.triggers.length, 2);
      assert.strictEqual(normalized.participants.external_parties.length, 2);
      assert.strictEqual(normalized.participants.internal_roles.length, 2);
      assert.strictEqual(normalized.missing_or_ambiguous.length, 1);
    });

    it('Stage 2: generates BPMN with exactly 1 start event by default, external pools with message flows, decisions with matching merge, and outcome-named end events', () => {
      const bpmn = convertSpecToBpmn(rawSpec);

      // 1. Invariant: Exactly ONE start event by default (the main arrival: Retailers place orders)
      const startNodes = bpmn.nodes.filter(n => n.type.includes('start-event'));
      assert.strictEqual(startNodes.length, 1, 'Must have exactly 1 start event by default');
      assert.strictEqual(startNodes[0].type, 'message-start-event', 'Retailer order arrival from external party -> message start');

      // 2. Start event placed in lane of starter role
      assert.ok(startNodes[0].lane, 'Start event must sit in performer role lane');

      // 3. External parties are separate pools added before message flows
      const pools = bpmn.nodes.filter(n => n.type === 'pool');
      assert(pools.some(p => p.label === 'Manufacturer'), 'Manufacturer pool must exist');
      assert(pools.some(p => p.label === 'Retailer'), 'Retailer pool must exist');

      const messageFlows = bpmn.edges.filter(e => e.flowType === 'message');
      assert(messageFlows.length >= 2, 'External pools must be connected with message flows');

      // 4. Waiting on external party is message catch event
      const waitDelivery = bpmn.nodes.find(n => n.label === 'Receive delivery from manufacturer');
      assert(waitDelivery, 'Wait delivery node must exist');
      assert.strictEqual(waitDelivery.type, 'message-intermediate-catch');

      // 5. Decisions: Split gateway has matching merge gateway downstream with labeled branches
      const splitGateways = bpmn.nodes.filter(n => n.type.includes('gateway') && n.gateway_role === 'split');
      splitGateways.forEach(split => {
        const outEdges = bpmn.edges.filter(e => e.source === split.id);
        assert(outEdges.length >= 2, `Split gateway ${split.id} must have >= 2 outgoing branches`);
        outEdges.forEach(e => {
          assert(e.data?.label, `Branch ${e.id} must have a condition label`);
        });
        const merge = bpmn.nodes.find(n => n.id === split.matching_merge_id);
        assert(merge, `Split ${split.id} must have a matching merge gateway`);
        assert.strictEqual(merge.data?.label || merge.label || '', '', 'Merge gateway must not display raw ID label');
      });

      // 6. End event named after outcome, not generic "Complete"
      const endNodes = bpmn.nodes.filter(n => n.type.includes('end-event'));
      assert.strictEqual(endNodes.length, 1);
      assert.notStrictEqual(endNodes[0].label, 'Complete');
      assert.notStrictEqual(endNodes[0].label, 'Process Complete');
      assert(endNodes[0].label.toLowerCase().includes('fulfilled') || endNodes[0].label.toLowerCase().includes('completed'));
    });

    it('Stage 3: flags missing duration on user activities, exempts structural activities, and repair is idempotent', () => {
      const bpmn = convertSpecToBpmn(rawSpec);
      const postVal = validatePostGeneration(bpmn);

      // User activity "Fulfill retailer order" has no stated duration -> flags missing-duration
      const missingDurViolations = postVal.violations.filter(v => v.rule === 'missing-duration');
      assert.strictEqual(missingDurViolations.length, 1);
      assert(missingDurViolations[0].message.includes('Fulfill retailer order'));

      // Structural nodes (gateways, joins) do not flag missing-duration
      missingDurViolations.forEach(v => {
        const node = bpmn.nodes.find(n => n.id === v.elementId);
        assert.notStrictEqual(node?.origin, 'structural');
      });

      // Idempotency: running normalizeAndRepairBpmn on postVal.repaired produces 0 further changes
      const pass1 = postVal.repaired;
      const snap1 = JSON.stringify({ nodes: pass1.nodes, edges: pass1.edges });
      const pass2 = normalizeAndRepairBpmn(JSON.parse(JSON.stringify(pass1)));
      const snap2 = JSON.stringify({ nodes: pass2.nodes, edges: pass2.edges });
      assert.strictEqual(snap1, snap2, 'Repair must be strictly idempotent (0 changes on second pass)');
    });

    it('Stage 4: converts arrival rate correctly with units (400/day over 8h -> 50/h) and maps resources & capital', () => {
      const bpmn = convertSpecToBpmn(rawSpec);
      const bound = bindSpecToSimulation(rawSpec, bpmn, { operatingHours: 8 });

      // Exactly ONE arrival rate bound to the single start event and to simulationConfig.arrival_rate
      // 400/day over 8 hours = 50 customers/hour, arrival_gap_minutes = 1.2
      assert.strictEqual(bound.simulationConfig.customers_per_hour, 50);
      assert.strictEqual(bound.simulationConfig.arrival_gap_minutes, 1.2);
      assert.strictEqual(bound.simulationConfig.busynessSource, 'stated');
      assert.strictEqual(bound.simulationConfig.capital, 150000);
      assert.strictEqual(bound.scenarioSettings.initialCapital, 150000);

      // Resources mapped with stated counts and salaries
      const wm = bound.diagram.resources.find(r => r.name === 'Warehouse Manager');
      assert(wm);
      assert.strictEqual(wm.quantity, 2);
      assert.strictEqual(wm.quantitySource, 'stated');
      assert.strictEqual(wm.monthly_salary, 60000);
      assert.strictEqual(wm.costSource, 'stated');

      const ob = bound.diagram.resources.find(r => r.name === 'Order Booker');
      assert(ob);
      assert.strictEqual(ob.quantity, 3);
      assert.strictEqual(ob.monthly_salary, 45000);
    });

    it('Stage 5 & 6: questionnaire skips stated screens, asks missing duration, zero technical terms in UI', () => {
      const bpmn = convertSpecToBpmn(rawSpec);
      const bound = bindSpecToSimulation(rawSpec, bpmn, { operatingHours: 8 });
      const diagram = bound.diagram;
      diagram.spec = rawSpec;

      // Stated values are NOT re-asked:
      assert.strictEqual(isScreenAnswered(1, diagram), true, 'Screen 1 (Staff) should be skipped (staff stated)');
      assert.strictEqual(isScreenAnswered(3, diagram), true, 'Screen 3 (Busyness) should be skipped (rate stated)');
      assert.strictEqual(isScreenAnswered(7, diagram), true, 'Screen 7 (Costs) should be skipped (salaries stated)');

      // Missing values ARE asked:
      assert.strictEqual(isScreenAnswered(2, diagram), false, 'Screen 2 (Speed) must be asked because Fulfill retailer order duration is missing');

      // Applying intake answers preserves stated arrival rate and capital
      const intakeAnswers = initializeIntakeAnswers(diagram);
      const result = applyIntakeToRawDiagram(diagram, intakeAnswers);

      assert.strictEqual(result.simulationConfig.customers_per_hour, 50, 'Stated 50/hr rate must be preserved');
      assert.strictEqual(result.simulationConfig.capital, 150000, 'Stated capital must be preserved');

      // Zero banned technical terms across user-facing messages
      const sampleErr = friendlyError('Gateway split gw_decision missing sequence flow', 'en', diagram);
      BANNED_TERMS.forEach(pattern => {
        assert(!pattern.test(sampleErr), `Friendly error contains banned technical term: ${pattern}`);
      });
    });
  });

  // =========================================================================
  // DOMAIN 2: Hospital Emergency Room (ER)
  // =========================================================================
  describe('Domain 2: Hospital Emergency Room (ER)', () => {
    const rawSpec = {
      participants: {
        internal_roles: [
          { name: 'Triage Nurse', count: 4 },
          { name: 'ER Doctor', count: 2 }
        ],
        external_parties: [
          { name: 'Central Lab' }
        ]
      },
      triggers: [
        {
          name: 'Patients arrive at emergency room',
          type: 'arrival',
          rate: 120,
          unit: 'day',
          independent: false
        }
      ],
      activities: [
        {
          name: 'Assess patient condition',
          performer_role: 'Triage Nurse',
          duration: 8
        },
        {
          name: 'Perform clinical examination',
          performer_role: 'ER Doctor',
          duration: 15
        },
        {
          name: 'Send blood sample to lab',
          performer_role: 'ER Doctor',
          duration: 5
        },
        {
          name: 'Wait for lab results',
          performer_role: 'ER Doctor'
        },
        {
          name: 'Administer emergency treatment',
          performer_role: 'ER Doctor'
          // duration missing intentionally
        }
      ],
      decisions: [
        {
          question: 'Does patient require ICU admission?',
          branches: [
            { label: 'Yes', probability: 0.15 },
            { label: 'No', probability: 0.85 }
          ]
        }
      ],
      resources_and_costs: [
        { role_or_item: 'Triage Nurse', count: 4, salary: 75000 },
        { role_or_item: 'ER Doctor', count: 2, salary: 180000 },
        { role_or_item: 'Departmental Budget', capital: 500000, currency: 'USD' }
      ],
      quantities: [
        { name: 'Annual Budget', value: 500000, unit: 'USD' }
      ],
      goals_or_issues: [
        'Minimize door-to-treatment waiting time for critical patients'
      ],
      missing_or_ambiguous: [
        { field: 'activities.duration', reason: 'Treatment administration duration not stated' }
      ]
    };

    it('Stage 1 & 2: 1 start event, 24/7 rate conversion, external lab pool with message flows, outcome-named end event', () => {
      const bpmn = convertSpecToBpmn(rawSpec);

      // 1. One start event for patient arrivals
      const startNodes = bpmn.nodes.filter(n => n.type.includes('start-event'));
      assert.strictEqual(startNodes.length, 1);
      assert.strictEqual(startNodes[0].type, 'start-event');
      assert.strictEqual(startNodes[0].lane, 'Triage Nurse', 'Placed in starter role lane');

      // 2. External Central Lab pool with message flows
      const labPool = bpmn.nodes.find(n => n.type === 'pool' && n.label === 'Central Lab');
      assert(labPool, 'Central Lab pool must exist');
      const msgFlows = bpmn.edges.filter(e => e.flowType === 'message');
      assert(msgFlows.length >= 1, 'Message flow to Central Lab must exist');

      // 3. Intermediate wait for lab results is a message catch event
      const waitLab = bpmn.nodes.find(n => n.label === 'Wait for lab results');
      assert.strictEqual(waitLab?.type, 'message-intermediate-catch');

      // 4. End event named after outcome, not generic "Complete"
      const endNodes = bpmn.nodes.filter(n => n.type.includes('end-event'));
      assert.strictEqual(endNodes.length, 1);
      assert.notStrictEqual(endNodes[0].label, 'Complete');
      assert.notStrictEqual(endNodes[0].label, 'Process Complete');
      assert(endNodes[0].label.toLowerCase().includes('treated') || endNodes[0].label.toLowerCase().includes('discharged'));
    });

    it('Stage 3 & 4: 24-hour rate conversion (120/day in 24h -> 5/h), capital binding, missing duration error, idempotent repair', () => {
      const bpmn = convertSpecToBpmn(rawSpec);

      // Validate missing duration
      const postVal = validatePostGeneration(bpmn);
      const missingDurViolations = postVal.violations.filter(v => v.rule === 'missing-duration');
      assert.strictEqual(missingDurViolations.length, 1);
      assert(missingDurViolations[0].message.includes('treatment'));

      // Bind simulation with 24-hour operation: 120 / 24 = 5 patients/hour, arrival_gap_minutes = 12 min
      const bound = bindSpecToSimulation(rawSpec, bpmn, { operatingHours: 24, is24Hour: true });
      assert.strictEqual(bound.simulationConfig.customers_per_hour, 5);
      assert.strictEqual(bound.simulationConfig.arrival_gap_minutes, 12);
      assert.strictEqual(bound.simulationConfig.capital, 500000);
      assert.strictEqual(bound.scenarioSettings.initialCapital, 500000);

      // Staff roles & costs bound
      const doc = bound.diagram.resources.find(r => r.name === 'ER Doctor');
      assert.strictEqual(doc?.quantity, 2);
      assert.strictEqual(doc?.monthly_salary, 180000);

      // Idempotency
      const snap1 = JSON.stringify({ nodes: postVal.repaired.nodes, edges: postVal.repaired.edges });
      const pass2 = normalizeAndRepairBpmn(JSON.parse(JSON.stringify(postVal.repaired)));
      const snap2 = JSON.stringify({ nodes: pass2.nodes, edges: pass2.edges });
      assert.strictEqual(snap1, snap2, 'Repair must be idempotent');
    });

    it('Stage 5: skips staff, busyness, costs screens, prompts for missing treatment duration', () => {
      const bpmn = convertSpecToBpmn(rawSpec);
      const bound = bindSpecToSimulation(rawSpec, bpmn, { operatingHours: 24 });
      const diagram = bound.diagram;
      diagram.spec = rawSpec;

      assert.strictEqual(isScreenAnswered(1, diagram), true, 'Staff screen skipped');
      assert.strictEqual(isScreenAnswered(3, diagram), true, 'Busyness screen skipped');
      assert.strictEqual(isScreenAnswered(7, diagram), true, 'Costs screen skipped');
      assert.strictEqual(isScreenAnswered(2, diagram), false, 'Speed screen must be asked');
    });
  });

  // =========================================================================
  // DOMAIN 3: Commercial Bank Loan Process
  // =========================================================================
  describe('Domain 3: Commercial Bank Loan Process', () => {
    const rawSpec = {
      participants: {
        internal_roles: [
          { name: 'Loan Officer', count: 5 },
          { name: 'Risk Underwriter', count: 2 }
        ],
        external_parties: [
          { name: 'Credit Bureau' }
        ]
      },
      triggers: [
        {
          name: 'Online loan application submitted',
          type: 'message',
          rate: 15,
          unit: 'hour',
          independent: false
        },
        {
          name: 'Monthly compliance audit',
          type: 'schedule',
          interval: 30,
          unit: 'day',
          independent: true
        }
      ],
      activities: [
        {
          name: 'Verify applicant identity and docs',
          performer_role: 'Loan Officer',
          duration: 12
        },
        {
          name: 'Request credit score report',
          performer_role: 'Loan Officer',
          duration: 5
        },
        {
          name: 'Await credit bureau report',
          performer_role: 'Loan Officer',
          duration: 15
        },
        {
          name: 'Evaluate creditworthiness',
          performer_role: 'Risk Underwriter',
          duration: 25
        },
        {
          name: 'Disburse loan funds to borrower',
          performer_role: 'Risk Underwriter',
          duration: 20
        },
        {
          name: 'Send loan rejection letter',
          performer_role: 'Loan Officer',
          duration: 5
        },
        {
          name: 'Perform periodic portfolio audit',
          performer_role: 'Risk Underwriter',
          duration: 60
        }
      ],
      decisions: [
        {
          question: 'Is credit score acceptable?',
          branches: [
            { label: 'Yes', probability: 0.70 },
            { label: 'No', probability: 0.30 }
          ]
        }
      ],
      resources_and_costs: [
        { role_or_item: 'Loan Officer', count: 5, salary: 55000 },
        { role_or_item: 'Risk Underwriter', count: 2, salary: 90000 },
        { role_or_item: 'Lending Capital', capital: 2000000, currency: 'USD' }
      ],
      quantities: [
        { name: 'Total Lending Fund', value: 2000000, unit: 'USD' }
      ],
      goals_or_issues: [
        'Accelerate loan approval turnaround time while maintaining risk standards'
      ],
      missing_or_ambiguous: [] // All values stated!
    };

    it('Stage 1 & 2: exactly 1 start event by default; 2nd start event ONLY when independent trigger confirmed', () => {
      // 1. By default: exactly ONE start event (the main arrival: Online loan application submitted)
      const bpmnDefault = convertSpecToBpmn(rawSpec);
      const startNodesDefault = bpmnDefault.nodes.filter(n => n.type.includes('start-event'));
      assert.strictEqual(startNodesDefault.length, 1, 'Must have exactly 1 start event by default');
      assert.strictEqual(startNodesDefault[0].type, 'message-start-event');

      // 2. When independent trigger is confirmed in questionnaire: exactly 2 start events!
      const bpmnConfirmed = convertSpecToBpmn(rawSpec, {
        confirmedIndependentTriggers: ['Monthly compliance audit']
      });
      const startNodesConfirmed = bpmnConfirmed.nodes.filter(n => n.type.includes('start-event'));
      assert.strictEqual(startNodesConfirmed.length, 2, 'Must have 2 start events when independent trigger confirmed');
      assert.strictEqual(startNodesConfirmed[0].type, 'message-start-event');
      assert.strictEqual(startNodesConfirmed[1].type, 'timer-start-event');

      // 3. External credit bureau pool with message flows
      const bureauPool = bpmnDefault.nodes.find(n => n.type === 'pool' && n.label === 'Credit Bureau');
      assert(bureauPool, 'Credit bureau pool must exist');

      // 4. Await credit bureau response is message catch event
      const awaitScore = bpmnDefault.nodes.find(n => n.label === 'Await credit bureau report');
      assert.strictEqual(awaitScore?.type, 'message-intermediate-catch');

      // 5. Decision has matching merge gateway
      const split = bpmnDefault.nodes.find(n => n.type.includes('gateway') && n.gateway_role === 'split');
      assert(split, 'Decision split gateway must exist');
      const merge = bpmnDefault.nodes.find(n => n.id === split.matching_merge_id);
      assert(merge, 'Matching merge gateway must exist');

      // 6. Outcome-named end events
      const endNodes = bpmnDefault.nodes.filter(n => n.type.includes('end-event'));
      assert.ok(endNodes.length >= 1);
      endNodes.forEach(en => {
        assert.notStrictEqual(en.label, 'Complete');
        assert.notStrictEqual(en.label, 'Process Complete');
      });
    });

    it('Stage 3 & 4: all durations stated -> 0 missing-duration errors, rate 15/hr, timer interval binding when confirmed', () => {
      // Test default model binding
      const bpmnDefault = convertSpecToBpmn(rawSpec);
      const postVal = validatePostGeneration(bpmnDefault);
      const missingDurViolations = postVal.violations.filter(v => v.rule === 'missing-duration');
      assert.strictEqual(missingDurViolations.length, 0, 'No missing duration errors should exist');

      // Stage 4 simulation binding: rate 15/hr -> arrival_gap_minutes = 4
      const bound = bindSpecToSimulation(rawSpec, bpmnDefault, { operatingHours: 8 });
      assert.strictEqual(bound.simulationConfig.customers_per_hour, 15);
      assert.strictEqual(bound.simulationConfig.arrival_gap_minutes, 4);
      assert.strictEqual(bound.simulationConfig.capital, 2000000);
      assert.strictEqual(bound.scenarioSettings.initialCapital, 2000000);

      // Test confirmed model binding (with timer start)
      const bpmnConfirmed = convertSpecToBpmn(rawSpec, {
        confirmedIndependentTriggers: ['Monthly compliance audit']
      });
      const boundConfirmed = bindSpecToSimulation(rawSpec, bpmnConfirmed, { operatingHours: 8 });
      const secStart = boundConfirmed.diagram.nodes.find(n => n.id === 'start_secondary_0' || n.label.includes('audit'));
      assert(secStart, 'Secondary timer start event must exist');
      assert.strictEqual(secStart.data.timer_interval, 30);
      assert.strictEqual(secStart.data.interval_unit, 'day');

      // Idempotency
      const snap1 = JSON.stringify({ nodes: postVal.repaired.nodes, edges: postVal.repaired.edges });
      const pass2 = normalizeAndRepairBpmn(JSON.parse(JSON.stringify(postVal.repaired)));
      const snap2 = JSON.stringify({ nodes: pass2.nodes, edges: pass2.edges });
      assert.strictEqual(snap1, snap2, 'Repair must be idempotent');
    });

    it('Stage 5: all stated screens skipped (staff, speed, busyness, costs)', () => {
      const bpmn = convertSpecToBpmn(rawSpec);
      const bound = bindSpecToSimulation(rawSpec, bpmn, { operatingHours: 8 });
      const diagram = bound.diagram;
      diagram.spec = rawSpec;

      assert.strictEqual(isScreenAnswered(1, diagram), true, 'Screen 1 (Staff) skipped');
      assert.strictEqual(isScreenAnswered(2, diagram), true, 'Screen 2 (Speed) skipped (all durations stated)');
      assert.strictEqual(isScreenAnswered(3, diagram), true, 'Screen 3 (Busyness) skipped');
      assert.strictEqual(isScreenAnswered(7, diagram), true, 'Screen 7 (Costs) skipped');
    });
  });

  // =========================================================================
  // GENERAL VERIFICATION: Domain-Agnosticism & Invariant Checks
  // =========================================================================
  describe('General Pipeline Invariants & Domain-Agnosticism', () => {
    it('pipeline modules contain NO domain-specific or hardcoded business keywords', () => {
      const filesToCheck = [
        '../shared/postGenerationValidator.js',
        '../shared/specSchema.js',
        '../shared/specToBpmn.js',
        '../shared/specSimulationBinding.js',
      ];

      const forbiddenDomainKeywords = [
        /\bbeverages\b/i,
        /\bbeer\b/i,
        /\bwarehouse manager\b/i,
        /\border booker\b/i,
        /\btriage nurse\b/i,
        /\ber doctor\b/i,
        /\bloan officer\b/i,
        /\brisk underwriter\b/i,
      ];

      for (const relPath of filesToCheck) {
        const fullPath = path.resolve(__dirname, relPath);
        const content = fs.readFileSync(fullPath, 'utf8');

        for (const kw of forbiddenDomainKeywords) {
          assert(
            !kw.test(content),
            `Domain-specific pattern ${kw} found in generic module ${relPath}! Must remain domain-agnostic.`
          );
        }
      }
    });

    it('convertRateToPerHour handles all units correctly without converting rate to days interval', () => {
      // 400 per day over 8 hours = 50 per hour
      assert.strictEqual(convertRateToPerHour(400, 'day', 8), 50);
      // 120 per day over 24 hours = 5 per hour
      assert.strictEqual(convertRateToPerHour(120, 'day', 24), 5);
      // 2 per minute = 120 per hour
      assert.strictEqual(convertRateToPerHour(2, 'minute'), 120);
      // 15 per hour = 15 per hour
      assert.strictEqual(convertRateToPerHour(15, 'hour'), 15);
    });

    it('convertIntervalToMinutes converts duration intervals to minutes correctly', () => {
      assert.strictEqual(convertIntervalToMinutes(30, 'minutes'), 30);
      assert.strictEqual(convertIntervalToMinutes(2, 'hours'), 120);
      assert.strictEqual(convertIntervalToMinutes(1, 'day'), 1440);
      assert.strictEqual(convertIntervalToMinutes(90, 'seconds'), 1.5);
    });
  });

});
