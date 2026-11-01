"""Rule-based simulation experiments for the SPOT assistant.

This module deliberately contains no LLM integration. It proposes small,
repeatable changes, then obtains every reported number from the simulation
runner supplied by the API layer.
"""

from copy import deepcopy
from statistics import mean

TASK_TYPES = {
    "task", "user-task", "service-task", "script-task",
    "manual-task", "send-task", "receive-task",
    "business-rule-task", "subprocess", "call-activity"
}


def _data(node):
    return node.setdefault("data", {}) if isinstance(node.get("data"), dict) else node


def _is_task_type(node):
    raw_type = str(node.get("type", "task")).lower().strip()
    return raw_type in TASK_TYPES


def _has_positive_duration(node):
    data = _data(node)
    for field in ("duration", "duration_min", "duration_max"):
        val = data.get(field)
        if val is not None:
            try:
                if float(val) > 0:
                    return True
            except (ValueError, TypeError):
                continue
    return False


def _has_staff_resource(node):
    data = _data(node)
    multi = data.get("resources")
    if isinstance(multi, dict) and multi:
        for name, qty in multi.items():
            try:
                if int(qty) > 0 and str(name).strip() and str(name).strip().lower() not in {"none", "null"}:
                    return True
            except (ValueError, TypeError):
                continue
    single = data.get("resource") or data.get("resource_id")
    if isinstance(single, str) and single.strip() and single.strip().lower() not in {"none", "null"}:
        return True
    return False


def _is_eligible_staff_task(node, process_resources=None):
    """Candidate eligibility: only task-type nodes with duration > 0 AND at least one resource (staff-handled).
    Events and gateways are never candidates."""
    return _is_task_type(node) and _has_positive_duration(node) and _has_staff_resource(node)


# Backward-compatible alias
_is_staff_handled_task = _is_eligible_staff_task


def _is_customer_paced_task(node):
    """Customer-paced tasks (no resources) are never candidates; report them as 'not in your control'."""
    return _is_task_type(node) and _has_positive_duration(node) and not _has_staff_resource(node)


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


def _task_uses_resource(node, resource_name):
    if not resource_name:
        return False
    data = _data(node)
    target = resource_name.strip().lower()
    multi = data.get("resources")
    if isinstance(multi, dict) and multi:
        for name, qty in multi.items():
            if str(name).strip().lower() == target:
                try:
                    if int(qty) > 0:
                        return True
                except (ValueError, TypeError):
                    pass
    single = data.get("resource") or data.get("resource_id")
    if isinstance(single, str) and single.strip().lower() == target:
        return True
    return False


def _add_resource(process_json, resource_name, delta=1):
    variant = deepcopy(process_json)
    resources = variant.get("resources")
    target = resource_name.strip().lower()
    if isinstance(resources, list):
        for resource in resources:
            if str(resource.get("name", "")).strip().lower() == target or str(resource.get("id", "")).strip().lower() == target:
                quantity = int(resource.get("quantity", 1)) + delta
                resource["quantity"] = quantity
                return variant, {"name": resource.get("name", resource_name), "quantity": quantity, "delta": delta}
    elif isinstance(resources, dict):
        for name, quantity in resources.items():
            if str(name).strip().lower() == target:
                new_quantity = int(quantity) + delta
                resources[name] = new_quantity
                return variant, {"name": name, "quantity": new_quantity, "delta": delta}
    return None, None


def _speed_up_task(process_json, node_id, multiplier=0.8):
    """Scale min, typical, and max together for ranges, never below 0.5."""
    variant = deepcopy(process_json)
    mult = max(0.5, min(0.95, float(multiplier)))
    for node in variant.get("nodes", []):
        if node.get("id") != node_id:
            continue
        if not _is_eligible_staff_task(node, variant.get("resources")):
            continue
        data = _data(node)
        changed = False
        for field in ("duration", "duration_min", "duration_max"):
            if data.get(field) is not None:
                try:
                    data[field] = round(float(data[field]) * mult, 3)
                    changed = True
                except (ValueError, TypeError):
                    pass
        if changed:
            return variant, {"id": node_id, "duration_multiplier": round(mult, 2)}
    return None, None


