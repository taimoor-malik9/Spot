from simulation.graph import build_graph
from simulation.monte_carlo import run_until_convergence
from simulation.financials import generate_financial_report, calculate_profit_delta


def run_what_if(baseline_process_json: dict, scenario_process_json: dict, config: dict) -> dict:
    baseline_result = _run_single(baseline_process_json, config)
    scenario_result = _run_single(scenario_process_json, config)
    scenario_result["profit_delta"] = calculate_profit_delta(
        baseline_result["financial_summary"],
        scenario_result["financial_summary"]
    )
    return {"baseline": baseline_result, "scenario": scenario_result}


def _run_single(process_json: dict, config: dict) -> dict:
    graph = build_graph(process_json)
    _START_TYPES = {"start", "start-event", "message-start-event", "timer-start-event",
                     "conditional-start-event", "signal-start-event"}
    start_node = next(n["id"] for n in process_json["nodes"] if n["type"] in _START_TYPES)
    resources_list = process_json.get("resources", [])

    result = run_until_convergence(
        graph, start_node,
        resources_dict=resources_list,
        arrival_rate=float(config.get("arrival_rate", 1.0)),
        max_runs=int(config.get("total_instances", 1000))
    )
    (all_times, all_task_durations, all_task_wait_times, all_resource_busy,
     task_arrival_times, task_queue_depths, total_sim_time, convergence_info) = result

    financial_summary = generate_financial_report(
        resources=resources_list,
        resource_busy_times=all_resource_busy,
        total_sim_minutes=total_sim_time
    )

    return {
        "total_time": total_sim_time,
        "resource_utilization": all_resource_busy,
        "convergence_data": convergence_info,
        "financial_summary": financial_summary,
    }