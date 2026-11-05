/**
 * deterministicNormalizer.js
 *
 * Deterministic normalizer and auto-repair engine for BPMN diagrams in SPOT.
 * Enforces valid BPMN 2.0 graph rules purely in code (no AI dependency):
 *  1. Tasks have exactly 1 incoming and 1 outgoing sequence flow.
 *  2. Multi-incoming tasks (2+ in) get an exclusive merge gateway before them.
 *  3. Multi-outgoing tasks (2+ out) get a split gateway after them.
 *  4. Orphan tasks (0 in or 0 out) are spliced into their logical semantic position.
 *  5. Single-path gateways (1 in, 1 out or 1 out) are removed.
 *  6. Converging branches merge through an exclusive gateway before continuing.
 *  7. Rework/failure branches (quality check fails, loan re-review) loop back instead of ending.
 *  8. Exactly 1 start event, at least 1 end event, full reachability.
 *  9. Every task has a role/lane, and lanes are created automatically.
 * 10. Generic filler tasks not in the user's description are pruned and flows rewired.
 * 11. Probabilities prefilled with smart estimated defaults (80/20 or equal share).
 */

import { isMessageFlow } from './validateBpmn.js';
import { stripTrailingPunctuation } from './stepListHelper.js';

// Global auto-fix log for debugging and automated assertions (never shown to the user)
let autoFixLogs = [];

export function getAutoFixLogs() {
  return [...autoFixLogs];
}

export function clearAutoFixLogs() {
  autoFixLogs = [];
}

export function logAutoFix(type, element, details = {}) {
  const entry = {
    type,
    element: typeof element === 'object' ? element.id : element,
    timestamp: Date.now(),
    ...details,
  };
  autoFixLogs.push(entry);
  return entry;
}

// Node type helpers
export function isTaskNode(typeOrNode) {
  const t = typeof typeOrNode === 'object' ? (typeOrNode.type || '') : String(typeOrNode || '');
  return t === 'task' || t.endsWith('-task');
}

export function isGatewayNode(typeOrNode) {
  const t = typeof typeOrNode === 'object' ? (typeOrNode.type || '') : String(typeOrNode || '');
  return t.includes('gateway') || (typeof typeOrNode === 'object' && typeOrNode.data?.gateway_type != null);
}

export function isExclusiveGatewayNode(typeOrNode) {
  if (!isGatewayNode(typeOrNode)) return false;
  if (typeof typeOrNode === 'object') {
    return typeOrNode.type === 'exclusive-gateway' || typeOrNode.data?.gateway_type === 'exclusive';
  }
  return typeOrNode === 'exclusive-gateway';
}

export function isParallelGatewayNode(typeOrNode) {
  if (!isGatewayNode(typeOrNode)) return false;
  if (typeof typeOrNode === 'object') {
    return typeOrNode.type === 'parallel-gateway' || typeOrNode.data?.gateway_type === 'parallel';
  }
  return typeOrNode === 'parallel-gateway';
}

export function isStartEventNode(typeOrNode) {
  const t = typeof typeOrNode === 'object' ? (typeOrNode.type || '') : String(typeOrNode || '');
  return t === 'start-event' || t.endsWith('-start-event');
}

export function isEndEventNode(typeOrNode) {
  const t = typeof typeOrNode === 'object' ? (typeOrNode.type || '') : String(typeOrNode || '');
  return t === 'end-event' || t.endsWith('-end-event');
}

export function isContainerNode(typeOrNode) {
  const t = typeof typeOrNode === 'object' ? (typeOrNode.type || '') : String(typeOrNode || '');
  return t === 'pool' || t === 'lane';
}

/**
 * Drop filler tasks:
 * Tasks with generic names that do not fuzzy-match the user's description,
 * rewiring the incoming and outgoing sequence flows around them.
 */