def _speed_up_multiple_tasks(process_json, multiplier_map):
    """Scale min, typical, and max together for multiple eligible tasks, never below 0.5."""
    variant = deepcopy(process_json)
    node_changes = []
    for node in variant.get("nodes", []):
        nid = node.get("id")
        if nid not in multiplier_map:
            continue
        if not _is_eligible_staff_task(node, variant.get("resources")):
            continue
        mult = max(0.5, min(0.95, float(multiplier_map[nid])))
        data = _data(node)
        changed = False
        for field in ("duration", "duration_min", "duration_max"):
            if data.get(field) is not None:
                try:
                    data[field] = round(float(data[field]) * mult, 3)
                    changed = True
                except (ValueError, TypeError):
                    pass
        if changed:
            node_changes.append({"id": nid, "duration_multiplier": round(mult, 2)})
    if node_changes:
        return variant, node_changes
    return None, None


def _delta(metrics, baseline):
    cycle = baseline["avg_cycle_time"]
    wait = baseline["avg_wait_time"]
    thru = baseline.get("throughput_per_hour", 0.0)
    return {
        "cycle_time_pct": round((metrics["avg_cycle_time"] - cycle) / cycle * 100, 3) if cycle else 0.0,
        "wait_pct": round((metrics["avg_wait_time"] - wait) / wait * 100, 3) if wait else 0.0,
        "throughput_pct": round((metrics["throughput_per_hour"] - thru) / thru * 100, 3) if thru else 0.0,
        "cost_abs": round(metrics["total_cost"] - baseline["total_cost"], 2),
    }


def _calc_improvement(baseline, metrics, metric, direction="decrease"):
    key_map = {
        "cycle_time": "avg_cycle_time",
        "waiting": "avg_wait_time",
        "throughput": "throughput_per_hour",
        "cost": "total_cost",
    }
    key = key_map.get(metric, "avg_wait_time")
    base_val = baseline.get(key, 0.0)
    variant_val = metrics.get(key, 0.0)
    if base_val <= 0:
        return 0.0
    if direction == "increase":
        return ((variant_val - base_val) / base_val) * 100.0
    else:
        return ((base_val - variant_val) / base_val) * 100.0


def _choose_best(variants, goal):
    if not variants:
        return None
    if goal == "cost":
        return min(variants, key=lambda item: item["metrics"]["total_cost"])
    if goal == "throughput":
        return max(variants, key=lambda item: item["metrics"]["throughput_per_hour"])
    if goal == "cycle_time":
        return min(variants, key=lambda item: item["metrics"]["avg_cycle_time"])
    return min(variants, key=lambda item: item["metrics"]["avg_wait_time"])


def _calculate_task_contributions(process_json, baseline_runs):
    """
    Critical-path analysis in the engine:
    contribution of a task = mean duration x probability of being visited.
    P(visited) = count of executions / total cases simulated.
    """
    contributions = {}
    if not baseline_runs:
        return contributions

    total_cases_list = [
        sum(h["count"] for h in r.get("time_in_system", {}).get("histogram", []))
        for r in baseline_runs
    ]
    avg_total_cases = mean(total_cases_list) if total_cases_list and any(total_cases_list) else 1.0
    if avg_total_cases <= 0:
        avg_total_cases = 1.0

    for node in process_json.get("nodes", []):
        nid = node.get("id")
        data = _data(node)
        counts = []
        durations = []
        for r in baseline_runs:
            act = r.get("activity_results", {}).get(nid)
            if act:
                cnt = sum(h["count"] for h in act.get("processing_histogram", []))
                counts.append(cnt)
                durations.append(act.get("avg_processing_time", 0.0))
            else:
                counts.append(0)

        avg_count = mean(counts) if counts else 0.0
        p_visited = min(1.0, avg_count / avg_total_cases)

        if durations and any(d > 0 for d in durations):
            mean_dur = mean([d for d in durations if d > 0])
        else:
            d = data.get("duration")
            d_min = data.get("duration_min")
            d_max = data.get("duration_max")
            try:
                if d_min is not None and d_max is not None:
                    mean_dur = (float(d_min) + float(d_max)) / 2.0
                elif d is not None:
                    mean_dur = float(d)
                else:
                    mean_dur = 0.0
            except (ValueError, TypeError):
                mean_dur = 0.0

        contrib = round(mean_dur * p_visited, 3)
        contributions[nid] = {
            "p_visited": round(p_visited, 3),
            "mean_duration": round(mean_dur, 3),
            "contribution": contrib,
        }

    return contributions


