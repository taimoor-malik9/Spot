import json


def _parse_edge_data(raw):
    """Edge metadata (probability, type, etc.) is often stored as a
    JSON-encoded string in edge['data'] rather than a plain dict.
    Normalize both shapes into a dict so callers can just read keys."""
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except (ValueError, TypeError):
            return {}
    return {}


_TYPE_MAP = {
    # ── Start Events (all trigger process start; arrival timing is external) ──
    "start-event":             "start",
    "message-start-event":     "start",
    "timer-start-event":       "start",
    "conditional-start-event": "start",
    "signal-start-event":      "start",

    # ── Intermediate Events ──────────────────────────────────────────────────
    # Plain / throw events: pass-through with zero delay
    "intermediate-event":             "intermediate-throw",
    "message-intermediate-throw":     "intermediate-throw",
    "signal-intermediate-throw":      "intermediate-throw",
    # Catch events: token waits for an external trigger (small random delay)
    "message-intermediate-catch":     "intermediate-catch",
    "conditional-intermediate-catch": "intermediate-catch",
    "signal-intermediate-catch":      "intermediate-catch",
    # Timer catch: token waits for a specified duration
    "timer-intermediate-catch":       "timer-catch",

    # ── End Events (all terminate the token) ─────────────────────────────────
    "end-event":            "end",
    "message-end-event":    "end",
    "error-end-event":      "end",
    "escalation-end-event": "end",
    "signal-end-event":     "end",
    "terminate-end-event":  "terminate-end",

    # ── Activities (all share the same simulation behaviour: duration + resource)
    "task":               "task",
    "user-task":          "task",
    "service-task":       "task",
    "script-task":        "task",
    "manual-task":        "task",
    "send-task":          "task",
    "receive-task":       "task",
    "business-rule-task": "task",
    "subprocess":         "task",
    "call-activity":      "task",

    # ── Gateways ─────────────────────────────────────────────────────────────
    "exclusive-gateway":   "exclusive-gateway",
    "parallel-gateway":    "parallel-gateway",
    "inclusive-gateway":   "inclusive-gateway",
    "complex-gateway":     "exclusive-gateway",   # model as XOR in simulation
    "event-based-gateway": "exclusive-gateway",   # one event fires → XOR
    "gateway":             "exclusive-gateway",

    # ── Visual-only (excluded from simulation graph) ─────────────────────────
    "pool":        None,
    "lane":        None,
    "data-object": None,
    "data-store":  None,
    "document":    None,
    "annotation":  None,
    "group":       None,
    "input":       None,
    "output":      None,
}

_VISUAL_ONLY = {
    "pool", "lane", "data-object", "data-store", "document",
    "annotation", "group", "input", "output",
}


def build_graph(process_json):
    nodes = {}
    adjacency = {}

    for node in process_json["nodes"]:
        raw_type = node.get("type", "task")
        if raw_type in _VISUAL_ONLY:
            continue  # skip visual-only nodes entirely

        mapped_type = _TYPE_MAP.get(raw_type, raw_type)
        nodes[node["id"]] = {**node, "type": mapped_type}

    # Only include edges where both endpoints exist in the sim graph.
    # Some exported process files use "connections" instead of "edges" —
    # accept either so a schema mismatch fails loudly (validate_process
    # catches "no start/end reachable") instead of silently producing an
    # empty graph.
    edge_list = process_json.get("edges")
    if not edge_list:
        edge_list = process_json.get("connections", [])
    for edge in edge_list:
        src = edge.get("source") or edge.get("from") or edge.get("fromId")
        tgt = edge.get("target") or edge.get("to")   or edge.get("toId")
        if src not in nodes or tgt not in nodes:
            continue
        if src not in adjacency:
            adjacency[src] = []

        # probability may live directly on the edge OR inside a
        # (possibly stringified) edge['data'] blob — check both.
        edge_data = _parse_edge_data(edge.get("data"))
        probability = edge.get("probability")
        if probability is None:
            probability = edge_data.get("probability")

        adjacency[src].append({
            "target":      tgt,
            "probability": probability,
        })

    return {"nodes": nodes, "adjacency": adjacency}