export function dropFillerTasks(diagram, userDescription = '') {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  const descLower = String(userDescription || '').toLowerCase();
  const genericPatterns = [
    /^(start\s*process|begin\s*process|process\s*start)$/i,
    /^(end\s*process|finish\s*process|process\s*end|process\s*ended)$/i,
    /^(review|check|notify|verify|process|evaluate\s*decision|evaluate)$/i,
    /^(process\s*request|receive\s*request|handle\s*request|handle\s*process)$/i,
    /^(do\s*nothing|proceed|pass|next\s*step|intermediate\s*step)$/i,
  ];

  let dropped = false;
  const nodesToRemove = new Set();
  const seqEdges = diagram.edges.filter((e) => !isMessageFlow(e));

  diagram.nodes.forEach((n) => {
    if (!isTaskNode(n)) return;
    const label = (n.data?.label || n.label || '').trim();
    if (!label) return;

    // Check if label matches a generic filler pattern
    const isGeneric = genericPatterns.some((pattern) => pattern.test(label));
    if (!isGeneric) return;

    // If the user's description explicitly contains this phrase/word, keep it
    const cleanWord = label.toLowerCase();
    if (descLower && descLower.includes(cleanWord)) {
      return;
    }

    // Task is a generic filler! Mark for removal and rewire
    nodesToRemove.add(n.id);
    dropped = true;
    logAutoFix('drop-filler-task', n.id, { label });

    const inEdges = seqEdges.filter((e) => e.target === n.id);
    const outEdges = seqEdges.filter((e) => e.source === n.id);

    if (inEdges.length > 0 && outEdges.length > 0) {
      // Connect each incoming source to the primary outgoing target
      const primaryTarget = outEdges[0].target;
      inEdges.forEach((ie) => {
        ie.target = primaryTarget;
      });
      // Remove other outgoing edges from the filler task
      outEdges.forEach((oe) => {
        diagram.edges = diagram.edges.filter((e) => e.id !== oe.id);
      });
    } else if (inEdges.length > 0 && outEdges.length === 0) {
      // Dangling incoming: remove incoming edges or leave to reachability repair
    }
  });

  if (dropped) {
    diagram.nodes = diagram.nodes.filter((n) => !nodesToRemove.has(n.id));
    diagram.edges = diagram.edges.filter((e) => !nodesToRemove.has(e.source) && !nodesToRemove.has(e.target));
  }

  return diagram;
}

/**
 * Remove single-path gateways:
 * Gateways with <= 1 outgoing sequence flow or 1 incoming & 1 outgoing sequence flow.
 */
export function removeSinglePathGateways(diagram) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  let changed = true;
  while (changed) {
    changed = false;
    const seqEdges = diagram.edges.filter((e) => !isMessageFlow(e));
    const gateways = diagram.nodes.filter(isGatewayNode);

    for (const gw of gateways) {
      const inEdges = seqEdges.filter((e) => e.target === gw.id);
      const outEdges = seqEdges.filter((e) => e.source === gw.id);

      if (outEdges.length <= 1) {
        if (inEdges.length === 1 && outEdges.length === 1) {
          const inEdge = inEdges[0];
          const outEdge = outEdges[0];

          // Rewire inEdge directly to outEdge target
          inEdge.target = outEdge.target;
          if (inEdge.data) {
            delete inEdge.data.label;
            inEdge.data.probability = 1.0;
          }

          // Remove outEdge and gw node
          diagram.edges = diagram.edges.filter((e) => e.id !== outEdge.id);
          diagram.nodes = diagram.nodes.filter((n) => n.id !== gw.id);
          logAutoFix('remove-single-path-gateway', gw.id);
          changed = true;
          break;
        } else if (inEdges.length === 0 && outEdges.length === 1) {
          // Orphan gateway
          const outEdge = outEdges[0];
          diagram.edges = diagram.edges.filter((e) => e.id !== outEdge.id);
          diagram.nodes = diagram.nodes.filter((n) => n.id !== gw.id);
          logAutoFix('remove-single-path-gateway', gw.id);
          changed = true;
          break;
        } else if (inEdges.length > 1 && outEdges.length === 1) {
          // This is a valid merge gateway! Keep it.
        } else if (outEdges.length === 0) {
          // Gateway with no outgoing edges: remove or connect to end
          diagram.nodes = diagram.nodes.filter((n) => n.id !== gw.id);
          diagram.edges = diagram.edges.filter((e) => e.source !== gw.id && e.target !== gw.id);
          logAutoFix('remove-single-path-gateway', gw.id);
          changed = true;
          break;
        }
      }
    }
  }

  return diagram;
}

/**
 * Task with 2+ incoming flows:
 * Insert an exclusive merge gateway before it and route all incoming flows into it.
 */
export function fixMultiIncomingTasks(diagram) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  const tasks = diagram.nodes.filter(isTaskNode);

  tasks.forEach((task) => {
    const inSeqEdges = diagram.edges.filter((e) => e.target === task.id && !isMessageFlow(e));
    if (inSeqEdges.length >= 2) {
      const mergeGwId = `gw_merge_${task.id}_${Date.now()}`;
      const mergeGw = {
        id: mergeGwId,
        type: 'exclusive-gateway',
        label: 'Merge',
        pool: task.pool || null,
        lane: task.lane || null,
        origin: 'structural',
        data: {
          label: 'Merge',
          gateway_type: 'exclusive',
          origin: 'structural',
        },
      };

      diagram.nodes.push(mergeGw);

      // Route all incoming flows into the merge gateway
      inSeqEdges.forEach((edge) => {
        edge.target = mergeGwId;
      });

      // Add single outgoing sequence flow from merge gateway into the task
      diagram.edges.push({
        id: `seq_merge_${mergeGwId}_${task.id}`,
        source: mergeGwId,
        target: task.id,
        flowType: 'sequence',
        data: {},
      });

      logAutoFix('insert-merge-gateway', task.id, { mergeGatewayId: mergeGwId });
    }
  });

  return diagram;
}

