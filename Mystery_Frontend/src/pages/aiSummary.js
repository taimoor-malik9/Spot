import { formatDuration, busyStatus } from './plainLanguage';

function round(n, d = 2) {
  if (n == null || isNaN(n)) return 0;
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

export function buildResultsSummary(results, idToLabel = {}, simMode = 'quick', idToResource = {}) {
  if (!results) return null;

  const tis = results.time_in_system || {};
  const throughputRaw = results.throughput_rates ?? results.throughput_rate ?? 0;
  const throughputPerHour = round((typeof throughputRaw === 'number' ? throughputRaw : 0) * 60, 2);

  const actObj = results.activity_results || {};
  const activities = Object.entries(actObj)
    .filter(([id]) => {
      // Only suggest changes to steps that have resources assigned
      if (idToResource && Object.keys(idToResource).length > 0) {
        return Boolean(idToResource[id]);
      }
      return true;
    })
    .map(([id, v]) => ({
      name: idToLabel[id] || id,
      assigned_resource: idToResource?.[id] || null,
      avg_cycle_time_min: round(v.avg_cycle_time),
      avg_processing_time_min: round(v.avg_processing_time),
      avg_wait_time_min: round(v.avg_wait_time),
      avg_wait_plain: formatDuration(v.avg_wait_time),
      avg_work_plain: formatDuration(v.avg_processing_time),
      efficiency_pct: round(v.efficiency_pct),
    }))
    .sort((a, b) => b.avg_wait_time_min - a.avg_wait_time_min)
    .slice(0, 6);

  const utilObj = results.resource_utilization || {};
  const resources = Object.entries(utilObj)
    .map(([name, v]) => {
      const util = round(v.utilization_pct);
      return {
        name,
        utilization_pct: util,
        idle_pct: round(100 - util),
        status: busyStatus(util).key,
        capacity: v.capacity,
      };
    })
    .sort((a, b) => b.utilization_pct - a.utilization_pct)
    .slice(0, 6);

  const queueObj = results.queue_levels || {};
  const queues = Object.entries(queueObj)
    .map(([id, v]) => ({
      name: idToLabel[id] || id,
      avg_queue_length: round(v.avg_queue_length),
      avg_wait_time_min: round(v.avg_wait_time),
      avg_wait_plain: formatDuration(v.avg_wait_time),
    }))
    .sort((a, b) => b.avg_queue_length - a.avg_queue_length)
    .slice(0, 5);

  const kpi = results.performance_metrics_kpi || {};
  const bn = results.bottleneck_identification || {};
  const primaryBottleneckId = kpi.primary_bottleneck;
  const pbHasResource = !idToResource || Object.keys(idToResource).length === 0 || Boolean(idToResource[primaryBottleneckId]);
  const primaryBottleneck = primaryBottleneckId
    ? {
        name: idToLabel[primaryBottleneckId] || primaryBottleneckId,
        has_assigned_resource: pbHasResource,
        assigned_resource: idToResource?.[primaryBottleneckId] || null,
        wait_time_avg_min: round(bn[primaryBottleneckId]?.wait_time_avg),
        wait_plain: formatDuration(bn[primaryBottleneckId]?.wait_time_avg),
        processing_time_avg_min: round(bn[primaryBottleneckId]?.processing_time_avg),
      }
    : null;

  const longestWait = activities[0]
    ? { name: activities[0].name, wait_plain: activities[0].avg_wait_plain }
    : null;

  const fin = results.financial_summary || null;
  const financial = fin
    ? {
        total_cost: round(fin.total_cost),
        active_cost: round(fin.total_active_cost),
        idle_cost: round(fin.total_idle_cost),
        idle_cost_pct: fin.total_cost > 0 ? round((fin.total_idle_cost / fin.total_cost) * 100) : 0,
      }
    : null;

  return {
    sim_mode: simMode,
    total_runs: results.runs ?? kpi.total_runs ?? 1,
    simulation_confidence: kpi.simulation_confidence,
    time_in_system_min: {
      avg: round(tis.avg),
      min: round(tis.min),
      max: round(tis.max),
      p95: round(tis.p95),
      std_dev: round(tis.std_dev),
    },
    time_in_system_plain: {
      average: formatDuration(tis.avg),
      fastest: formatDuration(tis.min),
      slowest: formatDuration(tis.max),
    },
    throughput_units_per_hour: throughputPerHour,
    system_efficiency_pct: round(kpi.system_efficiency),
    avg_resource_utilization_pct: round(kpi.avg_resource_utilization),
    avg_queue_depth: round(kpi.avg_queue_depth),
    primary_bottleneck: primaryBottleneck,
    longest_wait_step: longestWait,
    top_wait_activities: activities,
    resource_utilization: resources,
    queue_hotspots: queues,
    financial,
  };
}