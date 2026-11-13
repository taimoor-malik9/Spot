import unittest
from simulation.resource_diff import compute_resource_changes, compute_task_changes, compute_all_changes


class TestResourceDiff(unittest.TestCase):
    def test_count_increase_and_decrease(self):
        baseline = {
            "resources": [
                {"id": "res_1", "name": "Loan Officer", "quantity": 2, "type": "staff"},
                {"id": "res_2", "name": "Clerk", "quantity": 3, "type": "staff"},
            ],
            "nodes": [
                {"id": "task_1", "type": "task", "data": {"label": "Manual Review", "resource": "Loan Officer"}},
                {"id": "task_2", "type": "task", "data": {"label": "Prepare Contract", "resource": "Loan Officer"}},
                {"id": "task_3", "type": "task", "data": {"label": "File Document", "resource": "Clerk"}},
            ]
        }
        # Scenario: Loan Officer count 2 -> 1, Clerk count 3 -> 4
        scenario = {
            "resources": [
                {"id": "res_1", "name": "Loan Officer", "quantity": 1, "type": "staff"},
                {"id": "res_2", "name": "Clerk", "quantity": 4, "type": "staff"},
            ],
            "nodes": baseline["nodes"]
        }

        changes = compute_resource_changes(baseline, scenario)
        self.assertEqual(len(changes), 2)

        lo_change = next(c for c in changes if c["id"] == "res_1")
        self.assertEqual(lo_change["name"], "Loan Officer")
        self.assertEqual(lo_change["property"], "count")
        self.assertEqual(lo_change["before"], 2)
        self.assertEqual(lo_change["after"], 1)
        self.assertEqual(lo_change["delta"], -1)
        self.assertEqual(lo_change["delta_text"], "-1")
        self.assertEqual(lo_change["direction"], "decrease")
        self.assertEqual(lo_change["summary"], "Loan Officer: 2 → 1 (-1)")
        self.assertIn("Manual Review", lo_change["affected_tasks"])
        self.assertIn("Prepare Contract", lo_change["affected_tasks"])

        clerk_change = next(c for c in changes if c["id"] == "res_2")
        self.assertEqual(clerk_change["before"], 3)
        self.assertEqual(clerk_change["after"], 4)
        self.assertEqual(clerk_change["delta"], 1)
        self.assertEqual(clerk_change["delta_text"], "+1")
        self.assertEqual(clerk_change["direction"], "increase")

    def test_match_by_id_rename(self):
        baseline = {
            "resources": [{"id": "res_lo", "name": "Officer", "quantity": 2, "type": "staff"}]
        }
        # Renamed from Officer to Loan Officer, same ID
        scenario = {
            "resources": [{"id": "res_lo", "name": "Loan Officer", "quantity": 2, "type": "staff"}]
        }
        changes = compute_resource_changes(baseline, scenario)
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]["property"], "name")
        self.assertEqual(changes[0]["before"], "Officer")
        self.assertEqual(changes[0]["after"], "Loan Officer")
        self.assertEqual(changes[0]["direction"], "edit")

    def test_cost_per_hour_change(self):
        baseline = {
            "resources": [
                {"id": "res_clerk", "name": "Clerk", "quantity": 1, "type": "staff", "monthly_salary": 1408, "hours_per_day": 8, "working_days_per_month": 22}
            ]
        }
        # Salary changed from 1408 ($8/hr) to 1760 ($10/hr)
        scenario = {
            "resources": [
                {"id": "res_clerk", "name": "Clerk", "quantity": 1, "type": "staff", "monthly_salary": 1760, "hours_per_day": 8, "working_days_per_month": 22}
            ]
        }
        changes = compute_resource_changes(baseline, scenario)
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]["property"], "cost_per_hour")
        self.assertEqual(changes[0]["before"], "$8")
        self.assertEqual(changes[0]["after"], "$10")
        self.assertIn("cost/hr $8 → $10", changes[0]["summary"])

    def test_schedule_shift_change(self):
        baseline = {
            "resources": [
                {"id": "res_staff", "name": "Support Agent", "quantity": 1, "hours_per_day": 8, "type": "staff"}
            ]
        }
        scenario = {
            "resources": [
                {"id": "res_staff", "name": "Support Agent", "quantity": 1, "hours_per_day": 10, "type": "staff"}
            ]
        }
        changes = compute_resource_changes(baseline, scenario)
        # Note: changing hours_per_day also changes hourly rate if monthly salary is set, or schedule
        sched_change = next((c for c in changes if c["property"] == "schedule_shift"), None)
        self.assertIsNotNone(sched_change)
        self.assertIn("8h/day", sched_change["before"])
        self.assertIn("10h/day", sched_change["after"])

    def test_no_resource_changes(self):
        baseline = {
            "resources": [{"id": "res_1", "name": "Doctor", "quantity": 1, "type": "staff"}],
            "nodes": [{"id": "task_1", "type": "task", "data": {"label": "Examine", "resource": "Doctor"}}]
        }
        scenario = {
            "resources": [{"id": "res_1", "name": "Doctor", "quantity": 1, "type": "staff"}],
            "nodes": [{"id": "task_1", "type": "task", "data": {"label": "Examine", "resource": "Doctor"}}]
        }
        changes = compute_resource_changes(baseline, scenario)
        self.assertEqual(len(changes), 0)

    def test_speed_up_all_tasks_shows_no_resource_changes_and_10_task_changes(self):
        baseline_resources = [
            {"id": f"res_{i}", "name": f"Role_{i}", "quantity": 1, "type": "staff"}
            for i in range(6)
        ]
        # Scenario resources matched by name/id with identical quantities
        scenario_resources = [
            {"id": f"Role_{i}", "name": f"Role_{i}", "quantity": 1, "type": "staff"}
            for i in range(6)
        ]

        task_names = [
            "Triage and check vitals", "Consult doctor", "Blood test", "Urine test",
            "X-ray scan", "ECG recording", "Wound dressing", "Prescription issue",
            "Follow-up advice", "Discharge processing"
        ]
        baseline_nodes = [
            {"id": f"task_{i}", "type": "task", "data": {"label": task_names[i], "duration": 10.0}}
            for i in range(10)
        ]
        scenario_nodes = [
            {"id": f"task_{i}", "type": "task", "data": {"label": task_names[i], "duration": 5.0}}
            for i in range(10)
        ]

        base_proc = {"resources": baseline_resources, "nodes": baseline_nodes}
        scen_proc = {"resources": scenario_resources, "nodes": scenario_nodes}

        res_changes = compute_resource_changes(base_proc, scen_proc)
        task_changes = compute_task_changes(base_proc, scen_proc)

        # BUG 1 Acceptance: 0 resource changes
        self.assertEqual(len(res_changes), 0)

        # BUG 2 Acceptance: all 10 task duration changes
        self.assertEqual(len(task_changes), 10)
        self.assertEqual(task_changes[0]["summary"], "Triage and check vitals: 10 → 5 min (-50%)")
        for tc in task_changes:
            self.assertEqual(tc["delta_pct"], -50)
            self.assertEqual(tc["delta_text"], "-50%")
            self.assertEqual(tc["direction"], "decrease")

    def test_add_1_radiologist_shows_only_radiologist_change(self):
        baseline_resources = [
            {"id": "res_0", "name": "Receptionist", "quantity": 1, "type": "staff"},
            {"id": "res_1", "name": "Nurse", "quantity": 2, "type": "staff"},
            {"id": "res_2", "name": "Doctor", "quantity": 1, "type": "staff"},
            {"id": "res_3", "name": "Radiologist", "quantity": 1, "type": "staff"},
        ]
        scenario_resources = [
            {"id": "res_0", "name": "Receptionist", "quantity": 1, "type": "staff"},
            {"id": "res_1", "name": "Nurse", "quantity": 2, "type": "staff"},
            {"id": "res_2", "name": "Doctor", "quantity": 1, "type": "staff"},
            {"id": "res_3", "name": "Radiologist", "quantity": 2, "type": "staff"},
        ]
        nodes = [
            {"id": "t1", "type": "task", "data": {"label": "X-ray", "resource": "Radiologist", "duration": 15}}
        ]
        base_proc = {"resources": baseline_resources, "nodes": nodes}
        scen_proc = {"resources": scenario_resources, "nodes": nodes}

        changes = compute_resource_changes(base_proc, scen_proc)
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]["name"], "Radiologist")
        self.assertEqual(changes[0]["summary"], "Radiologist: 1 → 2 (+1)")
        self.assertNotIn("res_0", [c["name"] for c in changes])


if __name__ == "__main__":
    unittest.main()
