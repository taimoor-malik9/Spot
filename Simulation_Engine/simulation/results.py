# results.py
import math


def _std_dev(values):
    n = len(values)
    if n < 2:
        return 0.0
    mean = sum(values) / n
    return math.sqrt(sum((x - mean) ** 2 for x in values) / (n - 1))


def _confidence_interval_95(values):
    """95% CI using t-distribution approximation."""
    n = len(values)
    if n < 2:
        return (0.0, 0.0)
    mean = sum(values) / n
    sd = _std_dev(values)
    z = 1.96 if n >= 30 else 2.0
    margin = z * sd / math.sqrt(n)
    return (round(mean - margin, 3), round(mean + margin, 3))


def _histogram(values, bins=10):
    if not values:
        return []
    lo, hi = min(values), max(values)
    if lo == hi:
        return [{"bin_start": round(lo, 3), "bin_end": round(hi, 3), "count": len(values)}]
    width = (hi - lo) / bins
    buckets = [0] * bins
    for v in values:
        idx = min(int((v - lo) / width), bins - 1)
        buckets[idx] += 1
    return [
        {
            "bin_start": round(lo + i * width, 3),
            "bin_end": round(lo + (i + 1) * width, 3),
            "count": buckets[i]
        }
        for i in range(bins)
    ]


