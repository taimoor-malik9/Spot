import unittest
from simulation.results import compute_results
from simulation.financials import generate_financial_report

class TestComputeResults(unittest.TestCase):
    def setUp(self):
        self.all_times = [10.0, 12.0, 15.0]
        self.all_task_durations = {"task_1": [5.0, 6.0, 7.0]}
        self.all_task_wait_times = {"task_1": [1.0, 2.0, 3.0]}
        self.all_resource_busy = {"cashier": [15.0, 18.0, 21.0]}
        self.total_sim_time = 50.0

    def test_with_resources_as_dict(self):
        resources_dict = {"Cashier": 2}
        res = compute_results(
            all_times=self.all_times,
            all_task_durations=self.all_task_durations,
            all_task_wait_times=self.all_task_wait_times,
            all_resource_busy=self.all_resource_busy,
            resources_dict=resources_dict,
            total_sim_time=self.total_sim_time
        )
        self.assertIn("Cashier", res["resource_utilization"])
        self.assertEqual(res["resource_utilization"]["Cashier"]["capacity"], 2)

    def test_with_resources_as_list(self):
        resources_list = [
            {"id": "res_001", "name": "Cashier", "quantity": 2}
        ]
        res = compute_results(
            all_times=self.all_times,
            all_task_durations=self.all_task_durations,
            all_task_wait_times=self.all_task_wait_times,
            all_resource_busy=self.all_resource_busy,
            resources_dict=resources_list,
            total_sim_time=self.total_sim_time
        )
        self.assertIn("Cashier", res["resource_utilization"])
        self.assertEqual(res["resource_utilization"]["Cashier"]["capacity"], 2)

    def test_financial_report_with_none_values(self):
        # Resource containing None values for numeric keys
        resources = [
            {
                "id": "res_001",
                "name": "Cashier",
                "type": "staff",
                "quantity": 1,
                "hours_per_day": None,
                "working_days_per_month": None,
                "monthly_salary": None
            }
        ]
        report = generate_financial_report(
            resources=resources,
            resource_busy_times=self.all_resource_busy,
            total_sim_minutes=self.total_sim_time
        )
        self.assertIn("res_001", report["resources"])
        self.assertEqual(report["resources"]["res_001"]["hourly_rate"], 0.0)

if __name__ == "__main__":
    unittest.main()
