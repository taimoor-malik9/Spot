"""Unit and integration tests for Module G1: Target-driven option search & realistic explanations."""

import unittest
from simulation.experiments import run_experiment, _is_staff_handled_task
from api import _run_process


class TestModuleG1Experiments(unittest.TestCase):
    def setUp(self):
        self.process = {
            "nodes": [
                {"id": "start", "type": "start"},
                {"id": "t1", "type": "task", "data": {"label": "Receive Order", "duration": 4, "resource": "cashier"}},
                {"id": "t2", "type": "task", "data": {"label": "Brew Tea", "duration": 7, "resource": "barista"}},
                {"id": "t3", "type": "task", "data": {"label": "Customer Wait / Drink", "duration": 5}},  # Unstaffed
                {"id": "end", "type": "end"}
            ],
            "edges": [
                {"source": "start", "target": "t1"},
                {"source": "t1", "target": "t2"},
                {"source": "t2", "target": "t3"},
                {"source": "t3", "target": "end"}
            ],
            "resources": [
                {"id": "cashier", "name": "cashier", "quantity": 1},
                {"id": "barista", "name": "barista", "quantity": 1}
            ]
        }
        self.config = {
            "arrival_rate": 0.1,
            "total_instances": 300,
            "seed": 42,
            "replications": 3
        }

    def test_unstaffed_tasks_never_sped_up(self):
        """Steps without resources must never receive duration multipliers."""
        staff_node = self.process["nodes"][1]
        unstaffed_node = self.process["nodes"][3]
        self.assertTrue(_is_staff_handled_task(staff_node, self.process["resources"]))
        self.assertFalse(_is_staff_handled_task(unstaffed_node, self.process["resources"]))

    def test_reduce_waiting_by_50(self):
        """reduce waiting by 50% returns either a tested option reaching target or honest reason."""
        target = {"metric": "waiting", "direction": "decrease", "target_pct": 50}
        result = run_experiment(self.process, self.config, "waiting", _run_process, target=target)

        self.assertIn("baseline", result)
        self.assertIn("best", result)
        self.assertIsNotNone(result["best"])

        if result["target_met"]:
            self.assertGreaterEqual(result["achieved_pct"], 49.5)
            self.assertIsNone(result["reason"])
        else:
            self.assertIsNotNone(result["reason"])
            self.assertIn("waiting", result["reason"].lower())

    def test_reduce_cycle_time_by_50(self):
        """reduce cycle time by 50% returns tested option or honest reason explaining work time vs waiting."""
        target = {"metric": "cycle_time", "direction": "decrease", "target_pct": 50}
        result = run_experiment(self.process, self.config, "cycle_time", _run_process, target=target)

        self.assertIn("baseline", result)
        self.assertIn("best", result)
        self.assertIsNotNone(result["best"])

        if result["target_met"]:
            self.assertGreaterEqual(result["achieved_pct"], 49.5)
        else:
            self.assertIsNotNone(result["reason"])
            self.assertTrue(
                "work time is" in result["reason"] or "staffing cannot go lower" in result["reason"],
                f"Expected work time explanation in reason: {result['reason']}"
            )
            self.assertIsNotNone(result["realism"])

    def test_unachievable_target_honest_explanation(self):
        """reduce cycle time by 85% is impossible because work time cannot drop below 50%; returns reason & realism."""
        target = {"metric": "cycle_time", "direction": "decrease", "target_pct": 85}
        result = run_experiment(self.process, self.config, "cycle_time", _run_process, target=target)

        self.assertFalse(result["target_met"])
        self.assertIsNotNone(result["reason"])
        self.assertIn("work time is", result["reason"])
        self.assertIn("staffing cannot go lower", result["reason"])
        self.assertIsNotNone(result["realism"])
        self.assertIn("requires steps", result["realism"])

    def test_no_target_uses_default_behavior(self):
        """When no target is given, target_met is True and no failure reason is set."""
        result = run_experiment(self.process, self.config, "waiting", _run_process, target=None)
        self.assertIn("baseline", result)
        self.assertIn("best", result)
        self.assertIsNone(result["reason"])


if __name__ == "__main__":
    unittest.main()
