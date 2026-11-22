/**
 * shared/postGenerationValidator.js
 *
 * Post-generation validator and auto-repair module for AI-generated BPMN diagrams.
 * Enforces structural validity and event semantics before diagrams are rendered.
 *
 * Rules:
 *  1. Exactly ONE start event by default. If multiple starts exist and were not
 *     confirmed independent, flag as an error and collapse into the main start.
 *     Start events have 0 incoming sequence flows. End events have 0 outgoing flows.
 *  2. Split gateways have >= 2 outgoing flows, each with a condition label, and a
 *     matching downstream merge gateway.
 *  3. A gateway with 1 incoming and 1 outgoing flow is invalid (remove or bypass).
 *  4. No element name may match an ID pattern (auto-generate human-readable names).
 *  5. Referential integrity: all edge source/target IDs must exist in nodes.
 *     If an edge points to a missing external pool, create the pool; if it points
 *     to a non-existent step, remove the edge.
 *  6. Every message event (start, catch, throw, end) must be connected to an
 *     external pool via a message flow.
 *  7. If multiple start events were confirmed, each must lead to a disjoint reachable
 *     subgraph with its own end event (no merging into one chained sequence).
 *  8. Redundant wait steps following message start events must be detected and removed.
 *  9. Activities from user description must specify a duration (missing-duration error).
 *     Structural activities added purely for BPMN satisfaction are exempt.
 * 10. Yes/No branch consistency (No must not route into Yes work).
 */

import { normalizeAndRepairBpmn, repairCrossPoolSequenceFlows } from './deterministicNormalizer.js';
import { areExternalPoolAliases } from './stepListHelper.js';

function isStartEvent(type) {
  if (!type || typeof type !== 'string') return false;
  return type === 'start-event' || type.endsWith('-start-event');
}

function isEndEvent(type) {
  if (!type || typeof type !== 'string') return false;
  return type === 'end-event' || type.endsWith('-end-event');
}

function isGateway(node) {
  if (!node || typeof node !== 'object') return false;
  const t = String(node.type || '');
  return t.includes('gateway') || node.data?.gateway_type != null;
}

function isExclusiveGateway(node) {
  if (!node || typeof node !== 'object') return false;
  const t = String(node.type || '');
  return t === 'exclusive-gateway' || node.data?.gateway_type === 'exclusive';
}

function isParallelGateway(node) {
  if (!node || typeof node !== 'object') return false;
  const t = String(node.type || '');
  return t === 'parallel-gateway' || node.data?.gateway_type === 'parallel';
}

function isTask(node) {
  if (!node || typeof node !== 'object') return false;
  const t = String(node.type || '');
  return t === 'task' || t.endsWith('-task');
}

function isContainer(node) {
  if (!node || typeof node !== 'object') return false;
  return node.type === 'pool' || node.type === 'lane';
}

function getNodeLabel(node) {
  if (!node) return '';
  return String(node.data?.label ?? node.label ?? node.id ?? '').trim();
}

function setNodeLabel(node, label) {
  node.label = label;
  if (!node.data) node.data = {};
  node.data.label = label;
}

const ID_LIKE_PATTERN = /^(gw_|task_|step_|node_|end_|start_|flow_|seq_|activity_).+|_\d+$|^gw_join_|^gw_split_/i;

