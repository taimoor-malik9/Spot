"""Validate the engine against M/M/1 and M/M/c queueing theory."""
import copy
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api import _run_process

MU = 1.0  # mean service rate (1 / minute)
MEAN_SERVICE = 1.0 / MU
SEED = 42
REPLICATIONS = 5
TOTAL_INSTANCES = 2000
REL_TOL = 0.10


def mm_process(capacity):
    return {
        "nodes": [
            {"id": "start", "type": "start-event"},
            {
                "id": "task",
                "type": "task",
                "data": {
                    "label": "Serve",
                    "duration": MEAN_SERVICE,
                    "duration_distribution": "exponential",
                    "resources": {"server": 1},
                },
            },
            {"id": "end", "type": "end-event"},
        ],
        "edges": [
            {"source": "start", "target": "task"},
            {"source": "task", "target": "end"},
        ],
        "resources": [{"id": "r1", "name": "server", "quantity": capacity}],
    }


def mm1_wq(lam, mu):
    """Wq = ρ / (μ − λ) with ρ = λ / μ."""
    rho = lam / mu
    return rho / (mu - lam)


def erlang_c_wq(c, lam, mu):
    """Mean queue wait from Erlang C: Wq = C(c, a) / (cμ − λ)."""
    a = lam / mu
    rho = a / c
    tail = (a ** c) / (math.factorial(c) * (1.0 - rho))
    p0_inv = sum(a ** k / math.factorial(k) for k in range(c)) + tail
    erlang_c = tail / p0_inv
    return erlang_c / (c * mu - lam)


def theoretical_util_pct(lam, c, mu):
    return (lam / (c * mu)) * 100.0


def simulate(capacity, arrival_rate):
    config = {
        "mode": "deep",
        "arrival_rate": arrival_rate,
        "total_instances": TOTAL_INSTANCES,
        "seed": SEED,
        "replications": REPLICATIONS,
        "warmup_pct": 0,
        "min_runs": TOTAL_INSTANCES,
    }
    return _run_process(copy.deepcopy(mm_process(capacity)), config)


def simulated_wait(results):
    stats = results.get("replication_stats") or {}
    if "mean_avg_wait" in stats:
        return stats["mean_avg_wait"]
    return results["activity_results"]["task"]["avg_wait_time"]


def simulated_util(results):
    return results["resource_utilization"]["server"]["utilization_pct"]


def rel_error(simulated, theory):
    return abs(simulated - theory) / theory if theory else float("inf")


class TestQueueingValidation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mm1 = simulate(capacity=1, arrival_rate=0.8)
        cls.mmc = simulate(capacity=3, arrival_rate=2.4)

    def test_mm1_mean_wait_within_10_percent(self):
        theory = mm1_wq(0.8, MU)
        sim = simulated_wait(self.mm1)
        err = rel_error(sim, theory)
        self.assertLessEqual(
            err, REL_TOL,
            f"M/M/1 Wq theory={theory:.4f} sim={sim:.4f} rel_error={err:.3%}",
        )

    def test_mmc_mean_wait_within_10_percent(self):
        theory = erlang_c_wq(3, 2.4, MU)
        sim = simulated_wait(self.mmc)
        err = rel_error(sim, theory)
        self.assertLessEqual(
            err, REL_TOL,
            f"M/M/c Wq theory={theory:.4f} sim={sim:.4f} rel_error={err:.3%}",
        )

    def test_utilization_matches_rho(self):
        cases = [
            ("M/M/1", self.mm1, 0.8, 1),
            ("M/M/c", self.mmc, 2.4, 3),
        ]
        for name, results, lam, c in cases:
            theory = theoretical_util_pct(lam, c, MU)
            sim = simulated_util(results)
            err = rel_error(sim, theory)
            self.assertLessEqual(
                err, REL_TOL,
                f"{name} util theory={theory:.2f}% sim={sim:.2f}% rel_error={err:.3%}",
            )


if __name__ == "__main__":
    unittest.main()
