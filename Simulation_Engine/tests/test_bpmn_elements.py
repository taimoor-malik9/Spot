"""
Test all BPMN element types are properly handled by the simulation engine.
Covers: start event variants, end event variants, task variants,
intermediate events (catch/throw/timer), inclusive gateway, and visual-only elements.
"""

import unittest
from simulation.graph import build_graph, _TYPE_MAP, _VISUAL_ONLY
from simulation.monte_carlo import run_single_pass, run_until_convergence


def _make_process(nodes, edges, resources=None):
    """Helper to build a process_json dict."""
    return {"nodes": nodes, "edges": edges, "resources": resources or []}


class TestTypeMap(unittest.TestCase):
    """Verify every model.jsx element type is in _TYPE_MAP."""

    MODEL_JSX_TYPES = [
        # Start events
        "start-event", "message-start-event", "timer-start-event",
        "conditional-start-event", "signal-start-event",
        # Intermediate events
        "intermediate-event", "message-intermediate-catch", "message-intermediate-throw",
        "timer-intermediate-catch", "conditional-intermediate-catch",
        "signal-intermediate-catch", "signal-intermediate-throw",
        # End events
        "end-event", "message-end-event", "error-end-event",
        "escalation-end-event", "signal-end-event", "terminate-end-event",
        # Activities
        "task", "user-task", "service-task", "script-task", "manual-task",
        "send-task", "receive-task", "business-rule-task", "subprocess", "call-activity",
        # Gateways
        "exclusive-gateway", "parallel-gateway", "inclusive-gateway",
        "complex-gateway", "event-based-gateway",
        # Artifacts & Swimlanes
        "data-object", "data-store", "document", "annotation", "group",
        "input", "output", "pool", "lane",
    ]

    def test_all_types_mapped(self):
        for t in self.MODEL_JSX_TYPES:
            self.assertIn(t, _TYPE_MAP, f"Type '{t}' from model.jsx is missing from _TYPE_MAP")

    def test_visual_only_types(self):
        for t in ["pool", "lane", "data-object", "data-store", "document",
                   "annotation", "group", "input", "output"]:
            self.assertIn(t, _VISUAL_ONLY, f"'{t}' should be in _VISUAL_ONLY")
            self.assertIsNone(_TYPE_MAP[t], f"'{t}' should map to None in _TYPE_MAP")


class TestStartEventVariants(unittest.TestCase):
    """All start event variants should be recognized and work as process entry."""

    START_TYPES = ["start-event", "message-start-event", "timer-start-event",
                   "conditional-start-event", "signal-start-event"]

    def test_each_start_variant(self):
        for start_type in self.START_TYPES:
            nodes = [
                {"id": "s1", "type": start_type},
                {"id": "t1", "type": "task", "data": {"duration": 5}},
                {"id": "e1", "type": "end-event"},
            ]
            edges = [
                {"source": "s1", "target": "t1"},
                {"source": "t1", "target": "e1"},
            ]
            process = _make_process(nodes, edges)
            graph = build_graph(process)

            self.assertIn("s1", graph["nodes"], f"Start node with type '{start_type}' should be in graph")
            self.assertEqual(graph["nodes"]["s1"]["type"], "start")

            result = run_single_pass(graph, "s1")
            self.assertTrue(len(result[0]) > 0, f"Process with {start_type} should produce results")


class TestEndEventVariants(unittest.TestCase):
    """All end event variants should terminate the token."""

    END_TYPES = ["end-event", "message-end-event", "error-end-event",
                 "escalation-end-event", "signal-end-event", "terminate-end-event"]

    def test_each_end_variant(self):
        for end_type in self.END_TYPES:
            nodes = [
                {"id": "s1", "type": "start-event"},
                {"id": "t1", "type": "task", "data": {"duration": 3}},
                {"id": "e1", "type": end_type},
            ]
            edges = [
                {"source": "s1", "target": "t1"},
                {"source": "t1", "target": "e1"},
            ]
            process = _make_process(nodes, edges)
            graph = build_graph(process)

            self.assertIn("e1", graph["nodes"], f"End node with type '{end_type}' should be in graph")

            result = run_single_pass(graph, "s1")
            self.assertTrue(len(result[0]) > 0, f"Process with {end_type} should produce results")
            self.assertGreater(result[0][0], 0, f"Cycle time should be > 0")


