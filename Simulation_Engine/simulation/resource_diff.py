"""
Simulation_Engine/simulation/resource_diff.py

Module for computing exact resource diffs between a baseline process model
and a what-if scenario model.

Rules:
- Match resources by ID (with fallback to name if ID missing) so renames are detected
  as renames rather than remove + add.
- Detect property changes:
  1. count (quantity)
  2. cost per hour (hourly_rate / cost_per_hour / derived from salary & equipment)
  3. schedule/shift (hours_per_day, working_days_per_month, shift)
  4. assigned tasks (which tasks reference this resource)
  5. name (renamed)
- Detect new resources added and resources removed.
- Identify affected tasks (all tasks using this resource in either model).
- Provide human-readable summary strings like:
  "Loan Officer: count 2 → 3 (+1)" or "Loan Officer: 2 → 1 (-1)"
  "Clerk: cost/hr $8 → $10 (+$2)"
"""

from typing import List, Dict, Any, Optional
from simulation.financials import get_hourly_rate, safe_float

_TASK_TYPES = {
    "task", "user-task", "service-task", "script-task", "manual-task",
    "send-task", "receive-task", "business-rule-task",
    "subprocess", "call-activity",
}


def _get_resource_id(res: dict, fallback_idx: Optional[int] = None) -> str:
    """Extract a canonical identifier for a resource, prioritizing 'id'."""
    if not isinstance(res, dict):
        return str(res).strip()
    res_id = res.get("id") or res.get("_id")
    if res_id is not None and str(res_id).strip():
        return str(res_id).strip()
    name = res.get("name") or res.get("displayName")
    if name is not None and str(name).strip():
        return str(name).strip()
    return f"res_{fallback_idx}" if fallback_idx is not None else "unknown_res"


def _get_resource_name(res: dict) -> str:
    if not isinstance(res, dict):
        return str(res)
    return str(res.get("displayName") or res.get("name") or res.get("id") or "Unnamed Resource").strip()


def _normalize_resources_list(resources) -> List[dict]:
    if isinstance(resources, dict):
        return [
            {"id": k, "name": k, "displayName": k, "quantity": v, "type": "staff"}
            for k, v in resources.items()
        ]
    if isinstance(resources, list):
        out = []
        for idx, r in enumerate(resources):
            if isinstance(r, dict):
                r_copy = dict(r)
                if "id" not in r_copy or not r_copy["id"]:
                    r_copy["id"] = r_copy.get("name") or f"res_{idx}"
                out.append(r_copy)
            elif isinstance(r, str):
                out.append({"id": r, "name": r, "displayName": r, "quantity": 1, "type": "staff"})
        return out
    return []


def _extract_task_assignments(process_json: dict) -> Dict[str, List[str]]:
    """
    Returns a dict mapping normalized resource key (id or lowercased name)
    to a list of task names that use it.
    """
    assignments: Dict[str, List[str]] = {}
    nodes = process_json.get("nodes", []) if isinstance(process_json, dict) else []

    for node in nodes:
        if not isinstance(node, dict):
            continue
        n_type = str(node.get("type", "")).lower()
        if n_type not in _TASK_TYPES and "task" not in n_type and "activity" not in n_type:
            continue

        data = node.get("data") if isinstance(node.get("data"), dict) else node
        task_label = str(data.get("label") or node.get("label") or data.get("name") or node.get("name") or node.get("id") or "Task").strip()

        # Check multi-resource map: node.data.resources = { 'res_id': 1 }
        multi = data.get("resources")
        if isinstance(multi, dict):
            for r_key, qty in multi.items():
                if not r_key or str(r_key).startswith("$") or str(r_key).startswith("_"):
                    continue
                try:
                    if int(qty) <= 0:
                        continue
                except (ValueError, TypeError):
                    pass
                key_norm = str(r_key).strip().lower()
                assignments.setdefault(key_norm, [])
                if task_label not in assignments[key_norm]:
                    assignments[key_norm].append(task_label)

        # Check single resource: node.data.resource or node.data.resource_id
        for single_field in ("resource", "resource_id"):
            val = data.get(single_field)
            if val and isinstance(val, str) and val.strip():
                key_norm = val.strip().lower()
                assignments.setdefault(key_norm, [])
                if task_label not in assignments[key_norm]:
                    assignments[key_norm].append(task_label)

    return assignments


def _get_assigned_tasks_for_resource(assignments: Dict[str, List[str]], res: dict) -> List[str]:
    """Find all task labels that reference this resource by ID or name."""
    tasks = []
    keys_to_check = []
    res_id = res.get("id")
    if res_id:
        keys_to_check.append(str(res_id).strip().lower())
    res_name = res.get("name")
    if res_name:
        keys_to_check.append(str(res_name).strip().lower())
    res_disp = res.get("displayName")
    if res_disp:
        keys_to_check.append(str(res_disp).strip().lower())

    for k in keys_to_check:
        for t in assignments.get(k, []):
            if t not in tasks:
                tasks.append(t)
    return tasks


