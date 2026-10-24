def safe_float(val, default=0.0):
    if val is None or val == "":
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def get_hourly_rate(resource: dict) -> float:
    res_type = resource.get("type")
    hours_per_day = safe_float(resource.get("hours_per_day"), 8.0)
    working_days = safe_float(resource.get("working_days_per_month"), 30.0)

    # Avoid division by zero
    if hours_per_day <= 0:
        hours_per_day = 8.0
    if working_days <= 0:
        working_days = 30.0

    if res_type == "staff":
        salary = safe_float(resource.get("monthly_salary"), 0.0)
        return salary / (working_days * hours_per_day)

    elif res_type in ("equipment", "vehicle"):
        price = safe_float(resource.get("purchase_price"), 0.0)
        lifespan = safe_float(resource.get("lifespan_months"), 1.0)
        running_cost = safe_float(resource.get("monthly_running_cost"), 0.0)
        if lifespan <= 0:
            lifespan = 1.0
        depreciation_rate = price / (lifespan * working_days * hours_per_day)
        running_rate = running_cost / (working_days * hours_per_day)
        return depreciation_rate + running_rate

    elif res_type == "facility":
        rent = safe_float(resource.get("monthly_rent"), 0.0)
        if rent > 0:
            return rent / (working_days * hours_per_day)
        price = safe_float(resource.get("purchase_price"), 0.0)
        lifespan = safe_float(resource.get("lifespan_months"), 1.0)
        if lifespan <= 0:
            lifespan = 1.0
        return price / (lifespan * working_days * hours_per_day)

    return 0.0


def normalize_resource_costs(resources: list) -> dict:
    return {res["id"]: get_hourly_rate(res) for res in resources}


def calculate_active_cost(resource: dict, busy_time_hours: float) -> float:
    return round(get_hourly_rate(resource) * busy_time_hours, 2)


def calculate_idle_cost(resource: dict, total_sim_hours: float, busy_time_hours: float) -> float:
    quantity = safe_float(resource.get("quantity"), 1.0)
    if quantity <= 0:
        quantity = 1.0
    # busy_time_hours is already summed ACROSS all units of this resource
    # (traversal.py records one entry per unit consumed), so the hours
    # available to compare against must be scaled the same way — one
    # unit sitting idle the whole run is not the same as three units
    # sitting idle the whole run.
    total_available_hours = total_sim_hours * quantity
    idle_hours = max(0, total_available_hours - busy_time_hours)
    return round(get_hourly_rate(resource) * idle_hours, 2)


def _as_resource_list(resources):
    """
    Accepts either shape the rest of the codebase uses for `resources`:
      - rich list:  [{"id": "...", "name": "...", "type": "staff", "monthly_salary": ...}, ...]
      - simple dict (just capacities, no cost data): {"person": 2, "computer": 1}
    Always returns a list of dicts with at least id/name/type so the rest
    of this module can stay simple. Simple-dict resources get type=None,
    which get_hourly_rate() prices at 0.0 (no cost metadata to bill from).
    """
    if isinstance(resources, dict):
        return [{"id": name, "name": name, "type": None, "quantity": qty} for name, qty in resources.items()]
    return resources or []


def generate_financial_report(resources, resource_busy_times: dict, total_sim_minutes: float) -> dict:
    """
    resources:            resource list/dict from process_json (see _as_resource_list).
    resource_busy_times:   all_resource_busy from the simulation — a dict of
                           {normalized_resource_name: [duration_minutes, ...]},
                           keyed by the SAME .strip().lower() normalization
                           traversal.py uses for SimPy resource contention.
                           NOTE: these are lists of per-task durations, not
                           a running total — they must be summed here.
    total_sim_minutes:     total simulated wall-clock time (env.now). All
                           durations in this engine are normalized to
                           MINUTES (see traversal.py), so this is minutes,
                           not hours — converted to hours below before
                           it's used with hourly rates.
    """
    report = {"resources": {}, "total_active_cost": 0.0, "total_idle_cost": 0.0, "total_cost": 0.0}
    total_sim_hours = (total_sim_minutes / 60.0) if total_sim_minutes else 0.0
    resource_busy_times = resource_busy_times or {}

    for res in _as_resource_list(resources):
        rid = res.get("id") or res.get("name")
        normalized_name = (res.get("name") or "").strip().lower()

        busy_minutes_list = resource_busy_times.get(normalized_name, [])
        busy_hours = (sum(busy_minutes_list) / 60.0) if busy_minutes_list else 0.0

        active_cost = calculate_active_cost(res, busy_hours)
        idle_cost = calculate_idle_cost(res, total_sim_hours, busy_hours)

        report["resources"][rid] = {
            "name": res.get("name"),
            "type": res.get("type"),
            "hourly_rate": round(get_hourly_rate(res), 2),
            "active_cost": active_cost,
            "idle_cost": idle_cost,
            "total_cost": round(active_cost + idle_cost, 2),
        }
        report["total_active_cost"] += active_cost
        report["total_idle_cost"] += idle_cost

    report["total_active_cost"] = round(report["total_active_cost"], 2)
    report["total_idle_cost"] = round(report["total_idle_cost"], 2)
    report["total_cost"] = round(report["total_active_cost"] + report["total_idle_cost"], 2)
    return report


def calculate_profit_delta(baseline_report: dict, scenario_report: dict) -> float:
    return round(baseline_report["total_cost"] - scenario_report["total_cost"], 2)