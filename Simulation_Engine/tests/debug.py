# tests/debug_resources.py
from simulation.graph import build_graph
from simulation.monte_carlo import _normalize_resources

process_json = {
    "resources": [
        {"id": "res_001", "name": "Cashier", "type": "staff", "quantity": 1,
         "hours_per_day": 8, "working_days_per_month": 22, "monthly_salary": 50000}
    ]
}

print(_normalize_resources(process_json["resources"]))