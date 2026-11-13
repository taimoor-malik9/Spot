"""Tests for realistic recommendation logic and honest ceilings in experiments."""

import json
import unittest
from pathlib import Path

from simulation.experiments import run_experiment


def mock_run_process(process_json, config):
    """Deterministic mock for run_process that computes realistic metrics based on resources and tasks."""
    resources = process_json.get("resources", [])
    if isinstance(resources, dict):
        res_list = [{"id": k, "name": k, "quantity": v} for k, v in resources.items()]
    else:
        res_list = resources

    # Baseline clinic parameters:
    # 1 Receptionist (30k), 1 Doctor (90k), 1 Lab Tech (45k)
    # Total monthly salary = 165,000 -> hourly cost ~ Rs 937.5
    # Let total base cost = 2000
    base_cost = 0.0
    for r in res_list:
        qty = float(r.get("quantity", 1))
        salary = float(r.get("monthly_salary") or 30000)
        h = float(r.get("hours_per_day") or 8)
        base_cost += qty * (salary / 22.0) * (h / 8.0) * 0.25  # for the batch

    # Check staff reductions and wait degradation
    # If Receptionist or Doctor is reduced to part-time or removed, wait increases
    wait_time = 0.0
    for r in res_list:
        r_name = str(r.get("name") or r.get("id") or "").lower()
        qty = float(r.get("quantity", 1))
        h = float(r.get("hours_per_day") or 8)
        if "doctor" in r_name and (qty < 1 or h < 8):
            wait_time += 15.0  # doctor bottleneck
        if "receptionist" in r_name and h < 8:
            wait_time += 1.5   # minor wait increase (+1.5m)
        if "pharmacist" in r_name and qty < 2:
            wait_time += 0.2   # safe reduction

    # Tasks duration
    cycle_time = 32.0 + wait_time

    # Fake resource utilization
    res_util = {}
    for r in res_list:
        r_name = str(r.get("name") or r.get("id") or "")
        r_low = r_name.lower()
        if "doctor" in r_low:
            u = 75.0
        elif "lab" in r_low:
            u = 52.0
        elif "receptionist" in r_low:
            u = 38.0  # under-utilized (< 40%)
        elif "pharmacist" in r_low:
            u = 22.0  # under-utilized (< 40%)
        else:
            u = 30.0
        res_util[r_name] = {
            "utilization_pct": u,
            "idle_pct": 100.0 - u,
            "capacity": r.get("quantity", 1),
            "avg_busy_time_per_item": 5.0
        }

    return {
        "time_in_system": {"avg": cycle_time, "histogram": [{"count": 100}]},
        "throughput_rates": 12.5,
        "resource_utilization": res_util,
        "queue_levels": {
            "queue_avg_wait_times": {"rec_queue": wait_time},
            "activity_wait_times": {"rec_node": wait_time}
        },
        "financial_summary": {
            "total_cost": round(base_cost, 2),
            "breakdown": {"labor": round(base_cost, 2)}
        },
        "activity_results": {
            "task_consult": {"avg_processing_time": 12.0, "processing_histogram": [{"count": 100}]}
        }
    }


