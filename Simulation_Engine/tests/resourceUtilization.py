# tests/resourceUtilization.py
from simulation.graph import build_graph
from simulation.monte_carlo import run_until_convergence

def build_10_task_process():
    nodes = [{"id": "start_1", "type": "start-event", "data": {"label": "Start"}}]
    edges = []
    prev = "start_1"
    for i in range(1, 11):
        tid = f"task_{i}"
        nodes.append({"id": tid, "type": "task", "data": {"label": f"Task {i}", "duration": 5, "resource": "cashier"}})
        edges.append({"source": prev, "target": tid})
        prev = tid
    nodes.append({"id": "end_1", "type": "end-event", "data": {"label": "End"}})
    edges.append({"source": prev, "target": "end_1"})

    return {
        "nodes": nodes,
        "edges": edges,
        "resources": [
            {"id": "res_001", "name": "Cashier", "type": "staff", "quantity": 1,
             "hours_per_day": 8, "working_days_per_month": 22, "monthly_salary": 50000}
        ]
    }

process_json = build_10_task_process()
graph = build_graph(process_json)
start_node = "start_1"

result = run_until_convergence(graph, start_node, resources_dict=process_json["resources"], max_runs=500)
(all_times, all_task_durations, all_task_wait_times,
 all_resource_busy, task_arrival_times, task_queue_depths,
 total_sim_time, convergence_info) = result

busy_times = all_resource_busy.get("cashier", [])
total_busy = sum(busy_times)
utilization = round((total_busy / total_sim_time) * 100, 2) if total_sim_time else 0

print("Busy time total:", total_busy)
print("Total sim time:", total_sim_time)
print("Utilization %:", utilization)