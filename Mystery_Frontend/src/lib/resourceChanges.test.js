import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeResourceChanges, computeTaskChanges, computeAllChanges } from './resourceDiff.js';

describe('Resource Changes Feature Tests', () => {
  it('1. Changing Loan Officers from 2 to 1 shows "Loan Officer: 2 → 1 (-1)" with affected tasks', () => {
    const baseline = {
      resources: [
        { id: 'res_loan_officer', name: 'Loan Officer', quantity: 2, type: 'staff' },
      ],
      nodes: [
        { id: 't1', type: 'task', data: { label: 'Manual Review', resource: 'Loan Officer' } },
        { id: 't2', type: 'task', data: { label: 'Prepare Contract', resources: { res_loan_officer: 1 } } }
      ]
    };

    const scenario = {
      resources: [
        { id: 'res_loan_officer', name: 'Loan Officer', quantity: 1, type: 'staff' },
      ],
      nodes: baseline.nodes,
    };

    const changes = computeResourceChanges(baseline, scenario);
    assert.strictEqual(changes.length, 1);
    const lo = changes[0];
    assert.strictEqual(lo.name, 'Loan Officer');
    assert.strictEqual(lo.property, 'count');
    assert.strictEqual(lo.before, 2);
    assert.strictEqual(lo.after, 1);
    assert.strictEqual(lo.delta, -1);
    assert.strictEqual(lo.delta_text, '-1');
    assert.strictEqual(lo.direction, 'decrease');
    assert.strictEqual(lo.summary, 'Loan Officer: 2 → 1 (-1)');
    assert(lo.affected_tasks.includes('Manual Review'));
    assert(lo.affected_tasks.includes('Prepare Contract'));
    assert.strictEqual(lo.tasks_display, 'Manual Review, Prepare Contract');
  });

  it('2. Applying several changes at once lists all of them (count, cost/hr, schedule, rename, added)', () => {
    const baseline = {
      resources: [
        { id: 'r1', name: 'Loan Officer', quantity: 2, type: 'staff' },
        { id: 'r2', name: 'Clerk', quantity: 1, type: 'staff', monthly_salary: 1408, hours_per_day: 8, working_days_per_month: 22 },
        { id: 'r3', name: 'Supervisor', quantity: 1, type: 'staff', hours_per_day: 8 },
        { id: 'r4', name: 'Old Specialist', quantity: 1, type: 'staff' },
      ],
      nodes: [
        { id: 't1', type: 'task', data: { label: 'Review', resource: 'Loan Officer' } },
        { id: 't2', type: 'task', data: { label: 'Filing', resource: 'Clerk' } },
      ]
    };

    const scenario = {
      resources: [
        { id: 'r1', name: 'Loan Officer', quantity: 3, type: 'staff' }, // count 2 -> 3 (+1)
        { id: 'r2', name: 'Clerk', quantity: 1, type: 'staff', monthly_salary: 1760, hours_per_day: 8, working_days_per_month: 22 }, // cost $8 -> $10
        { id: 'r3', name: 'Supervisor', quantity: 1, type: 'staff', hours_per_day: 10 }, // schedule 8h/day -> 10h/day
        { id: 'r4', name: 'Senior Specialist', quantity: 1, type: 'staff' }, // renamed
        { id: 'r5', name: 'Intern', quantity: 2, type: 'staff' }, // newly added
      ],
      nodes: baseline.nodes,
    };

    const changes = computeResourceChanges(baseline, scenario);
    assert.strictEqual(changes.length, 5, 'All 5 distinct changes are listed');

    const countChange = changes.find(c => c.id === 'r1');
    assert.strictEqual(countChange.summary, 'Loan Officer: 2 → 3 (+1)');
    assert.strictEqual(countChange.direction, 'increase');

    const costChange = changes.find(c => c.id === 'r2');
    assert.strictEqual(costChange.property, 'cost_per_hour');
    assert.strictEqual(costChange.summary, 'Clerk: cost/hr $8 → $10');
    assert.strictEqual(costChange.direction, 'edit');

    const schedChange = changes.find(c => c.id === 'r3');
    assert.strictEqual(schedChange.property, 'schedule_shift');
    assert.strictEqual(schedChange.direction, 'edit');

    const renameChange = changes.find(c => c.id === 'r4');
    assert.strictEqual(renameChange.property, 'name');
    assert.strictEqual(renameChange.summary, 'Old Specialist → Senior Specialist (renamed)');

    const newRes = changes.find(c => c.id === 'r5');
    assert.strictEqual(newRes.direction, 'new');
    assert.strictEqual(newRes.summary, 'Intern: +2 (new)');
  });

  it('3. Matching by ID detects renames instead of remove + add', () => {
    const baseline = {
      resources: [{ id: 'res_special', name: 'Assistant', quantity: 1, type: 'staff' }]
    };
    const scenario = {
      resources: [{ id: 'res_special', name: 'Executive Assistant', quantity: 1, type: 'staff' }]
    };

    const changes = computeResourceChanges(baseline, scenario);
    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].property, 'name');
    assert.strictEqual(changes[0].direction, 'edit');
    assert.strictEqual(changes[0].before, 'Assistant');
    assert.strictEqual(changes[0].after, 'Executive Assistant');
  });

  it('4. If nothing changed, returns empty array [] ("No resource changes")', () => {
    const baseline = {
      resources: [{ id: 'r1', name: 'Manager', quantity: 1, type: 'staff' }]
    };
    const scenario = {
      resources: [{ id: 'r1', name: 'Manager', quantity: 1, type: 'staff' }]
    };

    const changes = computeResourceChanges(baseline, scenario);
    assert.strictEqual(changes.length, 0);
  });

  it('5. "Speed up all staff tasks by 50%" shows 0 resource changes and all 10 task duration changes', () => {
    const baselineResources = Array.from({ length: 6 }, (_, i) => ({
      id: `res_${i}`,
      name: `Staff_${i}`,
      quantity: 1,
      type: 'staff'
    }));

    const scenarioResources = Array.from({ length: 6 }, (_, i) => ({
      id: `Staff_${i}`,
      name: `Staff_${i}`,
      quantity: 1,
      type: 'staff'
    }));

    const taskNames = [
      'Triage and check vitals', 'Consult doctor', 'Blood test', 'Urine test',
      'X-ray scan', 'ECG recording', 'Wound dressing', 'Prescription issue',
      'Follow-up advice', 'Discharge processing'
    ];

    const baselineNodes = taskNames.map((name, i) => ({
      id: `task_${i}`,
      type: 'task',
      data: { label: name, duration: 6 }
    }));

    const scenarioNodes = taskNames.map((name, i) => ({
      id: `task_${i}`,
      type: 'task',
      data: { label: name, duration: 3 }
    }));

    const baseProc = { resources: baselineResources, nodes: baselineNodes };
    const scenProc = { resources: scenarioResources, nodes: scenarioNodes };

    const resChanges = computeResourceChanges(baseProc, scenProc);
    const taskChanges = computeTaskChanges(baseProc, scenProc);

    // Acceptance: 0 resource changes, 10 task changes
    assert.strictEqual(resChanges.length, 0, 'No false resource changes');
    assert.strictEqual(taskChanges.length, 10, 'All 10 task changes detected');
    assert.strictEqual(taskChanges[0].summary, 'Triage and check vitals: 6 → 3 min (-50%)');
    assert.strictEqual(taskChanges[0].delta_pct, -50);
    assert.strictEqual(taskChanges[0].delta_text, '-50%');
  });

  it('6. "Add 1 Radiologist" shows only "Radiologist: 1 → 2 (+1)" and no raw IDs', () => {
    const baselineResources = [
      { id: 'res_0', name: 'Receptionist', quantity: 1, type: 'staff' },
      { id: 'res_1', name: 'Nurse', quantity: 2, type: 'staff' },
      { id: 'res_2', name: 'Doctor', quantity: 1, type: 'staff' },
      { id: 'res_3', name: 'Radiologist', quantity: 1, type: 'staff' },
    ];
    const scenarioResources = [
      { id: 'res_0', name: 'Receptionist', quantity: 1, type: 'staff' },
      { id: 'res_1', name: 'Nurse', quantity: 2, type: 'staff' },
      { id: 'res_2', name: 'Doctor', quantity: 1, type: 'staff' },
      { id: 'res_3', name: 'Radiologist', quantity: 2, type: 'staff' },
    ];
    const nodes = [
      { id: 't1', type: 'task', data: { label: 'X-ray scan', duration: 15, resource: 'Radiologist' } }
    ];

    const baseProc = { resources: baselineResources, nodes };
    const scenProc = { resources: scenarioResources, nodes };

    const changes = computeResourceChanges(baseProc, scenProc);
    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].name, 'Radiologist');
    assert.strictEqual(changes[0].summary, 'Radiologist: 1 → 2 (+1)');
    assert(!changes.some(c => String(c.name).includes('res_0')), 'No raw res_0 IDs in names');
  });
});
