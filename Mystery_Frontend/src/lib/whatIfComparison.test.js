/**
 * whatIfComparison.test.js
 *
 * Unit tests for Step R1:
 * - Uses exact numbers: 16m vs 16m with -2.2%, 6.2 vs 5.3/hr with a "None" bottleneck.
 * - Asserts:
 *   1. Cycle time labeled "No meaningful change" (badge and narrative).
 *   2. Formatted with 1 decimal when rounded would match ("16.0m" vs "15.7m" or "15.6m").
 *   3. Never writes "significantly" for the non-meaningful cycle time.
 *   4. Narrative states "Mixed result".
 *   5. Bottleneck "None" states "No queue formed in this run", never "resolved".
 *   6. Throughput drop (-14.9% or -14.5%) is stated clearly.
 *   7. Footnote states "Based on 5 runs, same random seed."
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  computeComparisonMetrics,
  checkMeaningfulChange,
  formatPairWithDecimals,
  fmtDuration,
} from './whatIfComparison.js';

describe('Step R1: What-If Comparison Fairness & Meaningful-Change Rules', () => {
  it('1. Decimal display when integer rounding matches (16.0m vs 15.7m)', () => {
    const pair = formatPairWithDecimals(16.0, 15.65, fmtDuration);
    assert.strictEqual(pair.formattedA, '16.0m');
    assert.strictEqual(pair.formattedB, '15.7m');

    // When values do not round to same integer, normal format is preserved
    const pairDiff = formatPairWithDecimals(20.0, 15.0, fmtDuration);
    assert.strictEqual(pairDiff.formattedA, '20m');
    assert.strictEqual(pairDiff.formattedB, '15m');
  });

  it('2. Meaningful change rule: |delta| >= 5% AND intervals do not overlap', () => {
    // Overlapping intervals: not meaningful even if delta was >= 5%
    const overlapping = checkMeaningfulChange(
      { mean: 100, ciLow: 90, ciHigh: 110 },
      { mean: 94, ciLow: 85, ciHigh: 103 } // -6% delta, but [90, 110] overlaps [85, 103]
    );
    assert.strictEqual(overlapping.isMeaningful, false);
    assert.strictEqual(overlapping.overlap, true);

    // Delta < 5%: not meaningful even if intervals were non-overlapping
    const smallDelta = checkMeaningfulChange(
      { mean: 16.0, ciLow: 15.8, ciHigh: 16.2 },
      { mean: 15.65, ciLow: 15.4, ciHigh: 15.7 } // -2.2% delta
    );
    assert.strictEqual(smallDelta.isMeaningful, false);

    // Both conditions met: |delta| >= 5% AND non-overlapping
    const meaningful = checkMeaningfulChange(
      { mean: 6.2, ciLow: 5.9, ciHigh: 6.5 },
      { mean: 5.3, ciLow: 5.0, ciHigh: 5.6 } // -14.5% delta, non-overlapping
    );
    assert.strictEqual(meaningful.isMeaningful, true);
    assert.strictEqual(meaningful.overlap, false);
  });

  it('3. Test exact scenario: 16m vs 16m (-2.2%), 6.2 vs 5.3/hr (-14.9%), "None" bottleneck', () => {
    const baselineResults = {
      runs: 5,
      mode: 'deep',
      time_in_system: {
        avg: 16.0,
        ci_95_low: 15.4,
        ci_95_high: 16.6,
      },
      replication_stats: {
        n: 5,
        mean_cycle_time: 16.0,
        ci_95_low: 15.4,
        ci_95_high: 16.6,
      },
      throughput_rates: 6.228 / 60, // 6.228 / hr -> 6.2 / hr
      throughput_ci_95: { low: 5.9, high: 6.5 },
      bottleneck: 'Cashier Checkout',
    };

    const whatifResults = {
      runs: 5,
      mode: 'deep',
      time_in_system: {
        avg: 15.65, // delta = (15.65 - 16.0) / 16.0 = -2.1875% -> -2.2%
        ci_95_low: 15.1,
        ci_95_high: 16.2, // overlaps with baseline [15.4, 16.6]
      },
      replication_stats: {
        n: 5,
        mean_cycle_time: 15.65,
        ci_95_low: 15.1,
        ci_95_high: 16.2,
      },
      throughput_rates: 5.3 / 60, // 5.3 / hr -> delta ~ -14.9%
      throughput_ci_95: { low: 5.0, high: 5.6 }, // does NOT overlap with baseline [5.9, 6.5]
      bottleneck: 'None',
      performance_metrics_kpi: {
        primary_bottleneck: 'None',
      },
    };

    const metrics = computeComparisonMetrics(baselineResults, whatifResults);

    // 1) Delta values and formatting
    assert.strictEqual(metrics.cycleTimeDelta.toFixed(1), '-2.2');
    assert.strictEqual(metrics.throughputDelta.toFixed(1), '-14.9');
    assert.strictEqual(metrics.baseCycleFormatted, '16.0m');
    assert.strictEqual(metrics.wiCycleFormatted, '15.7m');

    // 2) Cycle time: NOT meaningful, labeled "No meaningful change"
    assert.strictEqual(metrics.cycleMeaningful, false, 'Cycle time change of -2.2% with overlapping CI must NOT be meaningful');

    // 3) Throughput: meaningful drop
    assert.strictEqual(metrics.throughputMeaningful, true, 'Throughput drop of -14.9% must be meaningful');

    // 4) Bottleneck: None
    assert.strictEqual(metrics.wiBnLabel, 'None');

    // 5) Assert narrative rules and wording
    const text = metrics.descText;

    // Never write "significantly" unless meaningful (cycle time is not meaningful)
    assert.ok(!text.includes('improved significantly'), 'Must NOT write "improved significantly" for -2.2% non-meaningful cycle time');
    assert.ok(!text.includes('significantly'), 'Must NOT write "significantly" when cycle time is not meaningful');

    // If one metric improves and another worsens, say "Mixed result"
    assert.ok(text.includes('Mixed result'), 'Must state "Mixed result"');

    // If the bottleneck becomes None, say "No queue formed in this run", never "resolved"
    assert.ok(text.includes('No queue formed in this run'), 'Must state "No queue formed in this run"');
    assert.ok(!text.toLowerCase().includes('resolved'), 'Must NEVER say "resolved" when bottleneck becomes None');

    // Never claim improvement when throughput dropped by 5% or more without stating it
    assert.ok(text.includes('decreased by **14.9%**') || text.includes('decreased by 14.9%'), 'Must state throughput decrease');

    // Footnote: "Based on 5 runs, same random seed."
    assert.ok(text.includes('Based on 5 runs, same random seed.'), 'Must include footnote "Based on 5 runs, same random seed."');
  });
});
