// src/lib/aiDiagramLayout.js
//
// The Spot_AI backend (POST /api/ai/generate-process) returns a BPMN graph
// as { nodes, edges, resources } — pool/lane aware, but with NO x/y layout.
// The canvas (model.jsx) works with a flat `elements` array (each node has
// its own position) + a `connections` array. This file bridges the two:
// it auto-computes a left-to-right layered layout so a generated diagram
// drops onto the canvas already readable, with elements properly positioned
// inside their respective swimlanes.

const NODE_W = 80, NODE_H = 80;          // matches NW/NH in model.jsx
const X_SPACING = 250;                   // horizontal gap between rank columns (240px-260px)
const POOL_HDR = 30;                     // matches POOL_LANE_HDR in model.jsx
const LANE_HDR = 30;                     // matches LANE_HDR in model.jsx
const POOL_PAD_X = 50;
const POOL_MARGIN_Y = 80;                // gap between stacked pools
const CANVAS_X0 = 120, CANVAS_Y0 = 100;
const DEFAULT_LANE_H = 160;              // standard lane height (140px-160px) matching canvas

function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function getNodeDisplayLabel(n) {
  if (!n) return '';
  const isMergeGw =
    n.role === 'merge' ||
    n.data?.role === 'merge' ||
    n.gateway_role === 'merge' ||
    n.data?.gateway_role === 'merge' ||
    (/merge|join/i.test(n.id) && (n.type?.includes('gateway') || n.data?.gateway_type != null));
  if (isMergeGw) return '';
  const raw = n.data?.label !== undefined ? n.data.label : n.label;
  if (raw !== undefined && raw !== null && raw !== '') {
    if (/\b(?:auto[-_]gw|gw_|_\d+|\b1\d{9,}\b)/i.test(raw)) {
      return '';
    }
    return raw;
  }
  if (n.id && !/\b(?:auto[-_]gw|gw_|_\d+|\b1\d{9,}\b)/i.test(n.id)) {
    return n.id;
  }
  return '';
}

/** Cycle-aware topological layering (longest path).
 *  Starts DFS from start-events (indegree 0) so forward process edges are
 *  traversed first and rework loops (back-edges) are correctly identified.
 *  This prevents cycles from stalling ranking or stacking elements on top of each other. */
function computeRanks(nodeIds, seqEdges) {
  const rank = {};
  nodeIds.forEach(id => { rank[id] = 0; });

  // 1. Calculate incoming degree for each node in this group
  const indegMap = {};
  nodeIds.forEach(id => { indegMap[id] = 0; });
  seqEdges.forEach(e => {
    if (nodeIds.includes(e.source) && nodeIds.includes(e.target)) {
      indegMap[e.target] += 1;
    }
  });

  // Start DFS prioritization: indegree 0 nodes (start-events) first
  const rootNodes = nodeIds.filter(id => indegMap[id] === 0);
  const startList = [...rootNodes, ...nodeIds.filter(id => !rootNodes.includes(id))];

  // 2. Identify forward edges by excluding back-edges (cycles) via DFS
  const visited = new Set();
  const onStack = new Set();
  const forwardEdges = [];

  function dfs(u) {
    visited.add(u);
    onStack.add(u);
    const outgoing = seqEdges.filter(e => e.source === u);
    for (const e of outgoing) {
      if (!nodeIds.includes(e.target)) continue;
      if (onStack.has(e.target)) {
        // Back-edge (cycle / rework loop). Skip adding to forwardEdges.
        continue;
      }
      forwardEdges.push(e);
      if (!visited.has(e.target)) {
        dfs(e.target);
      }
    }
    onStack.delete(u);
  }

  startList.forEach(id => {
    if (!visited.has(id)) dfs(id);
  });

  // 3. Longest-path rank calculation on the DAG of forwardEdges
  const indeg = {};
  const adj = {};
  nodeIds.forEach(id => { indeg[id] = 0; adj[id] = []; });
  forwardEdges.forEach(e => {
    adj[e.source].push(e.target);
    indeg[e.target] += 1;
  });

  const queue = nodeIds.filter(id => indeg[id] === 0);
  const processed = new Set();
  while (queue.length) {
    const cur = queue.shift();
    processed.add(cur);
    for (const next of adj[cur] || []) {
      rank[next] = Math.max(rank[next] ?? 0, rank[cur] + 1);
      indeg[next] -= 1;
      if (indeg[next] <= 0) queue.push(next);
    }
  }

  // 4. Fallback for any unvisited disconnected nodes
  const maxR = Math.max(0, ...Object.values(rank));
  nodeIds.forEach(id => {
    if (!processed.has(id)) {
      rank[id] = maxR + 1;
    }
  });

  return rank;
}

