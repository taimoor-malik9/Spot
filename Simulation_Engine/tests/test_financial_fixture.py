import unittest
from fastapi import HTTPException
from simulation.financials import generate_financial_report, get_hourly_rate
from api import validate_process


class TestFinancialFixture(unittest.TestCase):
    """
    Tests for Module F1: Hand-computed fixture and financial analysis validation.
    
    Fixture:
    - 1 Doctor
    - salary: 26,000 / month
    - working hours: 26 days x 8h = 208 h/month
    - rate: 26,000 / 208 = Rs 125.0 / h
    - 1 task of 5 min using Doctor
    - 6 customers arriving 10 minutes apart:
        Customer 0: arrives t=0, departs t=5
        Customer 1: arrives t=10, departs t=15
        Customer 2: arrives t=20, departs t=25
        Customer 3: arrives t=30, departs t=35
        Customer 4: arrives t=40, departs t=45
        Customer 5: arrives t=50, departs t=55
    - Simulated period: t=0 to last departure t=55 min -> 55.0 min = 55.0 / 60.0 hours (0.9167 h)
    - Busy time for Doctor: 6 * 5 min = 30 min -> 0.5 hours
    """

    def setUp(self):
        self.doctor_resource = {
            "id": "res_doctor",
            "name": "Doctor",
            "type": "staff",
            "quantity": 1,
            "monthly_salary": 26000,
            "working_days_per_month": 26,
            "hours_per_day": 8,
        }

    def test_hand_computed_fixture(self):
        # 1. Hourly rate calculation
        rate = get_hourly_rate(self.doctor_resource)
        self.assertEqual(rate, 125.0, f"Expected hourly rate 125.0, got {rate}")

        # 2. Financial report computation
        # 6 customers, 5 min task each => 30 min busy
        total_sim_minutes = 55.0
        period_hours = total_sim_minutes / 60.0
        busy_minutes = [5.0, 5.0, 5.0, 5.0, 5.0, 5.0]
        busy_hours = sum(busy_minutes) / 60.0  # 0.5 hours

        resource_busy_times = {
            "doctor": busy_minutes,
            "res_doctor": busy_minutes,
        }

        report = generate_financial_report(
            resources=[self.doctor_resource],
            resource_busy_times=resource_busy_times,
            total_sim_minutes=total_sim_minutes,
            customers=6,
        )

        expected_active = round(busy_hours * 125.0, 2)  # 0.5 * 125 = 62.50
        expected_paid = round(1 * 125.0 * period_hours, 2)  # 1 * 125 * (55/60) = 114.58
        expected_idle = round(expected_paid - expected_active, 2)  # 114.58 - 62.50 = 52.08
        expected_total = expected_paid  # 114.58

        self.assertEqual(report["total_active_cost"], expected_active)
        self.assertEqual(report["total_idle_cost"], expected_idle)
        self.assertEqual(report["total_cost"], expected_total)
        self.assertEqual(report["customers"], 6)
        self.assertEqual(report["cost_per_customer"], round(expected_total / 6, 2))

        doc_report = report["resources"]["res_doctor"]
        self.assertEqual(doc_report["active_cost"], expected_active)
        self.assertEqual(doc_report["idle_cost"], expected_idle)
        self.assertEqual(doc_report["total_cost"], expected_total)
        self.assertEqual(doc_report["hourly_rate"], 125.0)
        self.assertEqual(doc_report["busy_hours"], 0.5)
        self.assertAlmostEqual(doc_report["utilization_pct"], round((0.5 / period_hours) * 100, 1), places=1)

    def test_fixture_no_resource_assigned(self):
        """
        Second test where task has no resource:
        Doctor is paid for the period, but busy hours = 0.
        Assert active = 0.0, idle = paid, total = paid, warning condition triggered.
        """
        total_sim_minutes = 55.0
        period_hours = total_sim_minutes / 60.0
        resource_busy_times = {}  # No resource busy time recorded

        report = generate_financial_report(
            resources=[self.doctor_resource],
            resource_busy_times=resource_busy_times,
            total_sim_minutes=total_sim_minutes,
            customers=6,
        )

        expected_paid = round(1 * 125.0 * period_hours, 2)  # 114.58

        self.assertEqual(report["total_active_cost"], 0.0)
        self.assertEqual(report["total_idle_cost"], expected_paid)
        self.assertEqual(report["total_cost"], expected_paid)

        # Warning condition in UI: active == 0 && paid > 0
        self.assertTrue(report["total_active_cost"] == 0 and report["total_cost"] > 0)

    def test_pre_run_check_unconfigured_resource(self):
        """
        Pre-run check: A task referencing a resource that is not in process_json['resources']
        must raise HTTPException(400) with 'Task X uses 'Y', which isn't set up. Add it in Setup before simulating.'
        """
        process_json = {
            "resources": [self.doctor_resource],
            "nodes": [
                {
                    "id": "start_1",
                    "type": "start-event",
                    "data": {"label": "Start"},
                },
                {
                    "id": "task_surgery",
                    "type": "task",
                    "data": {
                        "label": "Perform Surgery",
                        "duration": 30,
                        "resource": "Surgeon",  # Missing resource!
                    },
                },
                {
                    "id": "end_1",
                    "type": "end-event",
                    "data": {"label": "End"},
                },
            ],
            "edges": [],
        }

        with self.assertRaises(HTTPException) as ctx:
            validate_process(process_json)

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Task 'Perform Surgery' uses 'Surgeon', which isn't set up. Add it in Setup before simulating.", ctx.exception.detail)

    def test_equipment_financial_model(self):
        """
        Verify equipment depreciation + running costs:
        purchase_price = 20,800, lifespan_months = 10 -> 2,080 / month
        monthly_running_cost = 2,080 / month
        working_days = 26, hours_per_day = 8 -> 208 h/month
        hourly rate = (2080 + 2080) / 208 = 20.0 / h
        """
        equipment = {
            "id": "eq_xray",
            "name": "X-Ray Machine",
            "type": "equipment",
            "quantity": 1,
            "purchase_price": 20800,
            "lifespan_months": 10,
            "monthly_running_cost": 2080,
            "working_days_per_month": 26,
            "hours_per_day": 8,
        }
        rate = get_hourly_rate(equipment)
        self.assertEqual(rate, 20.0)

        # 1 hour simulation, 0.5 hours active
        report = generate_financial_report(
            resources=[equipment],
            resource_busy_times={"x-ray machine": [30.0]},
            total_sim_minutes=60.0,
            customers=2,
        )
        self.assertEqual(report["total_active_cost"], 10.0)
        self.assertEqual(report["total_idle_cost"], 10.0)
        self.assertEqual(report["total_cost"], 20.0)
        self.assertEqual(report["cost_per_customer"], 10.0)


if __name__ == "__main__":
    unittest.main()
