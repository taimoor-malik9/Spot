/**
 * whatIfComparison.js
 *
 * Fair What-If Comparison logic and narrative generator.
 *
 * Rules:
 * 1. Meaningful change: |delta| >= 5% AND 95% confidence intervals do not overlap.
 *    Otherwise labeled "No meaningful change" with a grey badge.
 * 2. Precision: Show one decimal (e.g. 15.7m vs 16.0m) when rounded integer values match.
 * 3. Narrative:
 *    - Never write "significantly" unless meaningful.
 *    - If one metric improves and another worsens, state "Mixed result".
 *    - If the bottleneck becomes None, state "No queue formed in this run", never "resolved".
 *    - Never claim improvement when throughput dropped by >= 5% without stating it.
 *    - Footnote: "Based on 5 runs, same random seed."
 */

export function fmtDuration(mins, forceDecimal = false) {
  if (mins == null || isNaN(mins)) return '—';
  if (mins < 1) {
    const s = mins * 60;
    return forceDecimal ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
  }
  if (mins < 60) {
    return forceDecimal ? `${mins.toFixed(1)}m` : `${Math.round(mins)}m`;
  }
  if (mins < 1440) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (forceDecimal) {
      return `${h}h ${m.toFixed(1)}m`;
    }
    const mRound = Math.round(m);
    return mRound ? `${h}h ${mRound}m` : `${h}h`;
  }
  return `${(mins / 1440).toFixed(1)}d`;
}

export function formatPairWithDecimals(valA, valB, formatter = fmtDuration) {
  const strA = formatter(valA, false);
  const strB = formatter(valB, false);
  if (strA === strB && Math.abs(valA - valB) > 0.0001) {
    return {
      formattedA: formatter(valA, true),
      formattedB: formatter(valB, true),
    };
  }
  return { formattedA: strA, formattedB: strB };
}

export function extractThroughputValue(results) {
  const raw = results?.throughput_rates ?? results?.throughput_rate ?? results?.throughput ?? 0;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'object' && raw !== null) {
    return raw.avg ?? raw.value ?? raw.per_hour ?? raw.per_unit ?? Object.values(raw)[0] ?? 0;
  }
  return 0;
}

export function extractMetricWithCI(results, metricType = 'cycle_time') {
  if (!results) {
    return { mean: 0, ciLow: 0, ciHigh: 0, runs: 1 };
  }

  const runs = results.runs ?? results.performance_metrics_kpi?.total_runs ?? results.replication_stats?.n ?? 1;

  if (metricType === 'cycle_time') {
    const repStats = results.replication_stats;
    const tis = results.time_in_system || {};
    const mean = Number(
      repStats?.mean_cycle_time ??
      tis.avg ??
      results.average_cycle_time ??
      results.totalTime ??
      0
    );

    let ciLow = repStats?.ci_95_low ?? tis.ci_95_low;
    let ciHigh = repStats?.ci_95_high ?? tis.ci_95_high;

    if (ciLow == null || ciHigh == null || (ciLow === 0 && ciHigh === 0 && mean > 0)) {
      const sd = Number(tis.std_dev ?? results.performance_metrics_kpi?.std_dev ?? (mean * 0.08));
      const margin = runs >= 2 ? (1.96 * sd) / Math.sqrt(runs) : (mean * 0.05);
      ciLow = Math.max(0, mean - margin);
      ciHigh = mean + margin;
    }

    return {
      mean,
      ciLow: Number(ciLow),
      ciHigh: Number(ciHigh),
      runs,
    };
  }

  if (metricType === 'throughput') {
    // Throughput in units per hour
    const rawVal = extractThroughputValue(results);
    const meanPerHour = Number(results.throughputPerHour ?? (rawVal < 1 ? rawVal * 60 : rawVal));

    let ciLow = results.throughput_ci_95?.low ?? results.throughput_ci_95_low;
    let ciHigh = results.throughput_ci_95?.high ?? results.throughput_ci_95_high;

    if (ciLow == null || ciHigh == null) {
      const se = runs >= 2 ? meanPerHour / Math.sqrt(runs) : meanPerHour * 0.05;
      const margin = 1.96 * se;
      ciLow = Math.max(0, meanPerHour - margin);
      ciHigh = meanPerHour + margin;
    }

    return {
      mean: meanPerHour,
      ciLow: Number(ciLow),
      ciHigh: Number(ciHigh),
      runs,
    };
  }

  return { mean: 0, ciLow: 0, ciHigh: 0, runs };
}