class TestTaskVariants(unittest.TestCase):
    """All task variants should consume duration and produce activity metrics."""

    TASK_TYPES = ["task", "user-task", "service-task", "script-task",
                  "manual-task", "send-task", "receive-task",
                  "business-rule-task", "subprocess", "call-activity"]

    def test_each_task_variant_simulates_duration(self):
        for task_type in self.TASK_TYPES:
            nodes = [
                {"id": "s1", "type": "start-event"},
                {"id": "t1", "type": task_type, "data": {"duration": 10}},
                {"id": "e1", "type": "end-event"},
            ]
            edges = [
                {"source": "s1", "target": "t1"},
                {"source": "t1", "target": "e1"},
            ]
            process = _make_process(nodes, edges)
            graph = build_graph(process)

            self.assertEqual(graph["nodes"]["t1"]["type"], "task",
                             f"'{task_type}' should map to 'task' in graph")

            result = run_single_pass(graph, "s1")
            all_times = result[0]
            all_task_durations = result[1]

            self.assertTrue(len(all_times) > 0, f"{task_type} should produce results")
            self.assertIn("t1", all_task_durations, f"{task_type} should record task durations")
            self.assertGreater(all_task_durations["t1"][0], 0, f"{task_type} should have duration > 0")

    def test_task_variant_with_resource(self):
        """User-task with a resource should queue properly."""
        nodes = [
            {"id": "s1", "type": "start-event"},
            {"id": "t1", "type": "user-task", "data": {"duration": 5, "resource": "Agent"}},
            {"id": "e1", "type": "end-event"},
        ]
        edges = [
            {"source": "s1", "target": "t1"},
            {"source": "t1", "target": "e1"},
        ]
        resources = [{"name": "Agent", "quantity": 1}]
        process = _make_process(nodes, edges, resources)
        graph = build_graph(process)

        result = run_until_convergence(graph, "s1", resources_dict=resources,
                                       arrival_rate=2.0, max_runs=50, min_runs=10)
        all_times = result[0]
        self.assertTrue(len(all_times) >= 10)


