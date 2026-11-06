from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from simulation.graph import build_graph
from simulation.monte_carlo import (
    run_until_convergence,
    run_single_pass,
    seed_replication,
    apply_warmup,
    mean_of_lists,
    build_replication_stats,
)
from simulation.results import compute_results
from simulation.financials import generate_financial_report, calculate_profit_delta
from simulation.experiments import run_experiment
import httpx
from fastapi.middleware.cors import CORSMiddleware
import os

EXPRESS_URL = os.getenv("EXPRESS_URL", "")

raw_origins = os.getenv("CORS_ORIGINS", os.getenv("ALLOWED_ORIGINS", "http://localhost:5000,http://127.0.0.1:5000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"))
allowed_origins = [o.strip() for o in raw_origins.split(",") if o.strip()]
has_wildcard = "*" in allowed_origins
allow_credentials = False if has_wildcard else True

app = FastAPI(title="SPOT Simulation Engine")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {
        "service": "SPOT Simulation Engine",
        "status": "ok",
        "health": "/health",
        "docs": "/docs",
    }


@app.api_route("/health", methods=["GET", "HEAD"])
def health():
    return {"status": "ok"}


class ProcessInput(BaseModel):
    process_json: dict
    config: dict = None


class ExperimentInput(BaseModel):
    process_json: dict
    config: dict = None
    goal: str = "waiting"
    target: dict = None

VISUAL_ONLY = {
    "pool", "lane", "data-object", "data-store", "document",
    "annotation", "group", "input", "output",
}

# All types that the engine treats as "start" (process entry point)
_START_TYPES = {
    "start", "start-event", "message-start-event", "timer-start-event",
    "conditional-start-event", "signal-start-event",
}

# All types that the engine treats as "end" (token termination)
_END_TYPES = {
    "end", "end-event", "message-end-event", "error-end-event",
    "escalation-end-event", "signal-end-event", "terminate-end-event",
}

# All types that behave as activities (consume duration + optional resource)
_TASK_TYPES = {
    "task", "user-task", "service-task", "script-task", "manual-task",
    "send-task", "receive-task", "business-rule-task",
    "subprocess", "call-activity",
}

def validate_process(process_json: dict):
    nodes = process_json.get("nodes", [])
    if not nodes:
        raise HTTPException(status_code=400, detail="Your process has no nodes. Build a process in the Model page first.")

    sim_nodes = [n for n in nodes if n.get("type") not in VISUAL_ONLY]
    has_start = any(n["type"] in _START_TYPES for n in sim_nodes)
    has_end   = any(n["type"] in _END_TYPES for n in sim_nodes)

    if not has_start:
        raise HTTPException(status_code=400, detail="Missing a Start Event. Add one to your process diagram.")
    if not has_end:
        raise HTTPException(status_code=400, detail="Missing an End Event. Add one to your process diagram.")

    missing_duration = []
    invalid_range = []

    for n in sim_nodes:
        if n["type"] not in _TASK_TYPES:
            continue
        data = n.get("data") or n
        origin = data.get("origin") or n.get("origin") or "user"
        kept = bool(data.get("kept") if "kept" in data else n.get("kept", False))

        # Rule: origin structural is always exempt
        if origin == "structural":
            continue

        # Rule: origin inferred and not kept is zero-time and exempt from duration error
        if origin == "inferred" and not kept:
            continue

        # Auto-normalize ranges: swap min/max if reversed, clamp to fixed duration if present
        d = data.get("duration")
        d_min = data.get("duration_min")
        d_max = data.get("duration_max")

        if d_min is not None and d_max is not None:
            try:
                min_v = float(d_min)
                max_v = float(d_max)
                if min_v > max_v:
                    min_v, max_v = max_v, min_v
                if d is not None:
                    d_v = float(d)
                    min_v = min(min_v, d_v)
                    max_v = max(max_v, d_v)
                data["duration_min"] = min_v
                data["duration_max"] = max_v
            except (ValueError, TypeError):
                pass

        has_fixed = d is not None and float(d) > 0
        has_range = data.get("duration_max") is not None and float(data["duration_max"]) > 0

        if not has_fixed and not has_range:
            missing_duration.append(data.get("label") or n.get("label") or n["id"])

    if missing_duration:
        names = ", ".join(f'"{x}"' for x in missing_duration[:5])
        raise HTTPException(
            status_code=400,
            detail=f"These tasks are missing durations: {names}. Set a duration for each task before simulating."
        )

    # Check that any resource referenced by a task is set up in process_json['resources']
    resources = process_json.get("resources", [])
    known_resources = set()
    for r in resources:
        if isinstance(r, dict):
            for key in ("name", "id", "displayName"):
                val = r.get(key)
                if val:
                    known_resources.add(str(val).strip().lower())
        elif isinstance(r, str) and r.strip():
            known_resources.add(r.strip().lower())

    for n in sim_nodes:
        if n.get("type") not in _TASK_TYPES:
            continue
        data = n.get("data") or n
        task_label = data.get("label") or n.get("label") or n.get("id")

        res_candidates = []
        multi = data.get("resources")
        if isinstance(multi, dict):
            for k, qty in multi.items():
                if k and not str(k).startswith("$") and not str(k).startswith("_"):
                    try:
                        if int(qty) > 0:
                            res_candidates.append(str(k))
                    except (ValueError, TypeError):
                        res_candidates.append(str(k))
        single = data.get("resource") or data.get("resource_id")
        if single and isinstance(single, str) and single.strip():
            res_candidates.append(single.strip())

        for r_name in res_candidates:
            if r_name.strip().lower() not in known_resources:
                raise HTTPException(
                    status_code=400,
                    detail=f"Task '{task_label}' uses '{r_name}', which isn't set up. Add it in Setup before simulating."
                )
    
