"""
Simulation_Engine/simulation/resource_diff.py

Module for computing exact resource diffs and task duration diffs between
a baseline process model and a what-if scenario model.

Rules:
- Resources are matched by a single stable identity across baseline and scenario:
  matching by canonical ID, name, displayName, or cross-matching ID to Name.
- Resource changes are ONLY reported when count, cost/hr, or schedule/shift actually differs.
- No raw IDs (res_0...) appear in user-facing summaries.
- Task changes detect duration edits on task nodes, reporting old -> new (pct%).
"""

from typing import List, Dict, Any, Optional
from simulation.financials import get_hourly_rate, safe_float

_TASK_TYPES = {
    "task", "user-task", "service-task", "script-task", "manual-task",
    "send-task", "receive-task", "business-rule-task",
    "subprocess", "call-activity",
}


def _clean_str(val: Any) -> str:
    if val is None:
        return ""
    return str(val).strip()


def _is_generic_id(val: str) -> bool:
    s = val.strip().lower()
    if not s or s in {"unknown_res", "unnamed resource", "none", "null"}:
        return True
    if s.startswith("res_") and any(ch.isdigit() for ch in s):
        return True
    return False


def _get_resource_name(res: dict, fallback_name: str = "") -> str:
    """Extract a human-readable name, avoiding raw generic IDs if a name exists."""
    if not isinstance(res, dict):
        return _clean_str(res)
    for field in ("name", "displayName", "label"):
        val = _clean_str(res.get(field))
        if val and not _is_generic_id(val):
            return val
    if fallback_name and not _is_generic_id(fallback_name):
        return fallback_name
    for field in ("name", "displayName", "label", "id"):
        val = _clean_str(res.get(field))
        if val:
            return val
    return "Staff / Specialist"


def _normalize_resources_list(resources) -> List[dict]:
    if isinstance(resources, dict):
        return [
            {"id": str(k).strip(), "name": str(k).strip(), "displayName": str(k).strip(), "quantity": v, "type": "staff"}
            for k, v in resources.items()
        ]
    if isinstance(resources, list):
        out = []
        for idx, r in enumerate(resources):
            if isinstance(r, dict):
                r_copy = dict(r)
                if not r_copy.get("name") and r_copy.get("displayName"):
                    r_copy["name"] = r_copy["displayName"]
                out.append(r_copy)
            elif isinstance(r, str):
                s = r.strip()
                out.append({"id": s, "name": s, "displayName": s, "quantity": 1, "type": "staff"})
        return out
    return []


def _extract_task_assignments(process_json: dict) -> Dict[str, List[str]]:
    assignments: Dict[str, List[str]] = {}
    nodes = process_json.get("nodes", []) if isinstance(process_json, dict) else []

    for node in nodes:
        if not isinstance(node, dict):
            continue
        n_type = str(node.get("type", "")).lower()
        if n_type not in _TASK_TYPES and "task" not in n_type and "activity" not in n_type:
            continue

        data = node.get("data") if isinstance(node.get("data"), dict) else node
        task_label = _clean_str(data.get("label") or node.get("label") or data.get("name") or node.get("name") or node.get("id") or "Task")

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

        for single_field in ("resource", "resource_id"):
            val = data.get(single_field)
            if val and isinstance(val, str) and val.strip():
                key_norm = val.strip().lower()
                assignments.setdefault(key_norm, [])
                if task_label not in assignments[key_norm]:
                    assignments[key_norm].append(task_label)

    return assignments


def _get_assigned_tasks_for_resource(assignments: Dict[str, List[str]], res: dict) -> List[str]:
    tasks = []
    keys = []
    for f in ("id", "name", "displayName"):
        val = res.get(f)
        if val:
            keys.append(str(val).strip().lower())

    for k in keys:
        for t in assignments.get(k, []):
            if t not in tasks:
                tasks.append(t)
    return tasks


