from fastapi import FastAPI
from pydantic import BaseModel
from simulation.graph import build_graph
from simulation.monte_carlo import run_until_convergence
from simulation.results import compute_results

app = FastAPI()


class ProcessInput(BaseModel):
    process_json: dict


@app.post("/simulate")
def simulate(input: ProcessInput):
    process_json = input.process_json
    graph = build_graph(process_json)
    start_node = next(n["id"] for n in process_json["nodes"] if n["type"] in ("start", "start-event"))
    resources_dict = process_json.get("resources", {})

    result = run_until_convergence(graph, start_node, resources_dict=resources_dict, max_runs=1000)

    (all_times, all_task_durations, all_task_wait_times,
     all_resource_busy, task_arrival_times, task_queue_depths,
     total_sim_time, convergence_info) = result

    results = compute_results(
        all_times, all_task_durations, all_task_wait_times,
        all_resource_busy, resources_dict, task_arrival_times,
        task_queue_depths, total_sim_time
    )
    results["convergence_data"] = convergence_info
    return results


@app.get("/health")
def health():
    return {"status": "ok"}