"""Rule-based simulation experiments for the SPOT assistant.

This module deliberately contains no LLM integration. It proposes small,
repeatable changes, then obtains every reported number from the simulation
runner supplied by the API layer.
"""

from copy import deepcopy
from statistics import mean


def _data(node):
    return node.setdefault("data", {}) if isinstance(node.get("data"), dict) else node


def _average_wait(result):
    """Equal-weight mean of each simulated activity's average queue wait."""
    activities = result.get("activity_results", {})
    waits = [item.get("avg_wait_time", 0.0) for item in activities.values()]
    return mean(waits) if waits else 0.0


def _metrics(results):
    """Average the engine's independently-run replication results."""
    return {
        "avg_cycle_time": round(mean(r["time_in_system"]["avg"] for r in results), 3),
        "avg_wait_time": round(mean(_average_wait(r) for r in results), 3),
        "throughput_per_hour": round(mean(r.get("throughput_rates", 0.0) * 60 for r in results), 3),
        "total_cost": round(mean(r.get("financial_summary", {}).get("total_cost", 0.0) for r in results), 2),
    }


def _run_replications(process_json, config, run_process):
    """Run each replication independently to make all four metrics comparable."""
    seed = int(config["seed"])
    replications = int(config["replications"])
    results = []
    for index in range(replications):
        run_config = deepcopy(config)
        run_config["seed"] = seed + index
        run_config["replications"] = 1
        results.append(run_process(deepcopy(process_json), run_config))
    return results


def _highest_utilized_resource(results):
    totals = {}
    counts = {}
    for result in results:
        for name, values in result.get("resource_utilization", {}).items():
            key = name.strip().lower()
            totals[key] = totals.get(key, 0.0) + values.get("utilization_pct", 0.0)
            counts[key] = counts.get(key, 0) + 1
    if not totals:
        return None
    return max(totals, key=lambda name: totals[name] / counts[name])


def _highest_wait_task(results):
    totals = {}
    counts = {}
    for result in results:
        for node_id, values in result.get("activity_results", {}).items():
            totals[node_id] = totals.get(node_id, 0.0) + values.get("avg_wait_time", 0.0)
            counts[node_id] = counts.get(node_id, 0) + 1
    if not totals:
        return None
    return max(totals, key=lambda node_id: totals[node_id] / counts[node_id])


def _task_label(process_json, node_id):
    for node in process_json.get("nodes", []):
        if node.get("id") == node_id:
            data = node.get("data") if isinstance(node.get("data"), dict) else node
            return data.get("label") or node.get("label") or node_id
    return node_id


def _add_resource(process_json, resource_name):
    variant = deepcopy(process_json)
    resources = variant.get("resources")
    target = resource_name.strip().lower()
    if isinstance(resources, list):
        for resource in resources:
            if str(resource.get("name", "")).strip().lower() == target:
                quantity = int(resource.get("quantity", 1)) + 1
                resource["quantity"] = quantity
                return variant, {"name": resource.get("name", resource_name), "quantity": quantity}
    elif isinstance(resources, dict):
        for name, quantity in resources.items():
            if str(name).strip().lower() == target:
                new_quantity = int(quantity) + 1
                resources[name] = new_quantity
                return variant, {"name": name, "quantity": new_quantity}
    return None, None


def _speed_up_task(process_json, node_id):
    variant = deepcopy(process_json)
    for node in variant.get("nodes", []):
        if node.get("id") != node_id:
            continue
        data = _data(node)
        changed = False
        for field in ("duration", "duration_min", "duration_max"):
            if data.get(field) is not None:
                data[field] = float(data[field]) * 0.8
                changed = True
        if changed:
            return variant, {"id": node_id, "duration_multiplier": 0.8}
    return None, None


def _delta(metrics, baseline):
    cycle = baseline["avg_cycle_time"]
    wait = baseline["avg_wait_time"]
    return {
        "cycle_time_pct": round((metrics["avg_cycle_time"] - cycle) / cycle * 100, 3) if cycle else 0.0,
        "wait_pct": round((metrics["avg_wait_time"] - wait) / wait * 100, 3) if wait else 0.0,
        "cost_abs": round(metrics["total_cost"] - baseline["total_cost"], 2),
    }


def _choose_best(variants, goal):
    if not variants:
        return None
    if goal == "cost":
        return min(variants, key=lambda item: item["metrics"]["total_cost"])
    if goal == "throughput":
        return max(variants, key=lambda item: item["metrics"]["throughput_per_hour"])
    return min(variants, key=lambda item: item["metrics"]["avg_wait_time"])


def run_experiment(process_json, config, goal, run_process):
    """Evaluate the baseline and up to two deterministic improvement options."""
    if goal not in {"waiting", "cost", "throughput"}:
        raise ValueError("goal must be one of: waiting, cost, throughput")

    experiment_config = deepcopy(config or {})
    experiment_config["mode"] = "deep"
    experiment_config.setdefault("seed", 42)
    experiment_config.setdefault("replications", 3)
    experiment_config["replications"] = max(1, int(experiment_config["replications"]))

    baseline_runs = _run_replications(process_json, experiment_config, run_process)
    baseline = _metrics(baseline_runs)
    variants = []
    definitions = []

    resource_name = _highest_utilized_resource(baseline_runs)
    if resource_name:
        variant_process, resource_change = _add_resource(process_json, resource_name)
        if variant_process:
            label = f"Add 1 {resource_change['name']}"
            definition = {"label": label, "resourceChanges": [resource_change], "nodeChanges": []}
            metrics = _metrics(_run_replications(variant_process, experiment_config, run_process))
            variants.append({"label": label, "metrics": metrics, "delta_vs_baseline": _delta(metrics, baseline)})
            definitions.append(definition)

    task_id = _highest_wait_task(baseline_runs)
    if task_id:
        variant_process, node_change = _speed_up_task(process_json, task_id)
        if variant_process:
            label = f"Speed up {_task_label(process_json, task_id)} by 20%"
            definition = {"label": label, "resourceChanges": [], "nodeChanges": [node_change]}
            metrics = _metrics(_run_replications(variant_process, experiment_config, run_process))
            variants.append({"label": label, "metrics": metrics, "delta_vs_baseline": _delta(metrics, baseline)})
            definitions.append(definition)

    best_variant = _choose_best(variants, goal)
    best = None
    if best_variant:
        definition = next(item for item in definitions if item["label"] == best_variant["label"])
        best = {**best_variant, "variant_definition": definition}

    return {
        "baseline": baseline,
        "variants": variants,
        "best": best,
        "variant_definitions": definitions,
        "wait_metric": "equal-weight mean of simulated activity average waits",
    }
