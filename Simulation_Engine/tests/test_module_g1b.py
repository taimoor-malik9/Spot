"""Unit and integration tests for Module G1b: Critical-path experiments, candidate eligibility, and honest feasibility."""

import json
import unittest
from pathlib import Path

from api import _run_process
from simulation.experiments import (
    _calculate_task_contributions,
    _is_customer_paced_task,
    _is_eligible_staff_task,
    _metrics,
    _run_replications,
    run_experiment,
)


class TestModuleG1b(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_path = Path(__file__).parent / "clinic_fixture.json"
        with open(fixture_path, "r", encoding="utf-8") as f:
            cls.clinic_fixture = json.load(f)
        cls.config = {
            "arrival_rate": 0.1,
            "total_instances": 300,
            "seed": 42,
            "replications": 3,
        }

    def test_clinic_zero_duration_and_events_excluded(self):
        """Zero-duration nodes, events, and customer-paced tasks must never be candidate staff tasks."""
        nodes = self.clinic_fixture["nodes"]
        resources = self.clinic_fixture["resources"]

        # rec_receive_checkin is a message-start-event with duration 0 or 2
        rec_node = next(n for n in nodes if n["id"] == "rec_receive_checkin")
        self.assertFalse(_is_eligible_staff_task(rec_node, resources))

        # Check all start/end events and gateways
        for n in nodes:
            raw_type = n.get("type")
            if raw_type in ("start-event", "message-start-event", "end-event", "message-end-event",
                            "exclusive-gateway", "parallel-gateway", "message-intermediate-throw",
                            "message-intermediate-catch"):
                self.assertFalse(
                    _is_eligible_staff_task(n, resources),
                    f"Node {n['id']} of type {raw_type} should not be an eligible task"
                )

        # Customer-paced tasks without resources
        customer_tasks = [n for n in nodes if _is_customer_paced_task(n)]
        self.assertTrue(len(customer_tasks) > 0)
        for ct in customer_tasks:
            self.assertFalse(_is_eligible_staff_task(ct, resources))

    def test_clinic_reduce_cycle_time_no_target_no_recommended(self):
        """On clinic fixture where no staff task changes cycle time, identical variants get no 'Recommended' badge."""
        result = run_experiment(self.clinic_fixture, self.config, "cycle_time", _run_process, target=None)

        # Baseline cycle time is in expected range (~31.15-32.7 min)
        base_cycle = result["baseline"]["avg_cycle_time"]
        self.assertGreaterEqual(base_cycle, 31.0)
        self.assertLessEqual(base_cycle, 35.0)

        # Waiting is zero
        self.assertLess(result["baseline"]["avg_wait_time"], 0.05)
        self.assertEqual(result["zero_wait_note"], "Nobody waits at this load; cycle time is work time.")

        # Best candidate must NOT be badged Recommended
        self.assertIsNotNone(result["best"])
        self.assertFalse(result["best"]["recommended"])
        self.assertTrue(result["no_meaningful_change"])
        self.assertIn("No option changed your cycle time", result["reason"])

    def test_clinic_reduce_cycle_time_50_percent_honest_ceiling(self):
        """Requesting 50% on clinic fixture returns honest ceiling message and realism note."""
        target = {"metric": "cycle_time", "direction": "decrease", "target_pct": 50}
        result = run_experiment(self.clinic_fixture, self.config, "cycle_time", _run_process, target=target)

        self.assertFalse(result["target_met"])
        self.assertIsNotNone(result["reason"])
        self.assertIn("Staff-handled steps are", result["reason"])
        self.assertIn("so the best you can reach is", result["reason"])
        self.assertIn("The rest is customer time or fixed", result["reason"])
        self.assertIsNotNone(result["realism"])
        self.assertFalse(result["best"]["recommended"])

    def test_critical_path_ranking_on_staffed_process(self):
        """Critical-path contribution ranks tasks by mean duration x visited probability."""
        process = {
            "nodes": [
                {"id": "start", "type": "start"},
                {"id": "t_short", "type": "task", "data": {"label": "Quick Greet", "duration": 2, "resource": "cashier"}},
                {"id": "t_long", "type": "task", "data": {"label": "Prepare Dish", "duration": 14, "resource": "chef"}},
                {"id": "t_customer", "type": "task", "data": {"label": "Customer Eats", "duration": 10}},
                {"id": "end", "type": "end"}
            ],
            "edges": [
                {"source": "start", "target": "t_short"},
                {"source": "t_short", "target": "t_long"},
                {"source": "t_long", "target": "t_customer"},
                {"source": "t_customer", "target": "end"}
            ],
            "resources": [
                {"id": "cashier", "name": "cashier", "quantity": 1},
                {"id": "chef", "name": "chef", "quantity": 1}
            ]
        }
        runs = _run_replications(process, self.config, _run_process)
        contribs = _calculate_task_contributions(process, runs)

        self.assertIn("t_short", contribs)
        self.assertIn("t_long", contribs)
        self.assertGreater(contribs["t_long"]["contribution"], contribs["t_short"]["contribution"])

        # Run experiment for cycle time
        res = run_experiment(process, self.config, "cycle_time", _run_process, target={"metric": "cycle_time", "direction": "decrease", "target_pct": 20})
        self.assertTrue(res["target_met"])
        self.assertTrue(res["best"]["recommended"])
        self.assertGreaterEqual(res["achieved_pct"], 19.5)


if __name__ == "__main__":
    unittest.main()