class TestIntermediateEvents(unittest.TestCase):
    """Intermediate catch/throw events should work correctly."""

    def test_intermediate_throw_passthrough(self):
        """Throw events should pass through with zero delay."""
        nodes = [
            {"id": "s1", "type": "start-event"},
            {"id": "t1", "type": "task", "data": {"duration": 5}},
            {"id": "it1", "type": "message-intermediate-throw"},
            {"id": "t2", "type": "task", "data": {"duration": 5}},
            {"id": "e1", "type": "end-event"},
        ]
        edges = [
            {"source": "s1", "target": "t1"},
            {"source": "t1", "target": "it1"},
            {"source": "it1", "target": "t2"},
            {"source": "t2", "target": "e1"},
        ]
        process = _make_process(nodes, edges)
        graph = build_graph(process)

        self.assertEqual(graph["nodes"]["it1"]["type"], "intermediate-throw")

        result = run_single_pass(graph, "s1")
        all_times = result[0]
        # Total time should be ~10 (5 + 5, throw adds 0)
        self.assertAlmostEqual(all_times[0], 10.0, places=1)

    def test_intermediate_catch_adds_delay(self):
        """Catch events should add a small delay."""
        nodes = [
            {"id": "s1", "type": "start-event"},
            {"id": "ic1", "type": "message-intermediate-catch"},
            {"id": "t1", "type": "task", "data": {"duration": 5}},
            {"id": "e1", "type": "end-event"},
        ]
        edges = [
            {"source": "s1", "target": "ic1"},
            {"source": "ic1", "target": "t1"},
            {"source": "t1", "target": "e1"},
        ]
        process = _make_process(nodes, edges)
        graph = build_graph(process)

        self.assertEqual(graph["nodes"]["ic1"]["type"], "intermediate-catch")

        result = run_single_pass(graph, "s1")
        all_times = result[0]
        # Total should be > 5 (task) because catch adds some delay
        self.assertGreater(all_times[0], 5.0)

    def test_timer_catch_uses_configured_duration(self):
        """Timer catch should use the configured duration."""
        nodes = [
            {"id": "s1", "type": "start-event"},
            {"id": "tc1", "type": "timer-intermediate-catch", "data": {"duration": 15}},
            {"id": "t1", "type": "task", "data": {"duration": 5}},
            {"id": "e1", "type": "end-event"},
        ]
        edges = [
            {"source": "s1", "target": "tc1"},
            {"source": "tc1", "target": "t1"},
            {"source": "t1", "target": "e1"},
        ]
        process = _make_process(nodes, edges)
        graph = build_graph(process)

        self.assertEqual(graph["nodes"]["tc1"]["type"], "timer-catch")

        result = run_single_pass(graph, "s1")
        all_times = result[0]
        # Total should be ~20 (15 timer + 5 task)
        self.assertAlmostEqual(all_times[0], 20.0, places=1)

    def test_signal_variants(self):
        """Signal catch and throw should work."""
        nodes = [
            {"id": "s1", "type": "start-event"},
            {"id": "sc1", "type": "signal-intermediate-catch"},
            {"id": "t1", "type": "task", "data": {"duration": 5}},
            {"id": "st1", "type": "signal-intermediate-throw"},
            {"id": "e1", "type": "end-event"},
        ]
        edges = [
            {"source": "s1", "target": "sc1"},
            {"source": "sc1", "target": "t1"},
            {"source": "t1", "target": "st1"},
            {"source": "st1", "target": "e1"},
        ]
        process = _make_process(nodes, edges)
        graph = build_graph(process)
        result = run_single_pass(graph, "s1")
        self.assertTrue(len(result[0]) > 0)
        self.assertGreater(result[0][0], 5.0)  # catch adds some delay


class TestInclusiveGateway(unittest.TestCase):
    """Inclusive gateway should activate one or more branches."""

    def test_inclusive_gateway_single_branch(self):
        """When only one outgoing edge, should just pass through."""
        nodes = [
            {"id": "s1", "type": "start-event"},
            {"id": "ig1", "type": "inclusive-gateway"},
            {"id": "t1", "type": "task", "data": {"duration": 5}},
            {"id": "e1", "type": "end-event"},
        ]
        edges = [
            {"source": "s1", "target": "ig1"},
            {"source": "ig1", "target": "t1"},
            {"source": "t1", "target": "e1"},
        ]
        process = _make_process(nodes, edges)
        graph = build_graph(process)
        result = run_single_pass(graph, "s1")
        self.assertTrue(len(result[0]) > 0)

    def test_inclusive_gateway_multi_branch(self):
        """Multiple branches with join should produce valid results."""
        nodes = [
            {"id": "s1", "type": "start-event"},
            {"id": "ig_split", "type": "inclusive-gateway"},
            {"id": "t1", "type": "task", "data": {"duration": 5}},
            {"id": "t2", "type": "task", "data": {"duration": 8}},
            {"id": "ig_join", "type": "inclusive-gateway"},
            {"id": "t3", "type": "task", "data": {"duration": 3}},
            {"id": "e1", "type": "end-event"},
        ]
        edges = [
            {"source": "s1", "target": "ig_split"},
            {"source": "ig_split", "target": "t1", "probability": 0.8},
            {"source": "ig_split", "target": "t2", "probability": 0.8},
            {"source": "t1", "target": "ig_join"},
            {"source": "t2", "target": "ig_join"},
            {"source": "ig_join", "target": "t3"},
            {"source": "t3", "target": "e1"},
        ]
        process = _make_process(nodes, edges)
        graph = build_graph(process)
        result = run_single_pass(graph, "s1")
        self.assertTrue(len(result[0]) > 0)