/** Match node to lane index in lanesInGroup */
function findLaneIndex(node, lanesInGroup) {
  if (!node.lane) return -1;
  const target = String(node.lane).trim().toLowerCase();
  const idxById = lanesInGroup.findIndex(l => l.id === node.lane);
  if (idxById !== -1) return idxById;
  const idxByLabel = lanesInGroup.findIndex(l =>
    l.data?.label && String(l.data.label).trim().toLowerCase() === target
  );
  if (idxByLabel !== -1) return idxByLabel;
  const idxBySub = lanesInGroup.findIndex(l => {
    const lbl = String(l.data?.label || '').toLowerCase();
    return lbl && (lbl.includes(target) || target.includes(lbl));
  });
  if (idxBySub !== -1) return idxBySub;
  return -1;
}

/** Determines lane assignment for every node in a group */
function computeNodeLanes(groupModelNodes, groupSeqEdges, lanesInGroup) {
  const nodeLaneMap = {};
  if (!lanesInGroup.length) {
    groupModelNodes.forEach(n => { nodeLaneMap[n.id] = 0; });
    return nodeLaneMap;
  }

  groupModelNodes.forEach(n => {
    const lIdx = findLaneIndex(n, lanesInGroup);
    if (lIdx !== -1) nodeLaneMap[n.id] = lIdx;
  });

  // Propagate along sequence edges for unassigned nodes
  let changed = true;
  let passes = 0;
  while (changed && passes < 10) {
    changed = false;
    passes++;
    groupSeqEdges.forEach(e => {
      if (nodeLaneMap[e.source] != null && nodeLaneMap[e.target] == null) {
        nodeLaneMap[e.target] = nodeLaneMap[e.source];
        changed = true;
      } else if (nodeLaneMap[e.target] != null && nodeLaneMap[e.source] == null) {
        nodeLaneMap[e.source] = nodeLaneMap[e.target];
        changed = true;
      }
    });
  }

  // Default remaining unassigned nodes to lane 0
  groupModelNodes.forEach(n => {
    if (nodeLaneMap[n.id] == null) {
      nodeLaneMap[n.id] = 0;
    }
  });

  return nodeLaneMap;
}

/** Assigns sub-row (0, 1, 2...) for nodes within a single lane to handle intra-lane branching */
function computeSubRowsForLane(laneNodes, seqEdges, rank) {
  const subRow = {};
  if (!laneNodes.length) return { subRow, maxSubRow: 1 };

  const ids = laneNodes.map(n => n.id);
  const laneEdges = seqEdges.filter(e => ids.includes(e.source) && ids.includes(e.target));

  const byRank = {};
  ids.forEach(id => {
    const r = rank[id] ?? 0;
    (byRank[r] = byRank[r] || []).push(id);
  });

  const preds = {};
  ids.forEach(id => (preds[id] = []));
  laneEdges.forEach(e => { if (preds[e.target]) preds[e.target].push(e.source); });

  const ranksSorted = Object.keys(byRank).map(Number).sort((a, b) => a - b);
  for (const r of ranksSorted) {
    const rankIds = byRank[r];
    rankIds.sort((a, b) => {
      const pa = preds[a].map(p => subRow[p] ?? 0);
      const pb = preds[b].map(p => subRow[p] ?? 0);
      const ba = pa.length ? pa.reduce((s, v) => s + v, 0) / pa.length : 0;
      const bb = pb.length ? pb.reduce((s, v) => s + v, 0) / pb.length : 0;
      return ba - bb;
    });
    rankIds.forEach((id, i) => { subRow[id] = i; });
  }

  const maxSubRow = Math.max(1, ...ids.map(id => (subRow[id] ?? 0) + 1));
  return { subRow, maxSubRow };
}

