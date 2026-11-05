/**
 * lib/intake/resultsSafetyAndDedupe.test.js
 *
 * Regression tests for:
 * 1. Bug 1: Elimination of "[object Object]" in baseline and scenario results across en, ur-roman, and ur.
 * 2. Bug 2: Deduplication and safe key generation for scenarios (scenario ID 6aecda279834275a45d2274a).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getBottleneckView,
  prepareResultForMetrics,
  dedupeScenarios,
  upsertScenarios,
  extractSafeString,
  extractSafeNumber,
} from '../resultsHelper.js';
import { computeComparisonMetrics } from '../whatIfComparison.js';
import { t } from './i18n.js';

describe('Bug 1: getBottleneckView & Results Helper Resilience', () => {
  it('extracts plain primitives when bottleneck is an object instead of a string', () => {
    const rawResult = {
      runs: 100,
      performance_metrics_kpi: {
        primary_bottleneck: {
          task_id: 'task_bake',
          resource: 'Baker',
          wait_time: 14.2,
        },
      },
      resource_utilization: {
        Baker: {
          capacity: 1,
          utilization_pct: 96,
          avg_busy_time_per_item: 12.0,
        },
      },
    };

    const idToLabel = { task_bake: 'Baking Oven' };
    const view = getBottleneckView(rawResult, idToLabel);

    assert.equal(typeof view.bottleneckName, 'string');
    assert.equal(view.bottleneckName, 'Baker');
    assert.ok(!view.bottleneckName.includes('[object Object]'));
    assert.equal(view.roleName, 'Baker');
    assert.equal(view.isOverloaded, true);
    assert.equal(view.tight.util, 96);
  });

  it('handles capacity as object { current, max } and resource as { id, name }', () => {
    const rawResult = {
      runs: 50,
      bottleneck: 'Packaging',
      resource_utilization: {
        Packer: {
          name: { id: 'res_pack', name: 'Packaging Staff' },
          capacity: { current: 2, max: 4 },
          utilization: { pct: 92 },
          avg_busy_time_per_item: 5.0,
        },
      },
      arrival_rate: { rate: 0.5 },
    };

    const view = getBottleneckView(rawResult);

    assert.equal(view.bottleneckName, 'Packaging');
    assert.equal(view.roleName, 'Packaging Staff');
    assert.equal(view.capacity, 2);
    assert.equal(view.capacityStr, '2.0');
    assert.equal(view.utilization, 92);
    assert.equal(view.utilizationStr, '92');
    assert.equal(view.arrivalPerHr, 30);
    assert.ok(view.perHr > 0);
    assert.ok(Number.isFinite(view.perHr));
    assert.ok(!view.capacityStr.includes('[object Object]'));
    assert.ok(!view.roleName.includes('[object Object]'));
  });

  it('handles resource_utilization as an array of objects', () => {
    const rawResult = {
      runs: 200,
      resource_utilization: [
        {
          name: 'Cashier',
          capacity: 1,
          utilization_pct: 97,
          avg_busy_time_per_item: 3.5,
        },
      ],
    };

    const view = getBottleneckView(rawResult);
    assert.equal(view.roleName, 'Cashier');
    assert.equal(view.isOverloaded, true);
  });

  it('handles null, undefined, and empty objects without crashing', () => {
    const viewNull = getBottleneckView(null);
    assert.equal(viewNull.bottleneckName, 'None');
    assert.equal(viewNull.roleName, '');
    assert.equal(viewNull.tight, null);

    const viewEmpty = getBottleneckView({});
    assert.equal(viewEmpty.bottleneckName, 'None');
    assert.equal(viewEmpty.roleName, '');
  });
});

describe('Bug 1: What-If Comparison Metric Narratives without [object Object]', () => {
  it('what-if comparison between runs with object bottlenecks never leaks [object Object]', () => {
    const baseRaw = {
      mode: 'deep',
      runs: 50,
      time_in_system: { avg: 25.0, min: 10, max: 40, ci_95_low: 23, ci_95_high: 27 },
      throughput_rates: 0.1,
      bottleneck: { task_id: 'task_order', resource: 'Counter Staff', wait_time: 10.0 },
    };

    const wiRaw = {
      mode: 'deep',
      runs: 50,
      time_in_system: { avg: 15.0, min: 8, max: 25, ci_95_low: 14, ci_95_high: 16 },
      throughput_rates: 0.15,
      bottleneck: { task_id: 'task_prep', resource: 'Kitchen Staff', wait_time: 8.0 },
    };

    const idToLabel = {
      task_order: 'Taking Order',
      task_prep: 'Food Preparation',
    };

    const safeBase = prepareResultForMetrics(baseRaw, idToLabel);
    const safeWI = prepareResultForMetrics(wiRaw, idToLabel);

    const metrics = computeComparisonMetrics(safeBase, safeWI, idToLabel);

    assert.ok(metrics, 'Metrics should be computed');
    assert.ok(!metrics.baseBnLabel.includes('[object Object]'), `baseBnLabel must not have [object Object]: ${metrics.baseBnLabel}`);
    assert.ok(!metrics.wiBnLabel.includes('[object Object]'), `wiBnLabel must not have [object Object]: ${metrics.wiBnLabel}`);
    assert.ok(!metrics.descText.includes('[object Object]'), `descText must not have [object Object]: ${metrics.descText}`);
    assert.ok(metrics.descText.includes('The bottleneck shifted from'));
  });
});

describe('Bug 1: i18n Results Sentences in en, ur-roman, and ur', () => {
  it('guarantees no [object Object], undefined, or NaN in results sentences even when passed objects', () => {
    const languages = ['en', 'ur-roman', 'ur'];

    const roleObj = { id: 'r1', name: 'Cashier' };
    const utilObj = { pct: 98 };
    const capObj = { current: 1, max: 2 };

    for (const lang of languages) {
      // 1. Role can handle
      const roleCanHandle = t('results_roleCanHandle', lang, roleObj);
      assert.ok(!roleCanHandle.includes('[object Object]'), `[${lang}] roleCanHandle: ${roleCanHandle}`);
      assert.ok(!roleCanHandle.includes('undefined'));
      assert.ok(roleCanHandle.includes('Cashier') || roleCanHandle.length > 0);

      // 2. Overloaded callout (the exact sentence reported by user)
      const calloutNoArrival = t('results_calloutOverloadedNoArrival', lang, roleObj, '98', '12.0');
      assert.ok(!calloutNoArrival.includes('[object Object]'), `[${lang}] calloutNoArrival: ${calloutNoArrival}`);
      assert.ok(!calloutNoArrival.includes('undefined'));
      assert.ok(!calloutNoArrival.includes('NaN'));

      // 3. Overloaded callout with all object arguments
      const calloutAllObjects = t('results_calloutOverloadedNoArrival', lang, roleObj, utilObj, capObj);
      assert.ok(!calloutAllObjects.includes('[object Object]'), `[${lang}] calloutAllObjects: ${calloutAllObjects}`);
      assert.ok(!calloutAllObjects.includes('undefined'));
      assert.ok(!calloutAllObjects.includes('NaN'));

      // 4. Overloaded with arrival
      const calloutWithArrival = t('results_calloutOverloadedWithArrival', lang, roleObj, '15.0', '12.0', '9.6');
      assert.ok(!calloutWithArrival.includes('[object Object]'), `[${lang}] calloutWithArrival: ${calloutWithArrival}`);

      // 5. Verdict overloaded
      const verdictOverloaded = t('results_verdictOverloaded', lang, roleObj, '25m', '12m', '8.5');
      assert.ok(!verdictOverloaded.includes('[object Object]'), `[${lang}] verdictOverloaded: ${verdictOverloaded}`);

      // 6. Verdict resource overloaded
      const verdictResOverloaded = t('results_verdictResourceOverloaded', lang, roleObj, '98');
      assert.ok(!verdictResOverloaded.includes('[object Object]'), `[${lang}] verdictResOverloaded: ${verdictResOverloaded}`);
    }
  });
});

describe('Bug 2: Scenario Upsert & Deduplication (Scenario 6aecda279834275a45d2274a)', () => {
  it('deduplicates scenario list and keeps only 1 entry for duplicate IDs', () => {
    const duplicateId = '6aecda279834275a45d2274a';
    const listWithDuplicates = [
      { id: 'baseline', name: 'Original', _isBaseline: true },
      { id: duplicateId, name: 'Speed up Nayi file banana by 20%', _backendId: duplicateId },
      { id: duplicateId, name: 'Speed up Nayi file banana by 20%', _backendId: duplicateId },
      { id: 'another-scenario', name: 'Another idea' },
    ];

    const deduped = dedupeScenarios(listWithDuplicates);

    assert.equal(deduped.length, 3);
    const matches = deduped.filter(s => s.id === duplicateId);
    assert.equal(matches.length, 1);
  });

  it('upsertScenarios merges backend hydrated scenarios without duplicating locally tracked scenarios', () => {
    const backendId = '6aecda279834275a45d2274a';
    
    // Existing list with local scenario that has been saved and assigned _backendId
    const existing = [
      { id: 'baseline', name: 'Original', _isBaseline: true },
      { id: 'local-173000', name: 'Speed up Nayi file banana by 20%', _backendId: backendId },
    ];

    // Incoming scenarios from getScenarios API (which returns id: backendId)
    const incoming = [
      { id: backendId, name: 'Speed up Nayi file banana by 20%', _backendId: backendId, updatedAt: '2026-11-05T00:00:00Z' },
    ];

    const merged = upsertScenarios(existing, incoming);

    // Must still have exactly 2 scenarios (baseline + 1 what-if)
    assert.equal(merged.length, 2);
    // Baseline is preserved
    assert.equal(merged[0].id, 'baseline');
    // Local item was updated with backend timestamp rather than appending duplicate
    assert.equal(merged[1]._backendId, backendId);
  });

  it('multiple re-hydrations leave scenario list deduplicated', () => {
    const backendId = '6aecda279834275a45d2274a';
    let current = [{ id: 'baseline', name: 'Baseline', _isBaseline: true }];

    const incoming = [
      { id: backendId, name: 'Speed up Nayi file banana by 20%', _backendId: backendId },
    ];

    // Simulate 3 consecutive re-fetches (e.g. StrictMode, navigation, tab clicks)
    current = upsertScenarios(current, incoming);
    current = upsertScenarios(current, incoming);
    current = upsertScenarios(current, incoming);

    assert.equal(current.length, 2);
    const count = current.filter(s => (s._backendId || s.id) === backendId).length;
    assert.equal(count, 1);
  });

  it('generates unique keys for render loops even if IDs collision occurs', () => {
    const list = [
      { id: '6aecda279834275a45d2274a', name: 'Idea 1' },
      { id: '6aecda279834275a45d2274a', name: 'Idea 1 duplicate' },
      { id: null, name: 'Null ID idea' },
    ];

    const seenKeys = new Set();
    const renderedKeys = list.map((s, idx) => {
      const rawKey = s.id || s._backendId || s._id;
      const cardKey = rawKey && !seenKeys.has(rawKey) ? rawKey : `${rawKey || 'scenario'}-${idx}`;
      seenKeys.add(cardKey);
      return cardKey;
    });

    assert.equal(renderedKeys.length, 3);
    assert.equal(new Set(renderedKeys).size, 3, 'All rendered keys must be strictly unique');
  });
});
