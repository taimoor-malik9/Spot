"""Run a deterministic overloaded-process experiment from the engine folder."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api import _run_process
from simulation.experiments import run_experiment


PROCESS = {
    "nodes": [
        {"id": "start", "type": "start-event"},
        {"id": "check", "type": "task", "data": {"duration": 3, "duration_unit": "minutes", "resource": "Staff"}},
        {"id": "finish", "type": "task", "data": {"duration": 2, "duration_unit": "minutes", "resource": "Staff"}},
        {"id": "end", "type": "end-event"},
    ],
    "edges": [
        {"source": "start", "target": "check"},
        {"source": "check", "target": "finish"},
        {"source": "finish", "target": "end"},
    ],
    "resources": [{
        "id": "staff-1", "name": "Staff", "quantity": 1, "type": "staff",
        "monthly_salary": 48000, "hours_per_day": 8, "working_days_per_month": 30,
    }],
}

CONFIG = {"arrival_rate": 1 / 3, "total_instances": 500, "seed": 42, "replications": 3}


def render(result):
    print("Option                          Waiting (min)  Cost (Rs)  Change")
    baseline = result["baseline"]
    print(f"Baseline                        {baseline['avg_wait_time']:13.3f}  {baseline['total_cost']:9.2f}  --")
    for option in result["variants"]:
        metrics = option["metrics"]
        change = option["delta_vs_baseline"]["wait_pct"]
        print(f"{option['label'][:30]:30}  {metrics['avg_wait_time']:13.3f}  {metrics['total_cost']:9.2f}  {change:+.2f}%")


if __name__ == "__main__":
    first = run_experiment(PROCESS, CONFIG, "waiting", _run_process)
    second = run_experiment(PROCESS, CONFIG, "waiting", _run_process)
    assert first == second, "A fixed seed must produce identical experiment output"
    render(first)