def _match_resource(b_res: dict, scen_resources: List[dict], matched_scen_indices: set) -> Optional[tuple]:
    """
    Find matching scenario resource by stable single identity:
    1. Exact ID match (case-insensitive)
    2. Exact Name match (case-insensitive)
    3. Cross-match: b.id == s.name or b.name == s.id
    """
    b_id = _clean_str(b_res.get("id")).lower()
    b_name = _clean_str(b_res.get("name") or b_res.get("displayName")).lower()

    # Pass 1: exact ID match (when not generic)
    if b_id and not _is_generic_id(b_id):
        for idx, s_res in enumerate(scen_resources):
            if idx in matched_scen_indices:
                continue
            s_id = _clean_str(s_res.get("id")).lower()
            if s_id and s_id == b_id:
                return idx, s_res

    # Pass 2: exact Name match (when not generic)
    if b_name and not _is_generic_id(b_name):
        for idx, s_res in enumerate(scen_resources):
            if idx in matched_scen_indices:
                continue
            s_name = _clean_str(s_res.get("name") or s_res.get("displayName")).lower()
            if s_name and s_name == b_name:
                return idx, s_res

    # Pass 3: cross-match b.name == s.id or b.id == s.name
    for idx, s_res in enumerate(scen_resources):
        if idx in matched_scen_indices:
            continue
        s_id = _clean_str(s_res.get("id")).lower()
        s_name = _clean_str(s_res.get("name") or s_res.get("displayName")).lower()

        if b_name and not _is_generic_id(b_name) and s_id and s_id == b_name:
            return idx, s_res
        if b_id and not _is_generic_id(b_id) and s_name and s_name == b_id:
            return idx, s_res

    # Pass 4: ID match even if generic if IDs match identically (e.g. res_0 == res_0)
    if b_id:
        for idx, s_res in enumerate(scen_resources):
            if idx in matched_scen_indices:
                continue
            s_id = _clean_str(s_res.get("id")).lower()
            if s_id and s_id == b_id:
                return idx, s_res

    return None