class TestComplexAndEventBasedGateway(unittest.TestCase):
    """Complex and event-based gateways should work as XOR."""

    def test_complex_gateway(self):
        nodes = [
            {"id": "s1", "type": "start-event"},
            {"id": "cg1", "type": "complex-gateway"},
            {"id": "t1", "type": "task", "data": {"duration": 5}},
            {"id": "t2", "type": "task", "data": {"duration": 3}},
            {"id": "e1", "type": "end-event"},
        ]
        edges = [
            {"source": "s1", "target": "cg1"},
            {"source": "cg1", "target": "t1", "probability": 0.5},
            {"source": "cg1", "target": "t2", "probability": 0.5},
            {"source": "t1", "target": "e1"},
            {"source": "t2", "target": "e1"},
        ]
        process = _make_process(nodes, edges)
        graph = build_graph(process)
        self.assertEqual(graph["nodes"]["cg1"]["type"], "exclusive-gateway")
        result = run_single_pass(graph, "s1")
        self.assertTrue(len(result[0]) > 0)

    def test_event_based_gateway(self):
        nodes = [
            {"id": "s1", "type": "start-event"},
            {"id": "ebg1", "type": "event-based-gateway"},
            {"id": "t1", "type": "task", "data": {"duration": 5}},
            {"id": "t2", "type": "task", "data": {"duration": 3}},
            {"id": "e1", "type": "end-event"},
        ]
        edges = [
            {"source": "s1", "target": "ebg1"},
            {"source": "ebg1", "target": "t1", "probability": 0.5},
            {"source": "ebg1", "target": "t2", "probability": 0.5},
            {"source": "t1", "target": "e1"},
            {"source": "t2", "target": "e1"},
        ]
        process = _make_process(nodes, edges)
        graph = build_graph(process)
        self.assertEqual(graph["nodes"]["ebg1"]["type"], "exclusive-gateway")
        result = run_single_pass(graph, "s1")
        self.assertTrue(len(result[0]) > 0)


class TestVisualOnlyFiltering(unittest.TestCase):
    """Visual-only nodes should not appear in the simulation graph."""

    def test_visual_only_excluded(self):
        nodes = [
            {"id": "s1", "type": "start-event"},
            {"id": "pool1", "type": "pool"},
            {"id": "lane1", "type": "lane"},
            {"id": "do1", "type": "data-object"},
            {"id": "ds1", "type": "data-store"},
            {"id": "doc1", "type": "document"},
            {"id": "ann1", "type": "annotation"},
            {"id": "grp1", "type": "group"},
            {"id": "inp1", "type": "input"},
            {"id": "out1", "type": "output"},
            {"id": "t1", "type": "task", "data": {"duration": 5}},
            {"id": "e1", "type": "end-event"},
        ]
        edges = [
            {"source": "s1", "target": "t1"},
            {"source": "t1", "target": "e1"},
        ]
        process = _make_process(nodes, edges)
        graph = build_graph(process)

        # Visual-only nodes should be excluded
        for nid in ["pool1", "lane1", "do1", "ds1", "doc1", "ann1", "grp1", "inp1", "out1"]:
            self.assertNotIn(nid, graph["nodes"], f"Visual-only node '{nid}' should not be in graph")

        # Simulation should still work
        result = run_single_pass(graph, "s1")
        self.assertTrue(len(result[0]) > 0)


class TestAPIValidation(unittest.TestCase):
    """Test that api.py validation recognizes all types."""

    def test_validate_recognizes_all_start_types(self):
        from api import _START_TYPES
        for t in ["start-event", "message-start-event", "timer-start-event",
                   "conditional-start-event", "signal-start-event"]:
            self.assertIn(t, _START_TYPES)

    def test_validate_recognizes_all_end_types(self):
        from api import _END_TYPES
        for t in ["end-event", "message-end-event", "error-end-event",
                   "escalation-end-event", "signal-end-event", "terminate-end-event"]:
            self.assertIn(t, _END_TYPES)

    def test_validate_recognizes_all_task_types(self):
        from api import _TASK_TYPES
        for t in ["task", "user-task", "service-task", "script-task", "manual-task",
                   "send-task", "receive-task", "business-rule-task",
                   "subprocess", "call-activity"]:
            self.assertIn(t, _TASK_TYPES)


if __name__ == "__main__":
    unittest.main()
