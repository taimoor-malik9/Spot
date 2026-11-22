import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBpmnFromProcessJson } from './deterministicBuilder.js';
import { validateBpmn } from './validateBpmn.js';

describe('Deterministic BPMN 2.0 Graph Builder', () => {

  it('1. Device Repair: builds valid model from JSON with external customer & parts supplier', () => {
    const deviceRepairJson = {
      processTitle: 'Device Repair Service',
      actors: [
        { name: 'Customer', type: 'external' },
        { name: 'Technician', type: 'internal' },
        { name: 'Parts Supplier', type: 'external' }
      ],
      steps: [
        {
          id: 'step_dropoff',
          name: 'Receive device and issue repair ticket',
          actor: 'Technician',
          type: 'task',
          duration: { min: 3, max: 5, unit: 'minutes' },
          resource: 'Technician',
          interactsWith: 'Customer'
        },
        {
          id: 'step_diagnose',
          name: 'Run hardware diagnostics',
          actor: 'Technician',
          type: 'task',
          duration: { min: 10, max: 20, unit: 'minutes' },
          resource: 'Technician'
        },
        {
          id: 'step_order_parts',
          name: 'Order parts from supplier',
          actor: 'Technician',
          type: 'task',
          duration: { min: 5, max: 10, unit: 'minutes' },
          resource: 'Technician',
          interactsWith: 'Parts Supplier'
        },
        {
          id: 'step_repair',
          name: 'Replace faulty components',
          actor: 'Technician',
          type: 'task',
          duration: { min: 25, max: 45, unit: 'minutes' },
          resource: 'Technician'
        },
        {
          id: 'step_qa',
          name: 'Quality test device',
          actor: 'Technician',
          type: 'task',
          duration: { min: 10, max: 15, unit: 'minutes' },
          resource: 'Technician'
        }
      ],
      decisions: [
        {
          question: 'Are replacement parts needed?',
          decisionStepId: 'step_diagnose',
          branches: [
            { condition: 'Parts in stock / not needed', targetStepId: 'step_repair', probability: 0.7 },
            { condition: 'Parts needed from supplier', targetStepId: 'step_order_parts', probability: 0.3 }
          ]
        }
      ]
    };

    const built = buildBpmnFromProcessJson(deviceRepairJson);

    // Structural checks
    assert.ok(built.nodes.length > 0, 'Nodes must not be empty');
    assert.ok(built.edges.length > 0, 'Edges must not be empty');

    // Invariant 1: Zero duplicate IDs
    const nodeIds = new Set();
    built.nodes.forEach(n => {
      assert.ok(!nodeIds.has(n.id), `Duplicate node ID found: ${n.id}`);
      nodeIds.add(n.id);
    });

    const edgeIds = new Set();
    built.edges.forEach(e => {
      assert.ok(!edgeIds.has(e.id), `Duplicate edge ID found: ${e.id}`);
      edgeIds.add(e.id);
    });

    // Invariant 2: External pools are collapsed black boxes
    const externalPools = built.nodes.filter(n => n.type === 'pool' && n.data?.isExternal);
    assert.ok(externalPools.length >= 2, 'Should create Customer and Parts Supplier external pools');
    externalPools.forEach(pool => {
      // No internal elements should have pool === externalPool.id
      const childNodes = built.nodes.filter(n => n.pool === pool.id);
      assert.equal(childNodes.length, 0, `External pool ${pool.label} must have 0 internal nodes`);
    });

    // Invariant 3: Zero sequence flows crossing pools
    built.edges.forEach(e => {
      if (e.type === 'sequence-flow') {
        const src = built.nodes.find(n => n.id === e.source);
        const tgt = built.nodes.find(n => n.id === e.target);
        assert.ok(src, `Source ${e.source} exists`);
        assert.ok(tgt, `Target ${e.target} exists`);
        const srcPool = src.pool || (src.type === 'pool' ? src.id : null);
        const tgtPool = tgt.pool || (tgt.type === 'pool' ? tgt.id : null);
        assert.equal(srcPool, tgtPool, `Sequence flow ${e.id} cannot cross pools (${srcPool} -> ${tgtPool})`);
      }
    });

    // Invariant 4: Cross-pool links are message flows
    const messageFlows = built.edges.filter(e => e.type === 'message-flow' || e.flowType === 'message');
    assert.ok(messageFlows.length >= 2, 'Should have message flows for Customer and Parts Supplier');

    // Invariant 5: Zero single-path gateways
    const gateways = built.nodes.filter(n => n.type?.includes('gateway'));
    gateways.forEach(gw => {
      const inc = built.edges.filter(e => e.target === gw.id && e.type === 'sequence-flow');
      const out = built.edges.filter(e => e.source === gw.id && e.type === 'sequence-flow');
      assert.ok(inc.length >= 2 || out.length >= 2, `Gateway ${gw.id} cannot be single-path (in: ${inc.length}, out: ${out.length})`);
    });

    // Invariant 6: 100% BPMN Validator pass with 0 errors
    const val = validateBpmn(built);
    assert.equal(val.valid, true, `Diagram must be valid. Errors: ${JSON.stringify(val.errors)}`);
    assert.equal(val.errors.length, 0, 'Must have zero validation errors');
  });

  it('2. Bakery: builds valid model with dough prep, baking, and QA decision', () => {
    const bakeryJson = {
      processTitle: 'Artisan Bakery Production',
      actors: [
        { name: 'Baker', type: 'internal' }
      ],
      steps: [
        {
          id: 'step_mix',
          name: 'Mix ingredients and knead dough',
          actor: 'Baker',
          type: 'task',
          duration: { min: 15, max: 20, unit: 'minutes' },
          resource: 'Baker'
        },
        {
          id: 'step_ferment',
          name: 'Proof and ferment dough',
          actor: 'Baker',
          type: 'task',
          duration: { min: 60, max: 90, unit: 'minutes' },
          resource: 'Baker'
        },
        {
          id: 'step_bake',
          name: 'Bake loaves in deck oven',
          actor: 'Baker',
          type: 'task',
          duration: { min: 30, max: 40, unit: 'minutes' },
          resource: 'Baker'
        },
        {
          id: 'step_cool',
          name: 'Cool on wire racks',
          actor: 'Baker',
          type: 'task',
          duration: { min: 20, max: 30, unit: 'minutes' },
          resource: 'Baker'
        },
        {
          id: 'step_pack',
          name: 'Package and tag loaves',
          actor: 'Baker',
          type: 'task',
          duration: { min: 5, max: 10, unit: 'minutes' },
          resource: 'Baker'
        }
      ]
    };

    const built = buildBpmnFromProcessJson(bakeryJson);
    const val = validateBpmn(built);
    assert.equal(val.valid, true, `Bakery must be valid. Errors: ${JSON.stringify(val.errors)}`);
    assert.equal(val.errors.length, 0);
  });

  it('3. Commercial Loan Origination: builds valid model with approval / rejection decision', () => {
    const loanJson = {
      processTitle: 'Commercial Loan Origination',
      actors: [
        { name: 'Applicant', type: 'external' },
        { name: 'Loan Officer', type: 'internal' },
        { name: 'Credit Analyst', type: 'internal' }
      ],
      steps: [
        {
          id: 'step_intake',
          name: 'Intake loan application',
          actor: 'Loan Officer',
          type: 'task',
          duration: { min: 10, max: 15, unit: 'minutes' },
          interactsWith: 'Applicant'
        },
        {
          id: 'step_credit_check',
          name: 'Perform credit score analysis',
          actor: 'Credit Analyst',
          type: 'task',
          duration: { min: 20, max: 30, unit: 'minutes' }
        },
        {
          id: 'step_underwrite',
          name: 'Underwrite risk assessment',
          actor: 'Credit Analyst',
          type: 'task',
          duration: { min: 30, max: 60, unit: 'minutes' }
        },
        {
          id: 'step_fund',
          name: 'Disburse funds to applicant',
          actor: 'Loan Officer',
          type: 'task',
          duration: { min: 15, max: 20, unit: 'minutes' },
          interactsWith: 'Applicant'
        }
      ],
      decisions: [
        {
          question: 'Does applicant meet credit criteria?',
          decisionStepId: 'step_underwrite',
          branches: [
            { condition: 'Approved', targetStepId: 'step_fund', probability: 0.65 },
            { condition: 'Rejected', targetStepId: null, probability: 0.35 }
          ]
        }
      ]
    };

    const built = buildBpmnFromProcessJson(loanJson);
    const val = validateBpmn(built);
    assert.equal(val.valid, true, `Loan process must be valid. Errors: ${JSON.stringify(val.errors)}`);
    assert.equal(val.errors.length, 0);
  });

  it('4. Hospital Emergency Triage: builds valid multi-actor emergency flow', () => {
    const hospitalJson = {
      processTitle: 'Emergency Department Care',
      actors: [
        { name: 'Patient', type: 'external' },
        { name: 'Triage Nurse', type: 'internal' },
        { name: 'Emergency Physician', type: 'internal' }
      ],
      steps: [
        {
          id: 'step_arrive',
          name: 'Patient arrival and intake',
          actor: 'Triage Nurse',
          type: 'task',
          duration: { min: 5, max: 10, unit: 'minutes' },
          interactsWith: 'Patient'
        },
        {
          id: 'step_assess',
          name: 'Clinical acuity assessment',
          actor: 'Triage Nurse',
          type: 'task',
          duration: { min: 5, max: 10, unit: 'minutes' }
        },
        {
          id: 'step_exam',
          name: 'Physician medical exam and diagnosis',
          actor: 'Emergency Physician',
          type: 'task',
          duration: { min: 20, max: 40, unit: 'minutes' }
        },
        {
          id: 'step_admit',
          name: 'Admit to inpatient ward',
          actor: 'Emergency Physician',
          type: 'task',
          duration: { min: 15, max: 30, unit: 'minutes' }
        }
      ],
      decisions: [
        {
          question: 'Requires hospital admission?',
          decisionStepId: 'step_exam',
          branches: [
            { condition: 'Admit to ward', targetStepId: 'step_admit', probability: 0.25 },
            { condition: 'Discharge home', targetStepId: null, probability: 0.75 }
          ]
        }
      ]
    };

    const built = buildBpmnFromProcessJson(hospitalJson);
    const val = validateBpmn(built);
    assert.equal(val.valid, true, `Hospital flow must be valid. Errors: ${JSON.stringify(val.errors)}`);
    assert.equal(val.errors.length, 0);
  });

  it('5. Generation 10 times produces zero duplicate IDs, zero cross-pool sequence flows, zero single-path gateways', () => {
    const input = {
      processTitle: 'Robust Multi-Run Process',
      actors: [
        { name: 'Customer', type: 'external' },
        { name: 'Clerk', type: 'internal' }
      ],
      steps: [
        { id: 's1', name: 'Order intake', actor: 'Clerk', duration: { min: 2, max: 4 } },
        { id: 's2', name: 'Check inventory', actor: 'Clerk', duration: { min: 1, max: 3 } },
        { id: 's3', name: 'Ship package', actor: 'Clerk', duration: { min: 5, max: 10 } }
      ],
      decisions: [
        {
          question: 'In stock?',
          decisionStepId: 's2',
          branches: [
            { condition: 'Yes', targetStepId: 's3', probability: 0.8 },
            { condition: 'No', targetStepId: null, probability: 0.2 }
          ]
        }
      ]
    };

    for (let run = 1; run <= 10; run++) {
      const built = buildBpmnFromProcessJson(input);
      assert.equal(built.valid, true);
      assert.equal(built.errors.length, 0);

      // Check unique IDs
      const ids = new Set();
      built.nodes.forEach(n => {
        assert.ok(!ids.has(n.id));
        ids.add(n.id);
      });
      built.edges.forEach(e => {
        assert.ok(!ids.has(e.id));
        ids.add(e.id);
      });

      // Check zero cross-pool sequence flows
      built.edges.forEach(e => {
        if (e.type === 'sequence-flow') {
          const src = built.nodes.find(n => n.id === e.source);
          const tgt = built.nodes.find(n => n.id === e.target);
          const srcPool = src.pool || (src.type === 'pool' ? src.id : null);
          const tgtPool = tgt.pool || (tgt.type === 'pool' ? tgt.id : null);
          assert.equal(srcPool, tgtPool);
        }
      });

      // Check zero single-path gateways
      const gws = built.nodes.filter(n => n.type?.includes('gateway'));
      gws.forEach(gw => {
        const inc = built.edges.filter(e => e.target === gw.id && e.type === 'sequence-flow');
        const out = built.edges.filter(e => e.source === gw.id && e.type === 'sequence-flow');
        assert.ok(inc.length >= 2 || out.length >= 2);
      });
    }
  });

});
