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
import { stripTrailingPunctuation, areExternalPoolAliases } from './stepListHelper.js';
export { areExternalPoolAliases };

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

export function cleanIdToHumanLabel(rawId) {
  if (!rawId) return 'Step';
  let cleaned = String(rawId)
    .replace(/^(gw_join_|gw_split_|gw_merge_auto_|gw_merge_|gw_|task_|step_|node_|activity_|start_|end_|seq_|flow_)/i, '')
    .replace(/\b1\d{9,}\b|\b\d{10,}\b/g, '') // remove timestamps
    .replace(/_\d+/g, '') // remove counters like _0, _1
    .replace(/\bauto[\s_-]gw[\s\w]*\b/gi, '')
    .replace(/\bauto\b/gi, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || /^(merge|join|gw|step|decision)$/i.test(cleaned)) {
    return 'Rejoin point';
  }

  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function getCleanStepName(nodeOrId, defaultName = 'Step') {
  if (!nodeOrId) return defaultName;
  const node = typeof nodeOrId === 'object' ? nodeOrId : null;
  const rawId = node ? node.id : nodeOrId;
  const isMerge = node && (
    node.role === 'merge' ||
    node.data?.role === 'merge' ||
    node.gateway_role === 'merge' ||
    node.data?.gateway_role === 'merge' ||
    /merge|join/i.test(node.id)
  );

  if (isMerge) {
    return 'Rejoin point';
  }

  const raw = node
    ? (node.data?.label || node.label || node.id)
    : nodeOrId;
  const stripped = stripTrailingPunctuation(String(raw || '').trim());
  if (
    !stripped ||
    /^(gw_|task_|step_|node_|activity_|start_|end_|seq_|flow_).+|_\d+$/i.test(stripped) ||
    /\bauto[\s_-]gw\b/i.test(stripped) ||
    /\b1\d{9,}\b/.test(stripped)
  ) {
    return cleanIdToHumanLabel(stripped || rawId || defaultName);
  }
  return stripped;
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

export function isInclusiveGatewayNode(typeOrNode) {
  if (!isGatewayNode(typeOrNode)) return false;
  if (typeof typeOrNode === 'object') {
    return typeOrNode.type === 'inclusive-gateway' || typeOrNode.data?.gateway_type === 'inclusive';
  }
  return typeOrNode === 'inclusive-gateway';
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
 * Generic fuzzy match for task labels against user process description:
 * Works across any language (English, Roman Urdu, etc.) without hardcoding.
 */
export function hasFuzzyMatch(taskLabel, userDescription = '') {
  if (!userDescription || typeof userDescription !== 'string' || !userDescription.trim()) {
    return true;
  }
  const cleanTask = String(taskLabel || '').trim().toLowerCase();
  if (!cleanTask) return false;

  const cleanDesc = userDescription.toLowerCase();
  const descTokens = cleanDesc.split(/\s+/).filter(Boolean);
  // Short domain titles/prompts (e.g. "Beverages Distribution Business", "Coffee Shop")
  // cannot describe multi-step flows; allow all generated tasks.
  if (descTokens.length < 8) {
    return true;
  }

  // Direct substring match
  if (cleanDesc.includes(cleanTask)) {
    return true;
  }

  // Normalized strings
  const normTask = cleanTask.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const normDesc = cleanDesc.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  if (normDesc.includes(normTask) || normTask.includes(normDesc)) {
    return true;
  }

  const taskWords = normTask.split(' ').filter((w) => w.length >= 3);
  if (taskWords.length === 0) {
    const anyWords = normTask.split(' ').filter(Boolean);
    return anyWords.some((w) => normDesc.includes(w));
  }

  const descWords = new Set(normDesc.split(' ').filter(Boolean));

  // Check matching words or inflections (e.g. submit/submits, inspect/inspects, karwata/karna)
  let matchingWordCount = 0;
  for (const tw of taskWords) {
    if (descWords.has(tw) || normDesc.includes(tw)) {
      matchingWordCount++;
    } else {
      const stem = tw.slice(0, Math.min(tw.length, 4));
      let stemFound = false;
      for (const dw of descWords) {
        if (dw.startsWith(stem) || dw.includes(stem)) {
          stemFound = true;
          break;
        }
      }
      if (stemFound) matchingWordCount++;
    }
  }

  return (matchingWordCount / taskWords.length) >= 0.4 || matchingWordCount >= 2 || (taskWords.length === 1 && matchingWordCount >= 1);
}

/**
 * Checks if a task is named after or mimics an adjacent gateway.
 */
export function matchesAdjacentGateway(taskNode, diagram) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return false;
  const taskId = typeof taskNode === 'object' ? taskNode.id : taskNode;
  const tNode = diagram.nodes.find((n) => n.id === taskId);
  if (!tNode) return false;

  const rawTaskLabel = (tNode.data?.label || tNode.label || '').trim().toLowerCase();
  if (!rawTaskLabel) return false;

  const normTask = rawTaskLabel.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const strippedTask = normTask.replace(/^(evaluate|check|decide|review|process|verify)\s+/i, '').trim();

  const seqEdges = diagram.edges.filter((e) => !isMessageFlow(e));
  const adjacentEdges = seqEdges.filter((e) => e.source === taskId || e.target === taskId);

  for (const edge of adjacentEdges) {
    const otherId = edge.source === taskId ? edge.target : edge.source;
    const otherNode = diagram.nodes.find((n) => n.id === otherId);
    if (!otherNode || !isGatewayNode(otherNode)) continue;

    const gwLabel = (otherNode.data?.label || otherNode.label || '').trim().toLowerCase();
    if (!gwLabel) continue;

    const normGw = gwLabel.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const strippedGw = normGw.replace(/^(evaluate|check|decide|review|process|verify)\s+/i, '').trim();
    if (!normGw && !strippedGw) continue;

    if (normTask === normGw || strippedTask === normGw || strippedTask === strippedGw || normTask === strippedGw) {
      return true;
    }
    if ((strippedGw.length >= 4 && normTask.includes(strippedGw)) || (strippedTask.length >= 4 && normGw.includes(strippedTask))) {
      return true;
    }
  }

  return false;
}

/**
 * Placeholder Guard (generic, post-generation):
 * Runs after generation and normalization.
 * If a task has no fuzzy match to user description OR matches an adjacent gateway,
 * removes the task, rewires incoming flow directly to outgoing flow, and logs removal.
 */
export function runPlaceholderGuard(diagram, userDescription = '') {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  let changed = true;
  while (changed) {
    changed = false;
    const seqEdges = diagram.edges.filter((e) => !isMessageFlow(e));
    const tasks = diagram.nodes.filter(isTaskNode);

    for (const task of tasks) {
      const taskLabel = (task.data?.label || task.label || '').trim();
      if (!taskLabel) continue;

      const isStructural = task.origin === 'structural' || task.data?.origin === 'structural';
      const isHidden = Boolean(task.data?.hidden);
      if (isStructural && isHidden) continue;

      const hasFuzzy = hasFuzzyMatch(taskLabel, userDescription);
      const matchesGw = matchesAdjacentGateway(task, diagram);

      if (!hasFuzzy || matchesGw) {
        const inEdges = seqEdges.filter((e) => e.target === task.id);
        const outEdges = seqEdges.filter((e) => e.source === task.id);

        if (inEdges.length > 0 && outEdges.length > 0) {
          const primaryTarget = outEdges[0].target;
          const outLabel = outEdges[0].label || outEdges[0].data?.label;

          inEdges.forEach((ie) => {
            ie.target = primaryTarget;
            if (!ie.label && !ie.data?.label && outLabel) {
              ie.label = outLabel;
              if (ie.data) ie.data.label = outLabel;
            }
          });

          outEdges.forEach((oe) => {
            diagram.edges = diagram.edges.filter((e) => e.id !== oe.id);
          });
        } else if (inEdges.length > 0) {
          inEdges.forEach((ie) => {
            diagram.edges = diagram.edges.filter((e) => e.id !== ie.id);
          });
        } else if (outEdges.length > 0) {
          outEdges.forEach((oe) => {
            diagram.edges = diagram.edges.filter((e) => e.id !== oe.id);
          });
        }

        diagram.nodes = diagram.nodes.filter((n) => n.id !== task.id);
        logAutoFix('placeholder-guard-removed', task.id, {
          label: taskLabel,
          reason: !hasFuzzy ? 'no-fuzzy-match' : 'matches-adjacent-gateway',
        });
        changed = true;
        break;
      }
    }
  }

  return diagram;
}

let uniqueNormalizerCounter = 0;
export function getUniqueNormalizerId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${++uniqueNormalizerCounter}`;
}

export function sanitizeFriendlyDescription(desc) {
  if (!desc || typeof desc !== 'string') return '';
  let sanitized = desc
    .replace(/\b1\d{9,}\b|\b\d{10,}\b/g, '') // remove timestamps
    .replace(/\bauto[\s_-]gw[a-z0-9_-]*\b/gi, 'rejoin point')
    .replace(/\bmerge\s+(?:auto\s+gw\s+)?merge[\s\d_]*\b/gi, 'rejoin point')
    .replace(/\bmerge\s+\d+\b/gi, 'rejoin point')
    .replace(/\bgateway\b/gi, 'decision step')
    .replace(/\bmessage\s+event\b/gi, 'step')
    .replace(/\bsequence\s+flow\b/gi, 'path')
    .replace(/\bsame[- ]pool\b/gi, '')
    .replace(/\bunconnected\b/gi, 'separate')
    .replace(/\bbpmn\b/gi, 'process')
    .replace(/\btoken\b/gi, 'flow')
    .replace(/\b(gw_|task_|step_|node_|seq_|flow_|activity_)[a-zA-Z0-9_]+|_\d+\b/gi, 'step')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return sanitized;
}

/**
 * Convert unsupported or same-pool message events into a valid form:
 *  - External pool + message flow if it references an external party.
 *  - Timer event if it represents a wait on time/duration.
 *  - Regular structural task in the previous step's lane otherwise.
 */
export function convertUnsupportedOrSamePoolMessageEvents(diagram, changelog = []) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  const messageNodes = diagram.nodes.filter(
    (n) =>
      n.type === 'message-intermediate-catch' ||
      n.type === 'message-intermediate-throw' ||
      n.type === 'message-start-event' ||
      (typeof n.type === 'string' && n.type.includes('message'))
  );

  messageNodes.forEach((node) => {
    // Check if node already has a valid cross-pool message flow
    const inMsgFlows = diagram.edges.filter((e) => e.target === node.id && isMessageFlow(e));
    const outMsgFlows = diagram.edges.filter((e) => e.source === node.id && isMessageFlow(e));
    const hasCrossPoolMsg = [...inMsgFlows, ...outMsgFlows].some((e) => {
      const srcNode = diagram.nodes.find((n) => n.id === e.source);
      const tgtNode = diagram.nodes.find((n) => n.id === e.target);
      return srcNode && tgtNode && (srcNode.pool || null) !== (tgtNode.pool || null);
    });

    if (hasCrossPoolMsg) return; // Already valid cross-pool message event

    // Same-pool or unsupported message event needs repair
    const undoSnapshot = {
      nodes: JSON.parse(JSON.stringify(diagram.nodes)),
      edges: JSON.parse(JSON.stringify(diagram.edges)),
      resources: diagram.resources ? JSON.parse(JSON.stringify(diagram.resources)) : undefined,
    };

    const label = (node.data?.label || node.label || '').trim();
    const cleanName = getCleanStepName(node, 'Waiting step');

    // Check if an existing external pool exists or match by label/interactsWith
    const initialExtPool = diagram.nodes.find(
      (n) => n.type === 'pool' && (n.data?.isExternal || n.isExternal || n.id.includes('ext'))
    );

    const hasExtContext = Boolean(
      initialExtPool ||
      node.data?.interactsWith ||
      node.data?.interacts_with ||
      /\b(from|to|by|with)\s+([A-Za-z0-9_-]+)/i.test(label) ||
      /\b(external|supplier|manufacturer|vendor|partner|client|customer|delivery)\b/i.test(label)
    );

    if (hasExtContext) {
      const partyExtracted = (label.match(/\b(?:from|to|by|with)\s+([A-Za-z0-9_-]+)/i)?.[1] ||
        label.match(/\b(external|supplier|manufacturer|vendor|partner|client|customer)\b/i)?.[1] ||
        'External Party');
      const extParty = node.data?.interactsWith || node.data?.interacts_with || initialExtPool?.label || partyExtracted;
      const rawParty = String(extParty).toLowerCase();
      const partyTitle = extParty.charAt(0).toUpperCase() + extParty.slice(1);

      // Check if an existing external pool matches or aliases this party
      const matchedExtPool = diagram.nodes.find(
        (n) => n.type === 'pool' && (n.data?.isExternal || n.id.includes('ext')) &&
               (areExternalPoolAliases(n.label || n.data?.label || n.id, rawParty) ||
                (n.label || '').toLowerCase().includes(rawParty))
      ) || initialExtPool;

      const extPoolId = matchedExtPool ? matchedExtPool.id : `pool_${rawParty.replace(/[^a-z0-9_]/g, '_')}`;
      const effectivePartyTitle = matchedExtPool ? (matchedExtPool.label || matchedExtPool.data?.label || partyTitle) : partyTitle;

      // Ensure main process pool exists if adding an external participant pool
      if (!diagram.nodes.some((n) => n.type === 'pool' && n.id !== extPoolId)) {
        diagram.nodes.unshift({
          id: 'main-process-pool',
          type: 'pool',
          label: 'Main Process',
          pool: 'main-process-pool',
          data: { label: 'Main Process', pool: 'main-process-pool' },
        });
      }

      // Assign main pool to internal nodes without a pool
      diagram.nodes.forEach((n) => {
        if (n.type !== 'pool' && !n.pool) {
          n.pool = 'main-process-pool';
          if (!n.data) n.data = {};
          n.data.pool = 'main-process-pool';
        }
      });

      // Ensure external pool exists
      if (!matchedExtPool && !diagram.nodes.some((n) => n.id === extPoolId)) {
        diagram.nodes.push({
          id: extPoolId,
          type: 'pool',
          label: partyTitle,
          pool: extPoolId,
          data: { label: partyTitle, isExternal: true, pool: extPoolId },
        });
      }

      // Add message flow between external pool and this message step
      const msgEdgeId = getUniqueNormalizerId(`msg_flow_${extPoolId}_${node.id}`);
      if (node.type === 'message-intermediate-throw' || node.type === 'message-end-event') {
        diagram.edges.push({
          id: msgEdgeId,
          source: node.id,
          target: extPoolId,
          flowType: 'message',
          type: 'message-flow',
          data: { label: `${effectivePartyTitle} dispatch` },
        });
      } else {
        diagram.edges.push({
          id: msgEdgeId,
          source: extPoolId,
          target: node.id,
          flowType: 'message',
          type: 'message-flow',
          data: { label: `${effectivePartyTitle} dispatch` },
        });
      }

      node.isHighlighted = true;
      if (node.data) node.data.isHighlighted = true;

      const desc = sanitizeFriendlyDescription(`Added a step to show the order going out to the ${rawParty}`);
      if (Array.isArray(changelog)) {
        changelog.push({
          id: getUniqueNormalizerId('change'),
          type: 'convert-message',
          elementId: node.id,
          affectedNodeIds: [node.id],
          stepName: cleanName,
          description: desc,
          assumed: true,
          undoSnapshot,
        });
      }
      logAutoFix('convert-same-pool-message', node.id, { action: 'added-external-pool-and-flow', party: partyTitle });
    } else if (/\b(wait|await|delay|hour|minute|day|week|month|time|duration|\d+\s*(m|h|d))\b/i.test(label)) {
      // Timer wait
      node.type = 'timer-intermediate-catch';
      if (!node.data) node.data = {};
      node.data.duration_unit = node.data.duration_unit || 'hours';

      node.isHighlighted = true;
      node.data.isHighlighted = true;

      const desc = sanitizeFriendlyDescription(`Converted '${cleanName}' into a waiting step`);
      if (Array.isArray(changelog)) {
        changelog.push({
          id: getUniqueNormalizerId('change'),
          type: 'convert-message',
          elementId: node.id,
          affectedNodeIds: [node.id],
          stepName: cleanName,
          description: desc,
          assumed: true,
          undoSnapshot,
        });
      }
      logAutoFix('convert-same-pool-message', node.id, { action: 'converted-to-timer' });
    } else {
      // Regular structural task
      node.type = 'task';
      if (!node.lane) {
        // Find preceding task's lane
        const inSeq = diagram.edges.filter((e) => e.target === node.id && !isMessageFlow(e));
        const prev = inSeq.length > 0 ? diagram.nodes.find((n) => n.id === inSeq[0].source) : null;
        node.lane = prev?.lane || 'Staff';
        if (node.data) node.data.lane = node.lane;
      }

      node.isHighlighted = true;
      if (node.data) node.data.isHighlighted = true;

      const desc = sanitizeFriendlyDescription(`Converted '${cleanName}' into a regular task`);
      if (Array.isArray(changelog)) {
        changelog.push({
          id: getUniqueNormalizerId('change'),
          type: 'convert-message',
          elementId: node.id,
          affectedNodeIds: [node.id],
          stepName: cleanName,
          description: desc,
          assumed: true,
          undoSnapshot,
        });
      }
      logAutoFix('convert-same-pool-message', node.id, { action: 'converted-to-task' });
    }
  });

  return diagram;
}

/**
 * Collapse consecutive intermediate catch events:
 * If two message or wait catch events occur back-to-back without an intervening activity
 * (e.g. Catch -> Catch), convert the second into an active internal task (e.g. processing/handling)
 * and ensure all message flows correctly route to the catch event.
 */
export function collapseConsecutiveCatchEvents(diagram, changelog = []) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  function isCatchEvent(n) {
    if (!n) return false;
    const t = String(n.type || '').toLowerCase();
    return (
      t === 'message-intermediate-catch' ||
      t === 'timer-intermediate-catch' ||
      t === 'intermediate-catch' ||
      (t.includes('catch') && !t.includes('boundary'))
    );
  }

  let changed = true;
  while (changed) {
    changed = false;
    const seqEdges = diagram.edges.filter((e) => !isMessageFlow(e));

    for (const edge of seqEdges) {
      const srcNode = diagram.nodes.find((n) => n.id === edge.source);
      const tgtNode = diagram.nodes.find((n) => n.id === edge.target);

      if (isCatchEvent(srcNode) && isCatchEvent(tgtNode)) {
        const undoSnapshot = {
          nodes: JSON.parse(JSON.stringify(diagram.nodes)),
          edges: JSON.parse(JSON.stringify(diagram.edges)),
          resources: diagram.resources ? JSON.parse(JSON.stringify(diagram.resources)) : undefined,
        };

        const oldLabel = String(tgtNode.data?.label || tgtNode.label || '').trim();
        let newLabel = oldLabel;
        if (/^(wait\s+for|await|receive|take)\b/i.test(newLabel)) {
          newLabel = newLabel.replace(/^(wait\s+for\s+|await\s+|receive\s+|take\s+)/i, 'Process ');
        } else if (!/^(process|handle|inspect|record|store)\b/i.test(newLabel)) {
          newLabel = `Process ${newLabel}`;
        }
        newLabel = newLabel.charAt(0).toUpperCase() + newLabel.slice(1);

        tgtNode.type = 'task';
        tgtNode.label = newLabel;
        if (!tgtNode.data) tgtNode.data = {};
        tgtNode.data.type = 'task';
        tgtNode.data.label = newLabel;
        tgtNode.isHighlighted = true;
        tgtNode.data.isHighlighted = true;

        // If tgtNode had incoming message flows, rewire or remove
        const inMsgEdges = diagram.edges.filter((e) => e.target === tgtNode.id && isMessageFlow(e));
        inMsgEdges.forEach((msgE) => {
          const srcAlreadyHasMsg = diagram.edges.some(
            (e) => isMessageFlow(e) && e.source === msgE.source && e.target === srcNode.id
          );
          if (!srcAlreadyHasMsg) {
            msgE.target = srcNode.id;
          } else {
            diagram.edges = diagram.edges.filter((e) => e.id !== msgE.id);
          }
        });

        const cleanOld = getCleanStepName(tgtNode, 'Waiting step');
        const desc = sanitizeFriendlyDescription(`Converted consecutive waiting step into '${newLabel}'`);
        if (Array.isArray(changelog)) {
          changelog.push({
            id: getUniqueNormalizerId('change'),
            type: 'convert-consecutive-catch',
            elementId: tgtNode.id,
            affectedNodeIds: [tgtNode.id],
            stepName: cleanOld,
            description: desc,
            assumed: true,
            undoSnapshot,
          });
        }

        logAutoFix('collapse-consecutive-catch', tgtNode.id, { from: oldLabel, to: newLabel });
        changed = true;
        break;
      }
    }
  }

  return diagram;
}

/**
 * Remove degenerate gateway pairs:
 * If a split gateway has all outgoing branches pointing directly to the same node
 * (with 0 intermediate activities on all branches), collapse or remove the degenerate gateway pair.
 */
export function removeDegenerateGatewayPairs(diagram, changelog = []) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  let changed = true;
  while (changed) {
    changed = false;
    const seqEdges = diagram.edges.filter((e) => !isMessageFlow(e));
    const gateways = diagram.nodes.filter(isGatewayNode);

    for (const splitGw of gateways) {
      const outEdges = seqEdges.filter((e) => e.source === splitGw.id);
      if (outEdges.length < 2) continue;

      // Check if ALL outgoing edges point directly to the SAME target node
      const firstTarget = outEdges[0].target;
      const allDirectToSameTarget = outEdges.every((e) => e.target === firstTarget);

      if (allDirectToSameTarget) {
        const targetNode = diagram.nodes.find((n) => n.id === firstTarget);
        const inEdgesToSplit = seqEdges.filter((e) => e.target === splitGw.id);

        const undoSnapshot = {
          nodes: JSON.parse(JSON.stringify(diagram.nodes)),
          edges: JSON.parse(JSON.stringify(diagram.edges)),
          resources: diagram.resources ? JSON.parse(JSON.stringify(diagram.resources)) : undefined,
        };

        const isTargetMergeGw =
          targetNode &&
          isGatewayNode(targetNode) &&
          (targetNode.role === 'merge' ||
            targetNode.gateway_role === 'merge' ||
            targetNode.data?.gateway_role === 'merge' ||
            /merge|join/i.test(targetNode.id));

        if (isTargetMergeGw) {
          const outFromMerge = seqEdges.filter((e) => e.source === targetNode.id);
          const nextTargetId = outFromMerge.length > 0 ? outFromMerge[0].target : null;

          if (nextTargetId) {
            inEdgesToSplit.forEach((ie) => {
              ie.target = nextTargetId;
              delete ie.label;
              if (ie.data) {
                delete ie.data.label;
                ie.data.probability = 1.0;
              }
            });

            const edgeIdsToRemove = new Set([
              ...outEdges.map((e) => e.id),
              ...outFromMerge.map((e) => e.id),
            ]);
            diagram.edges = diagram.edges.filter((e) => !edgeIdsToRemove.has(e.id));
            diagram.nodes = diagram.nodes.filter(
              (n) => n.id !== splitGw.id && n.id !== targetNode.id
            );

            const cleanName = getCleanStepName(splitGw, 'Decision');
            const desc = sanitizeFriendlyDescription(`Removed unnecessary decision step '${cleanName}'`);
            if (Array.isArray(changelog)) {
              changelog.push({
                id: getUniqueNormalizerId('change'),
                type: 'remove-degenerate-gateways',
                elementId: splitGw.id,
                affectedNodeIds: [splitGw.id, targetNode.id],
                stepName: cleanName,
                description: desc,
                assumed: false,
                undoSnapshot,
              });
            }

            logAutoFix('remove-degenerate-gateway-pair', splitGw.id, { mergeId: targetNode.id });
            changed = true;
            break;
          }
        } else if (inEdgesToSplit.length > 0) {
          inEdgesToSplit.forEach((ie) => {
            ie.target = firstTarget;
            delete ie.label;
            if (ie.data) {
              delete ie.data.label;
              ie.data.probability = 1.0;
            }
          });
          diagram.edges = diagram.edges.filter((e) => !outEdges.some((oe) => oe.id === e.id));
          diagram.nodes = diagram.nodes.filter((n) => n.id !== splitGw.id);

          const cleanName = getCleanStepName(splitGw, 'Decision');
          const desc = sanitizeFriendlyDescription(`Removed unnecessary decision step '${cleanName}'`);
          if (Array.isArray(changelog)) {
            changelog.push({
              id: getUniqueNormalizerId('change'),
              type: 'remove-degenerate-gateways',
              elementId: splitGw.id,
              affectedNodeIds: [splitGw.id],
              stepName: cleanName,
              description: desc,
              assumed: false,
              undoSnapshot,
            });
          }

          logAutoFix('remove-degenerate-split', splitGw.id, { target: firstTarget });
          changed = true;
          break;
        }
      }
    }
  }

  return diagram;
}

/**
 * Ensure every exclusive split gateway has >= 2 outgoing branches.
 * If only 1 path exists (e.g. Yes), add the missing branch (e.g. No) that bypasses the decision block.
 */
export function addMissingBranchPaths(diagram, changelog = []) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  const gateways = diagram.nodes.filter(isGatewayNode);

  gateways.forEach((gw) => {
    const isExcl = isExclusiveGatewayNode(gw) || gw.data?.gateway_type === 'exclusive' || gw.type?.includes('exclusive');
    if (!isExcl) return;

    // Never treat a merge gateway as a decision split!
    // A merge gateway is defined by:
    // 1. Tagged with role: "merge" or gateway_role: "merge"
    // 2. Or has 2+ incoming sequence flows
    // 3. Or tagged as structural: true (created by the repair engine as a merge or join)
    // 4. Or element ID / label indicates merge / join
    const inSeq = diagram.edges.filter((e) => e.target === gw.id && !isMessageFlow(e));
    const isMerge =
      gw.role === 'merge' ||
      gw.data?.role === 'merge' ||
      gw.gateway_role === 'merge' ||
      gw.data?.gateway_role === 'merge' ||
      inSeq.length >= 2 ||
      (gw.structural === true && gw.role !== 'split') ||
      (gw.data?.structural === true && gw.data?.role !== 'split') ||
      /merge|join/i.test(gw.id);

    if (isMerge) return;

    gw.role = 'split';
    gw.gateway_role = 'split';
    if (!gw.data) gw.data = {};
    gw.data.role = 'split';
    gw.data.gateway_role = 'split';

    const outSeq = diagram.edges.filter((e) => e.source === gw.id && !isMessageFlow(e));
    if (outSeq.length === 1) {
      const undoSnapshot = {
        nodes: JSON.parse(JSON.stringify(diagram.nodes)),
        edges: JSON.parse(JSON.stringify(diagram.edges)),
        resources: diagram.resources ? JSON.parse(JSON.stringify(diagram.resources)) : undefined,
      };

      const existingEdge = outSeq[0];
      const existingLabel = String(existingEdge.data?.label || existingEdge.label || '').trim().toLowerCase();
      const isAffirmative = /^(yes|true|y|approved|eligible|urgent|require|pass)\b/i.test(existingLabel);
      const missingLabel = isAffirmative ? 'No' : 'Yes';

      // Find sensible bypass target:
      // Trace forward from existingEdge.target to find downstream merge gateway, terminal step, or end event
      let bypassTargetId = null;
      const visited = new Set();
      let currentId = existingEdge.target;

      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const currNode = diagram.nodes.find((n) => n.id === currentId);
        if (!currNode) break;

        // Check if currNode is an existing merge gateway
        if (isGatewayNode(currNode) && (currNode.gateway_role === 'merge' || currNode.data?.gateway_role === 'merge')) {
          bypassTargetId = currNode.id;
          break;
        }
        if (isEndEventNode(currNode)) {
          bypassTargetId = currNode.id;
          break;
        }

        const outEdges = diagram.edges.filter((e) => e.source === currentId && !isMessageFlow(e));
        if (outEdges.length === 0) {
          bypassTargetId = currentId;
          break;
        }
        currentId = outEdges[0].target;
      }

      if (!bypassTargetId) {
        const endNode = diagram.nodes.find(isEndEventNode);
        bypassTargetId = endNode ? endNode.id : existingEdge.target;
      }

      if (bypassTargetId === existingEdge.target) {
        // Adding a missing branch directly to the same target creates a degenerate 0-task pair.
        // Skip adding; removeSinglePathGateways / removeDegenerateGatewayPairs will handle it.
        return;
      }

      const rawExistingProb = existingEdge.probability ?? existingEdge.data?.probability;
      let existingP = rawExistingProb != null && !isNaN(Number(rawExistingProb)) ? Number(rawExistingProb) : null;
      let missingProb = 0.2;

      if (existingP != null && existingP > 0 && existingP < 1.0) {
        missingProb = Number((1.0 - existingP).toFixed(2));
      } else {
        existingP = 0.8;
        missingProb = 0.2;
        existingEdge.probability = 0.8;
        if (!existingEdge.data) existingEdge.data = {};
        existingEdge.data.probability = 0.8;
        existingEdge.data.probabilityEstimated = true;
      }

      const missingEdgeId = getUniqueNormalizerId(`seq_${gw.id}_${bypassTargetId}_missing`);
      diagram.edges.push({
        id: missingEdgeId,
        source: gw.id,
        target: bypassTargetId,
        flowType: 'sequence',
        label: missingLabel,
        data: {
          label: missingLabel,
          probability: missingProb,
          probabilityEstimated: true,
        },
      });

      gw.isHighlighted = true;
      if (gw.data) gw.data.isHighlighted = true;

      const cleanGw = stripTrailingPunctuation(getCleanStepName(gw, 'Decision')) + '?';
      const desc = sanitizeFriendlyDescription(`Added a missing '${missingLabel}' path to '${cleanGw}'`);
      if (Array.isArray(changelog)) {
        changelog.push({
          id: getUniqueNormalizerId('change'),
          type: 'add-path',
          elementId: gw.id,
          affectedNodeIds: [gw.id],
          stepName: cleanGw,
          description: desc,
          assumed: true,
          undoSnapshot,
        });
      }

      logAutoFix('add-missing-branch-path', gw.id, { missingLabel, target: bypassTargetId });
    }
  });

  return diagram;
}

/**
 * For any split gateway with 2+ branches whose paths converge directly into a non-gateway step,
 * insert an exclusive merge gateway before the converging step.
 */
export function addMissingMergePoints(diagram, changelog = []) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  const gateways = diagram.nodes.filter(isGatewayNode);

  gateways.forEach((gw) => {
    // A merge gateway never triggers branch merging!
    const inSeq = diagram.edges.filter((e) => e.target === gw.id && !isMessageFlow(e));
    const isMerge =
      gw.role === 'merge' ||
      gw.data?.role === 'merge' ||
      gw.gateway_role === 'merge' ||
      gw.data?.gateway_role === 'merge' ||
      inSeq.length >= 2 ||
      /merge|join/i.test(gw.id);
    if (isMerge) return;

    const outSeq = diagram.edges.filter((e) => e.source === gw.id && !isMessageFlow(e));
    if (outSeq.length < 2) return;

    // Trace forward paths
    const branchPaths = outSeq.map((edge) => {
      const visited = new Set();
      const queue = [edge.target];
      const reachable = new Set();
      while (queue.length > 0) {
        const curr = queue.shift();
        if (visited.has(curr)) continue;
        visited.add(curr);
        reachable.add(curr);
        const outgoing = diagram.edges.filter((e) => e.source === curr && !isMessageFlow(e) && !e.data?.isRework && !e.isRework);
        for (const nextEdge of outgoing) {
          if (nextEdge.target !== gw.id) {
            queue.push(nextEdge.target);
          }
        }
      }
      return { edge, reachable };
    });

    const allReachable = new Map();
    branchPaths.forEach((bp) => {
      bp.reachable.forEach((nodeId) => {
        allReachable.set(nodeId, (allReachable.get(nodeId) || 0) + 1);
      });
    });

    const commonNodes = Array.from(allReachable.entries())
      .filter(([id, count]) => count >= 2)
      .map(([id]) => diagram.nodes.find((n) => n.id === id))
      .filter(Boolean);

    const hasMergeGateway = commonNodes.some(
      (n) => isGatewayNode(n) && (n.gateway_role === 'merge' || n.data?.gateway_role === 'merge')
    );
    const allTerminal = outSeq.every((edge) => {
      const tn = diagram.nodes.find((n) => n.id === edge.target);
      return tn && isEndEventNode(tn);
    });

    if (!hasMergeGateway && !allTerminal && commonNodes.length > 0) {
      const firstCommon = commonNodes[0];
      const incomingToCommon = diagram.edges.filter((e) => e.target === firstCommon.id && !isMessageFlow(e));
      if (!isGatewayNode(firstCommon) && incomingToCommon.length >= 2) {
        const undoSnapshot = {
          nodes: JSON.parse(JSON.stringify(diagram.nodes)),
          edges: JSON.parse(JSON.stringify(diagram.edges)),
          resources: diagram.resources ? JSON.parse(JSON.stringify(diagram.resources)) : undefined,
        };

        const mergeGwId = getUniqueNormalizerId(`gw_merge_${gw.id}`);
        const mergeNode = {
          id: mergeGwId,
          type: 'exclusive-gateway',
          label: '',
          gateway_role: 'merge',
          role: 'merge',
          structural: true,
          origin: 'structural',
          pool: gw.pool || firstCommon.pool || null,
          lane: firstCommon.lane || gw.lane || null,
          isHighlighted: true,
          data: {
            label: '',
            gateway_type: 'exclusive',
            gateway_role: 'merge',
            role: 'merge',
            structural: true,
            origin: 'structural',
            isHighlighted: true,
          },
        };
        diagram.nodes.push(mergeNode);

        // Reroute edges going into firstCommon from the branches
        incomingToCommon.forEach((e) => {
          e.target = mergeGwId;
        });

        // Add single sequence flow from mergeNode to firstCommon
        diagram.edges.push({
          id: getUniqueNormalizerId(`seq_merge_to_${firstCommon.id}`),
          source: mergeGwId,
          target: firstCommon.id,
          flowType: 'sequence',
          data: {},
        });

        const cleanGw = stripTrailingPunctuation(getCleanStepName(gw, 'Decision')) + '?';
        const desc = cleanGw.includes('Rejoin')
          ? 'Added a merge point to rejoin process paths'
          : sanitizeFriendlyDescription(`Added a merge point for paths after '${cleanGw}'`);
        if (Array.isArray(changelog)) {
          changelog.push({
            id: getUniqueNormalizerId('change'),
            type: 'add-merge',
            elementId: mergeGwId,
            affectedNodeIds: [mergeGwId],
            stepName: cleanGw,
            description: desc,
            assumed: true,
            undoSnapshot,
          });
        }

        logAutoFix('insert-missing-merge', gw.id, { mergeId: mergeGwId, before: firstCommon.id });
      }
    }
  });

  return diagram;
}

/**
 * Collapses chains of consecutive merge gateways into one.
 * If Merge A has a single outgoing sequence flow into Merge B,
 * reroutes all incoming flows into Merge A directly into Merge B,
 * removes the edge between Merge A and Merge B, and deletes Merge A.
 */
export function collapseConsecutiveMerges(diagram, changelog = []) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  let changed = true;
  let iterations = 0;
  while (changed && iterations < 10) {
    changed = false;
    iterations++;
    const seqEdges = diagram.edges.filter((e) => !isMessageFlow(e));
    const gateways = diagram.nodes.filter(isGatewayNode);

    for (const gw of gateways) {
      const inEdges = seqEdges.filter((e) => e.target === gw.id);
      const outEdges = seqEdges.filter((e) => e.source === gw.id);

      const isMerge =
        gw.role === 'merge' ||
        gw.data?.role === 'merge' ||
        gw.gateway_role === 'merge' ||
        gw.data?.gateway_role === 'merge' ||
        inEdges.length >= 2 ||
        /merge|join/i.test(gw.id);

      // Merge gateway with 1 outgoing flow
      if (isMerge && outEdges.length === 1) {
        const targetNode = diagram.nodes.find((n) => n.id === outEdges[0].target);
        if (!targetNode || !isGatewayNode(targetNode)) continue;

        const targetInEdges = seqEdges.filter((e) => e.target === targetNode.id);
        const isTargetMerge =
          targetNode.role === 'merge' ||
          targetNode.data?.role === 'merge' ||
          targetNode.gateway_role === 'merge' ||
          targetNode.data?.gateway_role === 'merge' ||
          targetInEdges.length >= 2 ||
          /merge|join/i.test(targetNode.id);

        if (isTargetMerge) {
          const connectingEdgeId = outEdges[0].id;
          inEdges.forEach((ie) => {
            ie.target = targetNode.id;
          });

          diagram.edges = diagram.edges.filter((e) => e.id !== connectingEdgeId);
          diagram.nodes = diagram.nodes.filter((n) => n.id !== gw.id);

          logAutoFix('collapse-consecutive-merges', gw.id, { mergedInto: targetNode.id });
          changed = true;
          break;
        }
      }
    }
  }

  return diagram;
}

/**
 * Remove single-path gateways:
 * Gateways with <= 1 outgoing sequence flow or 1 incoming & 1 outgoing sequence flow.
 */
export function removeSinglePathGateways(diagram, changelog = []) {
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

          const undoSnapshot = {
            nodes: JSON.parse(JSON.stringify(diagram.nodes)),
            edges: JSON.parse(JSON.stringify(diagram.edges)),
            resources: diagram.resources ? JSON.parse(JSON.stringify(diagram.resources)) : undefined,
          };

          // Rewire inEdge directly to outEdge target
          inEdge.target = outEdge.target;
          const srcNode = diagram.nodes.find((n) => n.id === inEdge.source);
          const isSplitSource = srcNode && isExclusiveGatewayNode(srcNode) && diagram.edges.filter((e) => e.source === srcNode.id && !isMessageFlow(e)).length >= 2;

          if (!isSplitSource) {
            delete inEdge.label;
            if (inEdge.data) {
              delete inEdge.data.label;
              inEdge.data.probability = 1.0;
            }
          }

          // Remove outEdge and gw node
          diagram.edges = diagram.edges.filter((e) => e.id !== outEdge.id);
          diagram.nodes = diagram.nodes.filter((n) => n.id !== gw.id);

          const cleanGw = getCleanStepName(gw, 'Decision');
          const desc = sanitizeFriendlyDescription(`Removed unnecessary decision step '${cleanGw}'`);
          if (Array.isArray(changelog)) {
            changelog.push({
              id: getUniqueNormalizerId('change'),
              type: 'remove-single-path',
              elementId: gw.id,
              affectedNodeIds: [gw.id],
              stepName: cleanGw,
              description: desc,
              assumed: false,
              undoSnapshot,
            });
          }

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
 * Repair cross-pool sequence flows:
 * In BPMN 2.0, sequence flows CANNOT cross pool boundaries.
 * 1. If an internal node (start-event, end-event, task, gateway) was mistakenly tagged with
 *    an external pool id (e.g. pool_ext_customer_1), re-parent it into the primary business pool.
 * 2. If a sequence flow connects an external pool (or a node in an external pool) to an internal node,
 *    convert the sequence flow into a message flow.
 */
export function repairCrossPoolSequenceFlows(diagram, changelog = []) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  const primaryPool = diagram.nodes.find((n) => n.type === 'pool' && !n.data?.isExternal && !n.isExternal && !n.id.includes('ext'));
  const primaryPoolId = primaryPool ? primaryPool.id : 'pool_primary';

  const nodeMap = new Map(diagram.nodes.map((n) => [n.id, n]));

  // Step 1: Re-parent internal nodes mistakenly assigned to external pools
  diagram.nodes.forEach((n) => {
    if (n.type === 'pool' || n.type === 'lane') return;
    const pId = n.pool || n.data?.pool;
    if (pId) {
      const targetPoolNode = nodeMap.get(pId);
      if (targetPoolNode && (targetPoolNode.data?.isExternal || targetPoolNode.isExternal || targetPoolNode.id.includes('ext'))) {
        n.pool = primaryPoolId;
        if (n.data) n.data.pool = primaryPoolId;
        logAutoFix('repair-node-pool', n.id, { oldPool: pId, newPool: primaryPoolId });
      }
    }
  });

  // Step 2: Convert any sequence flow crossing pools into a message flow
  diagram.edges.forEach((edge) => {
    if (isMessageFlow(edge)) return;

    const src = nodeMap.get(edge.source);
    const tgt = nodeMap.get(edge.target);
    if (!src || !tgt) return;

    const sp = src.pool || (src.type === 'pool' ? src.id : primaryPoolId);
    const tp = tgt.pool || (tgt.type === 'pool' ? tgt.id : primaryPoolId);

    if (sp !== tp) {
      edge.flowType = 'message';
      edge.type = 'message-flow';
      if (edge.data) {
        edge.data.flowType = 'message';
        edge.data.type = 'message-flow';
      }
      logAutoFix('convert-cross-pool-sequence-to-message', edge.id, {
        source: edge.source,
        target: edge.target,
        sourcePool: sp,
        targetPool: tp,
      });
    }
  });

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
      const mergeGwId = getUniqueNormalizerId(`gw_merge_${task.id}`);
      const mergeGw = {
        id: mergeGwId,
        type: 'exclusive-gateway',
        label: '',
        gateway_role: 'merge',
        role: 'merge',
        structural: true,
        origin: 'structural',
        pool: task.pool || null,
        lane: task.lane || null,
        data: {
          label: '',
          gateway_type: 'exclusive',
          gateway_role: 'merge',
          role: 'merge',
          structural: true,
          origin: 'structural',
        },
      };

      diagram.nodes.push(mergeGw);

      // Route all incoming flows into the merge gateway
      inSeqEdges.forEach((edge) => {
        edge.target = mergeGwId;
      });

      // Add single outgoing sequence flow from merge gateway into the task (unlabeled)
      diagram.edges.push({
        id: getUniqueNormalizerId(`seq_merge_${task.id}`),
        source: mergeGwId,
        target: task.id,
        flowType: 'sequence',
        label: '',
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
        return /\b(parallel|concurrent|concurrently|simultaneous|simultaneously|saath\s*saath)\b/i.test(lbl);
      });

      const gwType = isParallel ? 'parallel-gateway' : 'exclusive-gateway';
      const splitGwId = getUniqueNormalizerId(`gw_split_${task.id}`);
      const splitGw = {
        id: splitGwId,
        type: gwType,
        label: `${task.data?.label || task.label || 'Decision'}?`,
        pool: task.pool || null,
        lane: task.lane || null,
        origin: 'structural',
        structural: true,
        role: 'split',
        gateway_role: 'split',
        data: {
          label: `${task.data?.label || task.label || 'Decision'}?`,
          gateway_type: isParallel ? 'parallel' : 'exclusive',
          gateway_role: 'split',
          role: 'split',
          structural: true,
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
        id: getUniqueNormalizerId(`seq_split_${task.id}`),
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
 * Connects strictly based on sequence in draftOrder or diagram.nodes,
 * never by reordering or hardcoded keywords.
 */
export function connectOrphanTasks(diagram, userDescription = '', draftOrder = [], changelog = []) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  const tasks = diagram.nodes.filter(isTaskNode);
  const startEvent = diagram.nodes.find(isStartEventNode);
  const endEvent = diagram.nodes.find(isEndEventNode);

  // Use explicit draftOrder sequence if provided, otherwise diagram node sequence
  const canonicalOrder = Array.isArray(draftOrder) && draftOrder.length > 0
    ? draftOrder
    : diagram.nodes.map((n) => n.id);

  tasks.forEach((task) => {
    const inSeq = diagram.edges.filter((e) => e.target === task.id && !isMessageFlow(e));
    const outSeq = diagram.edges.filter((e) => e.source === task.id && !isMessageFlow(e));

    const isOrphanIn = inSeq.length === 0;
    const isOrphanOut = outSeq.length === 0;

    if (!isOrphanIn && !isOrphanOut) return;

    const undoSnapshot = {
      nodes: JSON.parse(JSON.stringify(diagram.nodes)),
      edges: JSON.parse(JSON.stringify(diagram.edges)),
      resources: diagram.resources ? JSON.parse(JSON.stringify(diagram.resources)) : undefined,
    };

    // Find position of task in canonical order
    let taskIdx = canonicalOrder.indexOf(task.id);
    if (taskIdx === -1) {
      taskIdx = diagram.nodes.findIndex((n) => n.id === task.id);
    }

    // Predecessor: nearest earlier node in sequence within the same pool
    let predecessor = null;
    for (let i = taskIdx - 1; i >= 0; i--) {
      const candId = canonicalOrder[i];
      const candNode = diagram.nodes.find((n) => n.id === candId);
      if (candNode && candNode.id !== task.id && !isContainerNode(candNode) && !isEndEventNode(candNode)) {
        if (!task.pool || !candNode.pool || task.pool === candNode.pool) {
          predecessor = candNode;
          break;
        }
      }
    }
    if (!predecessor) {
      predecessor = diagram.nodes.find((n) => isStartEventNode(n) && (!task.pool || !n.pool || task.pool === n.pool)) || startEvent;
    }

    // Successor: nearest later node in sequence within the same pool
    let successor = null;
    for (let i = taskIdx + 1; i < canonicalOrder.length; i++) {
      const candId = canonicalOrder[i];
      const candNode = diagram.nodes.find((n) => n.id === candId);
      if (candNode && candNode.id !== task.id && !isContainerNode(candNode) && !isStartEventNode(candNode)) {
        if (!task.pool || !candNode.pool || task.pool === candNode.pool) {
          successor = candNode;
          break;
        }
      }
    }
    if (!successor) {
      successor = diagram.nodes.find((n) => isEndEventNode(n) && (!task.pool || !n.pool || task.pool === n.pool)) || endEvent;
    }

    if (isOrphanIn && isOrphanOut) {
      // Splicing: if an edge exists between predecessor and successor, splice into it
      let existingEdge = diagram.edges.find(
        (e) => !isMessageFlow(e) && e.source === predecessor?.id && e.target === successor?.id
      );

      // If no direct edge between predecessor and successor, check if predecessor has a single outgoing sequence flow
      if (!existingEdge && predecessor) {
        const outFromPred = diagram.edges.filter((e) => !isMessageFlow(e) && e.source === predecessor.id);
        if (outFromPred.length === 1) {
          existingEdge = outFromPred[0];
        }
      }

      if (existingEdge && predecessor) {
        const oldTarget = existingEdge.target;
        existingEdge.target = task.id;
        diagram.edges.push({
          id: getUniqueNormalizerId(`seq_splice_${task.id}_${oldTarget}`),
          source: task.id,
          target: oldTarget,
          flowType: 'sequence',
          data: {},
        });
        logAutoFix('connect-orphan-task', task.id, {
          predecessor: predecessor.id,
          successor: oldTarget,
          action: 'spliced into existing flow',
        });
      } else {
        if (predecessor) {
          diagram.edges.push({
            id: `seq_orphan_in_${task.id}`,
            source: predecessor.id,
            target: task.id,
            flowType: 'sequence',
            data: {},
          });
        }
        if (successor) {
          diagram.edges.push({
            id: `seq_orphan_out_${task.id}`,
            source: task.id,
            target: successor.id,
            flowType: 'sequence',
            data: {},
          });
        }
        logAutoFix('connect-orphan-task', task.id, {
          predecessor: predecessor?.id,
          successor: successor?.id,
        });
      }
    } else if (isOrphanIn && predecessor) {
      const outFromPred = diagram.edges.filter((e) => !isMessageFlow(e) && e.source === predecessor.id);
      if (outFromPred.length === 1 && (!task.pool || !predecessor.pool || task.pool === predecessor.pool)) {
        const predEdge = outFromPred[0];
        const oldTarget = predEdge.target;
        predEdge.target = task.id;
        diagram.edges.push({
          id: getUniqueNormalizerId(`seq_splice_${task.id}_${oldTarget}`),
          source: task.id,
          target: oldTarget,
          flowType: 'sequence',
          data: {},
        });
        logAutoFix('connect-orphan-task', task.id, {
          predecessor: predecessor.id,
          successor: oldTarget,
          action: 'spliced into existing flow',
        });
      } else {
        diagram.edges.push({
          id: `seq_orphan_in_${task.id}`,
          source: predecessor.id,
          target: task.id,
          flowType: 'sequence',
          data: {},
        });
        logAutoFix('connect-orphan-task', task.id, { predecessor: predecessor.id });
      }
    } else if (isOrphanOut && successor) {
      diagram.edges.push({
        id: `seq_orphan_out_${task.id}`,
        source: task.id,
        target: successor.id,
        flowType: 'sequence',
        data: {},
      });
      logAutoFix('connect-orphan-task', task.id, { successor: successor.id });
    }

    task.isHighlighted = true;
    task.assumed = true;
    if (!task.data) task.data = {};
    task.data.isHighlighted = true;
    task.data.assumed = true;

    const cleanTask = getCleanStepName(task, 'Step');
    const desc = sanitizeFriendlyDescription(`Connected '${cleanTask}' to the next step`);
    if (Array.isArray(changelog)) {
      changelog.push({
        id: getUniqueNormalizerId('change'),
        type: 'connect-orphan',
        elementId: task.id,
        affectedNodeIds: [task.id],
        stepName: cleanTask,
        description: desc,
        assumed: true,
        undoSnapshot,
      });
    }
  });

  return diagram;
}

/**
 * Rework/failure branch (quality check fails, loan needs re-review):
 * Generically loops back to the earlier work step instead of ending.
 * Domain-agnostic, language-agnostic, with no hardcoded process keywords.
 */
export function fixReworkBranches(diagram) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  const reworkPattern = /(fail|failed|re-?do|re-?work|defect|error|incorrect|invalid|re-?try|re-?review|wapas|dobara|kharab|theek nahi)/i;

  const seqEdges = diagram.edges.filter((e) => !isMessageFlow(e));

  seqEdges.forEach((edge) => {
    const label = (edge.label || edge.data?.label || '').toLowerCase();
    const isRework = reworkPattern.test(label) || Boolean(edge.data?.isRework) || Boolean(edge.data?.retry);

    if (!isRework) return;

    const tgtNode = diagram.nodes.find((n) => n.id === edge.target);
    const isTerminal = isEndEventNode(tgtNode);

    // Find the earlier step that performed the work being evaluated / checked
    // Trace backward along incoming flows from the decision gateway
    const srcNode = diagram.nodes.find((n) => n.id === edge.source);
    let loopTarget = null;

    if (srcNode) {
      const inEdgesToDecision = diagram.edges.filter((e) => e.target === srcNode.id && !isMessageFlow(e));
      for (const inEdge of inEdgesToDecision) {
        const predecessor = diagram.nodes.find((n) => n.id === inEdge.source);
        if (predecessor && isTaskNode(predecessor)) {
          loopTarget = predecessor;
          break;
        } else if (predecessor && isGatewayNode(predecessor)) {
          const inBeforeMerge = diagram.edges.filter((e) => e.target === predecessor.id && !isMessageFlow(e));
          for (const ibm of inBeforeMerge) {
            const taskBefore = diagram.nodes.find((n) => n.id === ibm.source && isTaskNode(n));
            if (taskBefore) {
              loopTarget = taskBefore;
              break;
            }
          }
        }
      }
    }

    if (!loopTarget) {
      loopTarget = diagram.nodes.find(isTaskNode);
    }

    if (isTerminal && loopTarget) {
      edge.target = loopTarget.id;
      logAutoFix('loopback-rework-branch', edge.id, {
        source: edge.source,
        newTarget: loopTarget.id,
        label: edge.label || edge.data?.label,
      });
    } else if (tgtNode && isTaskNode(tgtNode) && loopTarget && tgtNode.id !== loopTarget.id) {
      // If the rework branch goes to an intermediate task, that task should loop back to loopTarget
      const outFromTgt = diagram.edges.filter((e) => e.source === tgtNode.id && !isMessageFlow(e));
      outFromTgt.forEach((outEdge) => {
        const outTgtNode = diagram.nodes.find((n) => n.id === outEdge.target);
        if (isEndEventNode(outTgtNode)) {
          outEdge.target = loopTarget.id;
          logAutoFix('loopback-rework-branch', outEdge.id, {
            source: tgtNode.id,
            newTarget: loopTarget.id,
            label: outEdge.label || outEdge.data?.label,
          });
        }
      });
    }
  });

  return diagram;
}

/**
 * Ensure referential integrity:
 * All edge source/target IDs must exist in nodes.
 * If an edge points to a missing external pool, create the pool;
 * if it points to a non-existent step, remove the edge.
 */
export function ensureReferentialIntegrity(diagram, changelog = []) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;
  const nodeMap = new Map(diagram.nodes.map((n) => [n.id, n]));
  const edgesToRemove = new Set();

  diagram.edges.forEach((e) => {
    const hasSource = nodeMap.has(e.source);
    const hasTarget = nodeMap.has(e.target);

    if (!hasSource || !hasTarget) {
      if (e.flowType === 'message' || e.type === 'message-flow') {
        const missingId = !hasSource ? e.source : e.target;
        const cleanPoolName = cleanIdToHumanLabel(missingId);
        const newPool = {
          id: missingId,
          type: 'pool',
          label: cleanPoolName,
          origin: 'structural',
          data: { label: cleanPoolName, isExternal: true, origin: 'structural' },
        };
        diagram.nodes.push(newPool);
        nodeMap.set(missingId, newPool);
        logAutoFix('create-missing-external-pool', missingId);
        return;
      }
      edgesToRemove.add(e.id);
      logAutoFix('remove-dangling-edge', e.id);
    }
  });

  if (edgesToRemove.size > 0) {
    diagram.edges = diagram.edges.filter((e) => !edgesToRemove.has(e.id));
  }
  return diagram;
}

/**
 * Remove redundant wait steps after message start event:
 * e.g. "Wait for order" right after message start is redundant.
 */
export function removeRedundantWaitStepsAfterMessageStart(diagram, changelog = []) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;
  const starts = diagram.nodes.filter(isStartEventNode);

  starts.forEach((sn) => {
    const isMsgStart = sn.type === 'message-start-event' || sn.data?.triggerType === 'message';
    if (!isMsgStart) return;

    const outSeq = diagram.edges.filter((e) => e.source === sn.id && !isMessageFlow(e));
    outSeq.forEach((edgeToWait) => {
      const waitTask = diagram.nodes.find((n) => n.id === edgeToWait.target);
      if (!waitTask || !isTaskNode(waitTask)) return;

      const label = getCleanStepName(waitTask);
      if (
        /^(receive|wait\s+for|await|take|accept)\b.*(message|notice|trigger|input|request|item|order|intake|delivery|arrival|submission|payload)/i.test(label) ||
        /^(receive\s+order|take\s+order|wait\s+for\s+order|await\s+order)/i.test(label)
      ) {
        const outFromWait = diagram.edges.filter((e) => e.source === waitTask.id && !isMessageFlow(e));
        if (outFromWait.length > 0) {
          const undoSnapshot = {
            nodes: JSON.parse(JSON.stringify(diagram.nodes)),
            edges: JSON.parse(JSON.stringify(diagram.edges)),
            resources: diagram.resources ? JSON.parse(JSON.stringify(diagram.resources)) : undefined,
          };

          const nextTarget = outFromWait[0].target;
          edgeToWait.target = nextTarget;
          const removeEdgeIds = new Set(outFromWait.map((e) => e.id));
          diagram.edges = diagram.edges.filter((e) => !removeEdgeIds.has(e.id));
          diagram.nodes = diagram.nodes.filter((n) => n.id !== waitTask.id);

          logAutoFix('remove-redundant-wait-step', waitTask.id);

          if (Array.isArray(changelog)) {
            changelog.push({
              id: getUniqueNormalizerId('change'),
              type: 'remove-redundant-wait',
              elementId: waitTask.id,
              affectedNodeIds: [waitTask.id],
              stepName: label,
              description: sanitizeFriendlyDescription(`Removed redundant '${label}' step after the initial arrival`),
              assumed: true,
              undoSnapshot,
            });
          }
        }
      }
    });
  });

  return diagram;
}

/**
 * Ensure exactly 1 start event, at least 1 end event, and full reachability.
 */
export function ensureSingleStartAndEndEvents(diagram, options = {}, changelog = []) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  const lang = options?.lang || options?.preferredLanguage || options?.intakeLanguage || 'en';
  const isUr = lang === 'ur-roman' || lang === 'ur';
  const defaultStart = lang === 'ur' ? 'شروع' : (lang === 'ur-roman' ? 'Shuru' : 'Start');
  const defaultEnd = lang === 'ur' ? 'ختم' : (lang === 'ur-roman' ? 'Khatam' : 'End');

  const modelNodes = diagram.nodes.filter((n) => !isContainerNode(n));
  const starts = modelNodes.filter(isStartEventNode);

  let primaryStart = starts[0];
  if (!primaryStart) {
    const undoSnapshot = {
      nodes: JSON.parse(JSON.stringify(diagram.nodes)),
      edges: JSON.parse(JSON.stringify(diagram.edges)),
      resources: diagram.resources ? JSON.parse(JSON.stringify(diagram.resources)) : undefined,
    };
    primaryStart = {
      id: `start_auto_${Date.now()}`,
      type: 'start-event',
      label: defaultStart,
      origin: 'structural',
      data: { label: defaultStart, origin: 'structural' },
    };
    diagram.nodes.unshift(primaryStart);
    logAutoFix('insert-start-event', primaryStart.id);

    if (Array.isArray(changelog)) {
      changelog.push({
        id: getUniqueNormalizerId('change'),
        type: 'add-start',
        elementId: primaryStart.id,
        affectedNodeIds: [primaryStart.id],
        stepName: defaultStart,
        description: sanitizeFriendlyDescription('Added a start step to begin the process'),
        assumed: true,
        undoSnapshot,
      });
    }
  } else {
    if (primaryStart.label === 'Start' && isUr) {
      primaryStart.label = defaultStart;
      if (primaryStart.data) primaryStart.data.label = defaultStart;
    }
    // Single start event enforcement:
    const confirmedStarts = new Set(
      (options?.confirmedIndependentTriggers || options?.confirmedStarts || []).map((s) => String(s).toLowerCase().trim())
    );

    const unconfirmedStarts = starts.filter((s, idx) => {
      if (idx === 0) return false;
      const lbl = (s.data?.label || s.label || s.id || '').toLowerCase().trim();
      return !confirmedStarts.has(lbl) && !confirmedStarts.has(s.id.toLowerCase().trim());
    });

    if (unconfirmedStarts.length > 0) {
      const undoSnapshot = {
        nodes: JSON.parse(JSON.stringify(diagram.nodes)),
        edges: JSON.parse(JSON.stringify(diagram.edges)),
        resources: diagram.resources ? JSON.parse(JSON.stringify(diagram.resources)) : undefined,
      };

      const removeIds = new Set(unconfirmedStarts.map((s) => s.id));
      diagram.nodes = diagram.nodes.filter((n) => !removeIds.has(n.id));
      diagram.edges.forEach((e) => {
        if (removeIds.has(e.source)) {
          e.source = primaryStart.id;
        }
      });
      logAutoFix('collapse-unconfirmed-start-events', primaryStart.id, { removed: [...removeIds] });

      if (Array.isArray(changelog)) {
        changelog.push({
          id: getUniqueNormalizerId('change'),
          type: 'collapse-starts',
          elementId: primaryStart.id,
          affectedNodeIds: [primaryStart.id, ...removeIds],
          stepName: getCleanStepName(primaryStart),
          description: sanitizeFriendlyDescription('Tidied up multiple start points into a single starting step'),
          assumed: true,
          undoSnapshot,
        });
      }
    }

    // Deduplicate any duplicate start events within the same pool
    const remainingStarts = diagram.nodes.filter(isStartEventNode);
    const startsByPool = new Map();
    remainingStarts.forEach((s) => {
      const p = s.pool || null;
      if (!startsByPool.has(p)) startsByPool.set(p, []);
      startsByPool.get(p).push(s);
    });

    startsByPool.forEach((poolStarts) => {
      if (poolStarts.length > 1) {
        const targetMap = new Map();
        poolStarts.forEach((s) => {
          const outEdges = (diagram.edges || []).filter((e) => e.source === s.id && e.flowType !== 'message');
          const targetKey = outEdges.map((e) => e.target).sort().join(',') || '__none__';
          if (!targetMap.has(targetKey)) targetMap.set(targetKey, []);
          targetMap.get(targetKey).push(s);
        });

        targetMap.forEach((duplicates) => {
          if (duplicates.length > 1) {
            const keep = duplicates[0];
            const remove = duplicates.slice(1);
            const removeIds = new Set(remove.map((s) => s.id));
            diagram.nodes = diagram.nodes.filter((n) => !removeIds.has(n.id));
            diagram.edges.forEach((e) => {
              if (removeIds.has(e.source)) {
                e.source = keep.id;
              }
            });
            logAutoFix('deduplicate-start-events', keep.id, { removed: [...removeIds] });
          }
        });
      }
    });
  }

  // Ensure at least 1 end event
  const ends = diagram.nodes.filter(isEndEventNode);
  let primaryEnd = ends[0];
  if (!primaryEnd) {
    const undoSnapshot = {
      nodes: JSON.parse(JSON.stringify(diagram.nodes)),
      edges: JSON.parse(JSON.stringify(diagram.edges)),
      resources: diagram.resources ? JSON.parse(JSON.stringify(diagram.resources)) : undefined,
    };
    primaryEnd = {
      id: `end_auto_${Date.now()}`,
      type: 'end-event',
      label: defaultEnd,
      origin: 'structural',
      data: { label: defaultEnd, origin: 'structural' },
    };
    diagram.nodes.push(primaryEnd);
    ends.push(primaryEnd);
    logAutoFix('insert-end-event', primaryEnd.id);

    if (Array.isArray(changelog)) {
      changelog.push({
        id: getUniqueNormalizerId('change'),
        type: 'add-end',
        elementId: primaryEnd.id,
        affectedNodeIds: [primaryEnd.id],
        stepName: defaultEnd,
        description: sanitizeFriendlyDescription('Added an end step to complete the process'),
        assumed: true,
        undoSnapshot,
      });
    }
  } else if (primaryEnd.label === 'End' && isUr) {
    primaryEnd.label = defaultEnd;
    if (primaryEnd.data) primaryEnd.data.label = defaultEnd;
  }

  if (options?.connectTerminals === false) {
    return diagram;
  }

  // Ensure terminal non-end nodes connect to an end event within their own pool
  const seqEdges = diagram.edges.filter((e) => !isMessageFlow(e));
  const outgoingMap = new Set(seqEdges.map((e) => e.source));
  const terminalNodes = diagram.nodes.filter(
    (n) => !isContainerNode(n) && !isEndEventNode(n) && !outgoingMap.has(n.id)
  );

  terminalNodes.forEach((tn) => {
    const tnPool = tn.pool || null;
    let poolEnd = ends.find((e) => (e.pool || null) === tnPool);
    if (!poolEnd) {
      poolEnd = {
        id: `end_auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'end-event',
        label: defaultEnd,
        pool: tnPool,
        lane: tn.lane || null,
        origin: 'structural',
        data: { label: defaultEnd, origin: 'structural' },
      };
      diagram.nodes.push(poolEnd);
      ends.push(poolEnd);
      logAutoFix('insert-end-event', poolEnd.id);
    }
    diagram.edges.push({
      id: `seq_terminal_to_end_${tn.id}`,
      source: tn.id,
      target: poolEnd.id,
      flowType: 'sequence',
      data: {},
    });
    logAutoFix('connect-terminal-to-end', tn.id, { endEventId: poolEnd.id });
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
  const startNodes = modelNodes.filter(isStartEventNode);
  const endNodes = modelNodes.filter(isEndEventNode);
  if (startNodes.length === 0 || endNodes.length === 0) return diagram;

  // Forward reachability from all start events (strictly sequence flows)
  const reachableFromStart = new Set(startNodes.map((s) => s.id));
  const queueStart = [...reachableFromStart];

  while (queueStart.length > 0) {
    const curr = queueStart.shift();
    diagram.edges.filter((e) => e.source === curr && !isMessageFlow(e)).forEach((e) => {
      if (!reachableFromStart.has(e.target)) {
        reachableFromStart.add(e.target);
        queueStart.push(e.target);
      }
    });
  }

  // Fix unreachable nodes: connect to a start event in the SAME pool (never cross pools)
  // CRITICAL: Only connect source/root nodes that have NO incoming sequence flows from within their pool
  modelNodes.forEach((n) => {
    if (!reachableFromStart.has(n.id) && !isStartEventNode(n)) {
      const inSeqEdges = diagram.edges.filter((e) => e.target === n.id && !isMessageFlow(e));
      if (inSeqEdges.length === 0) {
        const poolStart = startNodes.find((s) => (s.pool || null) === (n.pool || null)) || startNodes[0];
        if (poolStart && (poolStart.pool || null) === (n.pool || null)) {
          diagram.edges.push({
            id: `seq_reach_start_${n.id}`,
            source: poolStart.id,
            target: n.id,
            flowType: 'sequence',
            data: {},
          });
          reachableFromStart.add(n.id);
          const q = [n.id];
          while (q.length > 0) {
            const cur = q.shift();
            diagram.edges.filter((e) => e.source === cur && !isMessageFlow(e)).forEach((e) => {
              if (!reachableFromStart.has(e.target)) {
                reachableFromStart.add(e.target);
                q.push(e.target);
              }
            });
          }
          logAutoFix('fix-reachability-from-start', n.id);
        }
      }
    }
  });

  // Backward reachability to end: start from all end events (strictly sequence flows)
  const canReachEnd = new Set(endNodes.map((e) => e.id));
  const queueEnd = [...canReachEnd];

  while (queueEnd.length > 0) {
    const curr = queueEnd.shift();
    diagram.edges.filter((e) => e.target === curr && !isMessageFlow(e)).forEach((e) => {
      if (!canReachEnd.has(e.source)) {
        canReachEnd.add(e.source);
        queueEnd.push(e.source);
      }
    });
  }

  // Fix nodes unable to reach end: connect to an end event in the SAME pool
  // CRITICAL: Only connect sink nodes that have NO outgoing sequence flows!
  modelNodes.forEach((n) => {
    if (!canReachEnd.has(n.id) && !isEndEventNode(n)) {
      const outSeqEdges = diagram.edges.filter((e) => e.source === n.id && !isMessageFlow(e));
      if (outSeqEdges.length === 0) {
        const poolEnd = endNodes.find((e) => (e.pool || null) === (n.pool || null)) || endNodes[0];
        if (poolEnd && (poolEnd.pool || null) === (n.pool || null)) {
          diagram.edges.push({
            id: `seq_reach_end_${n.id}`,
            source: n.id,
            target: poolEnd.id,
            flowType: 'sequence',
            data: {},
          });
          canReachEnd.add(n.id);
          const q = [n.id];
          while (q.length > 0) {
            const cur = q.shift();
            diagram.edges.filter((e) => e.target === cur && !isMessageFlow(e)).forEach((e) => {
              if (!canReachEnd.has(e.source)) {
                canReachEnd.add(e.source);
                q.push(e.source);
              }
            });
          }
          logAutoFix('fix-reachability-to-end', n.id);
        }
      }
    }
  });

  return diagram;
}