def compute_resource_changes(baseline_process: dict, scenario_process: dict) -> List[Dict[str, Any]]:
    """
    Computes a comprehensive diff between baseline and scenario resources.
    Matches resources by ID first, then by fallback name.
    """
    base_resources = _normalize_resources_list((baseline_process or {}).get("resources", []))
    scen_resources = _normalize_resources_list((scenario_process or {}).get("resources", []))

    base_assignments = _extract_task_assignments(baseline_process or {})
    scen_assignments = _extract_task_assignments(scenario_process or {})

    # Map baseline by ID
    base_by_id: Dict[str, dict] = {}
    base_by_name: Dict[str, dict] = {}
    for idx, r in enumerate(base_resources):
        rid = _get_resource_id(r, idx)
        base_by_id[rid] = r
        rname = _get_resource_name(r).lower()
        if rname:
            base_by_name[rname] = r

    scen_by_id: Dict[str, dict] = {}
    scen_by_name: Dict[str, dict] = {}
    for idx, r in enumerate(scen_resources):
        rid = _get_resource_id(r, idx)
        scen_by_id[rid] = r
        rname = _get_resource_name(r).lower()
        if rname:
            scen_by_name[rname] = r

    changes: List[Dict[str, Any]] = []
    matched_scen_ids = set()

    for idx, b_res in enumerate(base_resources):
        b_id = _get_resource_id(b_res, idx)
        b_name = _get_resource_name(b_res)
        b_tasks = _get_assigned_tasks_for_resource(base_assignments, b_res)

        # Look for matching scenario resource by ID
        s_res = scen_by_id.get(b_id)
        if s_res is None:
            # Fallback by name only if ID match didn't find anything
            s_res = scen_by_name.get(b_name.lower())

        if s_res is None:
            # Resource was REMOVED in scenario
            qty = safe_float(b_res.get("quantity"), 1.0)
            qty_int = int(qty) if qty.is_integer() else qty
            changes.append({
                "id": b_id,
                "resource_id": b_id,
                "name": b_name,
                "property": "count",
                "property_label": "Count",
                "before": qty_int,
                "after": 0,
                "delta": -qty_int,
                "delta_text": f"-{qty_int}",
                "direction": "removed",
                "change_text": f"{b_name}: removed (was {qty_int})",
                "summary": f"{b_name}: {qty_int} → 0 (-{qty_int})",
                "affected_tasks": b_tasks,
                "tasks_display": ", ".join(b_tasks) if b_tasks else "None",
            })
            continue

        s_id = _get_resource_id(s_res)
        matched_scen_ids.add(s_id)
        s_name = _get_resource_name(s_res)
        s_tasks = _get_assigned_tasks_for_resource(scen_assignments, s_res)
        all_affected_tasks = sorted(list(set(b_tasks + s_tasks)))

        # 1. Rename check (matched by ID but name changed)
        if b_name.strip().lower() != s_name.strip().lower():
            changes.append({
                "id": b_id,
                "resource_id": b_id,
                "name": s_name,
                "property": "name",
                "property_label": "Name",
                "before": b_name,
                "after": s_name,
                "delta": 0,
                "delta_text": "renamed",
                "direction": "edit",
                "change_text": f'{b_name}: renamed to "{s_name}"',
                "summary": f'{b_name} → {s_name} (renamed)',
                "affected_tasks": all_affected_tasks,
                "tasks_display": ", ".join(all_affected_tasks) if all_affected_tasks else "None",
            })

        # 2. Count (Quantity) check
        b_qty = safe_float(b_res.get("quantity"), 1.0)
        s_qty = safe_float(s_res.get("quantity"), 1.0)
        if b_qty != s_qty:
            b_qty_val = int(b_qty) if b_qty.is_integer() else b_qty
            s_qty_val = int(s_qty) if s_qty.is_integer() else s_qty
            diff = s_qty_val - b_qty_val
            direction = "increase" if diff > 0 else "decrease"
            diff_sign = f"+{diff}" if diff > 0 else f"{diff}"
            changes.append({
                "id": b_id,
                "resource_id": b_id,
                "name": s_name,
                "property": "count",
                "property_label": "Count",
                "before": b_qty_val,
                "after": s_qty_val,
                "delta": diff,
                "delta_text": diff_sign,
                "direction": direction,
                "change_text": f"{s_name}: count {b_qty_val} → {s_qty_val} ({diff_sign})",
                "summary": f"{s_name}: {b_qty_val} → {s_qty_val} ({diff_sign})",
                "affected_tasks": all_affected_tasks,
                "tasks_display": ", ".join(all_affected_tasks) if all_affected_tasks else "None",
            })

        # 3. Cost per hour check
        b_rate = round(get_hourly_rate(b_res), 2)
        s_rate = round(get_hourly_rate(s_res), 2)
        if abs(b_rate - s_rate) >= 0.01:
            rate_diff = round(s_rate - b_rate, 2)
            rate_diff_sign = f"+${rate_diff:g}" if rate_diff > 0 else f"-${abs(rate_diff):g}"
            direction = "increase" if rate_diff > 0 else "decrease"
            changes.append({
                "id": b_id,
                "resource_id": b_id,
                "name": s_name,
                "property": "cost_per_hour",
                "property_label": "Cost / hr",
                "before": f"${b_rate:g}",
                "after": f"${s_rate:g}",
                "delta": rate_diff,
                "delta_text": rate_diff_sign,
                "direction": "edit" if direction == "increase" else "edit",  # Prompt specifies amber for cost/schedule edits
                "cost_direction": direction,
                "change_text": f"{s_name}: cost/hr ${b_rate:g} → ${s_rate:g} ({rate_diff_sign})",
                "summary": f"{s_name}: cost/hr ${b_rate:g} → ${s_rate:g}",
                "affected_tasks": all_affected_tasks,
                "tasks_display": ", ".join(all_affected_tasks) if all_affected_tasks else "None",
            })

        # 4. Schedule / Shift check
        b_hpd = b_res.get("hours_per_day")
        s_hpd = s_res.get("hours_per_day")
        b_wd = b_res.get("working_days_per_month")
        s_wd = s_res.get("working_days_per_month")
        b_shift = b_res.get("shift") or b_res.get("schedule")
        s_shift = s_res.get("shift") or s_res.get("schedule")

        schedule_changed = False
        b_sched_str = []
        s_sched_str = []

        if b_hpd != s_hpd and (b_hpd is not None or s_hpd is not None):
            schedule_changed = True
            b_sched_str.append(f"{b_hpd}h/day" if b_hpd is not None else "default")
            s_sched_str.append(f"{s_hpd}h/day" if s_hpd is not None else "default")

        if b_wd != s_wd and (b_wd is not None or s_wd is not None):
            schedule_changed = True
            b_sched_str.append(f"{b_wd}d/mo" if b_wd is not None else "default")
            s_sched_str.append(f"{s_wd}d/mo" if s_wd is not None else "default")

        if b_shift != s_shift and (b_shift or s_shift):
            schedule_changed = True
            b_sched_str.append(str(b_shift or "standard"))
            s_sched_str.append(str(s_shift or "standard"))

        if schedule_changed:
            b_str = ", ".join(b_sched_str)
            s_str = ", ".join(s_sched_str)
            changes.append({
                "id": b_id,
                "resource_id": b_id,
                "name": s_name,
                "property": "schedule_shift",
                "property_label": "Schedule / Shift",
                "before": b_str,
                "after": s_str,
                "delta": 0,
                "delta_text": "modified",
                "direction": "edit",
                "change_text": f"{s_name}: schedule {b_str} → {s_str}",
                "summary": f"{s_name}: schedule {b_str} → {s_str}",
                "affected_tasks": all_affected_tasks,
                "tasks_display": ", ".join(all_affected_tasks) if all_affected_tasks else "None",
            })

        # 5. Assigned tasks changed (tasks were added/removed from this resource)
        if set(b_tasks) != set(s_tasks):
            added_tasks = [t for t in s_tasks if t not in b_tasks]
            removed_tasks = [t for t in b_tasks if t not in s_tasks]
            b_tasks_str = ", ".join(b_tasks) if b_tasks else "None"
            s_tasks_str = ", ".join(s_tasks) if s_tasks else "None"
            direction = "increase" if len(added_tasks) > len(removed_tasks) else ("decrease" if len(removed_tasks) > len(added_tasks) else "edit")
            details = []
            if added_tasks:
                details.append(f"+{', '.join(added_tasks)}")
            if removed_tasks:
                details.append(f"-{', '.join(removed_tasks)}")
            delta_detail = "; ".join(details)
            changes.append({
                "id": b_id,
                "resource_id": b_id,
                "name": s_name,
                "property": "assigned_tasks",
                "property_label": "Assigned Tasks",
                "before": b_tasks_str,
                "after": s_tasks_str,
                "delta": len(s_tasks) - len(b_tasks),
                "delta_text": delta_detail,
                "direction": direction,
                "change_text": f"{s_name}: assigned tasks {b_tasks_str} → {s_tasks_str}",
                "summary": f"{s_name}: assigned tasks changed ({delta_detail})",
                "affected_tasks": all_affected_tasks,
                "tasks_display": ", ".join(all_affected_tasks) if all_affected_tasks else "None",
            })

    # Check for NEW resources added in scenario
    for idx, s_res in enumerate(scen_resources):
        s_id = _get_resource_id(s_res, idx)
        if s_id in matched_scen_ids:
            continue
        s_name = _get_resource_name(s_res)
        s_qty = safe_float(s_res.get("quantity"), 1.0)
        s_qty_val = int(s_qty) if s_qty.is_integer() else s_qty
        s_tasks = _get_assigned_tasks_for_resource(scen_assignments, s_res)

        changes.append({
            "id": s_id,
            "resource_id": s_id,
            "name": s_name,
            "property": "count",
            "property_label": "New Resource",
            "before": "—",
            "after": s_qty_val,
            "delta": s_qty_val,
            "delta_text": f"+{s_qty_val}",
            "direction": "new",
            "change_text": f"{s_name}: new resource (count: {s_qty_val})",
            "summary": f"{s_name}: +{s_qty_val} (new)",
            "affected_tasks": s_tasks,
            "tasks_display": ", ".join(s_tasks) if s_tasks else "None",
        })

    return changes
