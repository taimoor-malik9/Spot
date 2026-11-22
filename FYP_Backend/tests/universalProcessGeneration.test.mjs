// FYP_Backend/tests/universalProcessGeneration.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBpmnFromProcessJson } from '../shared/deterministicBuilder.js';
import { validateBpmn } from '../shared/validateBpmn.js';

describe('Universal Business Process Model Generation Test Suite', () => {

  // Helper to verify graph reachability from a node to any end event
  function canReachEndEvent(startNodeId, nodes, edges) {
    const visited = new Set();
    const queue = [startNodeId];
    while (queue.length > 0) {
      const currId = queue.shift();
      if (visited.has(currId)) continue;
      visited.add(currId);
      const currNode = nodes.find(n => n.id === currId);
      if (currNode && (currNode.type === 'end-event' || currNode.type?.includes('end'))) {
        return true;
      }
      const outEdges = edges.filter(e => (e.source === currId || e.fromId === currId) && (e.type === 'sequence-flow' || e.flowType === 'sequence'));
      for (const edge of outEdges) {
        const tgt = edge.target || edge.toId;
        if (!visited.has(tgt)) {
          queue.push(tgt);
        }
      }
    }
    return false;
  }

  const testProcesses = [
    {
      id: 'proc_1_linear',
      name: '1. Linear Process: Corporate IT Equipment Provisioning',
      spec: {
        processTitle: 'Corporate IT Equipment Provisioning',
        actors: [
          { name: 'IT Support Specialist', type: 'internal' },
          { name: 'System Admin', type: 'internal' }
        ],
        steps: [
          { id: 's1', name: 'Verify hardware requisition', actor: 'IT Support Specialist', type: 'task', duration: { min: 10, max: 15, unit: 'minutes' } },
          { id: 's2', name: 'Image and configure laptop', actor: 'System Admin', type: 'task', duration: { min: 30, max: 45, unit: 'minutes' } },
          { id: 's3', name: 'Assign user access credentials', actor: 'System Admin', type: 'task', duration: { min: 15, max: 20, unit: 'minutes' } },
          { id: 's4', name: 'Deliver equipment to employee', actor: 'IT Support Specialist', type: 'task', duration: { min: 5, max: 10, unit: 'minutes' } }
        ]
      }
    },
    {
      id: 'proc_2_xor_branching',
      name: '2. XOR Branching Process: Online Commercial Loan Application Review',
      spec: {
        processTitle: 'Online Commercial Loan Application Review',
        actors: [
          { name: 'Loan Officer', type: 'internal' },
          { name: 'Risk Underwriter', type: 'internal' }
        ],
        steps: [
          { id: 's1', name: 'Review applicant documents', actor: 'Loan Officer', type: 'task', duration: { min: 20, max: 30, unit: 'minutes' } },
          { id: 's2', name: 'Assess credit score and risk', actor: 'Risk Underwriter', type: 'task', duration: { min: 30, max: 45, unit: 'minutes' } },
          { id: 's3', name: 'Prepare loan contract', actor: 'Loan Officer', type: 'task', duration: { min: 15, max: 20, unit: 'minutes' } },
          { id: 's4', name: 'Send rejection notice', actor: 'Loan Officer', type: 'task', duration: { min: 5, max: 10, unit: 'minutes' } }
        ],
        decisions: [
          {
            question: 'Credit score acceptable?',
            decisionStepId: 's2',
            branches: [
              { condition: 'Approved', targetStepId: 's3', probability: 0.75 },
              { condition: 'Declined', targetStepId: 's4', probability: 0.25 }
            ]
          }
        ]
      }
    },
    {
      id: 'proc_3_parallel_and',
      name: '3. Parallel AND Process: Property Mortgage Underwriting & Verification',
      spec: {
        processTitle: 'Property Mortgage Underwriting and Verification',
        actors: [
          { name: 'Underwriter', type: 'internal' },
          { name: 'Property Appraiser', type: 'internal' },
          { name: 'Legal Counsel', type: 'internal' }
        ],
        steps: [
          { id: 's1', name: 'Initiate application file', actor: 'Underwriter', type: 'task', duration: { min: 15, max: 20, unit: 'minutes' } },
          { id: 's2', name: 'Conduct property appraisal', actor: 'Property Appraiser', type: 'task', duration: { min: 90, max: 120, unit: 'minutes' } },
          { id: 's3', name: 'Perform title search and legal check', actor: 'Legal Counsel', type: 'task', duration: { min: 60, max: 90, unit: 'minutes' } },
          { id: 's4', name: 'Issue final approval package', actor: 'Underwriter', type: 'task', duration: { min: 20, max: 30, unit: 'minutes' } }
        ],
        parallelGroups: [
          {
            after_step: 's1',
            branches: [
              ['s2'],
              ['s3']
            ],
            rejoin_step: 's4'
          }
        ]
      }
    },
    {
      id: 'proc_4_rework_loop',
      name: '4. Rework Loop Process: Precision Engineering Part Quality Inspection',
      spec: {
        processTitle: 'Precision Engineering Part Quality Inspection',
        actors: [
          { name: 'CNC Machinist', type: 'internal' },
          { name: 'QA Inspector', type: 'internal' }
        ],
        steps: [
          { id: 's1', name: 'Machine raw alloy block', actor: 'CNC Machinist', type: 'task', duration: { min: 45, max: 60, unit: 'minutes' } },
          { id: 's2', name: 'Inspect dimensional tolerances', actor: 'QA Inspector', type: 'task', duration: { min: 10, max: 15, unit: 'minutes' } },
          { id: 's3', name: 'Laser engrave serial number and pack', actor: 'CNC Machinist', type: 'task', duration: { min: 5, max: 10, unit: 'minutes' } }
        ],
        loops: [
          {
            from_step: 's2',
            to_step: 's1',
            condition: 'Out of tolerance',
            probability: 0.15
          }
        ]
      }
    },
    {
      id: 'proc_5_multiple_external',
      name: '5. Multiple External Parties: Global Freight Import and Customs Clearance',
      spec: {
        processTitle: 'Global Freight Import and Customs Clearance',
        actors: [
          { name: 'Overseas Manufacturer', type: 'external' },
          { name: 'Customs Broker', type: 'internal' },
          { name: 'Port Customs Authority', type: 'external' },
          { name: 'Logistics Carrier', type: 'external' }
        ],
        steps: [
          { id: 's1', name: 'Receive shipping manifest', actor: 'Customs Broker', type: 'message receive', interactsWith: 'Overseas Manufacturer', duration: { min: 10, max: 15, unit: 'minutes' } },
          { id: 's2', name: 'Submit import declaration', actor: 'Customs Broker', type: 'message send', interactsWith: 'Port Customs Authority', duration: { min: 20, max: 30, unit: 'minutes' } },
          { id: 's3', name: 'Await customs clearance inspection', actor: 'Customs Broker', type: 'wait', duration: { min: 2, max: 4, unit: 'hours' } },
          { id: 's4', name: 'Dispatch shipment with carrier', actor: 'Customs Broker', type: 'message send', interactsWith: 'Logistics Carrier', duration: { min: 15, max: 20, unit: 'minutes' } }
        ]
      }
    },
    {
      id: 'proc_6_one_actor',
      name: '6. One Actor Only: Solo Freelance Monthly Retainer Invoicing',
      spec: {
        processTitle: 'Solo Freelance Monthly Retainer Invoicing',
        actors: [
          { name: 'Freelance Consultant', type: 'internal' },
          { name: 'Corporate Client', type: 'external' }
        ],
        steps: [
          { id: 's1', name: 'Consolidate monthly billable hours', actor: 'Freelance Consultant', type: 'task', duration: { min: 20, max: 30, unit: 'minutes' } },
          { id: 's2', name: 'Generate formal PDF invoice', actor: 'Freelance Consultant', type: 'task', duration: { min: 5, max: 10, unit: 'minutes' } },
          { id: 's3', name: 'Email invoice and payment link', actor: 'Freelance Consultant', type: 'message send', interactsWith: 'Corporate Client', duration: { min: 3, max: 5, unit: 'minutes' } }
        ]
      }
    },
    {
      id: 'proc_7_many_actors',
      name: '7. Many Actors: Hospital Multi-Disciplinary Inpatient Admission & Surgery',
      spec: {
        processTitle: 'Hospital Multi-Disciplinary Inpatient Admission',
        actors: [
          { name: 'Triage Registrar', type: 'internal' },
          { name: 'Admissions Nurse', type: 'internal' },
          { name: 'Attending Physician', type: 'internal' },
          { name: 'Clinical Pharmacist', type: 'internal' },
          { name: 'Surgical Coordinator', type: 'internal' }
        ],
        steps: [
          { id: 's1', name: 'Intake patient registration', actor: 'Triage Registrar', type: 'task', duration: { min: 8, max: 12, unit: 'minutes' } },
          { id: 's2', name: 'Vital signs assessment and history', actor: 'Admissions Nurse', type: 'task', duration: { min: 15, max: 20, unit: 'minutes' } },
          { id: 's3', name: 'Pre-op physical examination', actor: 'Attending Physician', type: 'task', duration: { min: 25, max: 35, unit: 'minutes' } },
          { id: 's4', name: 'Review medication contraindications', actor: 'Clinical Pharmacist', type: 'task', duration: { min: 15, max: 25, unit: 'minutes' } },
          { id: 's5', name: 'Finalize surgical suite scheduling', actor: 'Surgical Coordinator', type: 'task', duration: { min: 10, max: 15, unit: 'minutes' } }
        ]
      }
    },
    {
      id: 'proc_8_wait_and_multiple_ends',
      name: '8. Wait Events & Multiple Ends: Pharmaceutical Clinical Trial Monitoring',
      spec: {
        processTitle: 'Pharmaceutical Clinical Trial Subject Monitoring',
        actors: [
          { name: 'Clinical Coordinator', type: 'internal' },
          { name: 'Principal Investigator', type: 'internal' }
        ],
        steps: [
          { id: 's1', name: 'Administer test trial dosage', actor: 'Clinical Coordinator', type: 'task', duration: { min: 10, max: 15, unit: 'minutes' } },
          { id: 's2', name: 'Post-dosage mandatory observation wait', actor: 'Clinical Coordinator', type: 'wait', duration: { min: 4, max: 6, unit: 'hours' } },
          { id: 's3', name: 'Evaluate subject vital profile', actor: 'Principal Investigator', type: 'task', duration: { min: 20, max: 30, unit: 'minutes' } },
          { id: 's4', name: 'Record standard protocol completion', actor: 'Clinical Coordinator', type: 'task', duration: { min: 15, max: 20, unit: 'minutes' } },
          { id: 's5', name: 'Log adverse reaction and exit study', actor: 'Clinical Coordinator', type: 'task', duration: { min: 30, max: 45, unit: 'minutes' } }
        ],
        decisions: [
          {
            question: 'Adverse reaction detected?',
            decisionStepId: 's3',
            branches: [
              { condition: 'Standard Normal Completion', targetStepId: 's4', probability: 0.85 },
              { condition: 'Adverse Event Stopped', targetStepId: 's5', probability: 0.15 }
            ]
          }
        ]
      }
    }
  ];

  // Global test summary table rows
  const summaryResults = [];

  for (const proc of testProcesses) {
    it(`${proc.name} (10 runs, all 6 invariants)`, () => {
      let runSuccessCount = 0;
      let totalNodesCount = 0;
      let totalEdgesCount = 0;

      for (let run = 1; run <= 10; run++) {
        const built = buildBpmnFromProcessJson(proc.spec);

        // 1. Assert 0 Save-validator issues
        const saveVal = validateBpmn(built, { allowUnresolved: true });
        assert.equal(saveVal.valid, true, `Run ${run}: Save validator must return valid: true`);
        assert.equal(saveVal.errors.length, 0, `Run ${run}: Save validator errors must be 0, got: ${saveVal.errors.join(', ')}`);

        // 2. Assert no duplicate IDs
        const nodeIds = new Set();
        built.nodes.forEach(n => {
          assert.ok(!nodeIds.has(n.id), `Run ${run}: Duplicate node ID detected: ${n.id}`);
          nodeIds.add(n.id);
        });

        const edgeIds = new Set();
        built.edges.forEach(e => {
          assert.ok(!edgeIds.has(e.id), `Run ${run}: Duplicate edge ID detected: ${e.id}`);
          edgeIds.add(e.id);
        });

        // 3. Assert no cross-pool sequence flows
        built.edges.forEach(e => {
          if (e.type === 'sequence-flow' || e.flowType === 'sequence') {
            const src = built.nodes.find(n => n.id === (e.source || e.fromId));
            const tgt = built.nodes.find(n => n.id === (e.target || e.toId));
            assert.ok(src, `Run ${run}: Source node for edge ${e.id} exists`);
            assert.ok(tgt, `Run ${run}: Target node for edge ${e.id} exists`);
            const srcPool = src.pool || (src.type === 'pool' ? src.id : null);
            const tgtPool = tgt.pool || (tgt.type === 'pool' ? tgt.id : null);
            assert.equal(srcPool, tgtPool, `Run ${run}: Sequence flow ${e.id} cannot cross pools (${srcPool} -> ${tgtPool})`);
          }
        });

        // 4. Assert no single-path gateways
        const gws = built.nodes.filter(n => n.type?.includes('gateway'));
        gws.forEach(gw => {
          const inc = built.edges.filter(e => (e.target === gw.id || e.toId === gw.id) && (e.type === 'sequence-flow' || e.flowType === 'sequence'));
          const out = built.edges.filter(e => (e.source === gw.id || e.fromId === gw.id) && (e.type === 'sequence-flow' || e.flowType === 'sequence'));
          assert.ok(inc.length >= 2 || out.length >= 2, `Run ${run}: Gateway ${gw.id} (${gw.label}) must not be single-path (inc: ${inc.length}, out: ${out.length})`);
        });

        // 5. Assert all tasks in lanes
        const tasks = built.nodes.filter(n => n.type === 'task');
        tasks.forEach(t => {
          const lane = t.lane || t.data?.lane;
          assert.ok(lane != null && String(lane).trim().length > 0, `Run ${run}: Task ${t.id} (${t.label}) must be assigned to a lane`);
        });

        // 6. Assert all branches reach an end event
        const nonEndNodes = built.nodes.filter(n => n.type !== 'pool' && n.type !== 'lane' && n.type !== 'end-event' && !n.type?.includes('end'));
        nonEndNodes.forEach(node => {
          const reachesEnd = canReachEndEvent(node.id, built.nodes, built.edges);
          assert.ok(reachesEnd, `Run ${run}: Node ${node.id} (${node.label}) must reach an end event`);
        });

        runSuccessCount++;
        totalNodesCount += built.nodes.length;
        totalEdgesCount += built.edges.length;
      }

      assert.equal(runSuccessCount, 10);
      summaryResults.push({
        name: proc.name,
        runs: 10,
        pass: runSuccessCount,
        saveIssues: 0,
        avgNodes: Math.round(totalNodesCount / 10),
        avgEdges: Math.round(totalEdgesCount / 10),
        status: '100% PASS'
      });
    });
  }

  // Print results table after suite
  it('Summary Results Table Output', () => {
    console.log('\n=================== UNIVERSAL PROCESS GENERATION TEST RESULTS ===================');
    console.table(summaryResults);
    console.log('=================================================================================\n');
    assert.equal(summaryResults.length, 8);
    assert.ok(summaryResults.every(r => r.pass === 10 && r.saveIssues === 0));
  });

});