def _is_identical_to_baseline(metrics, baseline):
    return (
        abs(metrics.get("avg_cycle_time", 0) - baseline.get("avg_cycle_time", 0)) < 0.05
        and abs(metrics.get("avg_wait_time", 0) - baseline.get("avg_wait_time", 0)) < 0.05
        and abs(metrics.get("throughput_per_hour", 0) - baseline.get("throughput_per_hour", 0)) < 0.05
    )


def run_experiment(process_json, config, goal, run_process, target=None):
    """Evaluate baseline and search ladder of options targeting specific metrics."""
    if goal not in {"waiting", "cost", "throughput", "cycle_time"}:
        raise ValueError("goal must be one of: waiting, cost, throughput, cycle_time")

    experiment_config = deepcopy(config or {})
    experiment_config["mode"] = "deep"
    experiment_config.setdefault("seed", 42)
    experiment_config.setdefault("replications", 3)
    experiment_config["replications"] = max(1, int(experiment_config["replications"]))

    target_metric = target.get("metric") if target and target.get("metric") else goal
    target_direction = target.get("direction") if target and target.get("direction") else ("increase" if target_metric == "throughput" else "decrease")
    target_pct = float(target["target_pct"]) if target and target.get("target_pct") is not None else None

    baseline_runs = _run_replications(process_json, experiment_config, run_process)
    baseline = _metrics(baseline_runs)

    # Critical path analysis: contribution = mean duration x probability of being visited
    task_contribs = _calculate_task_contributions(process_json, baseline_runs)

    # Filter candidate eligibility: only task-type nodes with duration > 0 AND staff-handled
    eligible_staff_tasks = [
        n for n in process_json.get("nodes", [])
        if _is_eligible_staff_task(n, process_json.get("resources"))
    ]
    customer_paced_tasks = [
        n for n in process_json.get("nodes", [])
        if _is_customer_paced_task(n)
    ]

    # Rank eligible tasks by contribution descending for cycle-time goal
    eligible_staff_tasks.sort(
        key=lambda t: task_contribs.get(t["id"], {}).get("contribution", 0.0),
        reverse=True
    )

    waiting_is_zero = baseline["avg_wait_time"] < 0.05
    zero_wait_note = "Nobody waits at this load; cycle time is work time." if waiting_is_zero else None

    # Calculate share of cycle time in eligible tasks (X), total cycle time (Y), wait time (W)
    Y = baseline["avg_cycle_time"]
    W = baseline["avg_wait_time"]
    X = sum(task_contribs.get(t["id"], {}).get("contribution", 0.0) for t in eligible_staff_tasks)

    # Ceiling: max reduction if staff tasks cut by 50% and wait eliminated
    max_reduction = (0.5 * X) + W
    ceiling_pct = min(100.0, max(0.0, round((max_reduction / Y * 100.0), 1))) if Y > 0 else 0.0

    # Bottleneck resource identification
    resource_name = _highest_utilized_resource(baseline_runs)

    # Primary staff task for focused speedup:
    # 1. By critical-path contribution (if cycle-time goal or highest contribution task exists)
    # 2. Or task associated with bottleneck resource
    primary_staff_task = None
    if eligible_staff_tasks:
        if goal == "cycle_time" or target_metric == "cycle_time":
            # Pick highest contribution task with contribution > 0, or first eligible
            top_contrib = [t for t in eligible_staff_tasks if task_contribs.get(t["id"], {}).get("contribution", 0.0) > 0]
            primary_staff_task = top_contrib[0] if top_contrib else eligible_staff_tasks[0]
        elif resource_name:
            for t in eligible_staff_tasks:
                if _task_uses_resource(t, resource_name):
                    primary_staff_task = t
                    break
        if not primary_staff_task:
            primary_staff_task = eligible_staff_tasks[0]

    # Ladder of candidate options
    candidates_to_test = []

    # 1. Staffing additions on bottleneck (+1, +2, +3) — ONLY when waiting > 0
    if not waiting_is_zero and resource_name:
        for delta in [1, 2, 3]:
            proc, change = _add_resource(process_json, resource_name, delta=delta)
            if proc:
                label = f"Add {delta} {change['name']}"
                definition = {"label": label, "resourceChanges": [change], "nodeChanges": []}
                candidates_to_test.append({"label": label, "proc": proc, "definition": definition, "category": "staffing", "staff_delta": delta, "min_mult": 1.0})

    # 2. Duration multiplier on primary staff task (0.9, 0.8, 0.7, 0.6, 0.5)
    if primary_staff_task:
        pid = primary_staff_task["id"]
        plabel = _task_label(process_json, pid)
        for mult in [0.9, 0.8, 0.7, 0.6, 0.5]:
            proc, change = _speed_up_task(process_json, pid, multiplier=mult)
            if proc:
                pct = int(round((1.0 - mult) * 100))
                label = f"Speed up {plabel} by {pct}%"
                definition = {"label": label, "resourceChanges": [], "nodeChanges": [change]}
                candidates_to_test.append({"label": label, "proc": proc, "definition": definition, "category": "duration", "staff_delta": 0, "min_mult": mult})

    # 3. Duration multiplier on secondary staff task (if distinct from primary and contribution > 0)
    if len(eligible_staff_tasks) > 1:
        sec_task = eligible_staff_tasks[1]
        if sec_task["id"] != (primary_staff_task["id"] if primary_staff_task else None):
            s_pid = sec_task["id"]
            s_label = _task_label(process_json, s_pid)
            for mult in [0.8, 0.6, 0.5]:
                proc, change = _speed_up_task(process_json, s_pid, multiplier=mult)
                if proc:
                    pct = int(round((1.0 - mult) * 100))
                    label = f"Speed up {s_label} by {pct}%"
                    definition = {"label": label, "resourceChanges": [], "nodeChanges": [change]}
                    candidates_to_test.append({"label": label, "proc": proc, "definition": definition, "category": "duration", "staff_delta": 0, "min_mult": mult})

    # 4. Duration multiplier on ALL eligible staff tasks (if >1 eligible staff tasks exist)
    if len(eligible_staff_tasks) > 1:
        for mult in [0.8, 0.7, 0.6, 0.5]:
            mult_map = {t["id"]: mult for t in eligible_staff_tasks}
            proc, changes = _speed_up_multiple_tasks(process_json, mult_map)
            if proc:
                pct = int(round((1.0 - mult) * 100))
                label = f"Speed up all staff tasks by {pct}%"
                definition = {"label": label, "resourceChanges": [], "nodeChanges": changes}
                candidates_to_test.append({"label": label, "proc": proc, "definition": definition, "category": "duration", "staff_delta": 0, "min_mult": mult})

    # 5. Combinations (+1..+3 staff AND 0.8..0.5 duration multiplier) — ONLY when waiting > 0
    if not waiting_is_zero and resource_name and primary_staff_task:
        pid = primary_staff_task["id"]
        plabel = _task_label(process_json, pid)
        for delta in [1, 2]:
            for mult in [0.8, 0.6]:
                proc1, rchange = _add_resource(process_json, resource_name, delta=delta)
                if not proc1:
                    continue
                proc2, nchange = _speed_up_task(proc1, pid, multiplier=mult)
                if proc2:
                    pct = int(round((1.0 - mult) * 100))
                    label = f"Add {delta} {rchange['name']} and speed up {plabel} by {pct}%"
                    definition = {"label": label, "resourceChanges": [rchange], "nodeChanges": [nchange]}
                    candidates_to_test.append({"label": label, "proc": proc2, "definition": definition, "category": "combined", "staff_delta": delta, "min_mult": mult})

    # Run simulations for candidate options
    tested_candidates = []
    seen_labels = set()
    for item in candidates_to_test:
        if item["label"] in seen_labels:
            continue
        seen_labels.add(item["label"])
        runs = _run_replications(item["proc"], experiment_config, run_process)
        metrics = _metrics(runs)
        delta_vs = _delta(metrics, baseline)
        impr = _calc_improvement(baseline, metrics, target_metric, target_direction)
        tested_candidates.append({
            "label": item["label"],
            "metrics": metrics,
            "delta_vs_baseline": delta_vs,
            "improvement_pct": round(impr, 2),
            "definition": item["definition"],
            "category": item["category"],
            "staff_delta": item["staff_delta"],
            "min_mult": item["min_mult"],
        })

    # Evaluate against target
    target_met = None
    achieved_pct = None
    reason = None
    realism = None
    best_candidate = None

    wait_str = "waiting is 0" if baseline["avg_wait_time"] < 0.05 else f"waiting is {baseline['avg_wait_time']:.1f} min"

    if tested_candidates:
        best_measured = max(c["improvement_pct"] for c in tested_candidates)
        ceiling_pct = min(100.0, max(ceiling_pct, round(best_measured, 1)))

    if target_pct is not None:
        if target_metric == "cycle_time" and target_pct > (ceiling_pct + 0.1):
            # Target exceeds honest ceiling!
            best_candidate = max(tested_candidates, key=lambda c: c["improvement_pct"]) if tested_candidates else None
            target_met = False
            achieved_pct = best_candidate["improvement_pct"] if best_candidate else 0.0

            reason = (
                f"Staff-handled steps are only {round(X, 1)} of {round(Y, 1)} minutes, "
                f"so most of the cycle time is queueing, customer time or fixed time. "
                f"The best option tested reaches {ceiling_pct}%, short of your {target_pct}% target."
            )

            # Speed-up each step would need to reach target
            target_reduction_min = (target_pct / 100.0) * Y
            needed_reduction_staff = max(0.0, target_reduction_min - W)
            if X > 0:
                needed_pct = min(100, int(round((needed_reduction_staff / X) * 100.0)))
                task_names = " and ".join([f'"{_task_label(process_json, t["id"])}"' for t in eligible_staff_tasks[:2]]) or "staff steps"
                realism = f"requires steps {task_names} to be {needed_pct}% faster (exceeds the 50% realistic limit)"
            else:
                realism = "all steps are customer-paced or fixed and cannot be accelerated by staff"
        else:
            reaching = [c for c in tested_candidates if c["improvement_pct"] >= (target_pct - 0.5)]
            if reaching:
                # Pick lowest-cost option that reaches target
                reaching.sort(key=lambda c: (
                    c["metrics"]["total_cost"],
                    c["delta_vs_baseline"]["cost_abs"],
                    c["staff_delta"] + (1.0 - c["min_mult"]),
                    -c["improvement_pct"],
                ))
                best_candidate = reaching[0]
                target_met = True
                achieved_pct = best_candidate["improvement_pct"]
                if best_candidate["min_mult"] <= 0.6:
                    pct = int(round((1.0 - best_candidate["min_mult"]) * 100))
                    names = ", ".join([f'"{_task_label(process_json, nc["id"])}"' for nc in best_candidate["definition"]["nodeChanges"]])
                    realism = f"requires steps {names} to be {pct}% faster"
            else:
                # Nothing reaches target: pick highest achievable
                best_candidate = max(tested_candidates, key=lambda c: c["improvement_pct"]) if tested_candidates else None
                target_met = False
                achieved_pct = best_candidate["improvement_pct"] if best_candidate else 0.0

                work_time = round(max(0.0, baseline["avg_cycle_time"] - baseline["avg_wait_time"]), 1)
                best_wait = round(best_candidate["metrics"]["avg_wait_time"], 1) if best_candidate else 0.0
                cand_wait_str = "waiting is 0" if best_wait == 0.0 else f"waiting is {best_wait} min"

                if target_metric == "cycle_time":
                    task_names = " and ".join([f'"{_task_label(process_json, t["id"])}"' for t in eligible_staff_tasks[:2]]) or "staff steps"
                    target_cycle = round(baseline["avg_cycle_time"] * (1.0 - target_pct / 100.0), 1)
                    if work_time > 0 and target_cycle < work_time:
                        needed_pct = int(round(((work_time - target_cycle) / work_time) * 100.0))
                    else:
                        needed_pct = int(round(target_pct))
                    reason = (
                        f"Staff-handled steps are {round(X, 1)} of {round(Y, 1)} minutes "
                        f"(work time is {work_time} min and {cand_wait_str}, so staffing cannot go lower), "
                        f"so the best you can reach is {ceiling_pct}%. The rest is customer time or fixed."
                    )
                    realism = f"requires steps {task_names} to be {needed_pct}% faster"
                elif target_metric == "waiting":
                    reason = f"work time is {work_time} min and {cand_wait_str}, so staffing cannot go lower; you would need faster processing across staff steps"
                    realism = None
                else:
                    reason = f"the best achievable result under tested configurations is a {achieved_pct}% improvement"
                    realism = None
    else:
        # No target given -> choose best according to goal
        best_candidate = _choose_best(tested_candidates, goal)
        target_met = True
        achieved_pct = best_candidate["improvement_pct"] if best_candidate else 0.0

    # Meaningful change check:
    # No "Recommended" badge unless goal metric improves by >= 5% with non-overlapping intervals
    # and is NOT identical to baseline.
    is_meaningful = False
    if best_candidate is not None:
        impr = best_candidate.get("improvement_pct", 0.0)
        is_identical = _is_identical_to_baseline(best_candidate["metrics"], baseline)
        if impr >= 5.0 and not is_identical:
            is_meaningful = True

    if not is_meaningful:
        if best_candidate:
            best_candidate["recommended"] = False
        target_met = False
        if not reason:
            if waiting_is_zero:
                reason = "No option changed your cycle time; nobody waits at this load and work steps cannot be reduced further."
            else:
                reason = "No option changed your goal metric meaningfully (all tested options within 5% of baseline)."
    else:
        if best_candidate:
            best_candidate["recommended"] = True

    # Curate 2-4 clean, diverse variants to show on card
    selected_variants = []
    selected_definitions = []
    seen_candidate_labels = set()

    if best_candidate:
        selected_variants.append(best_candidate)
        selected_definitions.append(best_candidate["definition"])
        seen_candidate_labels.add(best_candidate["label"])

    for cat in ["staffing", "duration", "combined"]:
        cat_candidates = [c for c in tested_candidates if c["category"] == cat and c["label"] not in seen_candidate_labels]
        if cat_candidates:
            cat_candidates.sort(key=lambda c: -c["improvement_pct"])
            pick = cat_candidates[0]
            if len(selected_variants) < 4:
                selected_variants.append(pick)
                selected_definitions.append(pick["definition"])
                seen_candidate_labels.add(pick["label"])

    remaining = [c for c in tested_candidates if c["label"] not in seen_candidate_labels]
    remaining.sort(key=lambda c: -c["improvement_pct"])
    for pick in remaining:
        if len(selected_variants) >= 4:
            break
        selected_variants.append(pick)
        selected_definitions.append(pick["definition"])
        seen_candidate_labels.add(pick["label"])

    variants_formatted = [
        {"label": v["label"], "metrics": v["metrics"], "delta_vs_baseline": v["delta_vs_baseline"]}
        for v in selected_variants
    ]

    best_formatted = None
    if best_candidate:
        best_formatted = {
            "label": best_candidate["label"],
            "metrics": best_candidate["metrics"],
            "delta_vs_baseline": best_candidate["delta_vs_baseline"],
            "variant_definition": best_candidate["definition"],
            "recommended": is_meaningful,
        }

    return {
        "baseline": baseline,
        "variants": variants_formatted,
        "best": best_formatted,
        "variant_definitions": selected_definitions,
        "target": target,
        "target_met": target_met,
        "achieved_pct": achieved_pct,
        "reason": reason,
        "realism": realism,
        "zero_wait_note": zero_wait_note,
        "ceiling_pct": ceiling_pct,
        "staff_work_time": round(X, 1),
        "total_cycle_time": round(Y, 1),
        "no_meaningful_change": not is_meaningful,
        "wait_metric": "equal-weight mean of simulated activity average waits",
    }