def compute_results(all_times, all_task_durations, all_task_wait_times=None,
                    all_resource_busy=None, resources_dict=None,
                    task_arrival_times=None, task_queue_depths=None,
                    total_sim_time=None):
    n_runs = len(all_times)
    if n_runs == 0:
        return {"error": "No simulation data generated."}

    # ── 1. Time in System (Cycle Time) ────────────────────────────────────────
    total_avg = sum(all_times) / n_runs
    ci_low, ci_high = _confidence_interval_95(all_times)
    time_in_system = {
        "avg": round(total_avg, 3),
        "min": round(min(all_times), 3),
        "max": round(max(all_times), 3),
        "p95": round(sorted(all_times)[int(len(all_times) * 0.95)], 3) if n_runs > 0 else 0,
        "std_dev": round(_std_dev(all_times), 3),
        "ci_95_low": ci_low,
        "ci_95_high": ci_high,
        "histogram": _histogram(all_times)
    }

    # ── 2. Throughput ─────────────────────────────────────────────────────────
    # FIX: use actual simulation wall-clock time, not max single token cycle time
    if total_sim_time and total_sim_time > 0:
        throughput = n_runs / total_sim_time
    else:
        # Fallback: use max cycle time (less accurate, only when sim_time unavailable)
        max_cycle = max(all_times)
        throughput = n_runs / max_cycle if max_cycle > 0 else 0.0

    # ── 3. Bottleneck Identification ──────────────────────────────────────────
    bottleneck_scores = {}
    if all_task_wait_times and all_task_durations:
        for task_id in all_task_durations:
            durations = all_task_durations[task_id]
            waits = all_task_wait_times.get(task_id, [0])
            avg_proc = sum(durations) / len(durations)
            avg_wait = sum(waits) / len(waits)
            total = avg_wait + avg_proc
            # Wait ratio: fraction of total task time spent queuing.
            # Scale-independent — 0% = no queuing, 100% = pure bottleneck.
            # avg_proc kept as 10% tie-breaker so tasks with identical wait
            # ratios rank by processing time (relevant in quick/no-load runs).
            if total > 0:
                wait_ratio = avg_wait / total          # 0.0 – 1.0
                proc_ratio = avg_proc / total          # tie-breaker
                score = (wait_ratio * 90) + (proc_ratio * 10)
            else:
                score = 0.0
            bottleneck_scores[task_id] = {
                "wait_time_avg": round(avg_wait, 3),
                "processing_time_avg": round(avg_proc, 3),
                "bottleneck_score": round(score, 3)
            }

    # ── 4. Resource Utilization ───────────────────────────────────────────────
    resource_utilization = {}
    if resources_dict and all_resource_busy:
        if isinstance(resources_dict, list):
            res_dict = {r.get("name", ""): r.get("quantity", 1) for r in resources_dict if r.get("name")}
        else:
            res_dict = resources_dict

        # FIX: use total_sim_time * capacity as the available time denominator
        sim_time_for_util = total_sim_time if (total_sim_time and total_sim_time > 0) else max(all_times)
        for res_name, capacity in res_dict.items():
            normalized_res_name = res_name.strip().lower()
            if normalized_res_name in all_resource_busy and capacity > 0:
                total_busy = sum(all_resource_busy[normalized_res_name])
                total_available = sim_time_for_util * int(capacity)
                utilization_pct = (total_busy / total_available) * 100 if total_available > 0 else 0.0
                resource_utilization[res_name] = {
                    "utilization_pct": round(utilization_pct, 2),
                    "idle_pct": round(100 - utilization_pct, 2),
                    "capacity": capacity,
                    "avg_busy_time_per_item": round(total_busy / n_runs, 3)
                }

    # ── 5. Queue Levels ───────────────────────────────────────────────────────
    # FIX: use Little's Law — L = λ × W
    queue_levels = {}
    if all_task_wait_times:
        for task_id, waits in all_task_wait_times.items():
            avg_wait = sum(waits) / len(waits)
            max_wait = max(waits)
            # Little's Law: avg queue length = throughput * avg wait time
            avg_queue_length = round(throughput * avg_wait, 3)
            queue_levels[task_id] = {
                "avg_queue_length": avg_queue_length,
                "avg_wait_time": round(avg_wait, 3),
                "max_wait_time": round(max_wait, 3),
                "wait_histogram": _histogram(waits)
            }

    # ── 6. Activity Results ───────────────────────────────────────────────────
    activity_results = {}
    if all_task_durations:
        for task_id, durations in all_task_durations.items():
            avg_proc = sum(durations) / len(durations)
            waits = all_task_wait_times.get(task_id, [0]) if all_task_wait_times else [0]
            avg_wait = sum(waits) / len(waits)
            cycle = avg_proc + avg_wait
            efficiency = (avg_proc / cycle * 100) if cycle > 0 else 0
            proc_ci_low, proc_ci_high = _confidence_interval_95(durations)
            wait_ci_low, wait_ci_high = _confidence_interval_95(waits)
            activity_results[task_id] = {
                "avg_cycle_time": round(cycle, 3),
                "avg_processing_time": round(avg_proc, 3),
                "avg_wait_time": round(avg_wait, 3),
                "efficiency_pct": round(efficiency, 2),
                "std_dev_processing": round(_std_dev(durations), 3),
                "std_dev_wait": round(_std_dev(waits), 3),
                "ci_95_processing": {"low": proc_ci_low, "high": proc_ci_high},
                "ci_95_wait": {"low": wait_ci_low, "high": wait_ci_high},
                "processing_histogram": _histogram(durations),
                "time_breakdown": {
                    "working_pct": round(efficiency, 2),
                    "blocked_pct": round((avg_wait / cycle * 100) if cycle > 0 else 0, 2),
                    "idle_pct": 0.0
                }
            }

    # ── 7. KPI Summary ────────────────────────────────────────────────────────
    primary_bottleneck = (
        max(bottleneck_scores, key=lambda k: bottleneck_scores[k]["bottleneck_score"])
        if bottleneck_scores else None
    )

    all_idle_pcts = []
    all_queue_depth_values = []

    if task_arrival_times:
        for task_id in all_task_durations:
            idle_key = f"{task_id}_idle"
            idle_times = task_arrival_times.get(idle_key, [])
            if idle_times:
                avg_idle = sum(idle_times) / len(idle_times)
                waits = all_task_wait_times.get(task_id, []) if all_task_wait_times else []
                durations = all_task_durations.get(task_id, [])
                if durations and len(waits) == len(durations):
                    cycles = [d + w for d, w in zip(durations, waits)]
                    idle_pcts = [(i / c * 100) if c > 0 else 0
                                 for i, c in zip(idle_times[:len(cycles)], cycles)]
                    all_idle_pcts.extend(idle_pcts)

    # FIX: task_queue_depths is now a dict keyed by task_id
    if task_queue_depths and isinstance(task_queue_depths, dict):
        for task_id, depths in task_queue_depths.items():
            all_queue_depth_values.extend(depths)

    avg_idle_pct = sum(all_idle_pcts) / len(all_idle_pcts) if all_idle_pcts else 0.0
    avg_queue_depth = sum(all_queue_depth_values) / len(all_queue_depth_values) if all_queue_depth_values else 0.0
    max_queue_depth = max(all_queue_depth_values) if all_queue_depth_values else 0

    kpi_summary = {
        "throughput_rate": round(throughput, 4),
        "avg_time_in_system": round(time_in_system["avg"], 3),
        "ci_95_time_in_system": {"low": ci_low, "high": ci_high},
        "primary_bottleneck": primary_bottleneck,
        "avg_resource_utilization": round(
            sum(r["utilization_pct"] for r in resource_utilization.values()) / max(len(resource_utilization), 1), 2
        ),
        "system_efficiency": round(
            sum(a["efficiency_pct"] for a in activity_results.values()) / max(len(activity_results), 1), 2
        ),
        "avg_idle_pct": round(avg_idle_pct, 2),
        "avg_queue_depth": round(avg_queue_depth, 2),
        "max_queue_depth": max_queue_depth,
        "total_runs": n_runs,
        "simulation_confidence": "high" if n_runs >= 300 else "medium" if n_runs >= 150 else "low"
    }

    return {
        "time_in_system": time_in_system,
        "throughput_rates": round(throughput, 4),
        "bottleneck_identification": bottleneck_scores,
        "resource_utilization": resource_utilization,
        "queue_levels": queue_levels,
        "activity_results": activity_results,
        "performance_metrics_kpi": kpi_summary,
        "runs": n_runs,
        "queue_sampling": {
            "avg_depth": round(avg_queue_depth, 2),
            "max_depth": max_queue_depth,
            "samples": len(all_queue_depth_values)
        }
    }