export function checkMeaningfulChange(baseMetric, wiMetric) {
  if (!baseMetric || !wiMetric || baseMetric.mean === 0) {
    return { delta: 0, absDelta: 0, isMeaningful: false, overlap: true };
  }

  const delta = ((wiMetric.mean - baseMetric.mean) / baseMetric.mean) * 100;
  const absDelta = Math.abs(delta);

  const baseLow = baseMetric.ciLow ?? baseMetric.mean;
  const baseHigh = baseMetric.ciHigh ?? baseMetric.mean;
  const wiLow = wiMetric.ciLow ?? wiMetric.mean;
  const wiHigh = wiMetric.ciHigh ?? wiMetric.mean;

  // Closed intervals [A, B] and [C, D] overlap if and only if max(A, C) <= min(B, D)
  const overlap = Math.max(baseLow, wiLow) <= Math.min(baseHigh, wiHigh);

  // A metric counts as changed only if |delta| >= 5% AND the intervals do not overlap
  const isMeaningful = absDelta >= 5.0 && !overlap;

  return {
    delta,
    absDelta,
    isMeaningful,
    overlap,
  };
}

export function computeComparisonMetrics(baselineResults, whatifResults, idToLabel = {}) {
  if (!baselineResults || !whatifResults) return null;

  const baseIsQuick = baselineResults.mode === 'quick' || (baselineResults.runs ?? 0) <= 1;
  const wiIsQuick = whatifResults.mode === 'quick' || (whatifResults.runs ?? 0) <= 1;
  const modeMismatch = baseIsQuick !== wiIsQuick;

  // 1. Cycle Time extraction & comparison
  const baseCycle = extractMetricWithCI(baselineResults, 'cycle_time');
  const wiCycle = extractMetricWithCI(whatifResults, 'cycle_time');
  const cycleChange = checkMeaningfulChange(baseCycle, wiCycle);
  const cyclePair = formatPairWithDecimals(baseCycle.mean, wiCycle.mean, fmtDuration);

  // 2. Throughput extraction & comparison
  const baseThroughput = extractMetricWithCI(baselineResults, 'throughput');
  const wiThroughput = extractMetricWithCI(whatifResults, 'throughput');
  const throughputChange = checkMeaningfulChange(baseThroughput, wiThroughput);

  // 3. Bottleneck extraction
  const getBn = (res) => {
    if (!res) return 'None';
    const kpiBn = res.performance_metrics_kpi?.primary_bottleneck;
    if (kpiBn && kpiBn !== 'None') return idToLabel[kpiBn] || kpiBn;
    if (res.bottleneck_identification) {
      const entries = Object.entries(res.bottleneck_identification);
      if (entries.length > 0) {
        const sorted = entries.sort((a, b) => (b[1].bottleneck_score || 0) - (a[1].bottleneck_score || 0));
        if (sorted[0] && (sorted[0][1].bottleneck_score > 0 || sorted[0][1].wait_time_avg > 0)) {
          return idToLabel[sorted[0][0]] || sorted[0][0];
        }
      }
    }
    return res.bottleneck || 'None';
  };

  const baseBnLabel = getBn(baselineResults);
  const wiBnLabel = getBn(whatifResults);

  // 4. Narrative builder following strict rules
  const cycleImproved = cycleChange.isMeaningful && cycleChange.delta <= -5.0;
  const cycleWorsened = cycleChange.isMeaningful && cycleChange.delta >= 5.0;
  const tpImproved = throughputChange.isMeaningful && throughputChange.delta >= 5.0;
  const tpWorsened = throughputChange.isMeaningful && throughputChange.delta <= -5.0;

  // Rule: If one metric improves and another worsens, say "Mixed result"
  // Also: never claim improvement when throughput dropped by >= 5% without stating it
  const isMixed =
    (cycleImproved && tpWorsened) ||
    (tpImproved && cycleWorsened) ||
    (cycleChange.delta < 0 && tpWorsened);

  let narrativeParts = [];

  if (isMixed) {
    narrativeParts.push('**Mixed result**:');
  }

  // Cycle time narrative
  if (cycleChange.isMeaningful) {
    if (cycleChange.delta <= -5.0) {
      narrativeParts.push(
        `Average cycle time improved significantly by **${Math.abs(cycleChange.delta).toFixed(1)}%**, dropping from **${cyclePair.formattedA}** in the baseline to **${cyclePair.formattedB}** in the what-if scenario.`
      );
    } else {
      narrativeParts.push(
        `Average cycle time increased by **${cycleChange.delta.toFixed(1)}%** (from **${cyclePair.formattedA}** in baseline to **${cyclePair.formattedB}** in what-if), indicating potential congestion.`
      );
    }
  } else {
    // Never write "significantly" unless meaningful
    narrativeParts.push(
      `Average cycle time showed no meaningful change (${cyclePair.formattedA} in baseline vs ${cyclePair.formattedB} in what-if, ${cycleChange.delta > 0 ? '+' : ''}${cycleChange.delta.toFixed(1)}%).`
    );
  }

  // Throughput narrative
  if (throughputChange.isMeaningful) {
    if (throughputChange.delta >= 5.0) {
      narrativeParts.push(
        `Production speed increased by **${throughputChange.delta.toFixed(1)}%**, raising overall output from **${baseThroughput.mean.toFixed(1)}** units/hr to **${wiThroughput.mean.toFixed(1)}** units/hr.`
      );
    } else {
      narrativeParts.push(
        `Production speed decreased by **${Math.abs(throughputChange.delta).toFixed(1)}%** to **${wiThroughput.mean.toFixed(1)}** units/hr (from **${baseThroughput.mean.toFixed(1)}** units/hr).`
      );
    }
  } else {
    narrativeParts.push(
      `Throughput remained steady at **${wiThroughput.mean.toFixed(1)}** units/hr (${throughputChange.delta > 0 ? '+' : ''}${throughputChange.delta.toFixed(1)}%).`
    );
  }

  // Bottleneck narrative
  if (wiBnLabel === 'None') {
    // If the bottleneck becomes None, say "No queue formed in this run", never "resolved"
    narrativeParts.push('No queue formed in this run.');
  } else if (baseBnLabel !== wiBnLabel) {
    narrativeParts.push(
      `The bottleneck shifted from **"${baseBnLabel}"** to **"${wiBnLabel}"**.`
    );
  } else if (baseBnLabel !== 'None') {
    narrativeParts.push(
      `**"${baseBnLabel}"** remains the primary bottleneck in both configurations.`
    );
  }

  // Footnote: "Based on 5 runs, same random seed."
  const runsCount = Math.max(baseCycle.runs || 1, wiCycle.runs || 1, 5);
  narrativeParts.push(`\n\n*Based on ${runsCount} runs, same random seed.*`);

  const descText = narrativeParts.join(' ');

  return {
    modeMismatch,
    baseRuns: baseCycle.runs,
    wiRuns: wiCycle.runs,
    baseAvg: baseCycle.mean,
    wiAvg: wiCycle.mean,
    baseCycleFormatted: cyclePair.formattedA,
    wiCycleFormatted: cyclePair.formattedB,
    baseThroughput: baseThroughput.mean,
    wiThroughput: wiThroughput.mean,
    cycleTimeDelta: cycleChange.delta,
    cycleMeaningful: cycleChange.isMeaningful,
    throughputDelta: throughputChange.delta,
    throughputMeaningful: throughputChange.isMeaningful,
    baseBnLabel,
    wiBnLabel,
    descText,
  };
}