/**
 * Ensure every task has a role/lane, and lanes are created automatically.
 */
export function ensureTaskLanes(diagram, defaultLane = 'Staff', changelog = []) {
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

  const existingPoolIds = new Set(diagram.nodes.filter((n) => n.type === 'pool').map((p) => p.id));
  const poolLanesList = diagram.nodes.filter((n) => n.type === 'lane');
  const existingLanes = new Set();
  poolLanesList.forEach((l) => {
    const pId = l.pool || poolNode.id;
    if (l.id) existingLanes.add(`${pId}:${l.id.toLowerCase()}`);
    if (l.label) existingLanes.add(`${pId}:${l.label.toLowerCase()}`);
    if (l.data?.label) existingLanes.add(`${pId}:${l.data.label.toLowerCase()}`);
  });

  diagram.nodes.forEach((n) => {
    if (isTaskNode(n)) {
      const wasMissingLane = !n.lane && !n.data?.lane;
      const assignedLane = n.lane || n.data?.lane || defaultLane;
      const currentPool = n.pool || n.data?.pool;
      const assignedPool = (currentPool && existingPoolIds.has(currentPool)) ? currentPool : poolNode.id;

      // Check if assignedLane matches an existing lane in assignedPool by id or label
      const assignedLower = String(assignedLane).trim().toLowerCase();
      const matchedLane = poolLanesList.find((l) => {
        const pId = l.pool || poolNode.id;
        if (pId !== assignedPool) return false;
        return (
          (l.id && l.id.toLowerCase() === assignedLower) ||
          (l.label && l.label.toLowerCase() === assignedLower) ||
          (l.data?.label && l.data.label.toLowerCase() === assignedLower)
        );
      });

      const canonicalLane = matchedLane ? (matchedLane.label || matchedLane.data?.label || matchedLane.id) : assignedLane;

      n.lane = canonicalLane;
      n.pool = assignedPool;
      if (!n.data) n.data = {};
      n.data.lane = canonicalLane;
      n.data.pool = assignedPool;

      if (wasMissingLane && Array.isArray(changelog)) {
        const cleanTask = getCleanStepName(n, 'Step');
        const desc = sanitizeFriendlyDescription(`Assigned '${cleanTask}' to ${canonicalLane}`);
        changelog.push({
          id: getUniqueNormalizerId('change'),
          type: 'assign-lane',
          elementId: n.id,
          affectedNodeIds: [n.id],
          stepName: cleanTask,
          description: desc,
          assumed: true,
          undoSnapshot: {
            nodes: JSON.parse(JSON.stringify(diagram.nodes)),
            edges: JSON.parse(JSON.stringify(diagram.edges)),
          },
        });
      }

      if (!matchedLane) {
        const isGenericLaneId = /^lane[-_]?\d+$/i.test(assignedLane.trim());
        if (!isGenericLaneId) {
          const laneKey = `${assignedPool}:${assignedLower}`;
          if (!existingLanes.has(laneKey)) {
            existingLanes.add(laneKey);
            const newLaneNode = {
              id: `lane_${assignedLane.toLowerCase().replace(/[^a-z0-9_]/g, '_')}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              type: 'lane',
              label: assignedLane,
              pool: assignedPool,
              data: { label: assignedLane, pool: assignedPool },
            };
            poolLanesList.push(newLaneNode);
            diagram.nodes.push(newLaneNode);
          }
        } else if (poolLanesList.length > 0) {
          const fallbackLane = poolLanesList[0];
          const fallbackLabel = fallbackLane.label || fallbackLane.data?.label || fallbackLane.id;
          n.lane = fallbackLabel;
          if (n.data) n.data.lane = fallbackLabel;
        }
      }
    }
  });

  // Drop any generic or orphan lanes with no nodes assigned
  const assignedLanesSet = new Set(
    diagram.nodes
      .filter((n) => n.type !== 'pool' && n.type !== 'lane')
      .flatMap((n) => [n.lane, n.data?.lane].filter(Boolean).map((x) => String(x).toLowerCase()))
  );
  diagram.nodes = diagram.nodes.filter((n) => {
    if (n.type !== 'lane') return true;
    const lId = String(n.id || '').toLowerCase();
    const lLabel = String(n.label || n.data?.label || '').toLowerCase();
    const hasAssignedNodes = assignedLanesSet.has(lId) || assignedLanesSet.has(lLabel);
    const isGenericLane = /^lane[-_]?\d+$/i.test(lLabel);
    if (isGenericLane && !hasAssignedNodes) return false;
    return true;
  });

  return diagram;
}

/**
 * Deduplicate external participant pools.
 * Merges duplicate external pools whose names alias (e.g. "Parts Supplier" and "Supplier"),
 * rewires message flows to the canonical pool ID, and removes duplicate pool nodes.
 */
export function deduplicateExternalPools(diagram, changelog = []) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  const extPools = diagram.nodes.filter(
    (n) => n.type === 'pool' && (n.data?.isExternal || n.isExternal || n.id.includes('ext'))
  );

  if (extPools.length <= 1) return diagram;

  // Sort descending by label length so the most specific name becomes canonical
  const sorted = [...extPools].sort((a, b) => {
    const lA = (a.label || a.data?.label || '').length;
    const lB = (b.label || b.data?.label || '').length;
    return lB - lA;
  });

  const canonicalPools = [];
  const aliasMap = new Map();

  sorted.forEach((p) => {
    const pLabel = p.label || p.data?.label || p.id;
    const canonical = canonicalPools.find((c) => {
      const cLabel = c.label || c.data?.label || c.id;
      return areExternalPoolAliases(cLabel, pLabel);
    });

    if (canonical) {
      aliasMap.set(p.id, canonical.id);
    } else {
      canonicalPools.push(p);
    }
  });

  if (aliasMap.size === 0) return diagram;

  // Rewire edges
  diagram.edges.forEach((e) => {
    if (aliasMap.has(e.source)) {
      e.source = aliasMap.get(e.source);
    }
    if (aliasMap.has(e.target)) {
      e.target = aliasMap.get(e.target);
    }
  });

  // Rewire node pools
  diagram.nodes.forEach((n) => {
    if (n.pool && aliasMap.has(n.pool)) {
      n.pool = aliasMap.get(n.pool);
    }
    if (n.data?.pool && aliasMap.has(n.data.pool)) {
      n.data.pool = aliasMap.get(n.data.pool);
    }
  });

  // Remove duplicate pools
  const removedIds = new Set(aliasMap.keys());
  diagram.nodes = diagram.nodes.filter((n) => !removedIds.has(n.id));

  // Deduplicate redundant message flows between the same source and target
  const seenEdges = new Set();
  diagram.edges = diagram.edges.filter((e) => {
    const key = `${e.source}->${e.target}:${e.flowType || e.type}`;
    if (seenEdges.has(key)) return false;
    seenEdges.add(key);
    return true;
  });

  removedIds.forEach((dupId) => {
    logAutoFix('deduplicate-external-pools', dupId, { canonicalId: aliasMap.get(dupId) });
  });

  return diagram;
}

/**
 * Ensure probabilities for decision gateways are prefilled and auto-normalized to sum to exactly 1.0 (100%).
 */
export function ensureDefaultProbabilities(diagram, changelog = []) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  diagram.nodes.forEach((n) => {
    if (!isExclusiveGatewayNode(n) && !isInclusiveGatewayNode(n)) return;
    const outEdges = diagram.edges.filter((e) => e.source === n.id && !isMessageFlow(e));
    if (outEdges.length < 2) return;

    const rawProbs = outEdges.map((e) => {
      const p = e.probability ?? e.data?.probability;
      return p != null && !isNaN(Number(p)) ? Number(p) : null;
    });

    const statedIndices = [];
    const missingIndices = [];
    rawProbs.forEach((p, idx) => {
      if (p !== null) statedIndices.push(idx);
      else missingIndices.push(idx);
    });

    let adjusted = false;

    if (missingIndices.length > 0) {
      adjusted = true;
      if (statedIndices.length === 0) {
        // No branches stated. Smart guess: if pass/fail, 80/20 else equal share.
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
            const prob = idx === outEdges.length - 1 ? Number((1.0 - runningSum).toFixed(2)) : equalShare;
            runningSum += equalShare;
            e.probability = prob;
            e.data = { ...(e.data || {}), probability: prob, probabilityEstimated: true };
          });
        }
      } else {
        // Some stated, some missing.
        const statedSum = statedIndices.reduce((acc, idx) => acc + rawProbs[idx], 0);
        if (statedSum < 1.0) {
          const remainder = Number((1.0 - statedSum).toFixed(2));
          const share = Number((remainder / missingIndices.length).toFixed(2));
          let running = 0;
          missingIndices.forEach((idx, mIdx) => {
            const isLast = mIdx === missingIndices.length - 1;
            const prob = isLast ? Number((remainder - running).toFixed(2)) : share;
            running += share;
            const e = outEdges[idx];
            e.probability = prob;
            e.data = { ...(e.data || {}), probability: prob, probabilityEstimated: true };
          });
          statedIndices.forEach((idx) => {
            const e = outEdges[idx];
            e.probability = rawProbs[idx];
            if (!e.data) e.data = {};
            e.data.probability = rawProbs[idx];
          });
        } else {
          // Stated sum >= 1.0 already! Need proportional normalization.
          const baseProbs = outEdges.map((e, idx) => (rawProbs[idx] != null && rawProbs[idx] > 0 ? rawProbs[idx] : 0.05));
          const totalBase = baseProbs.reduce((acc, v) => acc + v, 0);
          let runningSum = 0;
          outEdges.forEach((e, idx) => {
            let norm;
            if (idx === outEdges.length - 1) {
              norm = Number((1.0 - runningSum).toFixed(2));
            } else {
              norm = Number((baseProbs[idx] / totalBase).toFixed(2));
              runningSum += norm;
            }
            e.probability = norm;
            e.data = { ...(e.data || {}), probability: norm, probabilityEstimated: true };
          });
        }
      }
      logAutoFix('prefill-decision-probabilities', n.id, { branchCount: outEdges.length });
    } else {
      // All branches have stated probabilities. Check if sum !== 1.0
      const currentSum = rawProbs.reduce((acc, p) => acc + p, 0);
      if (Math.abs(currentSum - 1.0) > 0.001) {
        adjusted = true;
        let runningSum = 0;
        outEdges.forEach((e, idx) => {
          let norm;
          if (idx === outEdges.length - 1) {
            norm = Number((1.0 - runningSum).toFixed(2));
          } else {
            norm = Number((rawProbs[idx] / currentSum).toFixed(2));
            runningSum += norm;
          }
          e.probability = norm;
          e.data = { ...(e.data || {}), probability: norm, probabilityEstimated: true };
        });
        logAutoFix('normalize-decision-probabilities', n.id, { originalSum: currentSum });
      }
    }

    if (adjusted && Array.isArray(changelog)) {
      const cleanGw = stripTrailingPunctuation(getCleanStepName(n, 'Decision')) + '?';
      const desc = sanitizeFriendlyDescription('Adjusted branch split percentages to total 100%');
      changelog.push({
        id: getUniqueNormalizerId('change'),
        type: 'probability-normalize',
        elementId: n.id,
        affectedNodeIds: [n.id],
        stepName: cleanGw,
        description: desc,
        assumed: true,
      });
    }
  });

  return diagram;
}

/**
 * Ensures merge gateways have label: '' and gateway_role: 'merge'.
 * Strips any leftover branch labels (e.g. "Rejoin", "Yes", "No") from edges leaving merge gateways.
 */
export function cleanMergeGatewayLabels(diagram) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return diagram;

  const seqEdges = diagram.edges.filter((e) => !isMessageFlow(e));

  diagram.nodes.forEach((n) => {
    if (!isGatewayNode(n)) return;
    const inSeq = seqEdges.filter((e) => e.target === n.id);
    const isMerge =
      inSeq.length >= 2 ||
      n.role === 'merge' ||
      n.data?.role === 'merge' ||
      n.gateway_role === 'merge' ||
      n.data?.gateway_role === 'merge' ||
      /merge|join/i.test(n.id);

    if (isMerge) {
      n.label = '';
      n.role = 'merge';
      n.gateway_role = 'merge';
      n.structural = true;
      if (!n.data) n.data = {};
      n.data.label = '';
      n.data.role = 'merge';
      n.data.gateway_role = 'merge';
      n.data.structural = true;

      // Check outgoing flows from this merge gateway: remove any leftovers like "Rejoin", "Yes", "No"
      const outSeq = seqEdges.filter((e) => e.source === n.id);
      outSeq.forEach((e) => {
        delete e.label;
        if (e.data) {
          delete e.data.label;
          e.data.probability = 1.0;
        }
      });
    }
  });

  return diagram;
}

/**
 * Auto-normalizes inverted duration ranges (duration_min > duration_max).
 * Swaps them so min <= max.
 */
export function normalizeDurationBounds(diagram, changelog) {
  if (!diagram || !Array.isArray(diagram.nodes)) return;
  for (const n of diagram.nodes) {
    const dMin = n.data?.duration_min ?? n.duration_min;
    const dMax = n.data?.duration_max ?? n.duration_max;
    if (dMin != null && dMax != null && dMin !== '' && dMax !== '') {
      const minNum = Number(dMin);
      const maxNum = Number(dMax);
      if (Number.isFinite(minNum) && Number.isFinite(maxNum)) {
        let finalMin = minNum;
        let finalMax = maxNum;
        if (minNum > maxNum) {
          finalMin = maxNum;
          finalMax = minNum;
          if (n.data) {
            n.data.duration_min = finalMin;
            n.data.duration_max = finalMax;
          }
          if (n.duration_min != null) {
            n.duration_min = finalMin;
            n.duration_max = finalMax;
          }
          const label = n.data?.label || n.label || n.id;
          if (changelog) {
            changelog.push({
              id: `swap-duration-${n.id}`,
              type: 'swap-duration-bounds',
              description: `Adjusted duration range for "${label}" so minimum does not exceed maximum.`,
              targetId: n.id,
            });
          }
        }
        // Clamp duration to [finalMin, finalMax]
        const d = n.data?.duration ?? n.duration;
        if (d != null && d !== '' && !Number.isNaN(Number(d))) {
          const numD = Number(d);
          if (Number.isFinite(numD) && (numD < finalMin || numD > finalMax)) {
            const clamped = Math.min(Math.max(numD, finalMin), finalMax);
            if (n.data) n.data.duration = clamped;
            if (n.duration != null) n.duration = clamped;
          }
        }
      }
    }
  }
}

/**
 * Deduplicates edges with identical source and target.
 */
export function deduplicateEdges(diagram, changelog = []) {
  if (!diagram || !Array.isArray(diagram.edges)) return diagram;
  const seen = new Set();
  const deduped = [];
  diagram.edges.forEach((e) => {
    const key = `${e.source}->${e.target}:${e.flowType || e.type || 'sequence'}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(e);
    } else {
      logAutoFix('deduplicate-edge', e.id, { source: e.source, target: e.target });
    }
  });
  diagram.edges = deduped;
  return diagram;
}

/**
 * Assigns unlaned nodes to the nearest neighbor actor's lane.
 */
export function assignUnlanedNodes(diagram, changelog = []) {
  if (!diagram || !Array.isArray(diagram.nodes)) return diagram;
  const lanes = diagram.nodes.filter(n => n.type === 'lane');
  if (lanes.length === 0) return diagram;
  const defaultLane = lanes[0];
  const nodeMap = new Map(diagram.nodes.map(n => [n.id, n]));
  const edges = Array.isArray(diagram.edges) ? diagram.edges : [];

  diagram.nodes.forEach(n => {
    if (n.type === 'pool' || n.type === 'lane') return;
    if (n.data?.isExternal || n.isExternal) return;
    if (!n.lane && !n.data?.lane) {
      const inEdge = edges.find(e => e.target === n.id);
      const outEdge = edges.find(e => e.source === n.id);
      const neighbor = (inEdge && nodeMap.get(inEdge.source)) || (outEdge && nodeMap.get(outEdge.target));
      const chosenLane = neighbor?.lane || neighbor?.data?.lane || defaultLane.id;
      n.lane = chosenLane;
      if (n.data) n.data.lane = chosenLane;
      logAutoFix('assign-unlaned-node', n.id, { lane: chosenLane });
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
  const changelog = options.preserveChangelog && Array.isArray(diagram.repairChanges) ? [...diagram.repairChanges] : [];

  const MAX_REPAIR_PASSES = 3;
  let pass = 0;

  while (pass < MAX_REPAIR_PASSES) {
    pass++;
    const snapBefore = JSON.stringify({
      nodes: (diagram.nodes || []).map((n) => ({ id: n.id, type: n.type, label: n.label, role: n.role })),
      edges: (diagram.edges || []).map((e) => ({ id: e.id, src: e.source, tgt: e.target, lbl: e.label })),
    });

    // 0. Ensure start and end events exist (nodes only; terminal flows wired after orphan connection)
    deduplicateEdges(diagram, changelog);
    assignUnlanedNodes(diagram, changelog);
    ensureSingleStartAndEndEvents(diagram, { ...options, connectTerminals: false }, changelog);

    // 0b. Remove redundant wait steps after message start
    removeRedundantWaitStepsAfterMessageStart(diagram, changelog);

    // 0c. Ensure referential integrity (missing external pools or dangling edges)
    ensureReferentialIntegrity(diagram, changelog);

    // 0d. Repair cross-pool sequence flows (re-parent internal nodes & convert cross-pool edges to message flows)
    repairCrossPoolSequenceFlows(diagram, changelog);

    // 1. Convert unsupported or same-pool message events
    convertUnsupportedOrSamePoolMessageEvents(diagram, changelog);

    // 1b. Collapse consecutive intermediate catch events and deduplicate external pools
    collapseConsecutiveCatchEvents(diagram, changelog);
    deduplicateExternalPools(diagram, changelog);

    // 2. Collapse any existing consecutive merges
    collapseConsecutiveMerges(diagram, changelog);

    // 2b. Remove degenerate gateway pairs
    removeDegenerateGatewayPairs(diagram, changelog);

    // 3. Add missing branch paths to single-path split gateways (skipping merge gateways!)
    addMissingBranchPaths(diagram, changelog);

    // 4. Drop generic filler tasks
    dropFillerTasks(diagram, userDesc);

    // 5. Remove single-path gateways
    removeSinglePathGateways(diagram, changelog);
    removeDegenerateGatewayPairs(diagram, changelog);

    // 6. Add missing merge points for converging branches
    addMissingMergePoints(diagram, changelog);

    // 7. Collapse consecutive merges that may have formed
    collapseConsecutiveMerges(diagram, changelog);

    // 8. Insert merge gateways before multi-incoming tasks
    fixMultiIncomingTasks(diagram);

    // 9. Insert split gateways after multi-outgoing tasks
    fixMultiOutgoingTasks(diagram);

    // 10. Connect orphan tasks strictly by sequence order (no hardcoded keywords)
    connectOrphanTasks(diagram, userDesc, draftOrder, changelog);

    // 11. Fix rework/failure loopback branches
    fixReworkBranches(diagram);

    // 12. Run Placeholder Guard
    runPlaceholderGuard(diagram, userDesc);

    // 13. Remove any newly-created single-path gateways and degenerate pairs
    removeSinglePathGateways(diagram, changelog);
    removeDegenerateGatewayPairs(diagram, changelog);
    collapseConsecutiveCatchEvents(diagram, changelog);
    deduplicateExternalPools(diagram, changelog);

    // 14. Ensure start and end events (wire terminal nodes)
    ensureSingleStartAndEndEvents(diagram, options, changelog);

    // 15. Ensure reachability
    ensureReachability(diagram);

    // 16. Ensure task lanes
    ensureTaskLanes(diagram, 'Staff', changelog);

    // 17. Ensure decision probabilities are prefilled and auto-normalized to 100%
    ensureDefaultProbabilities(diagram, changelog);

    // 18. Re-check multi-incoming tasks that might have formed from reachability
    fixMultiIncomingTasks(diagram);
    fixMultiOutgoingTasks(diagram);
    collapseConsecutiveMerges(diagram, changelog);
    removeSinglePathGateways(diagram, changelog);

    // 19. Clean merge gateway labels and leftover branch labels on merge flows
    cleanMergeGatewayLabels(diagram);

    // 19b. Auto-normalize duration bounds so min <= max
    normalizeDurationBounds(diagram, changelog);

    // 19c. Final pass cross-pool sequence flow repair
    repairCrossPoolSequenceFlows(diagram, changelog);

    // 20. Final Placeholder Guard check
    runPlaceholderGuard(diagram, userDesc);

    const snapAfter = JSON.stringify({
      nodes: (diagram.nodes || []).map((n) => ({ id: n.id, type: n.type, label: n.label, role: n.role })),
      edges: (diagram.edges || []).map((e) => ({ id: e.id, src: e.source, tgt: e.target, lbl: e.label })),
    });

    if (snapBefore === snapAfter) {
      break;
    }
  }

  // Deduplicate changelog entries by description
  const seenDesc = new Set();
  const dedupedChanges = [];
  for (const c of changelog) {
    if (!seenDesc.has(c.description)) {
      seenDesc.add(c.description);
      dedupedChanges.push(c);
    }
  }

  diagram.repairChanges = dedupedChanges;

  return diagram;
}

/**
 * Reverts a single repair change and returns the restored diagram.
 */
export function undoRepairChange(diagram, changeId) {
  if (!diagram || !Array.isArray(diagram.repairChanges)) return diagram;
  const changeIndex = diagram.repairChanges.findIndex((c) => c.id === changeId);
  if (changeIndex === -1) return diagram;

  const change = diagram.repairChanges[changeIndex];
  if (change && change.undoSnapshot) {
    diagram.nodes = JSON.parse(JSON.stringify(change.undoSnapshot.nodes));
    diagram.edges = JSON.parse(JSON.stringify(change.undoSnapshot.edges));
    if (change.undoSnapshot.resources) {
      diagram.resources = JSON.parse(JSON.stringify(change.undoSnapshot.resources));
    }
  }

  // Remove this change from changelog
  diagram.repairChanges.splice(changeIndex, 1);
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

  const lang = options?.lang || options?.preferredLanguage || options?.intakeLanguage || 'en';
  const startLbl = lang === 'ur' ? 'شروع' : (lang === 'ur-roman' ? 'Shuru' : 'Start');
  const endLbl = lang === 'ur' ? 'ختم' : (lang === 'ur-roman' ? 'Khatam' : 'End');

  const roles = draft.roles || ['Customer', 'Staff'];
  const activities = draft.activities || draft.steps || [];
  const rawDecisions = draft.decisions || draft.branches || [];
  const order = draft.order || [];

  // Deduplicate repeated conditions: if user/AI repeats the same condition, reuse the decision
  const decisions = [];
  const seenDecisionQuestions = new Map();
  rawDecisions.forEach((dec) => {
    const qNorm = (dec.question || dec.label || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!qNorm) {
      decisions.push(dec);
      return;
    }
    if (seenDecisionQuestions.has(qNorm)) {
      logAutoFix('reuse-repeated-condition', dec.id || 'decision', {
        question: dec.question,
        reusedId: seenDecisionQuestions.get(qNorm).id,
      });
    } else {
      seenDecisionQuestions.set(qNorm, dec);
      decisions.push(dec);
    }
  });

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
    label: startLbl,
    pool: poolId,
    lane: roles[0] || 'Customer',
    origin: 'structural',
    data: { label: startLbl, origin: 'structural' },
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

  const reworkPattern = /(fail|failed|re-?do|re-?work|defect|error|incorrect|invalid|re-?try|re-?review|wapas|dobara|kharab|theek nahi)/i;

  const afterActivitySet = new Set(decisions.map((d) => d.afterActivityId || d.afterStepId).filter(Boolean));
  const reworkStepIds = new Set();
  const branchEntryStepIds = new Set();

  decisions.forEach((dec) => {
    (dec.branches || dec.options || []).forEach((b) => {
      const isRework = reworkPattern.test(b.label || '') || Boolean(b.isRework) || Boolean(b.loopsTo) || Boolean(b.returnsTo);
      if (isRework) {
        (b.steps || []).forEach((s) => reworkStepIds.add(s));
      }
      if (b.steps && b.steps.length > 0) {
        branchEntryStepIds.add(b.steps[0]);
      }
    });
  });

  if (sequenceSteps.length > 0) {
    edges.push({
      id: `seq_${startId}_${sequenceSteps[0]}`,
      source: startId,
      target: sequenceSteps[0],
      flowType: 'sequence',
      data: {},
    });

    for (let i = 0; i < sequenceSteps.length - 1; i++) {
      const currId = sequenceSteps[i];
      const nextId = sequenceSteps[i + 1];

      // If currId is followed by a decision, or is inside a rework loop, or nextId is entered from a branch split,
      // do not blindly chain currId -> nextId
      if (afterActivitySet.has(currId) || reworkStepIds.has(currId) || branchEntryStepIds.has(nextId)) {
        continue;
      }

      edges.push({
        id: `seq_${currId}_${nextId}`,
        source: currId,
        target: nextId,
        flowType: 'sequence',
        data: {},
      });
    }
  }

  // End Event
  const endId = 'end_event_1';
  nodes.push({
    id: endId,
    type: 'end-event',
    label: endLbl,
    pool: poolId,
    lane: roles[0] || 'Customer',
    origin: 'structural',
    data: { label: endLbl, origin: 'structural' },
  });

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
      // Connect afterId -> splitId
      const existingOut = edges.find((e) => e.source === afterId && !isMessageFlow(e));
      let nextId = null;
      if (existingOut) {
        nextId = existingOut.target;
        existingOut.target = splitId;
      } else {
        edges.push({
          id: `seq_${afterId}_${splitId}`,
          source: afterId,
          target: splitId,
          flowType: 'sequence',
          data: {},
        });
        const afterIdx = sequenceSteps.indexOf(afterId);
        nextId = afterIdx !== -1
          ? sequenceSteps.slice(afterIdx + 1).find((s) => !reworkStepIds.has(s))
          : null;
      }

      // Connect branches
      const branches = dec.branches || dec.options || [];
      branches.forEach((b, bIdx) => {
        const bLabel = b.label || `Option ${bIdx + 1}`;
        const bSteps = b.steps || [];
        const isRework = reworkPattern.test(bLabel) || Boolean(b.isRework) || Boolean(b.loopsTo) || Boolean(b.returnsTo);
        const loopTargetId = b.loopsTo || b.returnsTo || afterId;

        if (isRework) {
          if (bSteps.length > 0 && actMap.has(bSteps[0])) {
            edges.push({
              id: `seq_${splitId}_${bSteps[0]}`,
              source: splitId,
              target: bSteps[0],
              flowType: 'sequence',
              data: { label: bLabel, probability: b.probability || null, isRework: true },
            });
            for (let k = 0; k < bSteps.length - 1; k++) {
              if (actMap.has(bSteps[k + 1])) {
                edges.push({
                  id: `seq_${bSteps[k]}_${bSteps[k + 1]}`,
                  source: bSteps[k],
                  target: bSteps[k + 1],
                  flowType: 'sequence',
                  data: {},
                });
              }
            }
            const lastBranchStep = bSteps[bSteps.length - 1];
            edges.push({
              id: `seq_${lastBranchStep}_${loopTargetId}_rework`,
              source: lastBranchStep,
              target: loopTargetId,
              flowType: 'sequence',
              data: { isRework: true },
            });
          } else {
            // Direct rework loopback from split gateway
            edges.push({
              id: `seq_${splitId}_${loopTargetId}_rework_${bIdx}`,
              source: splitId,
              target: loopTargetId,
              flowType: 'sequence',
              data: { label: bLabel, probability: b.probability || null, isRework: true },
            });
          }
        } else {
          // Normal branch
          if (bSteps.length > 0 && actMap.has(bSteps[0])) {
            edges.push({
              id: `seq_${splitId}_${bSteps[0]}`,
              source: splitId,
              target: bSteps[0],
              flowType: 'sequence',
              data: { label: bLabel, probability: b.probability || null },
            });
            for (let k = 0; k < bSteps.length - 1; k++) {
              if (actMap.has(bSteps[k + 1])) {
                edges.push({
                  id: `seq_${bSteps[k]}_${bSteps[k + 1]}`,
                  source: bSteps[k],
                  target: bSteps[k + 1],
                  flowType: 'sequence',
                  data: {},
                });
              }
            }

            const lastBranchStep = bSteps[bSteps.length - 1];
            const decAfter = decisions.find((d) => (d.afterActivityId || d.afterStepId) === lastBranchStep);
            if (!decAfter && !edges.some((e) => e.source === lastBranchStep && !isMessageFlow(e))) {
              const siblingSteps = new Set();
              (dec.branches || []).forEach((otherB) => {
                (otherB.steps || []).forEach((s) => siblingSteps.add(s));
              });
              const lastIdx = sequenceSteps.indexOf(lastBranchStep);
              const nextDownstream = lastIdx !== -1
                ? sequenceSteps.slice(lastIdx + 1).find((id) => !siblingSteps.has(id) && !reworkStepIds.has(id))
                : null;
              if (nextDownstream) {
                edges.push({
                  id: getUniqueNormalizerId(`seq_${lastBranchStep}_${nextDownstream}`),
                  source: lastBranchStep,
                  target: nextDownstream,
                  flowType: 'sequence',
                  data: {},
                });
              } else {
                edges.push({
                  id: getUniqueNormalizerId(`seq_${lastBranchStep}_${endId}`),
                  source: lastBranchStep,
                  target: endId,
                  flowType: 'sequence',
                  data: {},
                });
              }
            }
          } else if (nextId) {
            // Empty / direct branch to nextId
            edges.push({
              id: `seq_${splitId}_${nextId}_${bIdx}`,
              source: splitId,
              target: nextId,
              flowType: 'sequence',
              data: { label: bLabel, probability: b.probability || null },
            });
          }
        }
      });
    }
  });

  const lastSeqStep = sequenceSteps[sequenceSteps.length - 1];
  if (lastSeqStep && !edges.some((e) => e.source === lastSeqStep && !isMessageFlow(e))) {
    edges.push({
      id: getUniqueNormalizerId(`seq_${lastSeqStep}_${endId}`),
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
  const lang = options?.lang || options?.preferredLanguage || options?.intakeLanguage || 'en';
  const startLbl = lang === 'ur' ? 'شروع' : (lang === 'ur-roman' ? 'Shuru' : 'Start');
  const endLbl = lang === 'ur' ? 'ختم' : (lang === 'ur-roman' ? 'Khatam' : 'End');

  let steps = [];
  let inputResources = [];

  if (Array.isArray(extractedSteps) && extractedSteps.length > 0) {
    steps = extractedSteps;
  } else if (extractedSteps && typeof extractedSteps === 'object') {
    if (Array.isArray(extractedSteps.resources)) {
      inputResources = extractedSteps.resources;
    }
    if (Array.isArray(extractedSteps.activities) && extractedSteps.activities.length > 0) {
      steps = extractedSteps.activities;
    } else if (Array.isArray(extractedSteps.steps) && extractedSteps.steps.length > 0) {
      steps = extractedSteps.steps;
    } else if (Array.isArray(extractedSteps.pools) && extractedSteps.pools.length > 0) {
      extractedSteps.pools.forEach((pool) => {
        (pool.steps || []).forEach((s) => {
          steps.push({
            ...s,
            role: s.lane || s.resource || pool.role || pool.name || 'Staff',
          });
        });
      });
    } else if (Array.isArray(extractedSteps.nodes)) {
      steps = extractedSteps.nodes
        .filter((n) => n.type === 'task')
        .map((n) => ({
          id: n.id,
          label: n.data?.label || n.label,
          role: n.lane || n.data?.lane || n.data?.resource || 'Staff',
          duration: n.data?.duration ?? n.duration ?? 5,
          duration_unit: n.data?.duration_unit || n.duration_unit || 'minutes',
          resource: n.data?.resource || n.resource,
          resources: n.data?.resources || n.resources,
        }));
    }
  }

  // If no steps provided from structured input, try extracting sentences from userDescription
  if (steps.length === 0 && typeof userDescription === 'string' && userDescription.trim()) {
    const rawSentences = userDescription
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 8);

    if (rawSentences.length > 0) {
      steps = rawSentences.map((sentence, idx) => {
        let role = 'Staff';
        const roleMatch = sentence.match(/^(?:the|an|a)\s+([a-zA-Z\s]+?)\s+(?:checks|reviews|performs|processes|examines|handles|approves|sends|receives|completes|verifies|runs|opens|prepares|creates|dispatches|inspects)\b/i);
        if (roleMatch && roleMatch[1].trim().length < 30) {
          const rawR = roleMatch[1].trim();
          role = rawR.charAt(0).toUpperCase() + rawR.slice(1);
        }
        return {
          id: `step_${idx + 1}`,
          label: sentence.replace(/[.!?]+$/, ''),
          role,
          duration: 5,
          duration_unit: 'minutes',
          kept: true,
          origin: 'stated',
        };
      });
    }
  }

  if (steps.length === 0) {
    steps = [
      { label: 'Receive Request', role: 'Staff', duration: 5, kept: true, origin: 'stated' },
      { label: 'Process Request', role: 'Staff', duration: 5, kept: true, origin: 'stated' },
      { label: 'Complete Process', role: 'Staff', duration: 5, kept: true, origin: 'stated' },
    ];
  }

  const poolId = 'pool_linear';
  const isExternalRole = (role) => /external|third_party/i.test(String(role || '').trim());

  // Collect all roles and staff roles
  const rolesSet = new Set();
  const staffRolesSet = new Set();

  steps.forEach((step) => {
    const r = (typeof step === 'object' && step.role) ? step.role : 'Staff';
    rolesSet.add(r);
    if (!isExternalRole(r)) {
      staffRolesSet.add(r);
    }
  });

  // If no staff role found at all, ensure at least one task is handled by Staff
  if (staffRolesSet.size === 0) {
    staffRolesSet.add('Staff');
    rolesSet.add('Staff');
  }

  const allRoles = Array.from(rolesSet);
  const primaryRole = allRoles[0] || 'Staff';

  const nodes = [
    {
      id: poolId,
      type: 'pool',
      label: 'Main Process',
      data: { label: 'Main Process' },
    },
  ];

  // Add lanes for all roles
  allRoles.forEach((r, idx) => {
    nodes.push({
      id: `lane_${r.toLowerCase().replace(/[^a-z0-9_]/g, '_')}_${idx}`,
      type: 'lane',
      label: r,
      pool: poolId,
      data: { label: r },
    });
  });

  // Start event
  nodes.push({
    id: 'start_linear',
    type: 'start-event',
    label: startLbl,
    pool: poolId,
    lane: primaryRole,
    origin: 'structural',
    data: { label: startLbl, origin: 'structural' },
  });

  const edges = [];
  let prevId = 'start_linear';

  steps.forEach((step, idx) => {
    const taskId = `task_lin_${idx + 1}`;
    const taskLabel = typeof step === 'string' ? step : (step.label || step.name || `Step ${idx + 1}`);
    let taskRole = (typeof step === 'object' && step.role) ? step.role : primaryRole;

    // If all steps were customer and we had to add Staff, make non-first step Staff
    if (staffRolesSet.has('Staff') && !allRoles.includes('Staff') && idx > 0) {
      taskRole = 'Staff';
    }

    const duration = (typeof step === 'object' && step.duration != null)
      ? Number(step.duration)
      : (typeof step === 'object' && step.duration_min != null ? Number(step.duration_min) : 5);
    const durationUnit = (typeof step === 'object' && step.duration_unit) ? step.duration_unit : 'minutes';

    const isExt = isExternalRole(taskRole);
    const taskResource = isExt ? null : (step.resource || taskRole);
    const taskResources = isExt
      ? {}
      : (step.resources && Object.keys(step.resources).length > 0 ? step.resources : { [taskResource]: 1 });

    nodes.push({
      id: taskId,
      type: 'task',
      label: taskLabel,
      pool: poolId,
      lane: taskRole,
      origin: step.origin || 'stated',
      kept: true,
      data: {
        label: taskLabel,
        origin: step.origin || 'stated',
        kept: true,
        duration,
        duration_unit: durationUnit,
        duration_min: step.duration_min != null ? Number(step.duration_min) : null,
        duration_max: step.duration_max != null ? Number(step.duration_max) : null,
        resource: taskResource,
        resources: taskResources,
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
    label: endLbl,
    pool: poolId,
    lane: allRoles[allRoles.length - 1] || primaryRole,
    origin: 'structural',
    data: { label: endLbl, origin: 'structural' },
  });

  edges.push({
    id: `seq_${prevId}_${endId}`,
    source: prevId,
    target: endId,
    flowType: 'sequence',
    data: {},
  });

  // Resources
  const resources = Array.from(staffRolesSet).map((role) => {
    const existing = inputResources.find(
      (r) => (r.name && r.name.toLowerCase() === role.toLowerCase()) || (r.id && r.id.toLowerCase() === role.toLowerCase())
    );
    if (existing) return existing;
    return {
      id: role,
      name: role,
      type: 'staff',
      quantity: 1,
      quantitySource: 'assumed',
      costSource: 'assumed',
      hours_per_day: 8,
      working_days_per_month: 22,
      monthly_salary: 60000,
    };
  });

  const rawDiagram = {
    type: 'diagram',
    summary: 'Simplified model created, you can add detail',
    note: 'Simplified model created, you can add detail',
    nodes,
    edges,
    resources,
  };

  logAutoFix('build-linear-fallback', 'fallback', { stepCount: steps.length });

  return rawDiagram;
}
