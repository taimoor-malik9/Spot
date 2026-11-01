import unittest
from fastapi import HTTPException
from api import validate_process

class TestModuleD1bValidation(unittest.TestCase):

    def _base_process(self, task_node):
        return {
            "nodes": [
                {"id": "start", "type": "start-event", "origin": "structural", "data": {"label": "Start"}},
                task_node,
                {"id": "end", "type": "end-event", "origin": "structural", "data": {"label": "End"}},
            ],
            "edges": [
                {"source": "start", "target": task_node["id"]},
                {"source": task_node["id"], "target": "end"},
            ],
            "resources": []
        }

    def test_stated_task_missing_duration_raises_error(self):
        task = {"id": "t1", "type": "task", "origin": "stated", "data": {"label": "Take Order", "duration": 0}}
        proc = self._base_process(task)
        with self.assertRaises(HTTPException) as ctx:
            validate_process(proc)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("These tasks are missing durations: \"Take Order\"", ctx.exception.detail)

    def test_structural_task_exempt_from_duration(self):
        task = {"id": "t_repair", "type": "task", "origin": "structural", "data": {"label": "Complete Process", "duration": 0}}
        proc = self._base_process(task)
        # Should not raise
        validate_process(proc)

    def test_inferred_unkept_task_exempt_from_duration(self):
        task = {"id": "t_inf", "type": "task", "origin": "inferred", "kept": False, "data": {"label": "Sanitize", "duration": 0}}
        proc = self._base_process(task)
        # Should not raise
        validate_process(proc)

    def test_inferred_kept_task_missing_duration_raises_error(self):
        task = {"id": "t_inf", "type": "task", "origin": "inferred", "kept": True, "data": {"label": "Sanitize", "duration": 0}}
        proc = self._base_process(task)
        with self.assertRaises(HTTPException) as ctx:
            validate_process(proc)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("These tasks are missing durations: \"Sanitize\"", ctx.exception.detail)

    def test_reversed_range_auto_normalizes_without_error(self):
        task = {"id": "t1", "type": "task", "origin": "user", "data": {"label": "Cook", "duration_min": 15, "duration_max": 5}}
        proc = self._base_process(task)
        # Ranges never error: auto-normalize
        validate_process(proc)
        self.assertEqual(task["data"]["duration_min"], 5.0)
        self.assertEqual(task["data"]["duration_max"], 15.0)

if __name__ == "__main__":
    unittest.main()
