# monte_carlo.py
import random
import simpy
import numpy as np
import copy
from simulation.traversal import simulate_process

# Student's t 0.975 quantile (two-sided 95% CI). df >= 30 uses 1.96.
_T_CRIT_95 = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
    6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
    11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131,
    16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
    21: 2.080, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.060,
    26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042,
}


def seed_replication(seed, i):
    """Seed numpy (and Python random) for replication i. No-op if seed is None."""
    if seed is None:
        return
    s = int(seed) + int(i)
    np.random.seed(s)
    random.seed(s)


def _trim_warmup_list(values, warmup_pct):
    if not values or warmup_pct <= 0:
        return values
    drop = int(len(values) * warmup_pct)
    if drop <= 0:
        return values
    if drop >= len(values):
        drop = len(values) - 1
    return values[drop:]


def apply_warmup(all_times, all_task_durations, all_task_wait_times,
                 all_resource_busy, all_task_arrival_times, all_task_queue_depths,
                 warmup_pct):
    """Drop the first warmup_pct of each collected list (per replication)."""
    def trim_dict(d):
        if not d:
            return d or {}
        return {
            k: _trim_warmup_list(v, warmup_pct) if isinstance(v, list) else v
            for k, v in d.items()
        }

    return (
        _trim_warmup_list(all_times, warmup_pct),
        trim_dict(all_task_durations),
        trim_dict(all_task_wait_times),
        trim_dict(all_resource_busy),
        trim_dict(all_task_arrival_times),
        trim_dict(all_task_queue_depths),
    )


def _t_crit_95(df):
    if df <= 0:
        return _T_CRIT_95[1]
    if df >= 30:
        return 1.96
    return _T_CRIT_95.get(int(df), 1.96)


def t_interval_95(values):
    """95% CI of the mean using the t-distribution. Returns (mean, low, high)."""
    n = len(values)
    if n == 0:
        return 0.0, 0.0, 0.0
    mean = sum(values) / n
    if n < 2:
        return mean, mean, mean
    var = sum((x - mean) ** 2 for x in values) / (n - 1)
    sd = var ** 0.5
    margin = _t_crit_95(n - 1) * sd / (n ** 0.5)
    return mean, mean - margin, mean + margin


def mean_of_lists(dict_of_lists):
    values = []
    for vals in (dict_of_lists or {}).values():
        values.extend(vals)
    if not values:
        return 0.0
    return sum(values) / len(values)


def build_replication_stats(cycle_means, wait_means=None, total_costs=None):
    n = len(cycle_means)
    mean_ct, ci_low, ci_high = t_interval_95(cycle_means)
    stats = {
        "n": n,
        "mean_cycle_time": round(mean_ct, 3),
        "ci_95_low": round(ci_low, 3),
        "ci_95_high": round(ci_high, 3),
        "per_replication_means": [round(m, 3) for m in cycle_means],
    }
    if wait_means is not None:
        mean_w, w_low, w_high = t_interval_95(wait_means)
        stats["per_replication_avg_wait"] = [round(m, 3) for m in wait_means]
        stats["mean_avg_wait"] = round(mean_w, 3)
        stats["wait_ci_95_low"] = round(w_low, 3)
        stats["wait_ci_95_high"] = round(w_high, 3)
    if total_costs is not None:
        mean_c, c_low, c_high = t_interval_95(total_costs)
        stats["per_replication_total_cost"] = [round(m, 2) for m in total_costs]
        stats["mean_total_cost"] = round(mean_c, 2)
        stats["cost_ci_95_low"] = round(c_low, 2)
        stats["cost_ci_95_high"] = round(c_high, 2)
    return stats


def _normalize_resources(resources_input):
    if not resources_input:
        return {}
    if isinstance(resources_input, list):
        return {r["name"].strip().lower(): r.get("quantity", 1) for r in resources_input}
    return {k.strip().lower(): v for k, v in resources_input.items()}


def arrival_generator(env, graph, start_node, arrival_rate, resources, results_containers, limit=None):
    token_count = 0
    (all_times, all_task_durations, all_task_wait_times,
     all_resource_busy, all_task_arrival_times, all_task_queue_depths) = results_containers

    while True:
        if limit and token_count >= limit:
            break

        yield env.timeout(np.random.exponential(1.0 / arrival_rate))

        env.process(simulate_process(
            env, start_node, graph, all_times, all_task_durations,
            resources, all_task_wait_times, all_resource_busy,
            all_task_arrival_times, all_task_queue_depths
        ))
        token_count += 1