/**
 * Task with 2+ outgoing flows:
 * Insert a split gateway after it (exclusive or parallel) and reroute outgoing flows.
 */
export function fixMultiOutgoingTasks(diagram) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  const tasks = diagram.nodes.filter(isTaskNode);

  tasks.forEach((task) => {
    const outSeqEdges = diagram.edges.filter((e) => e.source === task.id && !isMessageFlow(e));
    if (outSeqEdges.length >= 2) {
      // Determine if parallel or exclusive based on edge data or labels
      const isParallel = outSeqEdges.some((e) => {
        const lbl = (e.label || e.data?.label || '').toLowerCase();
        return lbl.includes('and') || lbl.includes('saath') || lbl.includes('parallel');
      });

      const gwType = isParallel ? 'parallel-gateway' : 'exclusive-gateway';
      const splitGwId = `gw_split_${task.id}_${Date.now()}`;
      const splitGw = {
        id: splitGwId,
        type: gwType,
        label: `${task.data?.label || task.label || 'Decision'}?`,
        pool: task.pool || null,
        lane: task.lane || null,
        origin: 'structural',
        data: {
          label: `${task.data?.label || task.label || 'Decision'}?`,
          gateway_type: isParallel ? 'parallel' : 'exclusive',
          origin: 'structural',
        },
      };

      diagram.nodes.push(splitGw);

      // Route all outgoing flows from the split gateway
      outSeqEdges.forEach((edge) => {
        edge.source = splitGwId;
      });

      // Add single sequence flow from task to split gateway
      diagram.edges.push({
        id: `seq_split_${task.id}_${splitGwId}`,
        source: task.id,
        target: splitGwId,
        flowType: 'sequence',
        data: {},
      });

      logAutoFix('insert-split-gateway', task.id, { splitGatewayId: splitGwId, gatewayType: gwType });
    }
  });

  return diagram;
}

/**
 * Connect orphan tasks (tasks with 0 incoming or 0 outgoing sequence flows):
 * Connect by logical semantic position (role, keywords, description ordering),
 * never by blindly appending at the end after payment.
 */