class TestRealisticExperiments(unittest.TestCase):
    def setUp(self):
        fixture_path = Path(__file__).parent / "clinic_fixture.json"
        with open(fixture_path, "r", encoding="utf-8") as f:
            self.clinic = json.load(f)

        # Add an under-utilized Pharmacist with count 2 (utilization 22%) to hospital clinic
        self.clinic["resources"].append({
            "id": "Pharmacist",
            "name": "Pharmacist",
            "type": "staff",
            "quantity": 2,
            "hours_per_day": 8,
            "working_days_per_month": 22,
            "monthly_salary": 40000,
        })

    def test_cost_reduction_50_percent_hospital_model(self):
        """For 'reduce cost by 50%' on hospital model:
        1. No blanket speed-up option is recommended or present.
        2. Realistic options (reducing under-utilized resources) are tested.
        3. 50% is identified as not realistically reachable, with honest ceiling and explanation.
        4. Every option names a concrete action and how-to-do line.
        """
        target = {"metric": "cost", "direction": "decrease", "target_pct": 50}
        result = run_experiment(self.clinic, {}, "cost", mock_run_process, target=target)

        # 1. No blanket speed-up
        for v in result["variants"]:
            self.assertNotIn("Speed up all staff tasks", v["label"])
            self.assertNotIn("Speed up all staff tasks", v.get("action", ""))

        # 2. Target met is False since 50% is not realistically reachable
        self.assertFalse(result["target_met"])
        self.assertIsNotNone(result["best"])
        self.assertFalse(result["best"]["recommended"])

        # 3. Reason states maximum realistic saving and shortfall
        self.assertIn("maximum realistic cost saving", result["reason"])
        self.assertIn("short of your 50.0% target", result["reason"])
        self.assertIn("cutting core operational staff beyond safe limits", result["reason"])
        self.assertIn("degrades patient wait times by more than the acceptable +15% threshold", result["reason"])

        # 4. Every variant has concrete action, how_to_do, option_type
        for v in result["variants"]:
            self.assertTrue(len(v.get("action", "")) > 0, f"Variant {v['label']} missing action")
            self.assertTrue(len(v.get("how_to_do", "")) > 0, f"Variant {v['label']} missing how_to_do")
            self.assertIn(v.get("option_type"), ["realistic", "what_if"])
            # If what-if, recommended must be False
            if v.get("option_type") == "what_if":
                self.assertFalse(v.get("recommended", False))

        # Check that reducing Pharmacist was tested
        pharmacist_variant = next((v for v in result["variants"] if "Pharmacist" in v["label"]), None)
        self.assertIsNotNone(pharmacist_variant, "Under-utilized Pharmacist reduction must be tested")
        self.assertEqual(pharmacist_variant["option_type"], "realistic")
        self.assertIn("Remove 1 Pharmacist", pharmacist_variant["action"])

    def test_trade_off_exceeded_rejects_realistic_recommendation(self):
        """Any option that degrades wait time by >15% is classified as what_if and never recommended."""
        # Create a mock where removing any staff causes wait to blow up by 100%
        def degrade_mock(process_json, config):
            res = mock_run_process(process_json, config)
            # If resources were reduced, blow up wait
            if len(process_json.get("resources", [])) < len(self.clinic["resources"]) or any(r.get("quantity", 1) < 2 for r in process_json.get("resources", []) if r.get("id") == "Pharmacist"):
                res["queue_levels"]["queue_avg_wait_times"]["rec_queue"] = 25.0
                res["queue_levels"]["activity_wait_times"]["rec_node"] = 25.0
            return res

        result = run_experiment(self.clinic, {}, "cost", degrade_mock, target={"metric": "cost", "direction": "decrease", "target_pct": 10})
        # Check that any candidate with >15% wait increase has option_type="what_if" and recommended=False
        for v in result["variants"]:
            if v.get("trade_off_exceeded"):
                self.assertEqual(v["option_type"], "what_if")
                self.assertFalse(v.get("recommended", False))
                self.assertIn("exceeds +15% limit", v.get("trade_off_summary", ""))

    def test_cycle_time_bottleneck_only_concrete_levers(self):
        """For cycle-time goals, task speedups are only for bottleneck and tied to concrete levers (capped at 25%)."""
        result = run_experiment(self.clinic, {}, "cycle_time", mock_run_process)
        for v in result["variants"]:
            # Blanket speedup must not exist
            self.assertNotIn("Speed up all staff tasks", v["label"])
            # Duration speedup should be tied to concrete lever or marked what-if
            if "speed up" in v["label"].lower() or "faster" in v["label"].lower():
                if v.get("option_type") == "realistic":
                    self.assertTrue(any(term in v["how_to_do"].lower() for term in ["protocol", "intake", "equipment", "kiosk", "training"]))
                    self.assertTrue(any(pct in v["label"] for pct in ["20%", "25%"]))


if __name__ == "__main__":
    unittest.main()
