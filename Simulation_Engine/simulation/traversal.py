import simpy
import numpy as np


def _find_matching_join(split_id, graph):
    cache = graph.setdefault("_join_cache", {})
    if split_id in cache:
        return cache[split_id]

    branches = graph["adjacency"].get(split_id, [])
    if len(branches) < 2:
        cache[split_id] = None
        return None

    visited = [{b["target"]} for b in branches]
    frontier = [[b["target"]] for b in branches]
    join_node = None

    while any(frontier) and join_node is None:
        for i, nodes in enumerate(frontier):
            nxt = []
            for node_id in nodes:
                for edge in graph["adjacency"].get(node_id, []):
                    tgt = edge["target"]
                    if tgt not in visited[i]:
                        visited[i].add(tgt)
                        nxt.append(tgt)
            frontier[i] = nxt

        common = set.intersection(*visited)
        if common:
            # Prefer a gateway node as the join point
            gateway_hits = [n for n in common
                            if graph["nodes"].get(n, {}).get("type") in
                            ("parallel-gateway", "inclusive-gateway")]
            join_node = sorted(gateway_hits or common)[0]

    cache[split_id] = join_node
    return join_node


def _walk(env, node_id, graph, all_times, all_task_durations, resources,
          all_task_wait_times, all_resource_busy, all_task_arrival_times,
          all_task_queue_depths, stop_at=None, token_start_time=None):
   
    if token_start_time is None:
        token_start_time = env.now

    current_node_id = node_id
    last_task_end_time = env.now

    while current_node_id:
        if stop_at is not None and current_node_id == stop_at:
            return  

        if current_node_id not in graph["nodes"]:
            return

        node = graph["nodes"][current_node_id]
        node_type = node["type"]
        neighbors = graph["adjacency"].get(current_node_id, [])

        # ── End Events ────────────────────────────────────────────────────
        if node_type == "end":
            if stop_at is None:
                all_times.append(env.now - token_start_time)
            return
        elif node_type == "terminate-end":
            if stop_at is None:
                all_times.append(env.now - token_start_time)
            return

        # ── Start Events (all variants) ──────────────────────────────────
        elif node_type in ("start", "pool", "lane"):
            all_task_arrival_times.setdefault(current_node_id, []).append(env.now)
            current_node_id = neighbors[0]["target"] if neighbors else None
            continue

        # ── Intermediate Throw Events ────────────────────────────────────
        elif node_type == "intermediate-throw":
            all_task_arrival_times.setdefault(current_node_id, []).append(env.now)
            current_node_id = neighbors[0]["target"] if neighbors else None
            continue

     
        elif node_type == "intermediate-catch":
            all_task_arrival_times.setdefault(current_node_id, []).append(env.now)
            data = node.get("data") or node
            duration_unit = data.get("duration_unit", "minutes")

            multiplier = 1.0
            if duration_unit == "seconds":   multiplier = 1 / 60.0
            elif duration_unit == "hours":   multiplier = 60.0
            elif duration_unit == "days":    multiplier = 60.0 * 24
            elif duration_unit == "weeks":   multiplier = 60.0 * 24 * 7
            elif duration_unit == "months":  multiplier = 60.0 * 24 * 30

            # Allow the user to configure a wait duration on catch events
            dur = data.get("duration")
            if dur is not None:
                wait = float(dur) * multiplier
            else:
                # Default: small random delay simulating external trigger wait
                wait = float(np.random.uniform(0.5, 2.0)) * multiplier
            yield env.timeout(wait)
            all_task_durations.setdefault(current_node_id, []).append(wait)
            all_task_wait_times.setdefault(current_node_id, []).append(0.0)
            all_task_queue_depths.setdefault(current_node_id, []).append(0)
            last_task_end_time = env.now
            current_node_id = neighbors[0]["target"] if neighbors else None

     
        elif node_type == "timer-catch":
            all_task_arrival_times.setdefault(current_node_id, []).append(env.now)
            data = node.get("data") or node

            duration_min = data.get("duration_min")
            duration_max = data.get("duration_max")
            duration_fixed = data.get("duration")
            duration_unit = data.get("duration_unit", "minutes")

            multiplier = 1.0
            if duration_unit == "seconds":   multiplier = 1 / 60.0
            elif duration_unit == "hours":   multiplier = 60.0
            elif duration_unit == "days":    multiplier = 60.0 * 24
            elif duration_unit == "weeks":   multiplier = 60.0 * 24 * 7
            elif duration_unit == "months":  multiplier = 60.0 * 24 * 30

            if duration_min is not None and duration_max is not None:
                float_min = float(duration_min) * multiplier
                float_max = float(duration_max) * multiplier
                if float_min >= float_max:
                    duration = float_max
                else:
                    mode = (float_min + float_max) / 2
                    duration = float(np.random.triangular(float_min, mode, float_max))
            elif duration_fixed is not None:
                duration = float(duration_fixed) * multiplier
            else:
                # Default timer delay if nothing configured
                duration = 1.0 * multiplier

            yield env.timeout(duration)
            all_task_durations.setdefault(current_node_id, []).append(duration)
            all_task_wait_times.setdefault(current_node_id, []).append(0.0)
            all_task_queue_depths.setdefault(current_node_id, []).append(0)
            last_task_end_time = env.now
            current_node_id = neighbors[0]["target"] if neighbors else None

        # ── Tasks / Activities (all variants) ────────────────────────────
        elif node_type in ("task", "subprocess"):
            data = node.get("data") or node

            duration_min = data.get("duration_min")
            duration_max = data.get("duration_max")
            duration_fixed = data.get("duration")
            duration_unit = data.get("duration_unit", "minutes")
            duration_dist = str(data.get("duration_distribution") or "").strip().lower()

            multiplier = 1.0
            if duration_unit == "seconds":   multiplier = 1 / 60.0
            elif duration_unit == "hours":   multiplier = 60.0
            elif duration_unit == "days":    multiplier = 60.0 * 24
            elif duration_unit == "weeks":   multiplier = 60.0 * 24 * 7
            elif duration_unit == "months":  multiplier = 60.0 * 24 * 30

            if duration_dist == "exponential":
                if duration_fixed is not None:
                    mean = float(duration_fixed) * multiplier
                elif duration_min is not None and duration_max is not None:
                    mean = ((float(duration_min) + float(duration_max)) / 2.0) * multiplier
                else:
                    mean = 1.0 * multiplier
                duration = float(np.random.exponential(max(mean, 1e-12)))
            elif duration_min is not None and duration_max is not None:
                float_min = float(duration_min) * multiplier
                float_max = float(duration_max) * multiplier
                if float_min >= float_max:
                    duration = float_max
                else:
                    mode = (float_min + float_max) / 2
                    duration = float(np.random.triangular(float_min, mode, float_max))
            else:
                duration = float(duration_fixed) * multiplier if duration_fixed is not None else (1.0 * multiplier)

            # A task may need several resources at once (e.g. Cook AND Oven),
            # and may need MORE THAN ONE unit of a given resource (e.g. an
            # oven that fits 2 pizzas needing "Oven": 2). Prefer the full
            # data.resources dict (name -> qty); fall back to the legacy
            # single data.resource / data.resource_id string field (qty 1).
            needed_qty = {}  # lowercased resource name -> units required
            multi = data.get("resources")
            if isinstance(multi, dict) and multi:
                for name, qty in multi.items():
                    key = str(name).strip().lower()
                    if not key:
                        continue
                    try:
                        q = int(qty)
                    except (TypeError, ValueError):
                        q = 1
                    needed_qty[key] = max(1, q)
            else:
                single = data.get("resource") or data.get("resource_id")
                if isinstance(single, str) and single.strip():
                    needed_qty[single.strip().lower()] = 1

            # Only resources that actually exist in the simulation's resource
            # pool can be contended for; skip unknown/unconfigured ones. Cap
            # requested units at the resource's total capacity so a task
            # asking for more than physically exists doesn't deadlock forever.
            needed_qty = {
                r: min(q, resources[r].capacity)
                for r, q in needed_qty.items()
                if resources and r in resources
            }

            arrival_time = env.now
            all_task_arrival_times.setdefault(current_node_id, []).append(arrival_time)
            idle_time = max(0, arrival_time - last_task_end_time)
            all_task_arrival_times.setdefault(f"{current_node_id}_idle", []).append(idle_time)

            if needed_qty:
                reqs = []
                wait_start = env.now
                max_queue_depth = max(len(resources[r].queue) for r in needed_qty)
                all_task_queue_depths.setdefault(current_node_id, []).append(max_queue_depth)

                # Request every required unit of every required resource before
                # starting the task — all must be granted before work begins
                # (models true simultaneous need, including multi-unit needs).
                try:
                    for r, qty in needed_qty.items():
                        for _ in range(qty):
                            req = resources[r].request()
                            reqs.append((r, req))
                    for _, req in reqs:
                        yield req

                    wait_time = env.now - wait_start
                    all_task_wait_times.setdefault(current_node_id, []).append(wait_time)
                    yield env.timeout(duration)
                    for r, _ in reqs:
                        all_resource_busy.setdefault(r, []).append(duration)
                    all_task_durations.setdefault(current_node_id, []).append(duration)
                finally:
                    for r, req in reqs:
                        resources[r].release(req)
            else:
                yield env.timeout(duration)
                all_task_durations.setdefault(current_node_id, []).append(duration)
                all_task_wait_times.setdefault(current_node_id, []).append(0.0)
                all_task_queue_depths.setdefault(current_node_id, []).append(0)

            last_task_end_time = env.now
            current_node_id = neighbors[0]["target"] if neighbors else None

        # ── Exclusive Gateway (XOR) ──────────────────────────────────────
        elif node_type in ("exclusive-gateway", "gateway"):
            all_task_arrival_times.setdefault(current_node_id, []).append(env.now)
            if not neighbors:
                current_node_id = None
                continue

            probabilities = [n.get("probability") for n in neighbors]
            if all(p is not None for p in probabilities):
                total = sum(probabilities)
                if total > 0:
                    weights = [p / total for p in probabilities]
                    chosen = np.random.choice(len(neighbors), p=weights)
                    current_node_id = neighbors[chosen]["target"]
                else:
                    chosen = np.random.randint(0, len(neighbors))
                    current_node_id = neighbors[chosen]["target"]
            else:
                chosen = np.random.randint(0, len(neighbors))
                current_node_id = neighbors[chosen]["target"]

        # ── Parallel Gateway (AND) ───────────────────────────────────────
        elif node_type == "parallel-gateway":
            all_task_arrival_times.setdefault(current_node_id, []).append(env.now)

            if not neighbors:
                current_node_id = None
                continue

            if len(neighbors) == 1:
               
                current_node_id = neighbors[0]["target"]
                continue

            join_node_id = _find_matching_join(current_node_id, graph)

            if join_node_id is None:
               
                for edge in neighbors:
                    env.process(_walk(
                        env, edge["target"], graph, all_times, all_task_durations,
                        resources, all_task_wait_times, all_resource_busy,
                        all_task_arrival_times, all_task_queue_depths, stop_at=None
                    ))
                return

            join_event = env.event()
            state = {"arrived": 0, "needed": len(neighbors)}

            def _branch_done(_event, state=state, join_event=join_event):
                state["arrived"] += 1
                if state["arrived"] >= state["needed"] and not join_event.triggered:
                    join_event.succeed()

            for edge in neighbors:
                branch_proc = env.process(_walk(
                    env, edge["target"], graph, all_times, all_task_durations,
                    resources, all_task_wait_times, all_resource_busy,
                    all_task_arrival_times, all_task_queue_depths,
                    stop_at=join_node_id
                ))
                branch_proc.callbacks.append(_branch_done)

            yield join_event  # wait until every branch has arrived at the join

            last_task_end_time = env.now
            join_neighbors = graph["adjacency"].get(join_node_id, [])
            current_node_id = join_neighbors[0]["target"] if join_neighbors else None

        # ── Inclusive Gateway (OR) ───────────────────────────────────────
        elif node_type == "inclusive-gateway":
            all_task_arrival_times.setdefault(current_node_id, []).append(env.now)

            if not neighbors:
                current_node_id = None
                continue

            # Single outgoing edge — just a merge / pass-through
            if len(neighbors) == 1:
                current_node_id = neighbors[0]["target"]
                continue

            # Decide which branches to activate
            probabilities = [n.get("probability") for n in neighbors]
            activated = []

            if all(p is not None for p in probabilities):
                for i, p in enumerate(probabilities):
                    if np.random.random() < p:
                        activated.append(i)
                # Guarantee at least one branch fires
                if not activated:
                    best = int(np.argmax(probabilities))
                    activated.append(best)
            else:
                # No probabilities set — activate all branches (full parallel)
                activated = list(range(len(neighbors)))

            if len(activated) == 1:
                # Only one branch — no fork needed, just continue
                current_node_id = neighbors[activated[0]]["target"]
                continue

            # Multiple branches — fork & synchronise at the join
            join_node_id = _find_matching_join(current_node_id, graph)

            if join_node_id is None:
                # No join found — fire branches independently
                for idx in activated:
                    env.process(_walk(
                        env, neighbors[idx]["target"], graph,
                        all_times, all_task_durations, resources,
                        all_task_wait_times, all_resource_busy,
                        all_task_arrival_times, all_task_queue_depths,
                        stop_at=None
                    ))
                return

            join_event = env.event()
            state = {"arrived": 0, "needed": len(activated)}

            def _inc_branch_done(_event, state=state, join_event=join_event):
                state["arrived"] += 1
                if state["arrived"] >= state["needed"] and not join_event.triggered:
                    join_event.succeed()

            for idx in activated:
                branch_proc = env.process(_walk(
                    env, neighbors[idx]["target"], graph,
                    all_times, all_task_durations, resources,
                    all_task_wait_times, all_resource_busy,
                    all_task_arrival_times, all_task_queue_depths,
                    stop_at=join_node_id
                ))
                branch_proc.callbacks.append(_inc_branch_done)

            yield join_event

            last_task_end_time = env.now
            join_neighbors = graph["adjacency"].get(join_node_id, [])
            current_node_id = join_neighbors[0]["target"] if join_neighbors else None

        # ── Fallback (unknown type) ──────────────────────────────────────
        else:
            current_node_id = neighbors[0]["target"] if neighbors else None


def simulate_process(env, node_id, graph, all_times, all_task_durations, resources,
                     all_task_wait_times, all_resource_busy, all_task_arrival_times,
                     all_task_queue_depths):
   
    yield from _walk(
        env, node_id, graph, all_times, all_task_durations, resources,
        all_task_wait_times, all_resource_busy, all_task_arrival_times,
        all_task_queue_depths, stop_at=None
    )