def run_single_pass(graph, start_node, resources_dict=None):
    deterministic_graph = copy.deepcopy(graph)
    for node_id, node in deterministic_graph["nodes"].items():
        data = node.get("data") or node
        d_min = data.get("duration_min")
        d_max = data.get("duration_max")
        if d_min is not None and d_max is not None:
            midpoint = (float(d_min) + float(d_max)) / 2
            if "data" in node and node["data"]:
                node["data"]["duration"] = midpoint
                node["data"].pop("duration_min", None)
                node["data"].pop("duration_max", None)
            else:
                node["duration"] = midpoint
                node.pop("duration_min", None)
                node.pop("duration_max", None)

    env = simpy.Environment()
    resources = {}  # No contention in quick mode

    all_times = []
    all_task_durations = {}
    all_task_wait_times = {}
    all_resource_busy = {}
    all_task_arrival_times = {}
    all_task_queue_depths = {}

    results_containers = (
        all_times, all_task_durations, all_task_wait_times,
        all_resource_busy, all_task_arrival_times, all_task_queue_depths
    )
    env.process(arrival_generator(
        env, deterministic_graph, start_node, arrival_rate=999, resources=resources,
        results_containers=results_containers, limit=1
    ))

    while len(all_times) < 1:
        env.step()

    total_sim_time = env.now

    return (all_times, all_task_durations, all_task_wait_times,
            all_resource_busy, all_task_arrival_times, all_task_queue_depths,
            total_sim_time)


def _has_converged(all_times, check_every, tolerance):
    n = len(all_times)
    if n < check_every * 2:
        return False, None

    recent   = all_times[-check_every:]
    previous = all_times[-check_every * 2:-check_every]

    recent_mean   = sum(recent)   / len(recent)
    previous_mean = sum(previous) / len(previous)

    if previous_mean <= 0:
        return False, None

    mean_change = abs(recent_mean - previous_mean) / previous_mean

    def _std(vals):
        m = sum(vals) / len(vals)
        return (sum((x - m) ** 2 for x in vals) / len(vals)) ** 0.5

    recent_std   = _std(recent)
    previous_std = _std(previous)
    std_change   = (abs(recent_std - previous_std) / previous_std
                    if previous_std > 0 else 0)

    converged = mean_change < tolerance and std_change < tolerance * 2

    convergence_info = {
        "converged":       converged,
        "mean_change_pct": round(mean_change * 100, 3),
        "std_change_pct":  round(std_change  * 100, 3),
        "recent_mean":     round(recent_mean, 3),
        "previous_mean":   round(previous_mean, 3),
        "runs_at_check":   n,
    }
    return converged, convergence_info


def run_until_convergence(graph, start_node, resources_dict=None,
                          arrival_rate=1.0, max_runs=2000,
                          min_runs=50, tolerance=0.02, check_every=50):
    env = simpy.Environment()

    resources = {}
    normalized = _normalize_resources(resources_dict)
    for name, capacity in normalized.items():
        resources[name] = simpy.Resource(env, capacity=int(capacity))

    all_times           = []
    all_task_durations  = {}
    all_task_wait_times = {}
    all_resource_busy   = {}
    all_task_arrival_times = {}
    all_task_queue_depths  = {}

    results_containers = (
        all_times, all_task_durations, all_task_wait_times,
        all_resource_busy, all_task_arrival_times, all_task_queue_depths
    )

    # Generator is capped at max_runs so it doesn't run forever if convergence fires late
    env.process(arrival_generator(
        env, graph, start_node, arrival_rate, resources, results_containers, limit=max_runs
    ))

    last_checked     = 0
    convergence_info = None

    while True:
        env.step()
        n = len(all_times)

        # Hard cap — always stop here regardless of convergence
        if n >= max_runs:
            if convergence_info is None:
                convergence_info = {
                    "converged":       False,
                    "reason":          "max_runs reached",
                    "runs_at_check":   n,
                    "mean_change_pct": None,
                    "std_change_pct":  None,
                    "recent_mean":     None,
                    "previous_mean":   None,
                }
            break

        # Only check at window boundaries after min_runs collected
        if n < min_runs or n % check_every != 0 or n == last_checked:
            continue

        last_checked = n
        converged, info = _has_converged(all_times, check_every, tolerance)
        if converged:
            info["reason"] = "converged"
            convergence_info = info
            break

    if convergence_info is None:
        convergence_info = {
            "converged":       False,
            "reason":          "insufficient data",
            "runs_at_check":   len(all_times),
            "mean_change_pct": None,
            "std_change_pct":  None,
            "recent_mean":     None,
            "previous_mean":   None,
        }

    total_sim_time = env.now

    return (all_times, all_task_durations, all_task_wait_times,
            all_resource_busy, all_task_arrival_times, all_task_queue_depths,
            total_sim_time, convergence_info)