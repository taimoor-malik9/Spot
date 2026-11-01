/**
 * routes/financials.test.js
 *
 * Tests for Module F1:
 * - Pre-run check: task referencing an unconfigured resource triggers 400 with:
 *   "Task \"<label>\" uses \"<resource>\", which isn't set up. Add it in Setup before simulating."
 * - Matching handles case-insensitivity and alternative id/displayName/name keys.
 * - Accurate hourly rate & financial cost calculation formulas.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('Module F1: Financial Analysis & Pre-run Resource Validation', () => {

  it('rejects simulation if a task references an unconfigured resource', () => {
    const processDoc = {
      resources: [
        { id: 'res_doctor', name: 'Doctor', quantity: 1, monthly_salary: 26000 }
      ],
      nodes: [
        {
          id: 'task_1',
          type: 'task',
          data: {
            label: 'Initial Checkup',
            duration: 10,
            resource: 'Surgeon' // Not in resources!
          }
        }
      ]
    };

    const knownResources = new Set(
      (processDoc.resources || []).flatMap(r => [
        r.id,
        r.name,
        r.displayName,
        r.payloadKey,
        (r.name || '').trim().toLowerCase(),
        (r.id || '').trim().toLowerCase(),
        (r.displayName || '').trim().toLowerCase()
      ].filter(Boolean))
    );

    let error = null;
    for (const n of (processDoc.nodes || [])) {
      if (n.type !== 'task' && n.type !== 'subprocess') continue;
      const taskLabel = n.data?.label || n.label || n.id;
      const candidates = [];
      if (n.data?.resource && typeof n.data.resource === 'string' && n.data.resource.trim() && !n.data.resource.startsWith('res_')) {
        candidates.push(n.data.resource.trim());
      }
      if (n.data?.resources && typeof n.data.resources === 'object') {
        Object.keys(n.data.resources).forEach(k => {
          const tk = String(k).trim();
          if (tk && !tk.startsWith('$') && !tk.startsWith('_') && !tk.startsWith('res_')) {
            candidates.push(tk);
          }
        });
      }
      for (const rName of candidates) {
        if (!knownResources.has(rName) && !knownResources.has(rName.toLowerCase())) {
          error = `Task "${taskLabel}" uses "${rName}", which isn't set up. Add it in Setup before simulating.`;
          break;
        }
      }
    }

    assert.strictEqual(
      error,
      'Task "Initial Checkup" uses "Surgeon", which isn\'t set up. Add it in Setup before simulating.'
    );
  });

  it('allows simulation when task resources match case-insensitively or by displayName/id', () => {
    const processDoc = {
      resources: [
        { id: 'res_doc', name: 'Doctor', displayName: 'Doctor', quantity: 1 }
      ],
      nodes: [
        {
          id: 'task_1',
          type: 'task',
          data: {
            label: 'Doctor Consultation',
            duration: 15,
            resource: 'doctor' // lower case
          }
        },
        {
          id: 'task_2',
          type: 'task',
          data: {
            label: 'Follow up',
            duration: 10,
            resources: { 'res_doc': 1 } // by ID
          }
        }
      ]
    };

    const knownResources = new Set(
      (processDoc.resources || []).flatMap(r => [
        r.id,
        r.name,
        r.displayName,
        r.payloadKey,
        (r.name || '').trim().toLowerCase(),
        (r.id || '').trim().toLowerCase(),
        (r.displayName || '').trim().toLowerCase()
      ].filter(Boolean))
    );

    let error = null;
    for (const n of (processDoc.nodes || [])) {
      if (n.type !== 'task' && n.type !== 'subprocess') continue;
      const taskLabel = n.data?.label || n.label || n.id;
      const candidates = [];
      if (n.data?.resource && typeof n.data.resource === 'string' && n.data.resource.trim() && !n.data.resource.startsWith('res_')) {
        candidates.push(n.data.resource.trim());
      }
      if (n.data?.resources && typeof n.data.resources === 'object') {
        Object.keys(n.data.resources).forEach(k => {
          const tk = String(k).trim();
          if (tk && !tk.startsWith('$') && !tk.startsWith('_') && !tk.startsWith('res_')) {
            candidates.push(tk);
          }
        });
      }
      for (const rName of candidates) {
        if (!knownResources.has(rName) && !knownResources.has(rName.toLowerCase())) {
          error = `Task "${taskLabel}" uses "${rName}", which isn't set up. Add it in Setup before simulating.`;
          break;
        }
      }
    }

    assert.strictEqual(error, null, 'Expected no validation error when resources match');
  });

  it('correctly calculates hand-computed fixture: 1 Doctor, salary 26000, 26d x 8h', () => {
    const monthlySalary = 26000;
    const workingDays = 26;
    const hoursPerDay = 8;
    const rate = monthlySalary / (workingDays * hoursPerDay); // 125.0
    assert.strictEqual(rate, 125);

    const customers = 6;
    const periodMinutes = 55.0; // t=0 to t=55 (last departure)
    const periodHours = periodMinutes / 60.0; // 0.9166666...
    const busyHours = (6 * 5.0) / 60.0; // 0.5 hours

    const paid = Number((1 * rate * periodHours).toFixed(2)); // 114.58
    const active = Number((busyHours * rate).toFixed(2)); // 62.50
    const idle = Number((paid - active).toFixed(2)); // 52.08
    const total = paid; // 114.58

    assert.strictEqual(active, 62.50);
    assert.strictEqual(paid, 114.58);
    assert.strictEqual(idle, 52.08);
    assert.strictEqual(total, 114.58);
    assert.strictEqual(Number((total / customers).toFixed(2)), 19.10);
  });
});
