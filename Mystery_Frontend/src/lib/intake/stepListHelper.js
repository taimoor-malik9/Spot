/**
 * Pure helper for extracting ordered steps from a raw BPMN diagram,
 * identifying actors (Customer / Store), sequential flow order, and branches.
 * Used by ProcessStepList and tests.
 */

export function stripTrailingPunctuation(str) {
  if (!str || typeof str !== 'string') return '';
  return str.trim().replace(/[?!:;,\s]+$/, '');
}

export function extractOrderedSteps(rawDiagram, options = {}) {
  const lang = options.lang || 'en';
  if (!rawDiagram?.nodes || !Array.isArray(rawDiagram.nodes)) return [];
  const nodes = rawDiagram.nodes;
  const edges = Array.isArray(rawDiagram.edges)
    ? rawDiagram.edges
    : Array.isArray(rawDiagram.connections)
    ? rawDiagram.connections
    : [];

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const outgoingMap = new Map();
  const incomingMap = new Map();

  edges.forEach((e) => {
    const src = e.source || e.fromId;
    const tgt = e.target || e.toId;
    if (src) {
      if (!outgoingMap.has(src)) outgoingMap.set(src, []);
      outgoingMap.get(src).push(e);
    }
    if (tgt) {
      if (!incomingMap.has(tgt)) incomingMap.set(tgt, []);
      incomingMap.get(tgt).push(e);
    }
  });

  const visited = new Set();
  const orderedSteps = [];

  function getStepLabel(n) {
    return n.data?.label || n.label || n.name || n.id;
  }

  function getActor(n) {
    const lane = (n.lane || n.data?.lane || n.pool || n.data?.pool || '').toLowerCase();
    const label = getStepLabel(n).toLowerCase();
    if (lane.includes('customer') || label.startsWith('customer')) {
      return { group: 'Customer', role: n.lane || n.data?.lane || 'Customer' };
    }
    return { group: 'Store', role: n.lane || n.data?.lane || 'Store / Staff' };
  }

  function canReach(srcId, targetId) {
    if (!srcId || !targetId || srcId === targetId) return false;
    const reachVisited = new Set();
    const queue = [srcId];
    while (queue.length > 0) {
      const curr = queue.shift();
      if (curr === targetId) return true;
      if (reachVisited.has(curr)) continue;
      reachVisited.add(curr);
      const nextEdges = outgoingMap.get(curr) || [];
      for (const ne of nextEdges) {
        const nxt = ne.target || ne.toId;
        if (nxt && !reachVisited.has(nxt)) {
          queue.push(nxt);
        }
      }
    }
    return false;
  }

  function sortEdgesByDependency(edgeList) {
    if (!Array.isArray(edgeList) || edgeList.length <= 1) return edgeList || [];
    return [...edgeList].sort((a, b) => {
      const aTgt = a.target || a.toId;
      const bTgt = b.target || b.toId;
      if (aTgt && bTgt && aTgt !== bTgt) {
        if (canReach(aTgt, bTgt)) return -1; // aTgt must come before bTgt
        if (canReach(bTgt, aTgt)) return 1;  // bTgt must come before aTgt
      }
      return 0;
    });
  }

  function isJoinGateway(nodeId) {
    const inEdges = incomingMap.get(nodeId) || [];
    const node = nodeMap.get(nodeId);
    if (!node) return false;
    const isGw = node.type?.includes('gateway');
    const lbl = (getStepLabel(node) || '').toLowerCase();
    const isMerge = node.gateway_role === 'merge' || node.data?.gateway_role === 'merge';
    return (isGw && inEdges.length >= 2) || isMerge || lbl.includes('rejoin');
  }

  function isJoinNode(nodeId) {
    const inEdges = incomingMap.get(nodeId) || [];
    const node = nodeMap.get(nodeId);
    if (!node) return false;
    const isGw = node.type?.includes('gateway');
    const lbl = (getStepLabel(node) || '').toLowerCase();
    return isGw || inEdges.length >= 2 || lbl.includes('rejoin');
  }

  function formatBranchCondition(gwNode, edge) {
    const rawLabel = getStepLabel(gwNode);
    const cleanGw = stripTrailingPunctuation(rawLabel);
    const edgeLabel = stripTrailingPunctuation(edge.label || edge.data?.label || edge.condition || '');

    if (cleanGw.toLowerCase().includes('rejoin')) {
      return null;
    }

    if (edgeLabel) {
      return cleanGw && cleanGw !== gwNode.id ? `${cleanGw}? ${edgeLabel}` : edgeLabel;
    }
    return cleanGw ? `${cleanGw}?` : null;
  }

  function cleanCondition(cond) {
    if (!cond) return null;
    if (cond.toLowerCase().includes('rejoin')) {
      return lang === 'ur-roman' ? 'Dono raaste yahan milte hain' : 'Both paths continue here';
    }
    // Clean any accidental double question marks
    return cond.replace(/\?+/g, '?');
  }

  function recordTask(node, condition) {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const isStructural = node.origin === 'structural' || node.data?.origin === 'structural' || node.data?.hidden;
    if (isStructural) return; // Structural tasks hidden from user-facing step list
    const actor = getActor(node);
    const isInferred = node.origin === 'inferred' || node.data?.origin === 'inferred';
    const isKept = node.kept === true || node.data?.kept === true;

    orderedSteps.push({
      id: node.id,
      label: getStepLabel(node),
      group: actor.group,
      role: actor.role,
      isInferred,
      isKept,
      branchCondition: cleanCondition(condition),
      rawNode: node,
    });
  }

  // Find the downstream join node (gateway or merge task) for a split gateway, if any
  function findMatchingJoinGateway(splitGwId) {
    const outEdges = outgoingMap.get(splitGwId) || [];
    if (outEdges.length < 2) return null;

    // Track reachability from each branch and shortest distance
    const branchReachSets = [];
    const minDistanceMap = new Map();

    outEdges.forEach((e) => {
      const reached = new Set();
      const queue = [{ id: e.target || e.toId, dist: 1 }];
      while (queue.length > 0) {
        const { id: curr, dist } = queue.shift();
        if (!curr || reached.has(curr)) continue;
        reached.add(curr);
        if (!minDistanceMap.has(curr) || dist < minDistanceMap.get(curr)) {
          minDistanceMap.set(curr, dist);
        }
        const nexts = outgoingMap.get(curr) || [];
        nexts.forEach((ne) => queue.push({ id: ne.target || ne.toId, dist: dist + 1 }));
      }
      branchReachSets.push(reached);
    });

    // Candidates reached by at least 2 branches (or all rejoining branches)
    const candidates = [];
    for (const [nodeId, node] of nodeMap.entries()) {
      if (nodeId === splitGwId) continue;
      const reachedCount = branchReachSets.filter((set) => set.has(nodeId)).length;
      if (reachedCount >= 2 && isJoinNode(nodeId)) {
        candidates.push({
          id: nodeId,
          isGw: isJoinGateway(nodeId),
          dist: minDistanceMap.get(nodeId) || 999,
          reachedCount,
        });
      }
    }

    if (candidates.length === 0) return null;

    // Prefer join gateways first, then smallest distance from split
    candidates.sort((a, b) => {
      if (a.isGw !== b.isGw) return a.isGw ? -1 : 1;
      return a.dist - b.dist;
    });

    return candidates[0].id;
  }

  function traverseBranch(startId, branchCond, stopJoinId) {
    let currId = startId;
    while (currId) {
      if (visited.has(currId)) break;
      if (stopJoinId && currId === stopJoinId) break;
      if (isJoinGateway(currId)) break;

      const node = nodeMap.get(currId);
      if (!node) break;

      const isTask = node.type === 'task' || node.type?.endsWith('-task');
      const isGateway = node.type?.includes('gateway');
      const isEnd = node.type === 'end-event' || node.type?.includes('end');

      if (isTask) {
        recordTask(node, branchCond);
      } else {
        visited.add(currId);
      }

      if (isEnd) break;

      const outEdges = sortEdgesByDependency(outgoingMap.get(currId) || []);
      if (isGateway && outEdges.length >= 2) {
        // Nested decision split
        handleDecision(currId);
        break;
      } else if (outEdges.length > 0) {
        currId = outEdges[0].target || outEdges[0].toId;
      } else {
        break;
      }
    }
  }

  function handleDecision(gwId) {
    const gwNode = nodeMap.get(gwId);
    if (!gwNode || visited.has(gwId)) return;
    visited.add(gwId);

    const rawOutEdges = outgoingMap.get(gwId) || [];
    if (rawOutEdges.length === 0) return;

    const outEdges = sortEdgesByDependency(rawOutEdges);
    const joinGwId = findMatchingJoinGateway(gwId);

    // Group all branch steps under their decision
    outEdges.forEach((outEdge) => {
      const tgtId = outEdge.target || outEdge.toId;
      const branchCond = formatBranchCondition(gwNode, outEdge);
      traverseBranch(tgtId, branchCond, joinGwId);
    });

    // After all branches have been traversed, continue from the join gateway or merge step
    if (joinGwId && !visited.has(joinGwId)) {
      const isGw = isJoinGateway(joinGwId);
      const mergeLabel = lang === 'ur-roman' ? 'Dono raaste yahan milte hain' : 'Both paths continue here';
      if (isGw) {
        visited.add(joinGwId);
        const postJoinEdges = sortEdgesByDependency(outgoingMap.get(joinGwId) || []);
        postJoinEdges.forEach((e) => {
          traverseFlow(e.target || e.toId, mergeLabel);
        });
      } else {
        // Merge node is a task step
        traverseFlow(joinGwId, mergeLabel);
      }
    }
  }

  function traverseFlow(nodeId, incomingBranch = null) {
    if (!nodeId || visited.has(nodeId)) return;
    const node = nodeMap.get(nodeId);
    if (!node) return;

    const isTask = node.type === 'task' || node.type?.endsWith('-task');
    const isGateway = node.type?.includes('gateway');
    const isJoin = isJoinGateway(nodeId);
    const outEdges = sortEdgesByDependency(outgoingMap.get(nodeId) || []);

    if (isGateway && outEdges.length >= 2 && !isJoin) {
      handleDecision(nodeId);
      return;
    }

    if (isJoin) {
      visited.add(nodeId);
      const mergeLabel = lang === 'ur-roman' ? 'Dono raaste yahan milte hain' : 'Both paths continue here';
      outEdges.forEach((e) => {
        traverseFlow(e.target || e.toId, mergeLabel);
      });
      return;
    }

    if (isTask) {
      recordTask(node, incomingBranch);
    } else {
      visited.add(nodeId);
    }

    outEdges.forEach((e) => {
      traverseFlow(e.target || e.toId, null);
    });
  }

  const startEvents = nodes.filter(
    (n) => n.type === 'start-event' || n.type === 'start' || n.type?.includes('start')
  );

  const roots = [];
  if (startEvents.length > 0) {
    roots.push(...startEvents.map((s) => s.id));
  } else {
    nodes.forEach((n) => {
      if (!incomingMap.has(n.id)) roots.push(n.id);
    });
    if (roots.length === 0 && nodes.length > 0) {
      roots.push(nodes[0].id);
    }
  }

  roots.sort((a, b) => {
    if (canReach(a, b)) return -1;
    if (canReach(b, a)) return 1;
    const aNode = nodeMap.get(a);
    const bNode = nodeMap.get(b);
    const aActor = aNode ? getActor(aNode) : null;
    const bActor = bNode ? getActor(bNode) : null;
    if (aActor?.group === 'Customer' && bActor?.group !== 'Customer') return -1;
    if (bActor?.group === 'Customer' && aActor?.group !== 'Customer') return 1;
    return 0;
  });

  roots.forEach((rId) => traverseFlow(rId));

  // Include any remaining tasks not reached via main flow
  nodes.forEach((n) => {
    if ((n.type === 'task' || n.type?.endsWith('-task')) && !visited.has(n.id)) {
      recordTask(n, null);
    }
  });

  return orderedSteps;
}