def compute_resource_changes(baseline_process: dict, scenario_process: dict) -> List[Dict[str, Any]]:
    """
    Computes a comprehensive diff between baseline and scenario resources.
    Matches resources by stable identity and only reports changes when count,
    cost/hr, or schedule actually differs.
    """
    base_resources = _normalize_resources_list((baseline_process or {}).get("resources", []))
    scen_resources = _normalize_resources_list((scenario_process or {}).get("resources", []))

    base_assignments = _extract_task_assignments(baseline_process or {})
    scen_assignments = _extract_task_assignments(scenario_process or {})

    changes: List[Dict[str, Any]] = []
    matched_scen_indices = set()

    for idx, b_res in enumerate(base_resources):
        b_tasks = _get_assigned_tasks_for_resource(base_assignments, b_res)
        b_name = _get_resource_name(b_res)
        b_id = _clean_str(b_res.get("id") or b_name)

        match = _match_resource(b_res, scen_resources, matched_scen_indices)

        if match is None:
            # Resource removed
            qty = safe_float(b_res.get("quantity"), 1.0)
            qty_int = int(qty) if qty.is_integer() else qty
            display_name = b_name if not _is_generic_id(b_name) else (b_tasks[0] + " Staff" if b_tasks else "Staff")
            changes.append({
                "id": b_id,
                "resource_id": b_id,
                "name": display_name,
                "property": "count",
                "property_label": "Count",
                "before": qty_int,
                "after": 0,
                "delta": -qty_int,
                "delta_text": f"-{qty_int}",
                "direction": "removed",
                "change_text": f"{display_name}: removed (was {qty_int})",
                "summary": f"{display_name}: {qty_int} → 0 (-{qty_int})",
                "affected_tasks": b_tasks,
                "tasks_display": ", ".join(b_tasks) if b_tasks else "None",
            })
            continue

        s_idx, s_res = match
        matched_scen_indices.add(s_idx)

        s_name = _get_resource_name(s_res, fallback_name=b_name)
        display_name = s_name if not _is_generic_id(s_name) else (_get_resource_name(b_res))
        s_tasks = _get_assigned_tasks_for_resource(scen_assignments, s_res)
        all_affected_tasks = sorted(list(set(b_tasks + s_tasks)))
        tasks_disp = ", ".join(all_affected_tasks) if all_affected_tasks else "None"

        # 1. Rename check: only if both are non-generic and distinctly renamed
        if b_name.strip().lower() != s_name.strip().lower() and not _is_generic_id(b_name) and not _is_generic_id(s_name):
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
                "tasks_display": tasks_disp,
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
                "name": display_name,
                "property": "count",
                "property_label": "Count",
                "before": b_qty_val,
                "after": s_qty_val,
                "delta": diff,
                "delta_text": diff_sign,
                "direction": direction,
                "change_text": f"{display_name}: count {b_qty_val} → {s_qty_val} ({diff_sign})",
                "summary": f"{display_name}: {b_qty_val} → {s_qty_val} ({diff_sign})",
                "affected_tasks": all_affected_tasks,
                "tasks_display": tasks_disp,
            })

        # 3. Cost per hour check
        b_rate = round(get_hourly_rate(b_res), 2)
        s_rate = round(get_hourly_rate(s_res), 2)
        if b_rate != s_rate:
            diff_cost = round(s_rate - b_rate, 2)
            direction = "increase" if diff_cost > 0 else "decrease"
            b_str = f"${int(b_rate)}" if b_rate.is_integer() else f"${b_rate:.2f}"
            s_str = f"${int(s_rate)}" if s_rate.is_integer() else f"${s_rate:.2f}"
            if diff_cost.is_integer():
                diff_sign = f"+${int(diff_cost)}" if diff_cost > 0 else f"-${int(abs(diff_cost))}"
            else:
                diff_sign = f"+${diff_cost:.2f}" if diff_cost > 0 else f"-${abs(diff_cost):.2f}"
            changes.append({
                "id": b_id,
                "resource_id": b_id,
                "name": display_name,
                "property": "cost_per_hour",
                "property_label": "Cost / hr",
                "before": b_str,
                "after": s_str,
                "delta": diff_cost,
                "delta_text": diff_sign,
                "direction": "edit",
                "change_text": f"{display_name}: cost/hr {b_str} → {s_str} ({diff_sign})",
                "summary": f"{display_name}: cost/hr {b_str} → {s_str}",
                "affected_tasks": all_affected_tasks,
                "tasks_display": tasks_disp,
            })

        # 4. Schedule / Shift check
        b_hpd = safe_float(b_res.get("hours_per_day"), 8.0)
        s_hpd = safe_float(s_res.get("hours_per_day"), 8.0)
        b_wdm = safe_float(b_res.get("working_days_per_month"), 22.0)
        s_wdm = safe_float(s_res.get("working_days_per_month"), 22.0)

        if (b_hpd != s_hpd or b_wdm != s_wdm) and (b_res.get("hours_per_day") is not None or s_res.get("hours_per_day") is not None):
            b_str = f"{int(b_hpd) if b_hpd.is_integer() else b_hpd}h/day, {int(b_wdm) if b_wdm.is_integer() else b_wdm}d/mo"
            s_str = f"{int(s_hpd) if s_hpd.is_integer() else s_hpd}h/day, {int(s_wdm) if s_wdm.is_integer() else s_wdm}d/mo"
            changes.append({
                "id": b_id,
                "resource_id": b_id,
                "name": display_name,
                "property": "schedule_shift",
                "property_label": "Schedule / Shift",
                "before": b_str,
                "after": s_str,
                "delta": 0,
                "delta_text": "modified",
                "direction": "edit",
                "change_text": f"{display_name}: schedule {b_str} → {s_str}",
                "summary": f"{display_name}: schedule {b_str} → {s_str}",
                "affected_tasks": all_affected_tasks,
                "tasks_display": tasks_disp,
            })

    # Check for NEW resources in scenario
    for idx, s_res in enumerate(scen_resources):
        if idx in matched_scen_indices:
            continue
        s_name = _get_resource_name(s_res)
        s_id = _clean_str(s_res.get("id") or s_name)
        s_qty = safe_float(s_res.get("quantity"), 1.0)
        s_qty_val = int(s_qty) if s_qty.is_integer() else s_qty
        s_tasks = _get_assigned_tasks_for_resource(scen_assignments, s_res)
        tasks_disp = ", ".join(s_tasks) if s_tasks else "None"

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
            "tasks_display": tasks_disp,
        })

    return changes