/**
 * @param {object} aiDiagram - the { type:'diagram', nodes, edges, resources } payload
 * @returns {{ elements: object[], connections: object[], resources: object[] }}
 */
export function layoutAiDiagram(aiDiagram) {
  let nodes = [...(aiDiagram.nodes || [])];
  let edges = [...(aiDiagram.edges || [])];
  const resources = aiDiagram.resources || [];

  // Deduplicate redundant start events that share identical targets, while preserving distinct start events for independent flows
  const modelNodesAll = nodes.filter(n => n.type !== 'pool' && n.type !== 'lane');
  const allStarts = modelNodesAll.filter(n => n.type === 'start-event' || (typeof n.type === 'string' && n.type.endsWith('-start-event')));

  if (allStarts.length > 1) {
    const targetMap = new Map();
    allStarts.forEach(s => {
      const outs = edges.filter(e => e.source === s.id && e.flowType !== 'message').map(e => e.target).sort().join(',') || '__none__';
      if (!targetMap.has(outs)) targetMap.set(outs, []);
      targetMap.get(outs).push(s);
    });

    targetMap.forEach(dupes => {
      if (dupes.length > 1) {
        const primaryStart = dupes[0];
        const extraIds = new Set(dupes.slice(1).map(s => s.id));
        nodes = nodes.filter(n => !extraIds.has(n.id));
        edges = edges.map(e => {
          if (extraIds.has(e.source)) {
            const targetNode = nodes.find(n => n.id === e.target);
            const isCrossPool = targetNode && targetNode.pool && primaryStart.pool && targetNode.pool !== primaryStart.pool;
            return {
              ...e,
              source: primaryStart.id,
              flowType: isCrossPool ? 'message' : e.flowType
            };
          }
          return e;
        });
      }
    });

    const seen = new Set();
    edges = edges.filter(e => {
      const k = `${e.source}->${e.target}:${e.flowType || 'sequence'}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  const poolNodes = nodes.filter(n => n.type === 'pool');
  const laneNodes = nodes.filter(n => n.type === 'lane');
  const modelNodes = nodes.filter(n => n.type !== 'pool' && n.type !== 'lane');
  const seqEdges = edges.filter(e => e.flowType !== 'message');

  // Group model nodes by their pool id ('__default' = single implicit pool).
  const groups = {};
  modelNodes.forEach(n => {
    const key = n.pool || '__default';
    (groups[key] = groups[key] || []).push(n);
  });

  // Identify external / collapsed pools (pools with no internal model nodes or flagged isExternal)
  const externalPoolNodes = poolNodes.filter(p =>
    Boolean(p.data?.isExternal || p.isExternal || p.id.includes('ext') || !groups[p.id]?.length)
  );
  const internalGroupKeys = (poolNodes.length
    ? [...poolNodes.map(p => p.id), ...Object.keys(groups).filter(k => !poolNodes.find(p => p.id === k))]
    : Object.keys(groups)
  ).filter(k => !externalPoolNodes.some(ep => ep.id === k));

  // PASS 1: Calculate ranks, lane structures, and needed pool widths for each internal group
  const groupLayoutData = [];

  for (const groupKey of internalGroupKeys) {
    const groupModelNodes = groups[groupKey] || [];
    if (!groupModelNodes.length) continue;

    const ids = groupModelNodes.map(n => n.id);
    const groupSeqEdges = seqEdges.filter(e => ids.includes(e.source) && ids.includes(e.target));
    const rank = computeRanks(ids, groupSeqEdges);

    const isRealPool = poolNodes.some(p => p.id === groupKey);
    const poolNode = poolNodes.find(p => p.id === groupKey);

    const lanesInGroup = laneNodes.filter(l =>
      l.pool === groupKey || l.poolId === groupKey || groupModelNodes.some(n => n.lane === l.id || n.lane === l.label || n.data?.lane === l.id || n.data?.lane === l.label));

    // A pool outputs one lane per internal actor, stacked vertically with real bounds.
    // Explicit lanes exist if defined (not implicit, label differs from pool title).
    // Prune generic "lane_N" phantom lanes and keep only distinct actor lanes
    const explicitLanesInGroup = lanesInGroup.filter(l => {
      if (l.implicitLane || l.data?.implicitLane) return false;
      const label = String(l.label || l.data?.label || '').trim();
      if (poolNode && label.toLowerCase() === String(poolNode.label || poolNode.data?.label || '').trim().toLowerCase()) {
        return false;
      }
      if (/^lane[-_]?\d+$/i.test(label)) {
        return false;
      }
      return true;
    });

    // Deduplicate by actor/label
    const seenLanes = new Set();
    const uniqueExplicitLanes = [];
    explicitLanesInGroup.forEach(l => {
      const key = String(l.label || l.data?.label || l.id).trim().toLowerCase();
      if (!seenLanes.has(key)) {
        seenLanes.add(key);
        uniqueExplicitLanes.push(l);
      }
    });

    const hasExplicitLanes = uniqueExplicitLanes.length >= 1;

    const maxRank = Math.max(0, ...ids.map(id => rank[id] ?? 0));
    const originX = CANVAS_X0 + (isRealPool ? (hasExplicitLanes ? POOL_HDR + LANE_HDR : POOL_HDR) + POOL_PAD_X : 0);
    const contentW = (maxRank + 1) * X_SPACING + NODE_W;
    const neededPoolW = Math.max(750, originX + contentW + POOL_PAD_X - CANVAS_X0);

    groupLayoutData.push({
      groupKey,
      groupModelNodes,
      ids,
      groupSeqEdges,
      rank,
      isRealPool,
      poolNode,
      lanesInGroup,
      explicitLanesInGroup: uniqueExplicitLanes,
      hasExplicitLanes,
      originX,
      neededPoolW,
    });
  }

  // Module I2h Item 2: Align all pool widths to the widest pool across all real pools
  const realPoolWidths = groupLayoutData.filter(g => g.isRealPool).map(g => g.neededPoolW);
  const maxPoolW = realPoolWidths.length > 0 ? Math.max(750, ...realPoolWidths) : 750;

  // Partition external pools into upstream (placed at top) and downstream (placed at bottom)
  const topExternalPools = [];
  const bottomExternalPools = [];
  externalPoolNodes.forEach(p => {
    const outgoingMsg = edges.filter(e => e.source === p.id);
    const incomingMsg = edges.filter(e => e.target === p.id);
    if (outgoingMsg.length > 0 && incomingMsg.length === 0) {
      topExternalPools.push(p);
    } else if (incomingMsg.length > 0 && outgoingMsg.length === 0) {
      bottomExternalPools.push(p);
    } else if (outgoingMsg.length > 0) {
      topExternalPools.push(p);
    } else if (topExternalPools.length === 0) {
      topExternalPools.push(p);
    } else {
      bottomExternalPools.push(p);
    }
  });

  const EXT_POOL_H = 60;
  const EXT_POOL_GAP = 25;
  const EXT_POOL_MARGIN = 65; // vertical margin >= 60px

  // PASS 2: Place pools, lanes, and model nodes with aligned widths
  const elements = [];

  // 1. Emit top external pools
  let currentExtY = 20;
  topExternalPools.forEach(p => {
    const pLabel = p.data?.label || p.label || p.id;
    elements.push({
      id: p.id,
      type: 'pool',
      label: pLabel,
      position: { x: CANVAS_X0, y: currentExtY },
      width: maxPoolW,
      height: EXT_POOL_H,
      isExternal: true,
      hasExplicitLanes: false,
      implicitLane: true,
      data: {
        label: pLabel,
        isExternal: true,
        hasExplicitLanes: false,
        implicitLane: true,
      },
    });
    currentExtY += EXT_POOL_H + EXT_POOL_GAP;
  });

  const lastTopPoolBottom = topExternalPools.length > 0 ? (currentExtY - EXT_POOL_GAP) : 0;
  let poolY = topExternalPools.length > 0 ? (lastTopPoolBottom + EXT_POOL_MARGIN) : CANVAS_Y0;

  for (const g of groupLayoutData) {
    const {
      groupModelNodes,
      ids,
      groupSeqEdges,
      rank,
      isRealPool,
      poolNode,
      explicitLanesInGroup,
      hasExplicitLanes,
      originX,
    } = g;

    if (isRealPool && hasExplicitLanes) {
      // Pool with 2+ explicit sub-lanes
      const nodeLaneMap = computeNodeLanes(groupModelNodes, groupSeqEdges, explicitLanesInGroup);
      const laneHeights = [];
      const subRowMaps = [];

      explicitLanesInGroup.forEach((lane, m) => {
        const laneNodesList = groupModelNodes.filter(n => nodeLaneMap[n.id] === m);
        const { subRow, maxSubRow } = computeSubRowsForLane(laneNodesList, groupSeqEdges, rank);
        subRowMaps.push(subRow);
        laneHeights.push(Math.max(DEFAULT_LANE_H, maxSubRow * 140));
      });

      const laneTopY = [];
      let currentLaneY = poolY;
      laneHeights.forEach((h) => {
        laneTopY.push(currentLaneY);
        currentLaneY += h;
      });

      const poolH = currentLaneY - poolY;

      // 1. Pool element (aligned to maxPoolW)
      elements.push({
        id: poolNode.id,
        type: 'pool',
        label: poolNode.data?.label || poolNode.label || poolNode.id,
        position: { x: CANVAS_X0, y: poolY },
        width: maxPoolW,
        height: poolH,
        hasExplicitLanes: true,
        implicitLane: false,
        data: {
          label: poolNode.data?.label || poolNode.label || poolNode.id,
          hasExplicitLanes: true,
          implicitLane: false,
        },
      });

      // 2. Explicit lane elements (draw lane headers only when a pool has 2+ explicit lanes)
      explicitLanesInGroup.forEach((l, m) => {
        elements.push({
          id: l.id,
          type: 'lane',
          label: l.data?.label || l.label || l.id,
          position: { x: CANVAS_X0 + POOL_HDR + LANE_HDR, y: laneTopY[m] },
          width: maxPoolW - (POOL_HDR + LANE_HDR),
          height: laneHeights[m],
          poolId: poolNode.id,
          pool: poolNode.id,
          rowIndex: m,
          implicitLane: false,
          data: {
            label: l.data?.label || l.label || l.id,
            poolId: poolNode.id,
            pool: poolNode.id,
            implicitLane: false,
          },
        });
      });

      // 3. Place model nodes centered inside their respective lanes
      ids.forEach(id => {
        const n = groupModelNodes.find(x => x.id === id);
        const m = nodeLaneMap[id] ?? 0;
        const subRow = subRowMaps[m]?.[id] ?? 0;
        const totalSubRows = Math.round(laneHeights[m] / 140) || 1;
        const subH = laneHeights[m] / Math.max(1, totalSubRows);

        const x = originX + (rank[id] ?? 0) * X_SPACING;
        const y = laneTopY[m] + (subRow + 0.5) * subH - NODE_H / 2;

        const dispLabel = getNodeDisplayLabel(n);
        elements.push({
          id: n.id,
          type: n.type,
          label: dispLabel,
          position: { x, y },
          pool: poolNode.id,
          lane: n.lane,
          data: {
            label: dispLabel,
            duration: n.data?.duration ?? null,
            duration_min: n.data?.duration_min ?? null,
            duration_max: n.data?.duration_max ?? null,
            gateway_type: n.data?.gateway_type || null,
            resource: n.data?.resource || (n.data?.resources ? Object.keys(n.data.resources)[0] : null),
            resources: n.data?.resources || {},
            implicitLane: false,
          },
        });
      });

      poolY += poolH + POOL_MARGIN_Y;
    } else if (isRealPool) {
      // Module I2h Item 1: Pool with no real sub-lanes renders as ONE pool band with a single title.
      // Do NOT emit a separate lane element to elements.
      const preds = {};
      ids.forEach(id => (preds[id] = []));
      groupSeqEdges.forEach(e => { if (preds[e.target]) preds[e.target].push(e.source); });

      const row = {};
      const byRank = {};
      ids.forEach(id => {
        const r = rank[id] ?? 0;
        (byRank[r] = byRank[r] || []).push(id);
      });
      const ranksSorted = Object.keys(byRank).map(Number).sort((a, b) => a - b);
      for (const r of ranksSorted) {
        const rankIds = byRank[r];
        rankIds.sort((a, b) => {
          const pa = preds[a].map(p => row[p] ?? 0);
          const pb = preds[b].map(p => row[p] ?? 0);
          const ba = pa.length ? pa.reduce((s, v) => s + v, 0) / pa.length : 0;
          const bb = pb.length ? pb.reduce((s, v) => s + v, 0) / pb.length : 0;
          return ba - bb;
        });
        rankIds.forEach((id, i) => { row[id] = i; });
      }

      const maxRow = Math.max(0, ...ids.map(id => row[id] ?? 0));
      const rowH = 130;
      const poolH = Math.max(DEFAULT_LANE_H, (maxRow + 1) * rowH + 40);

      // Create pool element (aligned to maxPoolW)
      elements.push({
        id: poolNode.id,
        type: 'pool',
        label: poolNode.data?.label || poolNode.label || poolNode.id,
        position: { x: CANVAS_X0, y: poolY },
        width: maxPoolW,
        height: poolH,
        hasExplicitLanes: false,
        implicitLane: true,
        data: {
          label: poolNode.data?.label || poolNode.label || poolNode.id,
          hasExplicitLanes: false,
          implicitLane: true,
        },
      });

      ids.forEach(id => {
        const n = groupModelNodes.find(x => x.id === id);
        const x = originX + (rank[id] ?? 0) * X_SPACING;
        const y = poolY + 20 + (row[id] ?? 0) * rowH + (rowH - NODE_H) / 2;
        const dispLabel = getNodeDisplayLabel(n);
        elements.push({
          id: n.id,
          type: n.type,
          label: dispLabel,
          position: { x, y },
          pool: poolNode.id,
          lane: poolNode.label,
          data: {
            label: dispLabel,
            duration: n.data?.duration ?? null,
            duration_min: n.data?.duration_min ?? null,
            duration_max: n.data?.duration_max ?? null,
            gateway_type: n.data?.gateway_type || null,
            resource: n.data?.resource || (n.data?.resources ? Object.keys(n.data.resources)[0] : null),
            resources: n.data?.resources || {},
            implicitLane: true,
          },
        });
      });

      poolY += poolH + POOL_MARGIN_Y;
    } else {
      // Implicit pool (no pool container)
      const preds = {};
      ids.forEach(id => (preds[id] = []));
      groupSeqEdges.forEach(e => { if (preds[e.target]) preds[e.target].push(e.source); });

      const row = {};
      const byRank = {};
      ids.forEach(id => {
        const r = rank[id] ?? 0;
        (byRank[r] = byRank[r] || []).push(id);
      });
      const ranksSorted = Object.keys(byRank).map(Number).sort((a, b) => a - b);
      for (const r of ranksSorted) {
        const rankIds = byRank[r];
        rankIds.sort((a, b) => {
          const pa = preds[a].map(p => row[p] ?? 0);
          const pb = preds[b].map(p => row[p] ?? 0);
          const ba = pa.length ? pa.reduce((s, v) => s + v, 0) / pa.length : 0;
          const bb = pb.length ? pb.reduce((s, v) => s + v, 0) / pb.length : 0;
          return ba - bb;
        });
        rankIds.forEach((id, i) => { row[id] = i; });
      }

      const maxRow = Math.max(0, ...ids.map(id => row[id] ?? 0));
      const rowH = 130;
      const contentH = (maxRow + 1) * rowH;

      ids.forEach(id => {
        const n = groupModelNodes.find(x => x.id === id);
        const x = CANVAS_X0 + (rank[id] ?? 0) * X_SPACING;
        const y = poolY + (row[id] ?? 0) * rowH;
        const dispLabel = getNodeDisplayLabel(n);
        elements.push({
          id: n.id,
          type: n.type,
          label: dispLabel,
          position: { x, y },
          pool: n.pool,
          lane: n.lane,
          data: {
            label: dispLabel,
            pool: n.pool,
            lane: n.lane,
            duration: n.data?.duration ?? null,
            duration_min: n.data?.duration_min ?? null,
            duration_max: n.data?.duration_max ?? null,
            gateway_type: n.data?.gateway_type || null,
            resource: n.data?.resource || (n.data?.resources ? Object.keys(n.data.resources)[0] : null),
            resources: n.data?.resources || {},
          },
        });
      });

      poolY += contentH + POOL_MARGIN_Y;
    }
  }

  // 2. Emit bottom external pools
  let currentBottomExtY = poolY;
  bottomExternalPools.forEach(p => {
    const pLabel = p.data?.label || p.label || p.id;
    elements.push({
      id: p.id,
      type: 'pool',
      label: pLabel,
      position: { x: CANVAS_X0, y: currentBottomExtY },
      width: maxPoolW,
      height: EXT_POOL_H,
      isExternal: true,
      hasExplicitLanes: false,
      implicitLane: true,
      data: {
        label: pLabel,
        isExternal: true,
        hasExplicitLanes: false,
        implicitLane: true,
      },
    });
    currentBottomExtY += EXT_POOL_H + EXT_POOL_GAP;
  });

  const nodePoolMap = {};
  nodes.forEach(n => {
    if (n.type === 'pool') {
      nodePoolMap[n.id] = n.id;
    } else if (n.type !== 'lane') {
      nodePoolMap[n.id] = n.pool || '__default';
    }
  });

  const connections = edges.map(e => {
    const sp = nodePoolMap[e.source];
    const tp = nodePoolMap[e.target];
    const isCrossPool = sp && tp && sp !== '__default' && tp !== '__default' && sp !== tp;
    const isMessage = e.flowType === 'message' || e.type === 'message-flow' || isCrossPool;

    const edgeLabel = e.data?.label || e.label || undefined;
    const srcId = e.source || e.fromId;
    const tgtId = e.target || e.toId;
    return {
      id: e.id || makeId('conn'),
      source: srcId,
      target: tgtId,
      fromId: srcId,
      toId: tgtId,
      type: isMessage ? 'message-flow' : 'sequence-flow',
      label: edgeLabel,
      probability: e.data?.probability ?? undefined,
      data: {
        ...(e.data || {}),
        label: edgeLabel,
      },
    };
  });

  return { elements, connections, resources };
}