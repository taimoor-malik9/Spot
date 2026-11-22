import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateBpmn } from './validateBpmn.js';
import { normalizeAndRepairBpmn } from './deterministicNormalizer.js';
import { validateCustomRange } from './i18n.js';
import { initializeIntakeAnswers, getActiveTaskNodes } from './intakeHelpers.js';

describe('Surgical 4 Bug Fixes Verification', () => {

  describe('Bug Fix 1: False-Positive "min greater than max" Validation Error', () => {
    it('does not trigger error when min <= max with numeric strings', () => {
      const diagram = {
        nodes: [
          { id: 's1', type: 'start-event' },
          {
            id: 't1',
            type: 'task',
            data: { label: 'Check stock', duration: '5', duration_min: '2', duration_max: '10' }
          },
          { id: 'e1', type: 'end-event' }
        ],
        edges: [
          { id: 'e_s1_t1', source: 's1', target: 't1' },
          { id: 'e_t1_e1', source: 't1', target: 'e1' }
        ]
      };
      const res = validateBpmn(diagram);
      const minMaxErr = (res.errors || []).find(e => e.includes('cannot be greater than duration_max'));
      assert.strictEqual(minMaxErr, undefined, 'Should not report min > max when min <= max');
    });

    it('does not trigger false positive when duration_max is empty string or null during typing', () => {
      const diagram = {
        nodes: [
          { id: 's1', type: 'start-event' },
          {
            id: 't1',
            type: 'task',
            data: { label: 'Pack goods', duration: '5', duration_min: '5', duration_max: '' }
          },
          { id: 'e1', type: 'end-event' }
        ],
        edges: [
          { id: 'e_s1_t1', source: 's1', target: 't1' },
          { id: 'e_t1_e1', source: 't1', target: 'e1' }
        ]
      };
      const res = validateBpmn(diagram);
      const minMaxErr = (res.errors || []).find(e => e.includes('cannot be greater than duration_max'));
      assert.strictEqual(minMaxErr, undefined, 'Empty max string must not cause false-positive 5 > 0');
    });

    it('auto-swaps inverted duration range in deterministicNormalizer', () => {
      const diagram = {
        nodes: [
          { id: 's1', type: 'start-event' },
          {
            id: 't1',
            type: 'task',
            data: { label: 'Assemble item', duration: 15, duration_min: 20, duration_max: 10 }
          },
          { id: 'e1', type: 'end-event' }
        ],
        edges: [
          { id: 'e_s1_t1', source: 's1', target: 't1' },
          { id: 'e_t1_e1', source: 't1', target: 'e1' }
        ]
      };
      const repaired = normalizeAndRepairBpmn(diagram);
      const task = repaired.nodes.find(n => n.id === 't1');
      assert.ok(Number(task.data.duration_min) <= Number(task.data.duration_max), 'Inverted bounds must be auto-swapped');
      assert.strictEqual(task.data.duration_min, 10);
      assert.strictEqual(task.data.duration_max, 20);
    });

    it('validateCustomRange only returns "less than minimum" when both are numbers and max < min', () => {
      // Empty max: does not say max < min
      const emptyMaxErr = validateCustomRange(10, '', 'en');
      assert.ok(!emptyMaxErr.includes('less than minimum'), 'Empty max should not complain about being less than min');

      // Actually inverted
      const invertedErr = validateCustomRange(15, 5, 'en');
      assert.strictEqual(invertedErr, 'Maximum time cannot be less than minimum.');
    });
  });

  describe('Bug Fix 2: Specific, Actionable Validation Errors on Save', () => {
    it('identifies exact failing step and reason in validation message', () => {
      const diagram = {
        nodes: [
          { id: 's1', type: 'start-event' },
          {
            id: 't_diag',
            type: 'task',
            data: { label: 'Run diagnostics', duration: 15, duration_min: 30, duration_max: 10 }
          },
          { id: 'e1', type: 'end-event' }
        ],
        edges: [
          { id: 'e1', source: 's1', target: 't_diag' },
          { id: 'e2', source: 't_diag', target: 'e1' }
        ]
      };
      const val = validateBpmn(diagram);
      assert.ok(val.errors.length > 0);
      const diagErr = val.errors.find(e => e.includes('Run diagnostics'));
      assert.ok(diagErr, 'Validation error must name the exact step "Run diagnostics"');
    });
  });

  describe('Bug Fix 3: Do Not Pre-Select Unstated Durations & Gate Next', () => {
    it('leaves duration unselected/empty for tasks whose duration was not stated', () => {
      const raw = {
        nodes: [
          { id: 't_stated', type: 'task', data: { label: 'Stated Step', duration: 10, duration_source: 'stated' } },
          { id: 't_unstated', type: 'task', data: { label: 'Unstated Step' } }
        ]
      };
      const active = getActiveTaskNodes(raw);
      const answers = initializeIntakeAnswers(raw, active);

      // Stated task retains duration and preset speed
      assert.strictEqual(answers.steps.t_stated.speed.value, 'slow');
      assert.strictEqual(answers.steps.t_stated.duration, 10);
      assert.strictEqual(answers.steps.t_stated.source, 'bucket');

      // Unstated task remains empty / null
      assert.strictEqual(answers.steps.t_unstated.speed.value, null);
      assert.strictEqual(answers.steps.t_unstated.duration_min, null);
      assert.strictEqual(answers.steps.t_unstated.duration_max, null);
      assert.strictEqual(answers.steps.t_unstated.duration, null);
      assert.strictEqual(answers.steps.t_unstated.source, 'unstated');
    });
  });

});