export function connectOrphanTasks(diagram, userDescription = '', draftOrder = []) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  const tasks = diagram.nodes.filter(isTaskNode);
  const startEvent = diagram.nodes.find(isStartEventNode);
  const endEvent = diagram.nodes.find(isEndEventNode);

  // Semantic ordering weights:
  // Phase 1 (0-20): Order / Intake / Customer Arrival
  // Phase 2 (20-40): Decision / Screening / Credit / Inspection
  // Phase 3 (40-60): Cooking / Preparation / Core work (Khana banana, Interview, Fix)
  // Phase 4 (60-80): Serving / Delivery / Packing / Notify
  // Phase 5 (80-100): Payment / Bill / Receipt / Closure
  function getSemanticPhase(label, role = '') {
    const l = (label || '').toLowerCase();
    const r = (role || '').toLowerCase();

    if (l.includes('khana banana') || l.includes('cook') || l.includes('prepare') || l.includes('kitchen') || r.includes('chef')) {
      return 45;
    }
    if (l.includes('order') || l.includes('arrive') || l.includes('intake') || l.includes('submit') || l.includes('aata') || l.includes('deta') || l.includes('resume')) {
      return 10;
    }
    if (l.includes('credit') || l.includes('screen') || l.includes('qualified') || l.includes('inspect') || l.includes('dine') || l.includes('takeaway') || l.includes('decision')) {
      return 30;
    }
    if (l.includes('interview') || l.includes('fix') || l.includes('disburse') || l.includes('resolve')) {
      return 50;
    }
    if (l.includes('serve') || l.includes('pack') || l.includes('deliver') || l.includes('waiter') || l.includes('notify') || l.includes('rejection') || l.includes('offer')) {
      return 70;
    }
    if (l.includes('pay') || l.includes('bill') || l.includes('cashier') || l.includes('close') || l.includes('survey') || l.includes('feedback')) {
      return 90;
    }
    return 50;
  }

  tasks.forEach((task) => {
    const inSeq = diagram.edges.filter((e) => e.target === task.id && !isMessageFlow(e));
    const outSeq = diagram.edges.filter((e) => e.source === task.id && !isMessageFlow(e));

    const isOrphanIn = inSeq.length === 0;
    const isOrphanOut = outSeq.length === 0;

    if (!isOrphanIn && !isOrphanOut) return;

    const taskLabel = task.data?.label || task.label || task.id;
    const taskRole = task.lane || task.data?.lane || '';
    const taskPhase = getSemanticPhase(taskLabel, taskRole);

    // Find best predecessor and successor to splice into
    // Candidate sequence edges that connect a node with lower semantic phase to higher semantic phase
    const candidates = diagram.edges.filter((e) => {
      if (isMessageFlow(e)) return false;
      const srcNode = diagram.nodes.find((n) => n.id === e.source);
      const tgtNode = diagram.nodes.find((n) => n.id === e.target);
      if (!srcNode || !tgtNode) return false;
      if (srcNode.id === task.id || tgtNode.id === task.id) return false;

      const srcPhase = isStartEventNode(srcNode) ? 0 : getSemanticPhase(srcNode.data?.label || srcNode.label, srcNode.lane);
      const tgtPhase = isEndEventNode(tgtNode) ? 100 : getSemanticPhase(tgtNode.data?.label || tgtNode.label, tgtNode.lane);

      return srcPhase <= taskPhase && tgtPhase >= taskPhase;
    });

    let targetEdge = candidates.length > 0 ? candidates[0] : null;

    // For "Khana banana" / Chef: explicitly ensure it sits after Dine-in/Takeaway decision and before Serve/Pack, never after payment
    if (taskPhase === 45) {
      const chefEdge = candidates.find((e) => {
        const srcNode = diagram.nodes.find((n) => n.id === e.source);
        const tgtNode = diagram.nodes.find((n) => n.id === e.target);
        const sLbl = (srcNode?.data?.label || srcNode?.label || '').toLowerCase();
        const tLbl = (tgtNode?.data?.label || tgtNode?.label || '').toLowerCase();
        return (
          (sLbl.includes('order') || sLbl.includes('decision') || sLbl.includes('dine') || sLbl.includes('takeaway') || sLbl.includes('payment') || srcNode?.type?.includes('gateway')) &&
          (tLbl.includes('serve') || tLbl.includes('pack') || tLbl.includes('waiter') || tLbl.includes('payment'))
        );
      });
      if (chefEdge) targetEdge = chefEdge;
    }

    if (isOrphanIn && isOrphanOut) {
      if (targetEdge) {
        // Splice task into targetEdge: src -> task -> tgt
        const oldTarget = targetEdge.target;
        targetEdge.target = task.id;

        diagram.edges.push({
          id: `seq_splice_${task.id}_${oldTarget}`,
          source: task.id,
          target: oldTarget,
          flowType: 'sequence',
          data: {},
        });

        logAutoFix('connect-orphan-task', task.id, {
          predecessor: targetEdge.source,
          successor: oldTarget,
          reason: 'spliced into matching semantic phase flow',
        });
      } else {
        // Fallback: connect after start or previous task, and to end event
        const prevNode = tasks.find((t) => t.id !== task.id && getSemanticPhase(t.data?.label, t.lane) <= taskPhase) || startEvent;
        const nextNode = tasks.find((t) => t.id !== task.id && getSemanticPhase(t.data?.label, t.lane) > taskPhase) || endEvent;

        if (prevNode) {
          diagram.edges.push({
            id: `seq_orphan_in_${task.id}`,
            source: prevNode.id,
            target: task.id,
            flowType: 'sequence',
            data: {},
          });
        }
        if (nextNode) {
          diagram.edges.push({
            id: `seq_orphan_out_${task.id}`,
            source: task.id,
            target: nextNode.id,
            flowType: 'sequence',
            data: {},
          });
        }
        logAutoFix('connect-orphan-task', task.id, {
          predecessor: prevNode?.id,
          successor: nextNode?.id,
        });
      }
    } else if (isOrphanIn) {
      // Has outgoing but no incoming
      const prevNode = tasks.find((t) => t.id !== task.id && getSemanticPhase(t.data?.label, t.lane) <= taskPhase) || startEvent;
      if (prevNode) {
        diagram.edges.push({
          id: `seq_orphan_in_${task.id}`,
          source: prevNode.id,
          target: task.id,
          flowType: 'sequence',
          data: {},
        });
        logAutoFix('connect-orphan-task', task.id, { predecessor: prevNode.id });
      }
    } else if (isOrphanOut) {
      // Has incoming but no outgoing
      const nextNode = tasks.find((t) => t.id !== task.id && getSemanticPhase(t.data?.label, t.lane) >= taskPhase) || endEvent;
      if (nextNode) {
        diagram.edges.push({
          id: `seq_orphan_out_${task.id}`,
          source: task.id,
          target: nextNode.id,
          flowType: 'sequence',
          data: {},
        });
        logAutoFix('connect-orphan-task', task.id, { successor: nextNode.id });
      }
    }
  });

  return diagram;
}

/**
 * Rework/failure branch (quality check fails, loan needs re-review):
 * Loop back to the earlier step instead of ending.
 */
