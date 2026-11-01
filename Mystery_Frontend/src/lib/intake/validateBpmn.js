/**
 * lib/intake/validateBpmn.js
 *
 * Pure BPMN validation and targeted auto-repair for raw SPOT diagrams.
 *
 * Rules:
 *  1. >=1 start event (no incoming sequence flows) and >=1 end event (no outgoing sequence flows).
 *  2. Every node reachable from a start and able to reach an end.
 *  3. No dangling edges or duplicate ids.
 *  4. Tasks and events have exactly 1 incoming and 1 outgoing sequence flow.
 *  5. Exclusive splits have >=2 outgoing flows with probabilities summing to 1.0 (tolerance 0.001).
 *  6. Every parallel split has a matching parallel join.
 *  7. Sequence flows never cross pools; message flows only between different pools.
 *  8. Every task has a lane.
 *  9. Labels non-empty.
 * 10. duration_min <= duration <= duration_max.
 *
 * Auto-repair:
 *  - ONLY missing end events and missing parallel join gateways, using zero-time nodes.
 *  - Each repair is recorded in repairs[].
 *  - Everything else goes into errors[].
 *
 * @param {object} rawDiagram - raw diagram { nodes, edges, resources }
 * @returns {{ errors: string[], repairs: Array<{ rule: string, description: string, nodeId?: string }>, repaired: object }}
 */

function isStartEvent(type) {
  return type === 'start-event' || (typeof type === 'string' && type.endsWith('-start-event'));
}

function isMessageStartEvent(type) {
  return type === 'message-start-event';
}

function isEndEvent(type) {
  return type === 'end-event' || (typeof type === 'string' && type.endsWith('-end-event'));
}

function isMessageEndEvent(type) {
  return type === 'message-end-event';
}

function isIntermediateEvent(type) {
  return (
    type === 'intermediate-event' ||
    (typeof type === 'string' && (type.includes('intermediate') || type.endsWith('-intermediate-catch') || type.endsWith('-intermediate-throw')))
  );
}

function isMessageIntermediateCatchEvent(type) {
  return type === 'message-intermediate-catch';
}

function isMessageIntermediateThrowEvent(type) {
  return type === 'message-intermediate-throw';
}

export function isMessageFlow(edge) {
  if (!edge || typeof edge !== 'object') return false;
  return (
    edge.flowType === 'message' ||
    edge.type === 'message-flow' ||
    edge.type === 'message' ||
    edge.data?.type === 'message-flow' ||
    edge.data?.flowType === 'message'
  );
}

function isTask(type) {
  return type === 'task' || (typeof type === 'string' && type.endsWith('-task'));
}

function isContainer(type) {
  return type === 'pool' || type === 'lane';
}

function isExclusiveGateway(node) {
  return (
    node.type === 'exclusive-gateway' ||
    (node.type === 'gateway' && node.data?.gateway_type === 'exclusive')
  );
}

function isParallelGateway(node) {
  return (
    node.type === 'parallel-gateway' ||
    (node.type === 'gateway' && node.data?.gateway_type === 'parallel')
  );
}

function isGateway(node) {
  if (!node) return false;
  const t = node.type || '';
  return (
    t.includes('gateway') ||
    isExclusiveGateway(node) ||
    isParallelGateway(node) ||
    node.data?.gateway_type != null
  );
}

function normalizeString(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTokens(str) {
  return new Set(normalizeString(str).split(' ').filter(Boolean));
}

function getBigrams(str) {
  const norm = normalizeString(str).replace(/\s/g, '');
  const bigrams = new Set();
  for (let i = 0; i < norm.length - 1; i++) {
    bigrams.add(norm.slice(i, i + 2));
  }
  return bigrams;
}

export function computeSimilarity(s1, s2) {
  const norm1 = normalizeString(s1);
  const norm2 = normalizeString(s2);
  if (!norm1 || !norm2) return 0;
  if (norm1 === norm2) return 1.0;

  // Token Jaccard
  const t1 = getTokens(norm1);
  const t2 = getTokens(norm2);
  let tokenIntersection = 0;
  t1.forEach((t) => {
    if (t2.has(t)) tokenIntersection++;
  });
  const tokenUnion = new Set([...t1, ...t2]).size;
  const jaccard = tokenUnion > 0 ? tokenIntersection / tokenUnion : 0;

  // Character bigram Dice coefficient
  const b1 = getBigrams(norm1);
  const b2 = getBigrams(norm2);
  let bigramIntersection = 0;
  b1.forEach((b) => {
    if (b2.has(b)) bigramIntersection++;
  });
  const dice = (b1.size + b2.size) > 0 ? (2 * bigramIntersection) / (b1.size + b2.size) : 0;

  // Substring overlap
  let subScore = 0;
  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    const minLen = Math.min(norm1.length, norm2.length);
    const maxLen = Math.max(norm1.length, norm2.length);
    subScore = minLen / maxLen;
  }

  return Math.max(jaccard, dice, subScore);
}