def find_start_node(process_json: dict) -> str:
    for n in process_json["nodes"]:
        if n["type"] in _START_TYPES:
            return n["id"]
    raise HTTPException(status_code=400, detail="No start node found.")


def _unpack_result(result):
    if len(result) >= 8:
        (all_times, all_task_durations, all_task_wait_times, all_resource_busy,
         task_arrival_times, task_queue_depths, total_sim_time, convergence_info) = result[:8]
    elif len(result) >= 7:
        all_times, all_task_durations, all_task_wait_times, all_resource_busy, task_arrival_times, task_queue_depths, total_sim_time = result[:7]
        convergence_info = None
    elif len(result) >= 6:
        all_times, all_task_durations, all_task_wait_times, all_resource_busy, task_arrival_times, task_queue_depths = result[:6]
        total_sim_time = None
        convergence_info = None
    else:
        all_times, all_task_durations, all_task_wait_times, all_resource_busy = result[:4]
        task_arrival_times = {}
        task_queue_depths = {}
        total_sim_time = None
        convergence_info = None
    return all_times, all_task_durations, all_task_wait_times, all_resource_busy, task_arrival_times, task_queue_depths, total_sim_time, convergence_info


def _parse_seed(config: dict):
    if not config or config.get("seed") is None or config.get("seed") == "":
        return None
    try:
        return int(config["seed"])
    except (TypeError, ValueError):
        return None


def _parse_replications(config: dict) -> int:
    try:
        n = int((config or {}).get("replications", 1) or 1)
    except (TypeError, ValueError):
        n = 1
    return max(1, n)


def _parse_warmup_pct(config: dict) -> float:
    try:
        w = float((config or {}).get("warmup_pct", 0) or 0)
    except (TypeError, ValueError):
        w = 0.0
    return max(0.0, min(0.3, w))


def _extend_dict_lists(target: dict, source: dict):
    for key, values in (source or {}).items():
        if isinstance(values, list):
            target.setdefault(key, []).extend(values)


def _results_from_run(all_times, all_task_durations, all_task_wait_times,
                      all_resource_busy, task_arrival_times, task_queue_depths,
                      total_sim_time, convergence_info, resources_list):
    results = compute_results(
        all_times, all_task_durations, all_task_wait_times,
        all_resource_busy, resources_list, task_arrival_times,
        task_queue_depths, total_sim_time
    )
    results["convergence_data"] = convergence_info
    results["financial_summary"] = generate_financial_report(
        resources=resources_list,
        resource_busy_times=all_resource_busy,
        total_sim_minutes=total_sim_time,
        customers=len(all_times) if all_times else 0
    )
    return results