export function fixReworkBranches(diagram) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  const reworkKeywords = [
    'fail', 'failed', 'quality check fail', 're-review', 'redo', 're-submit',
    'needs rework', 'rework', 'defect', 'correction', 'dobara'
  ];

  diagram.edges.forEach((edge) => {
    if (isMessageFlow(edge)) return;
    const label = (edge.label || edge.data?.label || '').toLowerCase();
    const isRework = reworkKeywords.some((kw) => label.includes(kw));

    if (!isRework) return;

    const tgtNode = diagram.nodes.find((n) => n.id === edge.target);
    const isTerminal = isEndEventNode(tgtNode);

    if (isTerminal) {
      // Find the earlier step that performed the work (e.g. preparation, cook, application, review)
      const srcNode = diagram.nodes.find((n) => n.id === edge.source);
      // Look for predecessor task before the decision
      const inEdgesToDecision = diagram.edges.filter((e) => e.target === srcNode?.id && !isMessageFlow(e));
      const workStep = inEdgesToDecision.length > 0
        ? diagram.nodes.find((n) => n.id === inEdgesToDecision[0].source && isTaskNode(n))
        : null;

      const fallbackWorkStep = diagram.nodes.find(
        (n) => isTaskNode(n) && (n.data?.label || n.label || '').match(/prep|cook|khana|submit|review|apply/i)
      );

      const loopTarget = workStep || fallbackWorkStep;
      if (loopTarget) {
        edge.target = loopTarget.id;
        logAutoFix('loopback-rework-branch', edge.id, {
          source: edge.source,
          newTarget: loopTarget.id,
          label: edge.label || edge.data?.label,
        });
      }
    }
  });

  return diagram;
}

/**
 * Ensure exactly 1 start event, at least 1 end event, and full reachability.
 */
export function ensureSingleStartAndEndEvents(diagram) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  const modelNodes = diagram.nodes.filter((n) => !isContainerNode(n));
  const starts = modelNodes.filter(isStartEventNode);

  let primaryStart = starts[0];
  if (!primaryStart) {
    primaryStart = {
      id: `start_auto_${Date.now()}`,
      type: 'start-event',
      label: 'Start',
      origin: 'structural',
      data: { label: 'Start', origin: 'structural' },
    };
    diagram.nodes.unshift(primaryStart);
    logAutoFix('insert-start-event', primaryStart.id);
  } else if (starts.length > 1) {
    // Keep only the first start event, reroute edges from other start events
    const extraStarts = starts.slice(1);
    const extraIds = new Set(extraStarts.map((s) => s.id));
    diagram.nodes = diagram.nodes.filter((n) => !extraIds.has(n.id));
    diagram.edges.forEach((e) => {
      if (extraIds.has(e.source)) {
        e.source = primaryStart.id;
      }
    });
    logAutoFix('deduplicate-start-events', primaryStart.id, { removed: [...extraIds] });
  }

  // Ensure at least 1 end event
  const ends = diagram.nodes.filter(isEndEventNode);
  let primaryEnd = ends[0];
  if (!primaryEnd) {
    primaryEnd = {
      id: `end_auto_${Date.now()}`,
      type: 'end-event',
      label: 'End',
      origin: 'structural',
      data: { label: 'End', origin: 'structural' },
    };
    diagram.nodes.push(primaryEnd);
    logAutoFix('insert-end-event', primaryEnd.id);
  }

  // Ensure terminal non-end nodes connect to an end event
  const seqEdges = diagram.edges.filter((e) => !isMessageFlow(e));
  const outgoingMap = new Set(seqEdges.map((e) => e.source));
  const terminalNodes = diagram.nodes.filter(
    (n) => !isContainerNode(n) && !isEndEventNode(n) && !outgoingMap.has(n.id)
  );

  terminalNodes.forEach((tn) => {
    diagram.edges.push({
      id: `seq_terminal_to_end_${tn.id}`,
      source: tn.id,
      target: primaryEnd.id,
      flowType: 'sequence',
      data: {},
    });
    logAutoFix('connect-terminal-to-end', tn.id, { endEventId: primaryEnd.id });
  });

  return diagram;
}

/**
 * Ensure reachability:
 * Every element reachable from start and able to reach an end event.
 */
export function ensureReachability(diagram) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  const modelNodes = diagram.nodes.filter((n) => !isContainerNode(n));
  const startEvent = modelNodes.find(isStartEventNode);
  const endEvent = modelNodes.find(isEndEventNode);
  if (!startEvent || !endEvent) return diagram;

  // Forward reachability from start
  const reachableFromStart = new Set([startEvent.id]);
  const queueStart = [startEvent.id];

  while (queueStart.length > 0) {
    const curr = queueStart.shift();
    diagram.edges.filter((e) => e.source === curr).forEach((e) => {
      if (!reachableFromStart.has(e.target)) {
        reachableFromStart.add(e.target);
        queueStart.push(e.target);
      }
    });
  }

  // Fix unreachable nodes
  modelNodes.forEach((n) => {
    if (!reachableFromStart.has(n.id) && !isStartEventNode(n)) {
      diagram.edges.push({
        id: `seq_reach_start_${n.id}`,
        source: startEvent.id,
        target: n.id,
        flowType: 'sequence',
        data: {},
      });
      reachableFromStart.add(n.id);
      logAutoFix('fix-reachability-from-start', n.id);
    }
  });

  // Backward reachability to end
  const canReachEnd = new Set(modelNodes.filter(isEndEventNode).map((e) => e.id));
  const queueEnd = [...canReachEnd];

  while (queueEnd.length > 0) {
    const curr = queueEnd.shift();
    diagram.edges.filter((e) => e.target === curr).forEach((e) => {
      if (!canReachEnd.has(e.source)) {
        canReachEnd.add(e.source);
        queueEnd.push(e.source);
      }
    });
  }

  modelNodes.forEach((n) => {
    if (!canReachEnd.has(n.id) && !isEndEventNode(n)) {
      diagram.edges.push({
        id: `seq_reach_end_${n.id}`,
        source: n.id,
        target: endEvent.id,
        flowType: 'sequence',
        data: {},
      });
      canReachEnd.add(n.id);
      logAutoFix('fix-reachability-to-end', n.id);
    }
  });

  return diagram;
}