export function validateBpmn(rawDiagram, options = {}) {
  const errors = [];
  const repairs = [];
  const unresolvedGateways = [];
  const duplicateWarnings = [];

  // 1. Pure: Deep copy input
  const repaired = JSON.parse(JSON.stringify(rawDiagram || { nodes: [], edges: [], resources: [] }));
  repaired.nodes = Array.isArray(repaired.nodes) ? repaired.nodes : [];
  repaired.edges = Array.isArray(repaired.edges) ? repaired.edges : [];
  repaired.resources = Array.isArray(repaired.resources) ? repaired.resources : [];

  if ((!repaired.edges || repaired.edges.length === 0) && Array.isArray(repaired.connections)) {
    repaired.edges = repaired.connections.map(c => {
      const isMsg = isMessageFlow(c);
      return {
        id: c.id,
        source: c.source || c.fromId || c.from,
        target: c.target || c.toId || c.to,
        flowType: isMsg ? 'message' : (c.flowType || 'sequence'),
        type: isMsg ? 'message-flow' : (c.type || 'sequence-flow'),
        data: c.data || {}
      };
    });
  } else if (Array.isArray(repaired.edges)) {
    repaired.edges.forEach(e => {
      if (!e.source && (e.fromId || e.from)) e.source = e.fromId || e.from;
      if (!e.target && (e.toId || e.to)) e.target = e.toId || e.to;
      const isMsg = isMessageFlow(e);
      if (!e.flowType) e.flowType = isMsg ? 'message' : 'sequence';
      if (!e.type) e.type = isMsg ? 'message-flow' : 'sequence-flow';
    });
  }

  // 2. Duplicate IDs and Dangling Edges Check
  const nodeIds = new Set();
  const duplicateNodeIds = new Set();
  repaired.nodes.forEach((n) => {
    if (!n.id || nodeIds.has(n.id)) {
      duplicateNodeIds.add(n.id);
    }
    nodeIds.add(n.id);
  });
  if (duplicateNodeIds.size > 0) {
    errors.push(`Duplicate node IDs found: ${Array.from(duplicateNodeIds).join(', ')}.`);
  }

  const edgeIds = new Set();
  const duplicateEdgeIds = new Set();
  repaired.edges.forEach((e) => {
    if (e.id && edgeIds.has(e.id)) {
      duplicateEdgeIds.add(e.id);
    }
    if (e.id) edgeIds.add(e.id);
  });
  if (duplicateEdgeIds.size > 0) {
    errors.push(`Duplicate edge IDs found: ${Array.from(duplicateEdgeIds).join(', ')}.`);
  }

  repaired.edges.forEach((e) => {
    if (!nodeIds.has(e.source)) {
      errors.push(`Dangling edge "${e.id || `${e.source}->${e.target}`}" references non-existent source node "${e.source}".`);
    }
    if (!nodeIds.has(e.target)) {
      errors.push(`Dangling edge "${e.id || `${e.source}->${e.target}`}" references non-existent target node "${e.target}".`);
    }
  });

  // Early return if graph node references are fundamentally corrupt
  if (errors.length > 0) {
    return { errors, repairs, repaired };
  }

  const modelNodes = repaired.nodes.filter((n) => !isContainer(n.type));

  // 3. Labels Non-empty Check (Rule 9)
  repaired.nodes.forEach((n) => {
    const lbl = n.data?.label !== undefined ? n.data.label : n.label;
    if (lbl == null || String(lbl).trim() === '') {
      errors.push(`Node "${n.id}" (${n.type}) has an empty label.`);
    }
  });

  // 4. Tasks have a lane Check (Rule 8)
  modelNodes.forEach((n) => {
    if (isTask(n.type)) {
      const lane = n.lane || n.data?.lane;
      if (!lane || String(lane).trim() === '') {
        errors.push(`Task "${n.data?.label || n.id}" must be assigned to a swimlane.`);
      }
    }
  });

  // 5. Sequence Flows never cross pools, Message Flows only between different pools (Rule 7)
  const nodePoolMap = {};
  repaired.nodes.forEach((n) => {
    nodePoolMap[n.id] = n.pool || n.data?.pool || null;
  });

  // Auto-repair same-pool message events and message flows (Rule 3.ii)
  repaired.edges.forEach((e) => {
    const isMsg = isMessageFlow(e);
    const sp = nodePoolMap[e.source];
    const tp = nodePoolMap[e.target];

    const srcNode = repaired.nodes.find((n) => n.id === e.source);
    const tgtNode = repaired.nodes.find((n) => n.id === e.target);
    const isSrcMsgEvent =
      srcNode &&
      (isMessageStartEvent(srcNode.type) ||
        isMessageEndEvent(srcNode.type) ||
        isMessageIntermediateCatchEvent(srcNode.type) ||
        isMessageIntermediateThrowEvent(srcNode.type) ||
        srcNode.type === 'message-event' ||
        (typeof srcNode.type === 'string' && srcNode.type.includes('message')));
    const isTgtMsgEvent =
      tgtNode &&
      (isMessageStartEvent(tgtNode.type) ||
        isMessageEndEvent(tgtNode.type) ||
        isMessageIntermediateCatchEvent(tgtNode.type) ||
        isMessageIntermediateThrowEvent(tgtNode.type) ||
        tgtNode.type === 'message-event' ||
        (typeof tgtNode.type === 'string' && tgtNode.type.includes('message')));

    if (isMsg && sp && tp && sp === tp && (isSrcMsgEvent || isTgtMsgEvent)) {
      // Message flow connected to message event inside one pool! Convert edge to sequence flow
      e.flowType = 'sequence';
      e.type = 'sequence-flow';
      if (e.data) {
        e.data.flowType = 'sequence';
        e.data.type = 'sequence-flow';
      }

      // Convert any endpoint that is a message event to a task
      [srcNode, tgtNode].forEach((node) => {
        if (
          node &&
          (isMessageStartEvent(node.type) ||
            isMessageEndEvent(node.type) ||
            isMessageIntermediateCatchEvent(node.type) ||
            isMessageIntermediateThrowEvent(node.type) ||
            node.type === 'message-event' ||
            (typeof node.type === 'string' && node.type.includes('message')))
        ) {
          node.type = 'task';
          if (node.data) node.data.type = 'task';
          const nodeLabel = node.data?.label || node.label || node.id;
          repairs.push({
            rule: 'same-pool-message',
            description: `Converted same-pool message event "${nodeLabel}" to task. What role performs "${nodeLabel}"?`,
            nodeId: node.id,
            question: `What role performs "${nodeLabel}"?`,
          });
        }
      });
    }
  });

  // Also convert any intermediate message events inside a pool that have no cross-pool message flows
  modelNodes.forEach((n) => {
    if (isMessageIntermediateCatchEvent(n.type) || isMessageIntermediateThrowEvent(n.type)) {
      const incidentEdges = repaired.edges.filter((e) => e.source === n.id || e.target === n.id);
      const hasCrossPoolMessage = incidentEdges.some((e) => {
        if (!isMessageFlow(e)) return false;
        const otherId = e.source === n.id ? e.target : e.source;
        return nodePoolMap[n.id] && nodePoolMap[otherId] && nodePoolMap[n.id] !== nodePoolMap[otherId];
      });
      if (!hasCrossPoolMessage) {
        n.type = 'task';
        if (n.data) n.data.type = 'task';
        const nodeLabel = n.data?.label || n.label || n.id;
        repairs.push({
          rule: 'same-pool-message',
          description: `Converted same-pool message event "${nodeLabel}" to task. What role performs "${nodeLabel}"?`,
          nodeId: n.id,
          question: `What role performs "${nodeLabel}"?`,
        });
      }
    }
  });

  repaired.edges.forEach((e) => {
    const isMessage = isMessageFlow(e);
    const sp = nodePoolMap[e.source];
    const tp = nodePoolMap[e.target];

    if (isMessage) {
      if (!sp || !tp || sp === tp) {
        errors.push(`Message flow "${e.id || `${e.source}->${e.target}`}" must only connect nodes across different pools.`);
      }
    } else {
      if (sp && tp && sp !== tp) {
        errors.push(`Sequence flow "${e.id || `${e.source}->${e.target}`}" crosses pools ("${sp}" -> "${tp}"). Sequence flows cannot cross pools.`);
      }
    }
  });

  // 6. Durations: duration_min <= duration <= duration_max (Rule 10)
  modelNodes.forEach((n) => {
    const d = n.data?.duration;
    const dMin = n.data?.duration_min;
    const dMax = n.data?.duration_max;

    if (dMin != null && dMax != null) {
      if (Number(dMin) > Number(dMax)) {
        errors.push(`Step "${n.data?.label || n.id}" duration_min (${dMin}) cannot be greater than duration_max (${dMax}).`);
      }
      if (d != null) {
        if (Number(d) < Number(dMin) || Number(d) > Number(dMax)) {
          errors.push(`Step "${n.data?.label || n.id}" duration (${d}) must be between duration_min (${dMin}) and duration_max (${dMax}).`);
        }
      }
    }
  });

  // 7. Auto-repair missing end events (Rule 1 part)
  const startNodes = modelNodes.filter((n) => isStartEvent(n.type));
  let endNodes = modelNodes.filter((n) => isEndEvent(n.type));

  if (startNodes.length === 0) {
    errors.push('Diagram must have at least one start event.');
  }

  // Check start nodes have 0 incoming sequence flows and message start events have >= 1 incoming message flow
  const seqEdges = repaired.edges.filter((e) => !isMessageFlow(e));
  const msgEdges = repaired.edges.filter((e) => isMessageFlow(e));
  startNodes.forEach((s) => {
    const incomingSeq = seqEdges.filter((e) => e.target === s.id);
    if (incomingSeq.length > 0) {
      errors.push(`Start event "${s.id}" cannot have incoming sequence flows (found ${incomingSeq.length}).`);
    }
    if (isMessageStartEvent(s.type)) {
      const incomingMsg = msgEdges.filter((e) => e.target === s.id);
      if (incomingMsg.length === 0) {
        errors.push(`Message start event "${s.data?.label || s.id}" must have at least 1 incoming message flow (found 0).`);
      }
    }
  });

  // Check / Repair end events
  if (endNodes.length === 0) {
    // Auto-repair missing end event
    const outgoingMap = new Set(seqEdges.map((e) => e.source));
    const terminalNodes = modelNodes.filter((n) => !outgoingMap.has(n.id) && !isEndEvent(n.type));

    const endId = `end_auto_repair_${Date.now()}`;
    const targetPool = terminalNodes[0]?.pool || null;
    const targetLane = terminalNodes[0]?.lane || null;

    const repairedEndNode = {
      id: endId,
      type: 'end-event',
      label: 'Process Ended',
      pool: targetPool,
      lane: targetLane,
      origin: 'inferred',
      data: {
        label: 'Process Ended',
        duration: 0,
        origin: 'inferred',
      },
    };

    repaired.nodes.push(repairedEndNode);
    modelNodes.push(repairedEndNode);
    endNodes.push(repairedEndNode);

    if (terminalNodes.length > 0) {
      terminalNodes.forEach((tn, i) => {
        const edgeId = `edge_repaired_end_${tn.id}_${i}`;
        const newEdge = {
          id: edgeId,
          source: tn.id,
          target: endId,
          flowType: 'sequence',
          data: {},
        };
        repaired.edges.push(newEdge);
        seqEdges.push(newEdge);
      });
    }

    repairs.push({
      rule: 'missing-end-event',
      description: `Auto-repaired missing end event: added zero-time "${repairedEndNode.label}" (${endId}) connected from terminal step(s).`,
      nodeId: endId,
    });
  }

  // Check end nodes have 0 outgoing sequence flows and message end events have >= 1 outgoing message flow
  endNodes.forEach((en) => {
    const outgoingSeq = seqEdges.filter((e) => e.source === en.id);
    if (outgoingSeq.length > 0) {
      errors.push(`End event "${en.id}" cannot have outgoing sequence flows (found ${outgoingSeq.length}).`);
    }
    if (isMessageEndEvent(en.type)) {
      const outgoingMsg = msgEdges.filter((e) => e.source === en.id);
      if (outgoingMsg.length === 0) {
        errors.push(`Message end event "${en.data?.label || en.id}" must have at least 1 outgoing message flow (found 0).`);
      }
    }
  });

  // 8. Auto-repair redundant gateways (Rule: gateways with exactly 1 in and 1 out sequence flow)
  let redundantFound = true;
  while (redundantFound) {
    redundantFound = false;
    const currentSeq = repaired.edges.filter((e) => !isMessageFlow(e));
    const gateways = repaired.nodes.filter(isGateway);

    for (const g of gateways) {
      const inSeq = currentSeq.filter((e) => e.target === g.id);
      const outSeq = currentSeq.filter((e) => e.source === g.id);

      if (inSeq.length === 1 && outSeq.length === 1) {
        const inEdge = inSeq[0];
        const outEdge = outSeq[0];

        // Connect incoming flow to outgoing target
        inEdge.target = outEdge.target;
        // Drop outgoing edge label, set probability to 1
        if (inEdge.data) {
          delete inEdge.data.label;
          inEdge.data.probability = 1;
        } else {
          inEdge.data = { probability: 1 };
        }
        delete inEdge.label;
        delete inEdge.probability;

        // Remove outEdge
        repaired.edges = repaired.edges.filter((e) => e.id !== outEdge.id);

        // Mark node origin as structural before removal and record repair
        g.origin = 'structural';
        if (g.data) g.data.origin = 'structural';

        // Remove gateway node from diagram
        repaired.nodes = repaired.nodes.filter((n) => n.id !== g.id);
        const mIdx = modelNodes.findIndex((n) => n.id === g.id);
        if (mIdx !== -1) modelNodes.splice(mIdx, 1);

        repairs.push({
          rule: 'redundant-gateway',
          description: 'Removed an unnecessary decision point',
          nodeId: g.id,
        });

        redundantFound = true;
        break;
      }
    }
  }

  // Auto-repair: Remove placeholder task on empty branch between split and join (Rule 3.i)
  let placeholderRemoved = true;
  while (placeholderRemoved) {
    placeholderRemoved = false;
    const currentSeq = repaired.edges.filter((e) => !isMessageFlow(e));
    for (const t of repaired.nodes) {
      if (!isTask(t.type)) continue;
      const duration = Number(t.data?.duration != null ? t.data.duration : (t.duration != null ? t.duration : 0));
      const resObj = t.data?.resources || t.resources || {};
      const hasResources = Object.keys(resObj).length > 0 || Boolean(t.data?.resource || t.resource);
      const origin = t.origin || t.data?.origin;
      const isInferredOrStructural = origin === 'inferred' || origin === 'structural';

      if (duration === 0 && !hasResources && isInferredOrStructural) {
        const inEdges = currentSeq.filter((e) => e.target === t.id);
        const outEdges = currentSeq.filter((e) => e.source === t.id);
        if (inEdges.length === 1 && outEdges.length === 1) {
          const inEdge = inEdges[0];
          const outEdge = outEdges[0];
          const srcNode = repaired.nodes.find((n) => n.id === inEdge.source);
          const tgtNode = repaired.nodes.find((n) => n.id === outEdge.target);

          const isSrcSplit = srcNode && isGateway(srcNode) && currentSeq.filter((e) => e.source === srcNode.id).length >= 2;
          const isTgtJoin = tgtNode && isGateway(tgtNode) && currentSeq.filter((e) => e.target === tgtNode.id).length >= 2;

          if (isSrcSplit && isTgtJoin) {
            // Rewire inEdge directly to tgtNode
            inEdge.target = tgtNode.id;
            // Remove outEdge
            repaired.edges = repaired.edges.filter((e) => e.id !== outEdge.id);
            // Remove task node
            repaired.nodes = repaired.nodes.filter((n) => n.id !== t.id);
            const mIdx = modelNodes.findIndex((n) => n.id === t.id);
            if (mIdx !== -1) modelNodes.splice(mIdx, 1);

            repairs.push({
              rule: 'remove-placeholder-step',
              description: 'Remove this step?',
              nodeId: t.id,
              action: 'Replaced placeholder task with direct sequence flow from split to join',
            });

            placeholderRemoved = true;
            break;
          }
        }
      }
    }
  }

  // Drop label on join gateway outgoing sequence flow (Rule 3.iv)
  const currentSeqForJoins = repaired.edges.filter((e) => !isMessageFlow(e));
  repaired.nodes.forEach((n) => {
    if (isGateway(n)) {
      const inSeq = currentSeqForJoins.filter((e) => e.target === n.id);
      if (inSeq.length >= 2) {
        // Join gateway! Check outgoing sequence flows
        const outSeq = currentSeqForJoins.filter((e) => e.source === n.id);
        outSeq.forEach((outEdge) => {
          const label = outEdge.label || outEdge.data?.label;
          if (label && String(label).trim() !== '') {
            delete outEdge.label;
            if (outEdge.data) {
              delete outEdge.data.label;
            }
            repairs.push({
              rule: 'join-outgoing-label-dropped',
              description: `Dropped label "${label}" from outgoing flow of join gateway "${n.id}".`,
              edgeId: outEdge.id,
            });
          }
        });
      }
    }
  });

  // Refresh seqEdges after removals
  seqEdges.length = 0;
  seqEdges.push(...repaired.edges.filter((e) => !isMessageFlow(e)));

  // 9. Auto-repair missing parallel join gateways (Rule 6)
  const parallelSplits = modelNodes.filter((n) => {
    if (!isParallelGateway(n)) return false;
    const outBranches = seqEdges.filter((e) => e.source === n.id);
    return outBranches.length >= 2;
  });

  parallelSplits.forEach((splitNode) => {
    const splitOutEdges = seqEdges.filter((e) => e.source === splitNode.id);
    const branchTargets = splitOutEdges.map((e) => e.target);

    // Find any parallel join reachable from this split
    const parallelJoins = modelNodes.filter((n) => {
      if (!isParallelGateway(n)) return false;
      const inBranches = seqEdges.filter((e) => e.target === n.id);
      return inBranches.length >= 2;
    });

    let hasMatchingJoin = false;
    for (const joinNode of parallelJoins) {
      // Check if all branches from splitNode can reach joinNode
      const reachesJoin = branchTargets.every((startBranch) => {
        const visited = new Set();
        const queue = [startBranch];
        while (queue.length > 0) {
          const curr = queue.shift();
          if (curr === joinNode.id) return true;
          visited.add(curr);
          seqEdges.filter((e) => e.source === curr).forEach((e) => {
            if (!visited.has(e.target)) queue.push(e.target);
          });
        }
        return false;
      });
      if (reachesJoin) {
        hasMatchingJoin = true;
        break;
      }
    }

    if (!hasMatchingJoin) {
      // Auto-repair: Insert a zero-time parallel join gateway
      const joinId = `gw_join_auto_${splitNode.id}_${Date.now()}`;
      const joinPool = splitNode.pool || null;
      const joinLane = splitNode.lane || null;

      const repairedJoin = {
        id: joinId,
        type: 'parallel-gateway',
        label: 'Parallel Join',
        pool: joinPool,
        lane: joinLane,
        origin: 'inferred',
        data: {
          label: 'Parallel Join',
          gateway_type: 'parallel',
          duration: 0,
          origin: 'inferred',
        },
      };

      repaired.nodes.push(repairedJoin);
      modelNodes.push(repairedJoin);

      // Connect branch terminal nodes to this join gateway
      const branchTerminalNodes = [];
      branchTargets.forEach((targetId) => {
        let curr = targetId;
        const visited = new Set();
        while (curr) {
          visited.add(curr);
          const out = seqEdges.filter((e) => e.source === curr);
          if (out.length === 0 || isEndEvent(modelNodes.find((m) => m.id === curr)?.type)) {
            branchTerminalNodes.push(curr);
            break;
          }
          if (out.some((e) => isEndEvent(modelNodes.find((m) => m.id === e.target)?.type))) {
            branchTerminalNodes.push(curr);
            break;
          }
          curr = out[0].target;
          if (visited.has(curr)) break;
        }
      });

      branchTerminalNodes.forEach((btn, idx) => {
        // Redirect or add edge to joinId
        const existingToTarget = seqEdges.find((e) => e.source === btn);
        if (existingToTarget && isEndEvent(modelNodes.find((m) => m.id === existingToTarget.target)?.type)) {
          existingToTarget.target = joinId;
        } else {
          const edgeId = `edge_join_in_${btn}_${idx}`;
          const newEdge = {
            id: edgeId,
            source: btn,
            target: joinId,
            flowType: 'sequence',
            data: {},
          };
          repaired.edges.push(newEdge);
          seqEdges.push(newEdge);
        }
      });

      // Connect join to the nearest end event
      const primaryEnd = endNodes[0];
      if (primaryEnd) {
        const joinOutEdge = {
          id: `edge_join_out_${joinId}`,
          source: joinId,
          target: primaryEnd.id,
          flowType: 'sequence',
          data: {},
        };
        repaired.edges.push(joinOutEdge);
        seqEdges.push(joinOutEdge);
      }

      repairs.push({
        rule: 'missing-join-gateway',
        description: `Auto-repaired missing parallel join: inserted zero-time parallel join gateway "${repairedJoin.label}" (${joinId}) to synchronize branches from ${splitNode.id}.`,
        nodeId: joinId,
      });
    }
  });

  // 9. Tasks & Events flow degree checks (Rule 4)
  const currentSeqEdges = repaired.edges.filter((e) => !isMessageFlow(e));
  modelNodes.forEach((n) => {
    const inSeq = currentSeqEdges.filter((e) => e.target === n.id);
    const outSeq = currentSeqEdges.filter((e) => e.source === n.id);

    if (isTask(n.type)) {
      if (inSeq.length !== 1) {
        errors.push(`Task "${n.data?.label || n.id}" must have exactly 1 incoming sequence flow (found ${inSeq.length}).`);
      }
      if (outSeq.length !== 1) {
        errors.push(`Task "${n.data?.label || n.id}" must have exactly 1 outgoing sequence flow (found ${outSeq.length}).`);
      }
    } else if (isIntermediateEvent(n.type)) {
      if (inSeq.length !== 1) {
        errors.push(`Intermediate event "${n.data?.label || n.id}" must have exactly 1 incoming sequence flow (found ${inSeq.length}).`);
      }
      if (outSeq.length !== 1) {
        errors.push(`Intermediate event "${n.data?.label || n.id}" must have exactly 1 outgoing sequence flow (found ${outSeq.length}).`);
      }
    } else if (isStartEvent(n.type)) {
      if (outSeq.length !== 1) {
        errors.push(`Start event "${n.data?.label || n.id}" must have exactly 1 outgoing sequence flow (found ${outSeq.length}).`);
      }
    } else if (isEndEvent(n.type)) {
      if (inSeq.length < 1) {
        errors.push(`End event "${n.data?.label || n.id}" must have at least 1 incoming sequence flow (found ${inSeq.length}).`);
      }
    } else if (isGateway(n)) {
      if (outSeq.length < 2 && inSeq.length < 2) {
        errors.push(`Gateway "${n.data?.label || n.label || n.id}" must be a split (>=2 outgoing sequence flows) or a join (>=2 incoming).`);
      }
    }
  });

  // 10. Exclusive Gateway Splits Probability Checks (Rule 5)
  modelNodes.forEach((n) => {
    if (isExclusiveGateway(n)) {
      const outSeq = currentSeqEdges.filter((e) => e.source === n.id);
      if (outSeq.length >= 2) {
        let hasUnlabeledBranch = false;
        let missingProb = false;
        let sumProb = 0;
        outSeq.forEach((e) => {
          const lbl = (e.label || e.data?.label || '').trim();
          if (!lbl) {
            hasUnlabeledBranch = true;
          }
          const prob = e.data?.probability != null ? e.data.probability : e.probability;
          if (prob == null || isNaN(Number(prob))) {
            missingProb = true;
          } else {
            sumProb += Number(prob);
          }
        });

        if (hasUnlabeledBranch) {
          errors.push(`Exclusive split "${n.data?.label || n.label || n.id}" has an unlabeled branch. Every outgoing flow must be labeled.`);
        }

        if (missingProb) {
          const q = `Exclusive split "${n.data?.label || n.label || n.id}": How often does each path happen?`;
          unresolvedGateways.push({
            gatewayId: n.id,
            label: n.data?.label || n.label || n.id,
            question: q,
            branches: outSeq.map((e) => ({
              edgeId: e.id,
              target: e.target,
              label: e.label || e.data?.label || '',
              probability: e.data?.probability != null ? e.data.probability : e.probability,
            })),
          });

          if (!options.allowUnresolved) {
            errors.push(q);
          }
        } else if (Math.abs(sumProb - 1.0) > 0.001) {
          errors.push(`Exclusive split "${n.data?.label || n.label || n.id}" branch probabilities must sum to 1.0 (found ${sumProb.toFixed(4)}).`);
        }
      }
    }
  });

  // 12. Check for duplicate tasks across different lanes (Rule 3.iii)
  const tasks = modelNodes.filter((n) => isTask(n.type));
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const t1 = tasks[i];
      const t2 = tasks[j];
      const lane1 = t1.lane || t1.data?.lane;
      const lane2 = t2.lane || t2.data?.lane;
      if (lane1 && lane2 && lane1 !== lane2) {
        const l1 = t1.data?.label || t1.label || '';
        const l2 = t2.data?.label || t2.label || '';
        const sim = computeSimilarity(l1, l2);
        if (sim >= 0.70) {
          duplicateWarnings.push({
            rule: 'suspected-duplicate-task',
            similarity: Number(sim.toFixed(2)),
            taskIds: [t1.id, t2.id],
            labels: [l1, l2],
            lanes: [lane1, lane2],
            question: 'Same step?',
          });
        }
      }
    }
  }

  // 11. Reachability Check: every node reachable from start and able to reach an end (Rule 2)
  const reachableFromStart = new Set();
  const queueStart = startNodes.map((s) => s.id);
  queueStart.forEach((id) => reachableFromStart.add(id));

  while (queueStart.length > 0) {
    const curr = queueStart.shift();
    // Flow can cross message flows to other pools or sequence flows within pools
    repaired.edges.filter((e) => e.source === curr).forEach((e) => {
      if (!reachableFromStart.has(e.target)) {
        reachableFromStart.add(e.target);
        queueStart.push(e.target);
      }
    });
  }

  modelNodes.forEach((n) => {
    if (!reachableFromStart.has(n.id)) {
      errors.push(`Node "${n.id}" (${n.data?.label || n.id}) is not reachable from any start event.`);
    }
  });

  // Backward reachability: able to reach an end event
  const canReachEnd = new Set();
  const queueEnd = endNodes.map((e) => e.id);
  queueEnd.forEach((id) => canReachEnd.add(id));

  while (queueEnd.length > 0) {
    const curr = queueEnd.shift();
    repaired.edges.filter((e) => e.target === curr).forEach((e) => {
      if (!canReachEnd.has(e.source)) {
        canReachEnd.add(e.source);
        queueEnd.push(e.source);
      }
    });
  }

  modelNodes.forEach((n) => {
    if (!canReachEnd.has(n.id)) {
      errors.push(`Node "${n.id}" (${n.data?.label || n.id}) cannot reach any end event.`);
    }
  });

  if (Array.isArray(rawDiagram?.connections)) {
    repaired.connections = repaired.edges.map((e) => {
      const isMsg = isMessageFlow(e);
      return {
        id: e.id,
        fromId: e.source,
        toId: e.target,
        source: e.source,
        target: e.target,
        flowType: isMsg ? 'message' : (e.flowType || 'sequence'),
        type: isMsg ? 'message-flow' : (e.type || 'sequence-flow'),
        data: e.data || {},
      };
    });
  }

  return {
    errors,
    repairs,
    repaired,
    unresolvedGateways,
    duplicateWarnings,
  };
}
