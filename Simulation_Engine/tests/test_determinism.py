"""Same seed + same input must reproduce; different seeds must not."""
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api import _run_process


PROCESS = {
    "nodes": [
        {"id": "s1", "type": "start-event"},
        {
            "id": "t1",
            "type": "task",
            "data": {
                "label": "Serve customer",
                "duration": 5,
                "duration_min": 3,
                "duration_max": 8,
                "resources": {"staff": 1},
            },
        },
        {"id": "e1", "type": "end-event"},
    ],
    "edges": [
        {"source": "s1", "target": "t1"},
        {"source": "t1", "target": "e1"},
    ],
    "resources": [
        {
            "id": "r1",
            "name": "staff",
            "type": "staff",
            "quantity": 1,
            "monthly_salary": 50000,
            "hours_per_day": 8,
            "working_days_per_month": 26,
        }
    ],
}

BASE_CONFIG = {
    "mode": "deep",
    "arrival_rate": 0.2,
    "total_instances": 80,
}


def _run(seed, replications=1, warmup_pct=0):
    cfg = dict(BASE_CONFIG)
    cfg["seed"] = seed
    cfg["replications"] = replications
    cfg["warmup_pct"] = warmup_pct
    return _run_process(copy.deepcopy(PROCESS), cfg)


class TestDeterminism(unittest.TestCase):
    def test_same_seed_identical_output(self):
        a = _run(seed=42)
        b = _run(seed=42)
        self.assertEqual(a["time_in_system"], b["time_in_system"])
        self.assertEqual(a["throughput_rates"], b["throughput_rates"])
        self.assertEqual(a["runs"], b["runs"])
        self.assertEqual(
            a["financial_summary"]["total_cost"],
            b["financial_summary"]["total_cost"],
        )
        self.assertEqual(a["activity_results"], b["activity_results"])
        self.assertNotIn("replication_stats", a)

    def test_different_seeds_differ(self):
        a = _run(seed=42)
        b = _run(seed=99)
        self.assertNotEqual(a["time_in_system"]["avg"], b["time_in_system"]["avg"])

    def test_replication_stats_present_when_replications_ge_2(self):
        result = _run(seed=42, replications=3)
        stats = result["replication_stats"]
        self.assertEqual(stats["n"], 3)
        self.assertEqual(len(stats["per_replication_means"]), 3)
        self.assertEqual(len(stats["per_replication_avg_wait"]), 3)
        self.assertEqual(len(stats["per_replication_total_cost"]), 3)
        self.assertLessEqual(stats["ci_95_low"], stats["mean_cycle_time"])
        self.assertLessEqual(stats["mean_cycle_time"], stats["ci_95_high"])

        again = _run(seed=42, replications=3)
        self.assertEqual(stats, again["replication_stats"])


if __name__ == "__main__":
    unittest.main()
