/**
 * Pure helper for extracting ordered steps from a raw BPMN diagram,
 * identifying actors (Customer / Store), sequential order, and branches.
 * Used by ProcessStepList and tests.
 */
export function extractOrderedSteps(rawDiagram) {
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

  const startEvents = nodes.filter(
    (n) => n.type === 'start-event' || n.type === 'start' || n.type?.includes('start')
  );

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

  function traverse(nodeId, incomingBranch = null) {
    if (!nodeId || visited.has(nodeId)) return;
    const node = nodeMap.get(nodeId);
    if (!node) return;

    visited.add(nodeId);

    const isTask = node.type === 'task' || node.type?.endsWith('-task');
    const isGateway = node.type?.includes('gateway');

    if (isTask) {
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
        branchCondition: incomingBranch,
        rawNode: node,
      });
    }

    const outgoing = outgoingMap.get(nodeId) || [];

    if (isGateway) {
      const gatewayQuestion = getStepLabel(node);
      outgoing.forEach((outEdge) => {
        const tgtId = outEdge.target || outEdge.toId;
        const edgeLabel = outEdge.label || outEdge.data?.label || outEdge.condition || '';
        const branchDesc = edgeLabel
          ? gatewayQuestion && gatewayQuestion !== node.id
            ? `${gatewayQuestion}? ${edgeLabel}`
            : edgeLabel
          : gatewayQuestion || 'Condition';
        traverse(tgtId, branchDesc);
      });
    } else {
      outgoing.forEach((outEdge) => {
        const tgtId = outEdge.target || outEdge.toId;
        const edgeLabel = outEdge.label || outEdge.data?.label || '';
        traverse(tgtId, edgeLabel || null);
      });
    }
  }

  const roots = [];
  if (startEvents.length > 0) {
    roots.push(...startEvents.map((s) => s.id));
  } else {
    // If no explicit start event, any node with 0 incoming edges is a root
    nodes.forEach((n) => {
      if (!incomingMap.has(n.id)) roots.push(n.id);
    });
    if (roots.length === 0 && nodes.length > 0) {
      roots.push(nodes[0].id);
    }
  }

  roots.forEach((rId) => traverse(rId));

  // Include any remaining tasks not reached via linear walk
  nodes.forEach((n) => {
    if ((n.type === 'task' || n.type?.endsWith('-task')) && !visited.has(n.id)) {
      const actor = getActor(n);
      const isInferred = n.origin === 'inferred' || n.data?.origin === 'inferred';
      const isKept = n.kept === true || n.data?.kept === true;
      let branchCond = null;
      const inEdges = incomingMap.get(n.id) || [];
      if (inEdges.length > 0) {
        const inEdge = inEdges[0];
        const srcNode = nodeMap.get(inEdge.source || inEdge.fromId);
        if (srcNode && srcNode.type?.includes('gateway')) {
          const gwQuestion = getStepLabel(srcNode);
          const edgeLabel = inEdge.label || inEdge.data?.label || inEdge.condition || '';
          branchCond = edgeLabel
            ? gwQuestion && gwQuestion !== srcNode.id
              ? `${gwQuestion}? ${edgeLabel}`
              : edgeLabel
            : gwQuestion || 'Condition';
        }
      }
      orderedSteps.push({
        id: n.id,
        label: getStepLabel(n),
        group: actor.group,
        role: actor.role,
        isInferred,
        isKept,
        branchCondition: branchCond,
        rawNode: n,
      });
      visited.add(n.id);
    }
  });

  return orderedSteps;
}