def _task_duration_info(node: dict) -> tuple:
    data = node.get("data") if isinstance(node.get("data"), dict) else node
    unit = data.get("duration_unit") or node.get("duration_unit") or "min"
    if unit.startswith("minute"):
        unit = "min"
    d_min = data.get("duration_min")
    d_max = data.get("duration_max")
    d = data.get("duration")

    try:
        if d_min is not None and d_max is not None:
            return round(float(d_min), 2), round(float(d_max), 2), unit, True
        if d is not None:
            return round(float(d), 2), None, unit, False
    except (ValueError, TypeError):
        pass
    return None, None, unit, False


def compute_task_changes(baseline_process: dict, scenario_process: dict) -> List[Dict[str, Any]]:
    """
    Computes duration changes on task nodes between baseline and scenario.
    Format example: "Triage and check vitals: 6 → 3 min (-50%)"
    """
    base_nodes = (baseline_process or {}).get("nodes", [])
    scen_nodes = (scenario_process or {}).get("nodes", [])

    base_map = {}
    for n in base_nodes:
        if isinstance(n, dict) and n.get("id"):
            base_map[str(n["id"]).strip().lower()] = n

    task_changes: List[Dict[str, Any]] = []

    for s_node in scen_nodes:
        if not isinstance(s_node, dict) or not s_node.get("id"):
            continue
        nid = str(s_node["id"]).strip().lower()
        b_node = base_map.get(nid)
        if not b_node:
            continue

        raw_type = str(s_node.get("type", "task")).lower().strip()
        if raw_type not in _TASK_TYPES and "task" not in raw_type and "activity" not in raw_type:
            continue

        b_min, b_max, b_unit, b_is_range = _task_duration_info(b_node)
        s_min, s_max, s_unit, s_is_range = _task_duration_info(s_node)

        if b_min is None or s_min is None:
            continue

        data = s_node.get("data") if isinstance(s_node.get("data"), dict) else s_node
        b_data = b_node.get("data") if isinstance(b_node.get("data"), dict) else b_node
        label = _clean_str(data.get("label") or s_node.get("label") or b_data.get("label") or b_node.get("label") or s_node.get("id"))

        if not b_is_range and not s_is_range:
            if b_min != s_min:
                pct = round(((s_min - b_min) / b_min) * 100) if b_min > 0 else 0
                pct_sign = f"+{pct}%" if pct > 0 else f"{pct}%"
                b_val = int(b_min) if float(b_min).is_integer() else b_min
                s_val = int(s_min) if float(s_min).is_integer() else s_min
                direction = "decrease" if s_min < b_min else "increase"
                task_changes.append({
                    "id": s_node.get("id"),
                    "task": label,
                    "property": "duration",
                    "property_label": "Duration",
                    "before": f"{b_val} {b_unit}",
                    "after": f"{s_val} {b_unit}",
                    "delta_pct": pct,
                    "delta_text": pct_sign,
                    "direction": direction,
                    "summary": f"{label}: {b_val} → {s_val} {b_unit} ({pct_sign})",
                })
        else:
            b_low = b_min
            b_high = b_max if b_max is not None else b_min
            s_low = s_min
            s_high = s_max if s_max is not None else s_min

            if b_low != s_low or b_high != s_high:
                avg_b = (b_low + b_high) / 2.0
                avg_s = (s_low + s_high) / 2.0
                pct = round(((avg_s - avg_b) / avg_b) * 100) if avg_b > 0 else 0
                pct_sign = f"+{pct}%" if pct > 0 else f"{pct}%"
                direction = "decrease" if avg_s < avg_b else "increase"
                task_changes.append({
                    "id": s_node.get("id"),
                    "task": label,
                    "property": "duration",
                    "property_label": "Duration",
                    "before": f"{b_low}-{b_high} {b_unit}",
                    "after": f"{s_low}-{s_high} {b_unit}",
                    "delta_pct": pct,
                    "delta_text": pct_sign,
                    "direction": direction,
                    "summary": f"{label}: {b_low}-{b_high} → {s_low}-{s_high} {b_unit} ({pct_sign})",
                })

    return task_changes


def compute_all_changes(baseline_process: dict, scenario_process: dict) -> Dict[str, Any]:
    return {
        "resource_changes": compute_resource_changes(baseline_process, scenario_process),
        "task_changes": compute_task_changes(baseline_process, scenario_process),
    }