/**
 * Ensure every task has a role/lane, and lanes are created automatically.
 */
export function ensureTaskLanes(diagram, defaultLane = 'Staff') {
  if (!diagram || !Array.isArray(diagram.nodes)) return diagram;

  let poolNode = diagram.nodes.find((n) => n.type === 'pool');
  if (!poolNode) {
    poolNode = {
      id: 'pool_default',
      type: 'pool',
      label: 'Business Process',
      data: { label: 'Business Process' },
    };
    diagram.nodes.unshift(poolNode);
  }

  const existingLanes = new Set(
    diagram.nodes.filter((n) => n.type === 'lane').map((l) => l.label || l.data?.label || l.id)
  );

  diagram.nodes.forEach((n) => {
    if (isTaskNode(n)) {
      const assignedLane = n.lane || n.data?.lane || defaultLane;
      n.lane = assignedLane;
      n.pool = poolNode.id;
      if (!n.data) n.data = {};
      n.data.lane = assignedLane;
      n.data.pool = poolNode.id;

      if (!existingLanes.has(assignedLane)) {
        existingLanes.add(assignedLane);
        diagram.nodes.push({
          id: `lane_${assignedLane.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`,
          type: 'lane',
          label: assignedLane,
          pool: poolNode.id,
          data: { label: assignedLane },
        });
      }
    }
  });

  return diagram;
}

/**
 * Ensure probabilities for decision gateways are prefilled with smart defaults.
 */
export function ensureDefaultProbabilities(diagram) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  diagram.nodes.forEach((n) => {
    if (!isExclusiveGatewayNode(n)) return;
    const outEdges = diagram.edges.filter((e) => e.source === n.id && !isMessageFlow(e));
    if (outEdges.length >= 2) {
      const anyMissing = outEdges.some(
        (e) => (e.probability == null && e.data?.probability == null) || isNaN(Number(e.probability ?? e.data?.probability))
      );
      if (anyMissing) {
        // Smart guess: if branches look like approve/reject or pass/fail, use 80/20
        const isPassFail = outEdges.length === 2 && outEdges.some((e) => {
          const l = (e.label || e.data?.label || '').toLowerCase();
          return l.includes('yes') || l.includes('pass') || l.includes('haan') || l.includes('approve');
        });

        if (isPassFail) {
          outEdges.forEach((e) => {
            const l = (e.label || e.data?.label || '').toLowerCase();
            const isPositive = l.includes('yes') || l.includes('pass') || l.includes('haan') || l.includes('approve');
            const prob = isPositive ? 0.8 : 0.2;
            e.probability = prob;
            e.data = { ...(e.data || {}), probability: prob, probabilityEstimated: true };
          });
        } else {
          const equalShare = Number((1.0 / outEdges.length).toFixed(2));
          let runningSum = 0;
          outEdges.forEach((e, idx) => {
            let prob;
            if (idx === outEdges.length - 1) {
              prob = Number((1.0 - runningSum).toFixed(2));
            } else {
              prob = equalShare;
              runningSum += equalShare;
            }
            e.probability = prob;
            e.data = { ...(e.data || {}), probability: prob, probabilityEstimated: true };
          });
        }
        logAutoFix('prefill-decision-probabilities', n.id, { branchCount: outEdges.length });
      }
    }
  });

  return diagram;
}

/**
 * Main Deterministic Normalizer:
 * Takes any BPMN diagram (from draft compiler, LLM, or canvas) and applies
 * all deterministic auto-fixes to produce a strictly valid BPMN graph.
 */