function cleanIdToHumanLabel(rawId) {
  if (!rawId) return 'Step';
  let cleaned = String(rawId)
    .replace(/^(gw_join_|gw_split_|gw_|task_|step_|node_|activity_|start_|end_|pool_ext_|pool_)/i, '')
    .replace(/_\d+$/g, '')
    .replace(/_/g, ' ')
    .trim();

  if (!cleaned) return 'Step';
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Validates and repairs an AI-generated BPMN diagram.
 *
 * @param {object} rawDiagram - { nodes: Array, edges: Array, resources?: Array }
 * @param {object} [options] - configuration options
 * @returns {{
 *   isValid: boolean,
 *   errors: string[],
 *   warnings: Array<{ rule: string, message: string, nodeId?: string, edgeId?: string }>,
 *   violations: Array<{ ruleId: number, rule: string, message: string, elementId?: string }>,
 *   repaired: object
 * }}
 */
export function validatePostGeneration(rawDiagram, options = {}) {
  const errors = [];
  const warnings = [];
  const violations = [];

  if (!rawDiagram || !Array.isArray(rawDiagram.nodes) || !Array.isArray(rawDiagram.edges)) {
    return {
      isValid: false,
      errors: ['Diagram must contain valid nodes and edges arrays.'],
      warnings: [],
      violations: [{ ruleId: 0, rule: 'schema', message: 'Missing nodes or edges array' }],
      repaired: rawDiagram || { nodes: [], edges: [] },
    };
  }

  // Deep clone to produce repaired diagram without mutating input
  const repaired = JSON.parse(JSON.stringify(rawDiagram));
  repairCrossPoolSequenceFlows(repaired);
  let nodes = repaired.nodes;
  let edges = repaired.edges;

  function getSeqInEdges(nodeId) {
    return edges.filter((e) => e.target === nodeId && e.flowType !== 'message');
  }

  function getSeqOutEdges(nodeId) {
    return edges.filter((e) => e.source === nodeId && e.flowType !== 'message');
  }

  function getSeqEdges() {
    return edges.filter((e) => e.flowType !== 'message');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 5a: REFERENTIAL INTEGRITY (Check early so graph operations are safe)
  // ──────────────────────────────────────────────────────────────────────────
  let nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const invalidEdgeIds = new Set();

  edges.forEach((e) => {
    const hasSource = nodeMap.has(e.source);
    const hasTarget = nodeMap.has(e.target);

    if (!hasSource || !hasTarget) {
      if (e.flowType === 'message') {
        const missingId = !hasSource ? e.source : e.target;
        const cleanPoolName = cleanIdToHumanLabel(missingId);
        const newPool = {
          id: missingId,
          type: 'pool',
          label: cleanPoolName,
          origin: 'structural',
          data: { label: cleanPoolName, isExternal: true, origin: 'structural' },
        };
        nodes.push(newPool);
        nodeMap.set(missingId, newPool);
        warnings.push({
          rule: 'create-missing-external-pool',
          message: `Created missing external pool "${cleanPoolName}" for message flow "${e.id}".`,
          nodeId: missingId,
        });
        return;
      }
      const msg = `Edge "${e.id}" references missing node(s): source=${e.source} (exists: ${hasSource}), target=${e.target} (exists: ${hasTarget}).`;
      errors.push(msg);
      violations.push({ ruleId: 5, rule: 'referential-integrity', message: msg, elementId: e.id });
      invalidEdgeIds.add(e.id);
    }
  });

  if (invalidEdgeIds.size > 0) {
    edges = edges.filter((e) => !invalidEdgeIds.has(e.id));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 1: START AND END EVENT INVARIANTS & SINGLE START BY DEFAULT
  // ──────────────────────────────────────────────────────────────────────────
  const startNodes = nodes.filter((n) => isStartEvent(n.type));
  const confirmedStarts = new Set(
    (options.confirmedIndependentTriggers || options.confirmedStarts || []).map((s) => String(s).toLowerCase().trim())
  );

  // Exactly ONE start event by default
  if (startNodes.length > 1) {
    const unconfirmedStarts = startNodes.filter((s) => {
      const lbl = getNodeLabel(s).toLowerCase().trim();
      return !confirmedStarts.has(lbl) && !confirmedStarts.has(s.id.toLowerCase().trim());
    });
    if (unconfirmedStarts.length > 0) {
      const msg = `Multiple start events detected (${startNodes.length}). By default, SPOT processes have exactly one start event.`;
      errors.push(msg);
      violations.push({ ruleId: 1, rule: 'single-start-event', message: msg, elementId: startNodes[1].id });
    }
  }

  // Start events have 0 incoming sequence flows
  startNodes.forEach((startNode) => {
    const inSeq = getSeqInEdges(startNode.id);
    if (inSeq.length > 0) {
      const msg = `Start event "${getNodeLabel(startNode)}" (${startNode.id}) has ${inSeq.length} incoming sequence flow(s). Start events must not have incoming flows.`;
      errors.push(msg);
      violations.push({ ruleId: 1, rule: 'start-no-incoming', message: msg, elementId: startNode.id });

      const removedEdgeIds = new Set(inSeq.map((e) => e.id));
      edges = edges.filter((e) => !removedEdgeIds.has(e.id));
      warnings.push({
        rule: 'start-no-incoming-repair',
        message: `Removed ${inSeq.length} invalid incoming sequence flow(s) into start event "${startNode.id}".`,
        nodeId: startNode.id,
      });
    }
  });

  // End events have 0 outgoing sequence flows
  const endNodes = nodes.filter((n) => isEndEvent(n.type));
  endNodes.forEach((endNode) => {
    const outSeq = getSeqOutEdges(endNode.id);
    if (outSeq.length > 0) {
      const msg = `End event "${getNodeLabel(endNode)}" (${endNode.id}) has ${outSeq.length} outgoing sequence flow(s). End events must not have outgoing flows.`;
      errors.push(msg);
      violations.push({ ruleId: 1, rule: 'end-no-outgoing', message: msg, elementId: endNode.id });

      const removedEdgeIds = new Set(outSeq.map((e) => e.id));
      edges = edges.filter((e) => !removedEdgeIds.has(e.id));
      warnings.push({
        rule: 'end-no-outgoing-repair',
        message: `Removed ${outSeq.length} invalid outgoing sequence flow(s) from end event "${endNode.id}".`,
        nodeId: endNode.id,
      });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 8a: REDUNDANT WAIT STEPS AFTER MESSAGE START
  // ──────────────────────────────────────────────────────────────────────────
  startNodes.forEach((sn) => {
    if (sn.type === 'message-start-event') {
      const outSeq = getSeqOutEdges(sn.id);
      outSeq.forEach((oe) => {
        const targetNode = nodes.find((n) => n.id === oe.target);
        if (targetNode && isTask(targetNode)) {
          const lbl = getNodeLabel(targetNode);
          if (
            /^(receive|wait\s+for|await|take|accept)\b.*(message|notice|trigger|input|request|item|order|intake|delivery|arrival|submission|payload)/i.test(lbl) ||
            /^(receive\s+order|take\s+order|wait\s+for\s+order|await\s+order)/i.test(lbl)
          ) {
            const msg = `Task "${lbl}" (${targetNode.id}) is a redundant wait step immediately following a message start event.`;
            errors.push(msg);
            violations.push({ ruleId: 8, rule: 'redundant-wait-after-start', message: msg, elementId: targetNode.id });

            // Auto-repair: bypass the redundant wait task
            const targetOutSeq = getSeqOutEdges(targetNode.id);
            if (targetOutSeq.length > 0) {
              const nextTarget = targetOutSeq[0].target;
              oe.target = nextTarget;
              edges = edges.filter((e) => e.id !== targetOutSeq[0].id);
              nodes = nodes.filter((n) => n.id !== targetNode.id);
              warnings.push({
                rule: 'remove-redundant-wait-step',
                message: `Removed redundant wait task "${lbl}" after message start.`,
                nodeId: targetNode.id,
              });
            }
          }
        }
      });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 8b: CONSECUTIVE INTERMEDIATE CATCH EVENTS
  // ──────────────────────────────────────────────────────────────────────────
  let consecutiveCatchFound = true;
  while (consecutiveCatchFound) {
    consecutiveCatchFound = false;
    const currentSeq = getSeqEdges();
    for (const e of currentSeq) {
      const srcNode = nodes.find((n) => n.id === e.source);
      const tgtNode = nodes.find((n) => n.id === e.target);
      const isCatch = (n) => n && (n.type === 'message-intermediate-catch' || n.type === 'timer-intermediate-catch' || n.type === 'intermediate-catch');
      if (isCatch(srcNode) && isCatch(tgtNode)) {
        consecutiveCatchFound = true;
        const oldLbl = getNodeLabel(tgtNode);
        let newLbl = oldLbl;
        if (/^(wait\s+for|await|receive|take)\b/i.test(newLbl)) {
          newLbl = newLbl.replace(/^(wait\s+for\s+|await\s+|receive\s+|take\s+)/i, 'Process ');
        } else if (!/^(process|handle|inspect|record|store)\b/i.test(newLbl)) {
          newLbl = `Process ${newLbl}`;
        }
        newLbl = newLbl.charAt(0).toUpperCase() + newLbl.slice(1);

        tgtNode.type = 'task';
        tgtNode.label = newLbl;
        if (!tgtNode.data) tgtNode.data = {};
        tgtNode.data.type = 'task';
        tgtNode.data.label = newLbl;
        warnings.push({
          rule: 'collapse-consecutive-catch-repair',
          message: `Converted consecutive waiting step "${oldLbl}" into active task "${newLbl}".`,
          nodeId: tgtNode.id,
        });
        break;
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 3: GATEWAY WITH 1 IN AND 1 OUT IS INVALID (Bypass early)
  // ──────────────────────────────────────────────────────────────────────────
  let singlePathGatewaysFound = true;
  while (singlePathGatewaysFound) {
    singlePathGatewaysFound = false;
    const currentGateways = nodes.filter((n) => isGateway(n));

    for (const gw of currentGateways) {
      const inSeq = getSeqInEdges(gw.id);
      const outSeq = getSeqOutEdges(gw.id);

      if (inSeq.length === 1 && outSeq.length === 1) {
        singlePathGatewaysFound = true;
        const msg = `Gateway "${getNodeLabel(gw)}" (${gw.id}) is single-path (1 incoming, 1 outgoing flow). Gateways must be splits or merges.`;
        errors.push(msg);
        violations.push({ ruleId: 3, rule: 'no-single-path-gateway', message: msg, elementId: gw.id });

        const inEdge = inSeq[0];
        const outEdge = outSeq[0];

        const directEdgeId = `seq_bypass_${inEdge.source}_${outEdge.target}_${Date.now()}`;
        edges.push({
          id: directEdgeId,
          source: inEdge.source,
          target: outEdge.target,
          flowType: 'sequence',
          data: {
            label: outEdge.data?.label || outEdge.label || inEdge.data?.label || inEdge.label || undefined,
            probability: outEdge.data?.probability ?? inEdge.data?.probability ?? undefined,
          },
        });

        edges = edges.filter((e) => e.id !== inEdge.id && e.id !== outEdge.id);
        nodes = nodes.filter((n) => n.id !== gw.id);

        warnings.push({
          rule: 'bypass-single-path-gateway',
          message: `Removed single-path gateway "${gw.id}" and connected "${inEdge.source}" directly to "${outEdge.target}".`,
          nodeId: gw.id,
        });
        break;
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 2: SPLIT GATEWAY HAS >= 2 OUTGOING FLOWS WITH LABELS & MATCHING MERGE
  // ──────────────────────────────────────────────────────────────────────────
  const gateways = nodes.filter((n) => isGateway(n));
  gateways.forEach((gw) => {
    const inSeq = getSeqInEdges(gw.id);
    const outSeq = getSeqOutEdges(gw.id);

    if (outSeq.length >= 2) {
      // 1. Verify outgoing branch labels
      outSeq.forEach((edge, idx) => {
        const lbl = String(edge.data?.label || edge.label || '').trim();
        const isDefault = Boolean(edge.data?.isDefault || edge.isDefault);
        if (!lbl && !isDefault) {
          const msg = `Split gateway "${getNodeLabel(gw)}" (${gw.id}) has an unlabeled branch to "${edge.target}". Every branch must define a condition label.`;
          errors.push(msg);
          violations.push({ ruleId: 2, rule: 'split-branch-labeled', message: msg, elementId: edge.id });

          const fallbackLabel = idx === 0 ? 'Yes' : (idx === 1 ? 'No' : `Option ${idx + 1}`);
          if (!edge.data) edge.data = {};
          edge.data.label = fallbackLabel;
          edge.label = fallbackLabel;
          warnings.push({
            rule: 'split-branch-labeled-repair',
            message: `Assigned label "${fallbackLabel}" to unlabeled branch on split gateway "${gw.id}".`,
            edgeId: edge.id,
          });
        }
      });

      // 2. Verify downstream merge gateway exists
      const branchPaths = outSeq.map((edge) => {
        const visited = new Set();
        const queue = [edge.target];
        const reachable = new Set();

        while (queue.length > 0) {
          const curr = queue.shift();
          if (visited.has(curr)) continue;
          visited.add(curr);
          reachable.add(curr);

          const outgoing = edges.filter((e) => e.source === curr && e.flowType !== 'message');
          for (const nextEdge of outgoing) {
            queue.push(nextEdge.target);
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
        .map(([id]) => nodes.find((n) => n.id === id))
        .filter(Boolean);

      const hasMergeGateway = commonNodes.some(
        (n) => isGateway(n) && (n.gateway_role === 'merge' || getSeqInEdges(n.id).length >= 2)
      );

      const allBranchesTerminal = outSeq.every((edge) => {
        const targetNode = nodes.find((n) => n.id === edge.target);
        return targetNode && isEndEvent(targetNode.type);
      });

      if (!hasMergeGateway && !allBranchesTerminal && commonNodes.length > 0) {
        const firstCommon = commonNodes[0];
        const msg = `Split gateway "${getNodeLabel(gw)}" (${gw.id}) does not have a corresponding merge gateway downstream (branches converge directly into "${getNodeLabel(firstCommon)}").`;
        errors.push(msg);
        violations.push({ ruleId: 2, rule: 'split-matching-merge', message: msg, elementId: gw.id });

        const gwType = isParallelGateway(gw) ? 'parallel-gateway' : 'exclusive-gateway';
        const cleanGwId = String(gw.id).replace(/^gw_split_/, '').replace(/[^a-zA-Z0-9_]/g, '_');
        const mergeId = `gw_merge_${cleanGwId}`;
        const mergeNode = {
          id: mergeId,
          type: gwType,
          label: '',
          gateway_role: 'merge',
          pool: gw.pool || firstCommon.pool || null,
          lane: firstCommon.lane || gw.lane || null,
          origin: 'structural',
          data: {
            label: '',
            gateway_type: isParallelGateway(gw) ? 'parallel' : 'exclusive',
            gateway_role: 'merge',
            origin: 'structural',
          },
        };
        nodes.push(mergeNode);

        const incomingToCommon = edges.filter((e) => e.target === firstCommon.id && e.flowType !== 'message');
        incomingToCommon.forEach((edge) => {
          edge.target = mergeId;
        });

        edges.push({
          id: `seq_${mergeId}_to_${firstCommon.id}`,
          source: mergeId,
          target: firstCommon.id,
          flowType: 'sequence',
          data: {},
        });

        warnings.push({
          rule: 'insert-matching-merge-repair',
          message: `Inserted merge gateway "${mergeId}" before "${firstCommon.id}" to properly close split "${gw.id}".`,
          nodeId: mergeId,
        });
      }
    } else if (outSeq.length < 2 && inSeq.length <= 1 && (isExclusiveGateway(gw) || gw.type?.includes('gateway'))) {
      const msg = `Split gateway "${getNodeLabel(gw)}" (${gw.id}) has fewer than 2 outgoing flows (${outSeq.length}). Every split gateway must define at least 2 branches.`;
      errors.push(msg);
      violations.push({ ruleId: 2, rule: 'split-min-two-branches', message: msg, elementId: gw.id });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 2b: DEGENERATE SPLIT-MERGE PAIRS (0 tasks on all branches)
  // ──────────────────────────────────────────────────────────────────────────
  let degeneratePairFound = true;
  while (degeneratePairFound) {
    degeneratePairFound = false;
    const currentGateways = nodes.filter((n) => isGateway(n));
    for (const splitGw of currentGateways) {
      const outSeq = getSeqOutEdges(splitGw.id);
      if (outSeq.length < 2) continue;
      const firstTarget = outSeq[0].target;
      if (outSeq.every((e) => e.target === firstTarget)) {
        const targetNode = nodes.find((n) => n.id === firstTarget);
        if (targetNode && isGateway(targetNode)) {
          degeneratePairFound = true;
          const inSeq = getSeqInEdges(splitGw.id);
          const outFromMerge = getSeqOutEdges(targetNode.id);
          if (outFromMerge.length > 0) {
            const nextTgt = outFromMerge[0].target;
            inSeq.forEach((ie) => {
              ie.target = nextTgt;
              delete ie.label;
              if (ie.data) {
                delete ie.data.label;
                ie.data.probability = 1.0;
              }
            });
            const removeIds = new Set([...outSeq.map((e) => e.id), ...outFromMerge.map((e) => e.id)]);
            edges = edges.filter((e) => !removeIds.has(e.id));
            nodes = nodes.filter((n) => n.id !== splitGw.id && n.id !== targetNode.id);
            warnings.push({
              rule: 'remove-degenerate-gateways',
              message: `Removed degenerate decision pair "${splitGw.id}" and "${targetNode.id}" with 0 tasks in branches.`,
              nodeId: splitGw.id,
            });
            break;
          }
        }
      }
    }
  }

  // Clean outgoing labels on merge gateways
  const currentGatewaysForMerge = nodes.filter((n) => isGateway(n));
  currentGatewaysForMerge.forEach((gw) => {
    const inSeq = getSeqInEdges(gw.id);
    const isMerge = inSeq.length >= 2 || gw.gateway_role === 'merge' || gw.data?.gateway_role === 'merge';
    if (isMerge) {
      const outSeq = getSeqOutEdges(gw.id);
      outSeq.forEach((oe) => {
        if (oe.data?.label || oe.label) {
          delete oe.label;
          if (oe.data) {
            delete oe.data.label;
          }
          warnings.push({
            rule: 'merge-outgoing-label-dropped',
            message: `Dropped condition label from outgoing flow of merge gateway "${gw.id}".`,
            edgeId: oe.id,
          });
        }
      });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 7: YES/NO BRANCH CONSISTENCY
  // ──────────────────────────────────────────────────────────────────────────
  const decisionGateways = nodes.filter((n) => isExclusiveGateway(n));
  decisionGateways.forEach((gw) => {
    const outSeq = getSeqOutEdges(gw.id);
    if (outSeq.length < 2) return;

    const yesEdge = outSeq.find((e) => /^(yes|true|y)\b/i.test(String(e.data?.label || e.label || '').trim()));
    const noEdge = outSeq.find((e) => /^(no|false|n)\b/i.test(String(e.data?.label || e.label || '').trim()));

    if (!yesEdge || !noEdge) return;

    const q = getNodeLabel(gw).toLowerCase().trim();
    const yesTarget = nodes.find((n) => n.id === yesEdge.target);
    const noTarget = nodes.find((n) => n.id === noEdge.target);

    if (!yesTarget || !noTarget) return;

    const isBypassNode = (targetNode) => isGateway(targetNode) || isEndEvent(targetNode?.type);
    const yesIsBypass = isBypassNode(yesTarget);
    const noIsWork = isTask(noTarget);
    const isNegativeQuestion = /^(skip|bypass|cancel|without|not\b|no\b|is\s+not)/i.test(q);

    if (!isNegativeQuestion && noIsWork && yesIsBypass) {
      const msg = `Gateway "${getNodeLabel(gw)}" has inverted Yes/No branches: "No" routes into task "${getNodeLabel(noTarget)}" while "Yes" bypasses it.`;
      errors.push(msg);
      violations.push({ ruleId: 7, rule: 'consistent-yes-no-branches', message: msg, elementId: gw.id });

      const oldYesLabel = yesEdge.data?.label || yesEdge.label || 'Yes';
      const oldNoLabel = noEdge.data?.label || noEdge.label || 'No';

      if (!yesEdge.data) yesEdge.data = {};
      if (!noEdge.data) noEdge.data = {};

      yesEdge.data.label = oldNoLabel;
      yesEdge.label = oldNoLabel;

      noEdge.data.label = oldYesLabel;
      noEdge.label = oldYesLabel;

      warnings.push({
        rule: 'consistent-yes-no-branches-repair',
        message: `Swapped inverted Yes/No branch labels on gateway "${gw.id}": Yes now routes to "${getNodeLabel(noTarget)}" and No bypasses.`,
        nodeId: gw.id,
      });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 6: MESSAGE EVENTS CONNECT TO EXTERNAL POOL & CONVERT WAITING TASKS
  // ──────────────────────────────────────────────────────────────────────────
  const taskNodes = nodes.filter((n) => isTask(n));
  const RECEIVE_REGEX = /^(receive|wait\s+for|await|waiting\s+for)\b/i;
  const SEND_REGEX = /^(send|submit|place|request|dispatch|transmit|forward|post|mail|issue)\b/i;

  taskNodes.forEach((task) => {
    const label = getNodeLabel(task);
    if (!RECEIVE_REGEX.test(label)) return;

    const inSeq = getSeqInEdges(task.id);
    const prevNode = inSeq.length > 0 ? nodes.find((n) => n.id === inSeq[0].source) : null;
    const prevLabel = prevNode ? getNodeLabel(prevNode) : '';

    const followsSendTask = SEND_REGEX.test(prevLabel);
    const hasExternalMessageFlow = edges.some((e) => e.target === task.id && e.flowType === 'message');
    const isWaitPhrasing = RECEIVE_REGEX.test(label);

    if (followsSendTask || hasExternalMessageFlow || isWaitPhrasing) {
      task.type = 'message-intermediate-catch';
      if (!task.data) task.data = {};
      task.data.duration_unit = task.data.duration_unit || 'hours';

      const msg = `Task "${label}" represents waiting on an external message/delivery; converted to message-intermediate-catch event.`;
      warnings.push({ rule: 'task-converted-to-message-catch', message: msg, nodeId: task.id, flagForReview: true });

      if (!edges.some((e) => e.target === task.id && e.flowType === 'message')) {
        let extPool = nodes.find((n) => n.type === 'pool' && (n.data?.isExternal || n.id.includes('ext')));
        if (!extPool) {
          extPool = {
            id: `pool_ext_party`,
            type: 'pool',
            label: 'External Party',
            origin: 'structural',
            data: { label: 'External Party', isExternal: true, origin: 'structural' },
          };
          nodes.push(extPool);
        }
        edges.push({
          id: `msg_ext_${extPool.id}_to_${task.id}`,
          source: extPool.id,
          target: task.id,
          flowType: 'message',
          type: 'message-flow',
          data: { label: label },
        });
      }
    }
  });

  // Verify message events have message flow to external pool
  const messageEventNodes = nodes.filter(
    (n) =>
      n.type === 'message-start-event' ||
      n.type === 'message-intermediate-catch' ||
      n.type === 'message-intermediate-throw' ||
      n.type === 'message-end-event'
  );

  messageEventNodes.forEach((men) => {
    const hasMsgEdge = edges.some(
      (e) => e.flowType === 'message' && (e.source === men.id || e.target === men.id)
    );
    if (!hasMsgEdge) {
      const msg = `Message event "${getNodeLabel(men)}" (${men.id}) must be connected to an external pool via a message flow.`;
      warnings.push({
        rule: 'message-event-external-flow-repaired',
        message: msg,
        nodeId: men.id,
      });

      let extPool = nodes.find((n) => n.type === 'pool' && (n.data?.isExternal || n.id.includes('ext')));
      if (!extPool) {
        extPool = {
          id: `pool_ext_party`,
          type: 'pool',
          label: 'External Party',
          origin: 'structural',
          data: { label: 'External Party', isExternal: true, origin: 'structural' },
        };
        nodes.push(extPool);
      }

      if (men.type === 'message-start-event' || men.type === 'message-intermediate-catch') {
        edges.push({
          id: `msg_ext_${extPool.id}_to_${men.id}`,
          source: extPool.id,
          target: men.id,
          flowType: 'message',
          type: 'message-flow',
          data: { label: getNodeLabel(men) },
        });
      } else {
        edges.push({
          id: `msg_${men.id}_to_ext_${extPool.id}`,
          source: men.id,
          target: extPool.id,
          flowType: 'message',
          type: 'message-flow',
          data: { label: getNodeLabel(men) },
        });
      }
      warnings.push({
        rule: 'connect-message-event-external-pool',
        message: `Connected message event "${men.id}" to external pool "${extPool.id}".`,
        nodeId: men.id,
      });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 7b: DISJOINT SUBGRAPHS FOR MULTIPLE CONFIRMED STARTS
  // ──────────────────────────────────────────────────────────────────────────
  if (startNodes.length > 1) {
    const reachableSets = startNodes.map((sn) => {
      const visited = new Set([sn.id]);
      const queue = [sn.id];
      while (queue.length > 0) {
        const curr = queue.shift();
        const outSeq = edges.filter((e) => e.source === curr && e.flowType !== 'message');
        for (const e of outSeq) {
          if (!visited.has(e.target)) {
            visited.add(e.target);
            queue.push(e.target);
          }
        }
      }
      return { startId: sn.id, reachable: visited };
    });

    for (let i = 0; i < reachableSets.length; i++) {
      for (let j = i + 1; j < reachableSets.length; j++) {
        const setA = reachableSets[i].reachable;
        const setB = reachableSets[j].reachable;
        const intersection = Array.from(setA).filter((id) => setB.has(id));
        if (intersection.length > 0) {
          const msg = `Independent start flows "${reachableSets[i].startId}" and "${reachableSets[j].startId}" converge at node "${intersection[0]}". Independent processes must have disjoint paths.`;
          errors.push(msg);
          violations.push({ ruleId: 7, rule: 'disjoint-independent-starts', message: msg, elementId: intersection[0] });
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 8: USER-DESCRIBED ACTIVITIES MUST HAVE DURATION
  // ──────────────────────────────────────────────────────────────────────────
  taskNodes.forEach((task) => {
    const origin = task.data?.origin || task.origin || 'stated';
    const isStructural = origin === 'structural' || task.data?.isStructural === true;
    if (isStructural) return;

    const dur = task.data?.duration ?? task.duration;
    if (dur == null || isNaN(Number(dur))) {
      const msg = `Activity "${getNodeLabel(task)}" (${task.id}) is missing duration. User-described activities must specify a duration.`;
      errors.push(msg);
      violations.push({ ruleId: 8, rule: 'missing-duration', message: msg, elementId: task.id });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 4: NO ELEMENT NAME MAY MATCH AN ID PATTERN
  // ──────────────────────────────────────────────────────────────────────────
  nodes.forEach((n) => {
    if (isContainer(n)) return;

    const label = getNodeLabel(n);
    const isMerge = isGateway(n) && (n.gateway_role === 'merge' || getSeqInEdges(n.id).length >= 2);

    if (isMerge) {
      if (ID_LIKE_PATTERN.test(label) || label.toLowerCase().startsWith('gw_') || label === n.id) {
        const msg = `Merge gateway "${n.id}" displayed raw internal ID "${label}" as label.`;
        errors.push(msg);
        violations.push({ ruleId: 4, rule: 'no-id-as-label', message: msg, elementId: n.id });

        setNodeLabel(n, '');
        warnings.push({
          rule: 'clear-merge-gateway-id-label',
          message: `Cleared internal ID label from merge gateway "${n.id}".`,
          nodeId: n.id,
        });
      }
    } else {
      if (ID_LIKE_PATTERN.test(label) || label.toLowerCase().startsWith('gw_') || label === n.id) {
        const msg = `Element "${n.id}" has an internal ID-like label "${label}". Element names must be human-readable.`;
        errors.push(msg);
        violations.push({ ruleId: 4, rule: 'no-id-as-label', message: msg, elementId: n.id });

        const humanName = cleanIdToHumanLabel(label || n.id);
        setNodeLabel(n, humanName);
        warnings.push({
          rule: 'auto-generate-human-label',
          message: `Replaced ID-like label "${label}" with human-readable name "${humanName}" on node "${n.id}".`,
          nodeId: n.id,
        });
      }
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 5: REACHABILITY & DEAD ENDS
  // ──────────────────────────────────────────────────────────────────────────
  const flowNodes = nodes.filter((n) => !isContainer(n));
  const effectiveStartNodes = flowNodes.filter((n) => isStartEvent(n.type));
  const effectiveEndNodes = flowNodes.filter((n) => isEndEvent(n.type));

  if (effectiveStartNodes.length === 0) {
    errors.push('Diagram has no start events.');
    violations.push({ ruleId: 5, rule: 'has-start-event', message: 'Diagram has no start events.' });
  }

  if (effectiveEndNodes.length === 0) {
    errors.push('Diagram has no end events.');
    violations.push({ ruleId: 5, rule: 'has-end-event', message: 'Diagram has no end events.' });
  }

  const reachableFromStart = new Set();
  const forwardQueue = effectiveStartNodes.map((n) => n.id);
  effectiveStartNodes.forEach((n) => reachableFromStart.add(n.id));

  while (forwardQueue.length > 0) {
    const curr = forwardQueue.shift();
    const outEdges = edges.filter((e) => e.source === curr && e.flowType !== 'message');
    for (const e of outEdges) {
      if (!reachableFromStart.has(e.target)) {
        reachableFromStart.add(e.target);
        forwardQueue.push(e.target);
      }
    }
  }

  flowNodes.forEach((node) => {
    if (!reachableFromStart.has(node.id) && !isStartEvent(node.type)) {
      const msg = `Node "${getNodeLabel(node)}" (${node.id}) is unreachable from any start event.`;
      errors.push(msg);
      violations.push({ ruleId: 5, rule: 'node-reachable-from-start', message: msg, elementId: node.id });
    }
  });

  const canReachEnd = new Set();
  const backwardQueue = effectiveEndNodes.map((n) => n.id);
  effectiveEndNodes.forEach((n) => canReachEnd.add(n.id));

  while (backwardQueue.length > 0) {
    const curr = backwardQueue.shift();
    const inEdges = edges.filter((e) => e.target === curr && e.flowType !== 'message');
    for (const e of inEdges) {
      if (!canReachEnd.has(e.source)) {
        canReachEnd.add(e.source);
        backwardQueue.push(e.source);
      }
    }
  }

  flowNodes.forEach((node) => {
    if (!canReachEnd.has(node.id) && !isEndEvent(node.type)) {
      const msg = `Node "${getNodeLabel(node)}" (${node.id}) is a dead end (cannot reach any end event).`;
      errors.push(msg);
      violations.push({ ruleId: 5, rule: 'node-can-reach-end', message: msg, elementId: node.id });
    }
  });

  repaired.nodes = nodes;
  repaired.edges = edges;

  // Run deterministic fallback repair so repaired diagram is 100% structurally valid
  const healed = normalizeAndRepairBpmn(repaired, options);

  return {
    valid: errors.length === 0,
    isValid: errors.length === 0,
    errors,
    warnings,
    violations,
    repaired: healed || repaired,
    rulesChecked: 14,
    repairsCount: (warnings || []).length,
  };
}