def _run_process(process_json: dict, config: dict) -> dict:
    validate_process(process_json)

    graph = build_graph(process_json)
    start_node = find_start_node(process_json)
    resources_list = process_json.get("resources", [])

    mode         = config.get("mode", "deep")
    arrival_rate = float(config.get("arrival_rate", 1.0))

    sim_duration = config.get("simulation_duration")
    time_unit    = config.get("time_unit", "minutes")
    if sim_duration:
        unit_to_minutes = {"minutes": 1, "hours": 60, "days": 1440, "weeks": 10080, "months": 43200}
        minutes  = float(sim_duration) * unit_to_minutes.get(time_unit, 1)
        max_runs = max(50, int(arrival_rate * minutes))
    else:
        max_runs = int(config.get("total_instances", 1000))

    if mode == "quick":
        result = run_single_pass(graph, start_node, resources_dict=resources_list)
        (all_times, all_task_durations, all_task_wait_times, all_resource_busy,
         task_arrival_times, task_queue_depths, total_sim_time, convergence_info) = _unpack_result(result)
        return _results_from_run(
            all_times, all_task_durations, all_task_wait_times,
            all_resource_busy, task_arrival_times, task_queue_depths,
            total_sim_time, convergence_info, resources_list
        )

    seed = _parse_seed(config)
    replications = _parse_replications(config)
    warmup_pct = _parse_warmup_pct(config)

    def _one_replication(i):
        seed_replication(seed, i)
        conv_kwargs = {}
        if config.get("min_runs") is not None:
            conv_kwargs["min_runs"] = int(config["min_runs"])
        result = run_until_convergence(
            graph, start_node,
            resources_dict=resources_list,
            arrival_rate=arrival_rate,
            max_runs=max_runs,
            **conv_kwargs
        )
        (all_times, all_task_durations, all_task_wait_times, all_resource_busy,
         task_arrival_times, task_queue_depths, total_sim_time, convergence_info) = _unpack_result(result)
        (all_times, all_task_durations, all_task_wait_times,
         all_resource_busy, task_arrival_times, task_queue_depths) = apply_warmup(
            all_times, all_task_durations, all_task_wait_times,
            all_resource_busy, task_arrival_times, task_queue_depths,
            warmup_pct
        )
        return (all_times, all_task_durations, all_task_wait_times,
                all_resource_busy, task_arrival_times, task_queue_depths,
                total_sim_time, convergence_info)

    if replications == 1:
        (all_times, all_task_durations, all_task_wait_times, all_resource_busy,
         task_arrival_times, task_queue_depths, total_sim_time, convergence_info) = _one_replication(0)
        return _results_from_run(
            all_times, all_task_durations, all_task_wait_times,
            all_resource_busy, task_arrival_times, task_queue_depths,
            total_sim_time, convergence_info, resources_list
        )

    pooled_times = []
    pooled_durations = {}
    pooled_waits = {}
    pooled_busy = {}
    pooled_arrivals = {}
    pooled_depths = {}
    pooled_sim_time = 0.0
    last_convergence = None
    cycle_means = []
    wait_means = []
    total_costs = []

    for i in range(replications):
        (all_times, all_task_durations, all_task_wait_times, all_resource_busy,
         task_arrival_times, task_queue_depths, total_sim_time, convergence_info) = _one_replication(i)
        last_convergence = convergence_info
        if all_times:
            cycle_means.append(sum(all_times) / len(all_times))
            pooled_times.extend(all_times)
        else:
            cycle_means.append(0.0)
        wait_means.append(mean_of_lists(all_task_wait_times))
        fin = generate_financial_report(
            resources=resources_list,
            resource_busy_times=all_resource_busy,
            total_sim_minutes=total_sim_time,
            customers=len(all_times) if all_times else 0
        )
        total_costs.append(fin.get("total_cost", 0.0))
        _extend_dict_lists(pooled_durations, all_task_durations)
        _extend_dict_lists(pooled_waits, all_task_wait_times)
        _extend_dict_lists(pooled_busy, all_resource_busy)
        _extend_dict_lists(pooled_arrivals, task_arrival_times)
        _extend_dict_lists(pooled_depths, task_queue_depths)
        pooled_sim_time += (total_sim_time or 0.0)

    results = _results_from_run(
        pooled_times, pooled_durations, pooled_waits,
        pooled_busy, pooled_arrivals, pooled_depths,
        pooled_sim_time, last_convergence, resources_list
    )
    results["replication_stats"] = build_replication_stats(
        cycle_means, wait_means, total_costs
    )
    return results


@app.post("/simulate")
def simulate(input: ProcessInput):
    return _run_process(input.process_json, input.config or {})


@app.post("/experiment")
def experiment(input: ExperimentInput):
    try:
        return run_experiment(
            input.process_json,
            input.config or {},
            input.goal,
            _run_process,
            target=input.target,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


class WhatIfModel(BaseModel):
    baseline: ProcessInput
    scenario: ProcessInput

@app.post("/what_if_scenario")
def what_if_scenario(what_if: WhatIfModel):
    baseline_result = _run_process(what_if.baseline.process_json, what_if.baseline.config or {})
    scenario_result = _run_process(what_if.scenario.process_json, what_if.scenario.config or {})

    scenario_result["profit_delta"] = calculate_profit_delta(
        baseline_result["financial_summary"],
        scenario_result["financial_summary"]
    )

    return {"baseline": baseline_result, "scenario": scenario_result}


@app.post("/baseline/save")
async def baseline_save(input: ProcessInput):
    if not EXPRESS_URL:
        raise HTTPException(status_code=500, detail="EXPRESS_URL environment variable is not configured")
    results = _run_process(input.process_json, input.config or {})

    async with httpx.AsyncClient() as client:
        await client.post(f"{EXPRESS_URL}/api/baselines", json=results)

    return results


@app.post("/baseline/compare")
async def baseline_compare(input: ProcessInput):
    if not EXPRESS_URL:
        raise HTTPException(status_code=500, detail="EXPRESS_URL environment variable is not configured")
    new_results = _run_process(input.process_json, input.config or {})

    async with httpx.AsyncClient() as client:
        response = await client.get(f"{EXPRESS_URL}/api/baselines/latest")
        baseline = response.json()

    base_avg = baseline["time_in_system"]["avg"]
    return {
        "baseline": baseline,
        "current": new_results,
        "comparison": {
            "avg_time_change": new_results["time_in_system"]["avg"] - base_avg,
            "avg_time_change_pct": (new_results["time_in_system"]["avg"] - base_avg) / base_avg * 100 if base_avg != 0 else 0,
            "improved": new_results["time_in_system"]["avg"] < base_avg,
        }
    }