export function normalizeAndRepairBpmn(diagram, options = {}) {
  if (!diagram) return diagram;
  const userDesc = options.userDescription || options.description || '';
  const draftOrder = options.order || [];

  // 1. Drop generic filler tasks
  dropFillerTasks(diagram, userDesc);

  // 2. Remove single-path gateways
  removeSinglePathGateways(diagram);

  // 3. Insert merge gateways before multi-incoming tasks
  fixMultiIncomingTasks(diagram);

  // 4. Insert split gateways after multi-outgoing tasks
  fixMultiOutgoingTasks(diagram);

  // 5. Connect orphan tasks by logical semantic position
  connectOrphanTasks(diagram, userDesc, draftOrder);

  // 6. Fix rework/failure loopback branches
  fixReworkBranches(diagram);

  // 7. Remove any newly-created single-path gateways
  removeSinglePathGateways(diagram);

  // 8. Ensure start and end events
  ensureSingleStartAndEndEvents(diagram);

  // 9. Ensure reachability
  ensureReachability(diagram);

  // 10. Ensure task lanes
  ensureTaskLanes(diagram);

  // 11. Ensure decision probabilities are prefilled
  ensureDefaultProbabilities(diagram);

  // 12. Final pass: re-check multi-incoming tasks that might have formed from reachability
  fixMultiIncomingTasks(diagram);
  fixMultiOutgoingTasks(diagram);
  removeSinglePathGateways(diagram);

  return diagram;
}

/**
 * Build valid BPMN diagram from a simple JSON draft:
 * Draft format:
 * {
 *   roles: string[],
 *   activities: Array<{ id: string, label: string, role?: string, duration?: number }>,
 *   decisions: Array<{ id: string, question: string, afterActivityId?: string, branches: Array<{ label: string, steps?: string[], rejoin?: boolean }> }>,
 *   order?: string[]
 * }
 */
export function buildBpmnFromDraft(draft, options = {}) {
  if (!draft) return null;

  const roles = draft.roles || ['Customer', 'Staff'];
  const activities = draft.activities || draft.steps || [];
  const decisions = draft.decisions || draft.branches || [];
  const order = draft.order || [];

  const nodes = [];
  const edges = [];

  // Pool & Lanes
  const poolId = 'pool_main';
  nodes.push({
    id: poolId,
    type: 'pool',
    label: 'Business Process',
    data: { label: 'Business Process' },
  });

  roles.forEach((r, idx) => {
    nodes.push({
      id: `lane_${r.toLowerCase().replace(/[^a-z0-9_]/g, '_')}_${idx}`,
      type: 'lane',
      label: r,
      pool: poolId,
      data: { label: r },
    });
  });

  // Start Event
  const startId = 'start_event_1';
  nodes.push({
    id: startId,
    type: 'start-event',
    label: 'Start',
    pool: poolId,
    lane: roles[0] || 'Customer',
    origin: 'structural',
    data: { label: 'Start', origin: 'structural' },
  });

  // Register Activities
  const actMap = new Map();
  activities.forEach((act, idx) => {
    const actId = act.id || `act_${idx + 1}`;
    const actLabel = act.label || act.name || `Step ${idx + 1}`;
    const actRole = act.role || act.lane || roles[0] || 'Staff';
    const duration = act.duration != null ? Number(act.duration) : (act.duration_min != null ? Number(act.duration_min) : 5);

    const taskNode = {
      id: actId,
      type: 'task',
      label: actLabel,
      pool: poolId,
      lane: actRole,
      origin: act.origin || 'stated',
      data: {
        label: actLabel,
        origin: act.origin || 'stated',
        duration,
        duration_unit: act.duration_unit || 'minutes',
        duration_min: act.duration_min != null ? Number(act.duration_min) : null,
        duration_max: act.duration_max != null ? Number(act.duration_max) : null,
        resource: actRole,
        resources: { [actRole]: 1 },
      },
    };
    nodes.push(taskNode);
    actMap.set(actId, taskNode);
  });

  // Build sequential flow based on order or activity sequence
  const sequenceSteps = order.length > 0
    ? order.filter((id) => actMap.has(id))
    : activities.map((a, i) => a.id || `act_${i + 1}`);

  if (sequenceSteps.length > 0) {
    edges.push({
      id: `seq_${startId}_${sequenceSteps[0]}`,
      source: startId,
      target: sequenceSteps[0],
      flowType: 'sequence',
      data: {},
    });

    for (let i = 0; i < sequenceSteps.length - 1; i++) {
      edges.push({
        id: `seq_${sequenceSteps[i]}_${sequenceSteps[i + 1]}`,
        source: sequenceSteps[i],
        target: sequenceSteps[i + 1],
        flowType: 'sequence',
        data: {},
      });
    }
  }

  // Register Decisions & Gateway Splits
  decisions.forEach((dec, dIdx) => {
    const splitId = `gw_split_${dec.id || dIdx}_${Date.now()}`;
    const splitLabel = stripTrailingPunctuation(dec.question || dec.label || 'Decision') + '?';

    nodes.push({
      id: splitId,
      type: 'exclusive-gateway',
      label: splitLabel,
      pool: poolId,
      lane: dec.role || roles[0] || 'Staff',
      origin: 'structural',
      data: {
        label: splitLabel,
        gateway_type: 'exclusive',
        origin: 'structural',
      },
    });

    // Splice decision after its afterActivityId or preceding activity
    const afterId = dec.afterActivityId || dec.afterStepId || (sequenceSteps.length > 0 ? sequenceSteps[0] : null);
    if (afterId && actMap.has(afterId)) {
      const existingOut = edges.find((e) => e.source === afterId && !isMessageFlow(e));
      if (existingOut) {
        const nextId = existingOut.target;
        existingOut.target = splitId;

        // Connect branches
        const branches = dec.branches || dec.options || [];
        branches.forEach((b, bIdx) => {
          const bLabel = b.label || `Option ${bIdx + 1}`;
          const bSteps = b.steps || [];
          if (bSteps.length > 0 && actMap.has(bSteps[0])) {
            edges.push({
              id: `seq_${splitId}_${bSteps[0]}`,
              source: splitId,
              target: bSteps[0],
              flowType: 'sequence',
              data: { label: bLabel, probability: b.probability || null },
            });
          } else {
            // Empty / direct branch to nextId
            edges.push({
              id: `seq_${splitId}_${nextId}_${bIdx}`,
              source: splitId,
              target: nextId,
              flowType: 'sequence',
              data: { label: bLabel, probability: b.probability || null },
            });
          }
        });
      }
    }
  });

  // End Event
  const endId = 'end_event_1';
  nodes.push({
    id: endId,
    type: 'end-event',
    label: 'End',
    pool: poolId,
    lane: roles[0] || 'Customer',
    origin: 'structural',
    data: { label: 'End', origin: 'structural' },
  });

  const lastSeqStep = sequenceSteps[sequenceSteps.length - 1];
  if (lastSeqStep) {
    edges.push({
      id: `seq_${lastSeqStep}_${endId}`,
      source: lastSeqStep,
      target: endId,
      flowType: 'sequence',
      data: {},
    });
  }

  const rawDiagram = {
    type: 'diagram',
    nodes,
    edges,
    resources: roles.map((r) => ({
      id: r,
      name: r,
      type: 'staff',
      quantity: 1,
      hours_per_day: 8,
      working_days_per_month: 22,
      monthly_salary: 60000,
    })),
  };

  return normalizeAndRepairBpmn(rawDiagram, options);
}

