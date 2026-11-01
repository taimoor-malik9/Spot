def safe_float(val, default=0.0):
    if val is None or val == "":
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def get_hourly_rate(resource: dict) -> float:
    res_type = resource.get("type", "staff")
    hours_per_day = safe_float(resource.get("hours_per_day"), 8.0)
    working_days = safe_float(resource.get("working_days_per_month"), 22.0)

    # Avoid division by zero
    if hours_per_day <= 0:
        hours_per_day = 8.0
    if working_days <= 0:
        working_days = 22.0

    working_hours_month = working_days * hours_per_day

    if res_type == "staff":
        salary = safe_float(resource.get("monthly_salary"), 0.0)
        return salary / working_hours_month

    elif res_type in ("equipment", "vehicle"):
        price = safe_float(resource.get("purchase_price"), 0.0)
        lifespan = safe_float(resource.get("lifespan_months"), 1.0)
        if lifespan <= 0:
            lifespan = 1.0
        running_cost = safe_float(resource.get("monthly_running_cost"), 0.0)
        monthly_equip = (price / lifespan) + running_cost
        return monthly_equip / working_hours_month

    elif res_type == "facility":
        rent = safe_float(resource.get("monthly_rent"), 0.0)
        if rent > 0:
            return rent / working_hours_month
        price = safe_float(resource.get("purchase_price"), 0.0)
        lifespan = safe_float(resource.get("lifespan_months"), 1.0)
        if lifespan <= 0:
            lifespan = 1.0
        return (price / lifespan) / working_hours_month

    return 0.0


def normalize_resource_costs(resources: list) -> dict:
    return {res["id"]: get_hourly_rate(res) for res in resources}


def calculate_active_cost(resource: dict, busy_time_hours: float) -> float:
    return round(get_hourly_rate(resource) * busy_time_hours, 2)


def calculate_idle_cost(resource: dict, total_sim_hours: float, busy_time_hours: float) -> float:
    quantity = safe_float(resource.get("quantity"), 1.0)
    if quantity <= 0:
        quantity = 1.0
    rate = get_hourly_rate(resource)
    paid = quantity * rate * total_sim_hours
    active = busy_time_hours * rate
    idle = max(0.0, paid - active)
    return round(idle, 2)


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


def generate_financial_report(resources, resource_busy_times: dict, total_sim_minutes: float, customers: int = None) -> dict:
    """
    resources:            resource list/dict from process_json (see _as_resource_list).
    resource_busy_times:   all_resource_busy from the simulation — a dict of
                           {normalized_resource_name: [duration_minutes, ...]},
                           keyed by .strip().lower() resource name/id.
    total_sim_minutes:     total simulated wall-clock time (env.now).
    customers:             total instances/customers completed in this run.
    """
    total_sim_hours = (total_sim_minutes / 60.0) if total_sim_minutes else 0.0
    resource_busy_times = resource_busy_times or {}

    report = {
        "resources": {},
        "total_active_cost": 0.0,
        "total_idle_cost": 0.0,
        "total_cost": 0.0,
        "period_minutes": round(total_sim_minutes or 0.0, 2),
        "period_hours": round(total_sim_hours, 3),
        "customers": customers,
        "cost_per_customer": 0.0
    }

    for res in _as_resource_list(resources):
        rid = res.get("id") or res.get("name")
        normalized_name = (res.get("name") or "").strip().lower()
        res_id_key = str(res.get("id") or "").strip().lower()

        busy_minutes_list = resource_busy_times.get(normalized_name)
        if busy_minutes_list is None and res_id_key:
            busy_minutes_list = resource_busy_times.get(res_id_key, [])
        busy_minutes_list = busy_minutes_list or []

        busy_hours = (sum(busy_minutes_list) / 60.0) if busy_minutes_list else 0.0
        rate = get_hourly_rate(res)
        quantity = safe_float(res.get("quantity"), 1.0)
        if quantity <= 0:
            quantity = 1.0

        paid = round(quantity * rate * total_sim_hours, 2)
        active = round(busy_hours * rate, 2)
        idle = round(max(0.0, paid - active), 2)
        total = paid  # Correct model: total = paid; idle = paid - active

        total_avail_hours = quantity * total_sim_hours
        utilization_pct = round((busy_hours / total_avail_hours) * 100, 1) if total_avail_hours > 0 else 0.0

        report["resources"][rid] = {
            "name": res.get("name") or rid,
            "type": res.get("type", "staff"),
            "quantity": quantity,
            "hourly_rate": round(rate, 2),
            "paid_hours": round(total_avail_hours, 2),
            "busy_hours": round(busy_hours, 2),
            "active_cost": active,
            "idle_cost": idle,
            "total_cost": total,
            "utilization_pct": utilization_pct,
        }
        report["total_active_cost"] += active
        report["total_idle_cost"] += idle
        report["total_cost"] += total

    report["total_active_cost"] = round(report["total_active_cost"], 2)
    report["total_idle_cost"] = round(report["total_idle_cost"], 2)
    report["total_cost"] = round(report["total_cost"], 2)

    if customers and customers > 0:
        report["cost_per_customer"] = round(report["total_cost"] / customers, 2)

    return report


def calculate_profit_delta(baseline_report: dict, scenario_report: dict) -> float:
    return round(baseline_report["total_cost"] - scenario_report["total_cost"], 2)