/**
 * Build a valid-by-construction linear fallback diagram from user's steps:
 * 1 Start event -> sequential tasks (each with role, 1 in / 1 out) -> 1 End event.
 */
export function buildLinearFallbackDiagram(userDescription, extractedSteps = [], options = {}) {
  const steps = extractedSteps.length > 0
    ? extractedSteps
    : [
        { label: 'Receive Request', role: 'Staff' },
        { label: 'Process Request', role: 'Staff' },
        { label: 'Complete Process', role: 'Staff' },
      ];

  const poolId = 'pool_linear';
  const roleName = steps[0]?.role || 'Staff';

  const nodes = [
    {
      id: poolId,
      type: 'pool',
      label: 'Main Process',
      data: { label: 'Main Process' },
    },
    {
      id: 'lane_main',
      type: 'lane',
      label: roleName,
      pool: poolId,
      data: { label: roleName },
    },
    {
      id: 'start_linear',
      type: 'start-event',
      label: 'Start',
      pool: poolId,
      lane: roleName,
      origin: 'structural',
      data: { label: 'Start', origin: 'structural' },
    },
  ];

  const edges = [];
  let prevId = 'start_linear';

  steps.forEach((step, idx) => {
    const taskId = `task_lin_${idx + 1}`;
    const taskLabel = typeof step === 'string' ? step : (step.label || `Step ${idx + 1}`);
    const taskRole = (typeof step === 'object' && step.role) ? step.role : roleName;

    nodes.push({
      id: taskId,
      type: 'task',
      label: taskLabel,
      pool: poolId,
      lane: taskRole,
      origin: 'stated',
      data: {
        label: taskLabel,
        origin: 'stated',
        duration: 5,
        duration_unit: 'minutes',
        resource: taskRole,
        resources: { [taskRole]: 1 },
      },
    });

    edges.push({
      id: `seq_${prevId}_${taskId}`,
      source: prevId,
      target: taskId,
      flowType: 'sequence',
      data: {},
    });

    prevId = taskId;
  });

  const endId = 'end_linear';
  nodes.push({
    id: endId,
    type: 'end-event',
    label: 'End',
    pool: poolId,
    lane: roleName,
    origin: 'structural',
    data: { label: 'End', origin: 'structural' },
  });

  edges.push({
    id: `seq_${prevId}_${endId}`,
    source: prevId,
    target: endId,
    flowType: 'sequence',
    data: {},
  });

  const rawDiagram = {
    type: 'diagram',
    nodes,
    edges,
    resources: [
      {
        id: roleName,
        name: roleName,
        type: 'staff',
        quantity: 1,
        hours_per_day: 8,
        working_days_per_month: 22,
        monthly_salary: 60000,
      },
    ],
  };

  logAutoFix('build-linear-fallback', 'fallback', { stepCount: steps.length });

  return rawDiagram;
}
