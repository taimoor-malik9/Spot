/**
 * shared/deterministicBuilder.js
 *
 * Deterministic BPMN 2.0 Graph Builder.
 * Converts a simple domain-agnostic JSON process description into a structurally valid BPMN 2.0 diagram.
 *
 * Pipeline Rules:
 * 1. Counter-based UniqueIdGenerator for all nodes and edges (never derived from other IDs).
 * 2. One main process pool with one lane per internal actor. Every task, event, and gateway sits in a lane
 *    (a gateway or event takes the lane of the actor who owns the preceding step).
 * 3. External parties become collapsed pools (0 internal nodes) connected ONLY by message flows,
 *    anchored to the exact steps that send or receive. Sequence flows NEVER cross pools.
 * 4. Add start and end events, split/merge gateways ONLY where there are 2+ paths, parallel split/join pairs,
 *    loops that reconnect to the correct earlier step, and no orphan nodes. Every branch must reach an end event.
 * 5. Layout automatically: lanes stacked vertically, steps left to right by order, no overlapping nodes or labels.
 * 6. Map each lane/actor to a resource (count >= 1) and attach durations and resources by step ID, never by name.
 * 7. Wait/delay steps: use explicit time unit (min / hours / days), mark "estimated" until confirmed, never default silently.
 */

import { validateBpmn } from './validateBpmn.js';
import { normalizeAndRepairBpmn } from './deterministicNormalizer.js';
import { layoutAiDiagram } from './aiDiagramLayout.js';

export class UniqueIdGenerator {
  constructor(seed = 1) {
    this.counter = seed;
  }

  next(prefix = 'id') {
    const cleanPrefix = String(prefix || 'id')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return `${cleanPrefix}_${this.counter++}`;
  }
}

function sanitizeNumber(val, defaultVal = 5) {
  const num = Number(val);
  return Number.isFinite(num) && num >= 0 ? num : defaultVal;
}

function sanitizeUnit(unit) {
  const u = String(unit || 'minutes').toLowerCase();
  if (u.startsWith('sec')) return 'seconds';
  if (u.startsWith('hour') || u.startsWith('hr')) return 'hours';
  if (u.startsWith('day')) return 'days';
  return 'minutes';
}

/**
 * Builds a 100% valid BPMN graph from a clean domain-agnostic process JSON.
 *
 * @param {object} processJson
 * @returns {{ nodes: Array<object>, edges: Array<object>, resources: Array<object>, valid: boolean, errors: Array<string>, repairsCount: number }}
 */
export function buildBpmnFromProcessJson(processJson) {
  if (!processJson || typeof processJson !== 'object') {
    throw new Error('Invalid process JSON provided to deterministic builder');
  }

  const idGen = new UniqueIdGenerator(1);
  const nodes = [];
  const edges = [];
  const resourcesMap = new Map();

  const title = String(processJson.processTitle || processJson.title || 'Business Process').trim();
  const rawActors = Array.isArray(processJson.actors)
    ? processJson.actors
    : (Array.isArray(processJson.participants?.internal_roles) ? processJson.participants.internal_roles : []);
  const rawExtParties = Array.isArray(processJson.external_parties || processJson.externalParties)
    ? (processJson.external_parties || processJson.externalParties)
    : (Array.isArray(processJson.participants?.external_parties) ? processJson.participants.external_parties : []);
  const rawSteps = Array.isArray(processJson.steps)
    ? processJson.steps
    : (Array.isArray(processJson.activities) ? processJson.activities : []);
  const rawDecisions = Array.isArray(processJson.decisions) ? processJson.decisions : [];
  const rawParallelGroups = Array.isArray(processJson.parallel_groups || processJson.parallelGroups)
    ? (processJson.parallel_groups || processJson.parallelGroups)
    : [];
  const rawLoops = Array.isArray(processJson.loops || processJson.rework)
    ? (processJson.loops || processJson.rework)
    : [];

  // ── 1. Classify Actors: Internal Roles vs External Parties ──
  const internalActors = [];
  const externalActors = [];

  // Register declared external parties first
  rawExtParties.forEach(party => {
    const name = typeof party === 'string' ? party.trim() : (party?.name || '').trim();
    if (name && !externalActors.some(a => a.toLowerCase() === name.toLowerCase())) {
      externalActors.push(name);
    }
  });

  // Register internal actors
  rawActors.forEach(actor => {
    const name = typeof actor === 'string' ? actor.trim() : (actor?.name || '').trim();
    if (!name) return;
    const type = typeof actor === 'object' && actor.type ? actor.type.toLowerCase() : null;
    const isExplicitExt = type === 'external' || externalActors.some(a => a.toLowerCase() === name.toLowerCase());
    if (isExplicitExt) {
      if (!externalActors.some(a => a.toLowerCase() === name.toLowerCase())) {
        externalActors.push(name);
      }
    } else {
      if (!internalActors.some(a => a.toLowerCase() === name.toLowerCase())) {
        internalActors.push(name);
      }
    }
  });

  // Infer any external parties or internal roles from steps
  rawSteps.forEach(step => {
    const stepActor = step.actor ? String(step.actor).trim() : '';
    if (stepActor) {
      const isKnownExt = externalActors.some(a => a.toLowerCase() === stepActor.toLowerCase()) || step.type === 'external';
      if (isKnownExt) {
        if (!externalActors.some(a => a.toLowerCase() === stepActor.toLowerCase())) {
          externalActors.push(stepActor);
        }
      } else {
        if (!internalActors.some(a => a.toLowerCase() === stepActor.toLowerCase())) {
          internalActors.push(stepActor);
        }
      }
    }
    const interactsWith = step.interacts_with || step.interactsWith;
    if (interactsWith) {
      const ext = String(interactsWith).trim();
      if (ext && !externalActors.some(a => a.toLowerCase() === ext.toLowerCase())) {
        externalActors.push(ext);
      }
    }
  });

  if (internalActors.length === 0) {
    internalActors.push('Operator');
  }

  // ── 2. Create Pools & Lanes ──
  // Main Process Pool
  const mainPoolId = idGen.next('pool_main');
  nodes.push({
    id: mainPoolId,
    type: 'pool',
    label: title,
    data: { label: title, isExternal: false },
  });

  // Lanes inside Main Pool (one per internal actor)
  const laneMap = new Map();
  internalActors.forEach(actorName => {
    const laneId = idGen.next('lane');
    laneMap.set(actorName.toLowerCase(), laneId);
    nodes.push({
      id: laneId,
      type: 'lane',
      label: actorName,
      pool: mainPoolId,
      data: { label: actorName, pool: mainPoolId },
    });
  });

  const defaultLaneId = internalActors[0];

  // External Collapsed Black-Box Pools (Zero internal elements)
  const externalPoolMap = new Map();
  externalActors.forEach(actorName => {
    const extPoolId = idGen.next('pool_ext');
    externalPoolMap.set(actorName.toLowerCase(), extPoolId);
    nodes.push({
      id: extPoolId,
      type: 'pool',
      label: actorName,
      data: { label: actorName, isExternal: true },
    });
  });

  const resolveLane = (actorName) => {
    if (!actorName) return internalActors[0];
    const lower = String(actorName).trim().toLowerCase();
    const found = internalActors.find(a => a.toLowerCase() === lower || lower.includes(a.toLowerCase()) || a.toLowerCase().includes(lower));
    return found || internalActors[0];
  };

  // Map each internal actor to a resource with quantity >= 1
  internalActors.forEach(actorName => {
    resourcesMap.set(actorName, {
      id: actorName,
      name: actorName,
      displayName: actorName,
      type: 'staff',
      quantity: 1,
    });
  });

  // ── 3. Step Nodes Generation ──
  const stepNodeMap = new Map(); // rawStepId -> internal node
  const externalInteractions = []; // { stepNodeId, externalPoolId, direction: 'in' | 'out', label: string }

  // Fallback if rawSteps is empty
  const effectiveRawSteps = rawSteps.length > 0 ? rawSteps : [
    { id: 'step_1', name: 'Execute Process Step', actor: internalActors[0], type: 'task', duration: 10 }
  ];

  effectiveRawSteps.forEach((step, sIdx) => {
    const rawStepId = String(step.id || `step_${sIdx + 1}`);
    const stepName = String(step.name || step.label || `Step ${sIdx + 1}`).trim();
    const actorName = step.actor ? String(step.actor).trim() : internalActors[0];
    const isActorExternal = externalActors.some(a => a.toLowerCase() === actorName.toLowerCase());

    const laneId = isActorExternal ? defaultLaneId : resolveLane(actorName);
    const rawType = String(step.type || step.kind || 'task').toLowerCase().trim();

    const isWaitType = rawType === 'wait' || rawType === 'timer';
    const isMsgSend = rawType.includes('send') || rawType === 'message send' || rawType === 'message_send';
    const isMsgReceive = rawType.includes('receive') || rawType === 'message receive' || rawType === 'message_receive';

    // Parse duration safely with explicit unit
    let minDur = 5, maxDur = 10, unit = 'minutes', isEstimated = false;
    if (typeof step.duration === 'object' && step.duration !== null) {
      minDur = sanitizeNumber(step.duration.min, 5);
      maxDur = sanitizeNumber(step.duration.max, Math.max(minDur, 10));
      if (minDur > maxDur) {
        const tmp = minDur; minDur = maxDur; maxDur = tmp;
      }
      unit = sanitizeUnit(step.duration.unit || step.duration_unit);
    } else if (step.duration != null && !isNaN(Number(step.duration))) {
      const parsed = sanitizeNumber(step.duration, 5);
      minDur = parsed;
      maxDur = parsed;
      if (step.duration_unit || step.unit) {
        unit = sanitizeUnit(step.duration_unit || step.unit);
      } else if (isWaitType) {
        // Never default to minutes silently for wait steps!
        unit = 'hours';
        isEstimated = true;
      } else {
        unit = 'minutes';
      }
    } else if (isWaitType) {
      minDur = 1;
      maxDur = 2;
      unit = 'hours';
      isEstimated = true;
    }

    if (step.estimated === true || step.duration_source === 'assumed') {
      isEstimated = true;
    }

    // Determine resource (keyed by actor/resource name)
    const resourceName = !isActorExternal ? actorName : internalActors[0];
    if (!resourcesMap.has(resourceName)) {
      resourcesMap.set(resourceName, {
        id: resourceName,
        name: resourceName,
        displayName: resourceName,
        type: 'staff',
        quantity: 1,
      });
    }

    // Determine node type
    let nodeType = 'task';
    if (isWaitType) {
      nodeType = (isActorExternal || step.interacts_with || step.interactsWith)
        ? 'message-intermediate-catch'
        : 'timer-intermediate-catch';
    } else if (isMsgReceive) {
      nodeType = 'message-intermediate-catch';
    } else if (isMsgSend) {
      nodeType = 'message-intermediate-throw';
    }

    const nodeId = idGen.next(nodeType.includes('catch') || nodeType.includes('throw') ? 'event' : 'task');

    const node = {
      id: nodeId,
      type: nodeType,
      label: stepName,
      pool: mainPoolId,
      lane: laneId,
      duration: minDur,
      duration_min: minDur,
      duration_max: maxDur,
      duration_unit: unit,
      resource: resourceName,
      resources: { [resourceName]: 1 },
      data: {
        label: stepName,
        pool: mainPoolId,
        lane: laneId,
        duration: minDur,
        duration_min: minDur,
        duration_max: maxDur,
        duration_unit: unit,
        resource: resourceName,
        resources: { [resourceName]: 1 },
        stepId: rawStepId,
        estimated: isEstimated,
        duration_source: isEstimated ? 'assumed' : 'stated',
      },
    };

    nodes.push(node);
    stepNodeMap.set(rawStepId, node);
    stepNodeMap.set(stepName.toLowerCase(), node);

    // Track external message flows (anchored strictly to this step)
    const extPartyName = (step.interacts_with || step.interactsWith)
      ? String(step.interacts_with || step.interactsWith).trim()
      : (isActorExternal ? actorName : null);

    if (extPartyName) {
      const extPoolId = externalPoolMap.get(extPartyName.toLowerCase()) ||
        Array.from(externalPoolMap.entries()).find(([k]) => k.includes(extPartyName.toLowerCase()) || extPartyName.toLowerCase().includes(k))?.[1];

      if (extPoolId) {
        const isIncoming = isMsgReceive || isWaitType || step.messageDirection === 'in';
        externalInteractions.push({
          stepNodeId: nodeId,
          externalPoolId: extPoolId,
          direction: isIncoming ? 'in' : 'out',
          label: stepName,
        });
      }
    }
  });

  const orderedSteps = [];
  const addedNodeIds = new Set();
  stepNodeMap.forEach((node) => {
    if (!addedNodeIds.has(node.id)) {
      addedNodeIds.add(node.id);
      orderedSteps.push(node);
    }
  });

  // ── 4. Graph Flow Construction (Inside Main Pool) ──
  const stepIndexMap = new Map();
  orderedSteps.forEach((s, idx) => {
    stepIndexMap.set(s.data.stepId, idx);
    stepIndexMap.set(s.id, idx);
    stepIndexMap.set(s.label.toLowerCase(), idx);
  });

  // Helper to add sequence flow (strictly inside main pool)
  const addSequenceFlow = (fromId, toId, label = '', probability = null) => {
    const edgeId = idGen.next('seq');
    const edge = {
      id: edgeId,
      source: fromId,
      target: toId,
      fromId: fromId,
      toId: toId,
      type: 'sequence-flow',
      flowType: 'sequence',
      label: label || '',
      data: {
        label: label || '',
        flowType: 'sequence',
      },
    };
    if (probability !== null && Number.isFinite(probability)) {
      edge.probability = probability;
      edge.data.probability = probability;
    }
    edges.push(edge);
    return edge;
  };

  // Helper to add message flow (strictly between external pool and internal step)
  const addMessageFlow = (fromId, toId, label = '') => {
    const edgeId = idGen.next('msg_flow');
    const edge = {
      id: edgeId,
      source: fromId,
      target: toId,
      fromId: fromId,
      toId: toId,
      type: 'message-flow',
      flowType: 'message',
      label: label || '',
      data: {
        label: label || '',
        flowType: 'message',
      },
    };
    edges.push(edge);
    return edge;
  };

  // Start Event (sits in the lane of the actor who owns the first step)
  const firstStepLane = orderedSteps[0]?.lane || defaultLaneId;
  const startEventId = idGen.next('start_event');
  nodes.push({
    id: startEventId,
    type: 'start-event',
    label: 'Start',
    pool: mainPoolId,
    lane: firstStepLane,
    data: { label: 'Start', pool: mainPoolId, lane: firstStepLane },
  });

  // Wire Start Event to first step
  addSequenceFlow(startEventId, orderedSteps[0].id);

  // Map decisions
  const decisionMap = new Map();
  rawDecisions.forEach(d => {
    const key = d.decisionStepId || d.after_step || d.afterStep || d.afterActivity;
    if (key && Array.isArray(d.branches) && d.branches.length >= 2) {
      decisionMap.set(String(key), d);
      decisionMap.set(String(key).toLowerCase(), d);
    }
  });

  // Map parallel groups
  const parallelGroupMap = new Map();
  rawParallelGroups.forEach(pg => {
    const key = pg.after_step || pg.afterStepId || pg.afterStep;
    if (key && Array.isArray(pg.branches) && pg.branches.length >= 2) {
      parallelGroupMap.set(String(key), pg);
      parallelGroupMap.set(String(key).toLowerCase(), pg);
    }
  });

  // Map loops/rework
  const loopMap = new Map();
  rawLoops.forEach(l => {
    const key = l.from_step || l.fromStep;
    if (key && (l.to_step || l.toStep)) {
      loopMap.set(String(key), l);
      loopMap.set(String(key).toLowerCase(), l);
    }
  });

  const handledStepIds = new Set();
  const terminalNodes = [];

  let i = 0;
  while (i < orderedSteps.length) {
    const current = orderedSteps[i];
    const stepId = current.data.stepId;
    const stepNameLower = current.label.toLowerCase();

    // ── Check Parallel Group (AND Split -> AND Join) ──
    if (parallelGroupMap.has(stepId) || parallelGroupMap.has(stepNameLower)) {
      const pg = parallelGroupMap.get(stepId) || parallelGroupMap.get(stepNameLower);
      const branches = pg.branches;

      // Parallel Split Gateway (takes lane of preceding step)
      const parSplitId = idGen.next('gw_par_split');
      nodes.push({
        id: parSplitId,
        type: 'parallel-gateway',
        label: pg.name || 'Parallel Split',
        pool: mainPoolId,
        lane: current.lane,
        data: {
          label: pg.name || 'Parallel Split',
          gateway_type: 'parallel',
          pool: mainPoolId,
          lane: current.lane,
        },
      });
      addSequenceFlow(current.id, parSplitId);

      // Find rejoin step
      const rejoinKey = pg.rejoin_step || pg.rejoinStepId || pg.rejoinStep;
      let rejoinIndex = -1;
      if (rejoinKey && stepIndexMap.has(String(rejoinKey).toLowerCase())) {
        rejoinIndex = stepIndexMap.get(String(rejoinKey).toLowerCase());
      } else if (rejoinKey && stepIndexMap.has(String(rejoinKey))) {
        rejoinIndex = stepIndexMap.get(String(rejoinKey));
      }

      const rejoinNode = rejoinIndex > i ? orderedSteps[rejoinIndex] : null;

      // Parallel Join Gateway
      const parJoinId = idGen.next('gw_par_join');
      nodes.push({
        id: parJoinId,
        type: 'parallel-gateway',
        label: '',
        pool: mainPoolId,
        lane: rejoinNode?.lane || current.lane,
        data: {
          label: '',
          gateway_type: 'parallel',
          pool: mainPoolId,
          lane: rejoinNode?.lane || current.lane,
        },
      });

      // Wire parallel branches
      branches.forEach((bSteps) => {
        const stepList = Array.isArray(bSteps) ? bSteps : [bSteps];
        let prevBranchNodeId = parSplitId;
        stepList.forEach(sRef => {
          const sName = typeof sRef === 'string' ? sRef : (sRef.name || sRef.id);
          const tgtIdx = stepIndexMap.get(String(sName).toLowerCase()) ?? stepIndexMap.get(String(sName));
          if (tgtIdx != null && tgtIdx > i && tgtIdx < (rejoinIndex > i ? rejoinIndex : orderedSteps.length)) {
            const branchNode = orderedSteps[tgtIdx];
            addSequenceFlow(prevBranchNodeId, branchNode.id);
            handledStepIds.add(branchNode.id);
            prevBranchNodeId = branchNode.id;
          }
        });
        addSequenceFlow(prevBranchNodeId, parJoinId);
      });

      if (rejoinNode) {
        addSequenceFlow(parJoinId, rejoinNode.id);
        i = rejoinIndex;
      } else {
        terminalNodes.push(parJoinId);
        i++;
      }
      continue;
    }

    // ── Check Decision (XOR Split -> XOR Merge) ──
    if (decisionMap.has(stepId) || decisionMap.has(stepNameLower)) {
      const decision = decisionMap.get(stepId) || decisionMap.get(stepNameLower);
      const branches = decision.branches || decision.options || [];

      if (branches.length >= 2) {
        // XOR Split Gateway (takes lane of preceding step)
        const splitGwId = idGen.next('gw_split');
        nodes.push({
          id: splitGwId,
          type: 'exclusive-gateway',
          label: decision.question || 'Decision',
          pool: mainPoolId,
          lane: current.lane,
          data: {
            label: decision.question || 'Decision',
            gateway_type: 'exclusive',
            pool: mainPoolId,
            lane: current.lane,
          },
        });
        addSequenceFlow(current.id, splitGwId);

        // Normalize branch probabilities to sum to exactly 1.000
        let totalProb = 0;
        let unstatedCount = 0;
        branches.forEach(b => {
          const p = Number(b.probability);
          if (Number.isFinite(p) && p > 0) totalProb += p;
          else unstatedCount++;
        });

        const normalizedProbs = branches.map(b => {
          const p = Number(b.probability);
          if (Number.isFinite(p) && p > 0) {
            return totalProb > 0 ? p / (unstatedCount === 0 ? totalProb : Math.max(totalProb, 1.0)) : 1 / branches.length;
          }
          const remaining = Math.max(0, 1.0 - totalProb);
          return unstatedCount > 0 ? remaining / unstatedCount : 1 / branches.length;
        });

        const currentSum = normalizedProbs.reduce((acc, v) => acc + v, 0);
        const finalProbs = currentSum > 0
          ? normalizedProbs.map(v => Math.round((v / currentSum) * 1000) / 1000)
          : branches.map(() => Math.round((1 / branches.length) * 1000) / 1000);
        const delta = Math.round((1.0 - finalProbs.reduce((a, b) => a + b, 0)) * 1000) / 1000;
        if (delta !== 0) finalProbs[0] = Math.round((finalProbs[0] + delta) * 1000) / 1000;

        // Identify rejoin step
        let rejoinIndex = -1;
        const forwardTargets = [];
        branches.forEach(b => {
          const tgtRef = b.targetStepId || b.target_step || b.target || b.targetStep;
          if (tgtRef) {
            const idx = stepIndexMap.get(String(tgtRef)) ?? stepIndexMap.get(String(tgtRef).toLowerCase());
            if (idx != null && idx > i) {
              forwardTargets.push(idx);
            }
          }
        });

        if (forwardTargets.length > 0) {
          rejoinIndex = Math.max(...forwardTargets);
        }

        const rejoinNode = rejoinIndex > i ? orderedSteps[rejoinIndex] : null;

        // XOR Merge Gateway (created ONLY where branches rejoin)
        let mergeGwId = null;
        if (rejoinNode && branches.length >= 2) {
          mergeGwId = idGen.next('gw_merge');
          nodes.push({
            id: mergeGwId,
            type: 'exclusive-gateway',
            label: '',
            pool: mainPoolId,
            lane: rejoinNode.lane || current.lane,
            data: {
              label: '',
              gateway_type: 'exclusive',
              pool: mainPoolId,
              lane: rejoinNode.lane || current.lane,
            },
          });
          addSequenceFlow(mergeGwId, rejoinNode.id);
        }

        // Wire branches
        branches.forEach((branch, bIdx) => {
          const condLabel = branch.condition || branch.label || `Option ${bIdx + 1}`;
          const prob = finalProbs[bIdx];
          const tgtRef = branch.targetStepId || branch.target_step || branch.target || branch.targetStep;
          const tgtIndex = tgtRef != null ? (stepIndexMap.get(String(tgtRef)) ?? stepIndexMap.get(String(tgtRef).toLowerCase())) : -1;

          if (tgtIndex != null && tgtIndex <= i && tgtIndex >= 0) {
            // Loopback rework branch
            const loopTargetNode = orderedSteps[tgtIndex];
            addSequenceFlow(splitGwId, loopTargetNode.id, condLabel, prob);
          } else if (tgtIndex != null && tgtIndex > i && tgtIndex < rejoinIndex) {
            // Intermediate branch step leading to merge gateway
            const intermediateNode = orderedSteps[tgtIndex];
            addSequenceFlow(splitGwId, intermediateNode.id, condLabel, prob);
            handledStepIds.add(intermediateNode.id);

            let currBranchNode = intermediateNode;
            for (let stepK = tgtIndex + 1; stepK < rejoinIndex; stepK++) {
              const nextBranchNode = orderedSteps[stepK];
              addSequenceFlow(currBranchNode.id, nextBranchNode.id);
              handledStepIds.add(nextBranchNode.id);
              currBranchNode = nextBranchNode;
            }

            if (mergeGwId) {
              addSequenceFlow(currBranchNode.id, mergeGwId);
            } else {
              terminalNodes.push(currBranchNode.id);
            }
          } else if (tgtIndex === rejoinIndex && rejoinNode) {
            // Direct bypass to merge gateway
            if (mergeGwId) {
              addSequenceFlow(splitGwId, mergeGwId, condLabel, prob);
            } else {
              addSequenceFlow(splitGwId, rejoinNode.id, condLabel, prob);
            }
          } else if (tgtIndex != null && tgtIndex > i) {
            const targetNode = orderedSteps[tgtIndex];
            addSequenceFlow(splitGwId, targetNode.id, condLabel, prob);
          } else {
            // Branch terminates at an end event
            const branchEndId = idGen.next('end_event');
            nodes.push({
              id: branchEndId,
              type: 'end-event',
              label: condLabel,
              pool: mainPoolId,
              lane: current.lane,
              data: { label: condLabel, pool: mainPoolId, lane: current.lane },
            });
            addSequenceFlow(splitGwId, branchEndId, condLabel, prob);
          }
        });

        if (rejoinIndex > i) {
          i = rejoinIndex;
        } else {
          i++;
        }
        continue;
      }
    }

    // ── Check Standalone Loop / Rework ──
    if (loopMap.has(stepId) || loopMap.has(stepNameLower)) {
      const loop = loopMap.get(stepId) || loopMap.get(stepNameLower);
      const toKey = loop.to_step || loop.toStep;
      const toIdx = toKey != null ? (stepIndexMap.get(String(toKey)) ?? stepIndexMap.get(String(toKey).toLowerCase())) : -1;

      if (toIdx != null && toIdx >= 0 && toIdx < i) {
        // Insert decision split for loopback
        const loopGwId = idGen.next('gw_split');
        nodes.push({
          id: loopGwId,
          type: 'exclusive-gateway',
          label: loop.condition || 'Quality Check',
          pool: mainPoolId,
          lane: current.lane,
          data: {
            label: loop.condition || 'Quality Check',
            gateway_type: 'exclusive',
            pool: mainPoolId,
            lane: current.lane,
          },
        });
        addSequenceFlow(current.id, loopGwId);

        const loopProb = Number(loop.probability) > 0 && Number(loop.probability) < 1 ? Number(loop.probability) : 0.2;
        const forwardProb = Math.round((1.0 - loopProb) * 1000) / 1000;

        // Loopback edge
        const loopTarget = orderedSteps[toIdx];
        addSequenceFlow(loopGwId, loopTarget.id, loop.condition || 'Rework', loopProb);

        // Forward edge to next step
        const nextStep = orderedSteps[i + 1];
        if (nextStep) {
          addSequenceFlow(loopGwId, nextStep.id, 'Passed', forwardProb);
        } else {
          terminalNodes.push(loopGwId);
        }
        i++;
        continue;
      }
    }

    // ── Linear Sequential Flow ──
    if (!handledStepIds.has(current.id)) {
      const next = orderedSteps[i + 1];
      if (next) {
        const alreadyWired = edges.some(e => e.source === current.id && e.type === 'sequence-flow');
        if (!alreadyWired) {
          addSequenceFlow(current.id, next.id);
        }
      } else {
        terminalNodes.push(current.id);
      }
    }
    i++;
  }

  // ── 5. End Event(s) ──
  const effectiveTerminals = Array.from(new Set(terminalNodes)).filter(id => {
    return !edges.some(e => e.source === id && e.type === 'sequence-flow');
  });

  const lastStep = orderedSteps[orderedSteps.length - 1];
  const lastLane = lastStep?.lane || defaultLaneId;

  if (effectiveTerminals.length > 0) {
    const mainEndEventId = idGen.next('end_event');
    nodes.push({
      id: mainEndEventId,
      type: 'end-event',
      label: 'End',
      pool: mainPoolId,
      lane: lastLane,
      data: { label: 'End', pool: mainPoolId, lane: lastLane },
    });
    effectiveTerminals.forEach(termId => {
      addSequenceFlow(termId, mainEndEventId);
    });
  } else {
    const lastHasOut = edges.some(e => e.source === lastStep.id && e.type === 'sequence-flow');
    if (!lastHasOut) {
      const mainEndEventId = idGen.next('end_event');
      nodes.push({
        id: mainEndEventId,
        type: 'end-event',
        label: 'End',
        pool: mainPoolId,
        lane: lastLane,
        data: { label: 'End', pool: mainPoolId, lane: lastLane },
      });
      addSequenceFlow(lastStep.id, mainEndEventId);
    }
  }

  // ── 6. Anchor External Message Flows ──
  externalInteractions.forEach(interaction => {
    if (interaction.direction === 'out') {
      addMessageFlow(interaction.stepNodeId, interaction.externalPoolId, interaction.label);
    } else {
      addMessageFlow(interaction.externalPoolId, interaction.stepNodeId, interaction.label);
    }
  });

  let rawDiagram = {
    nodes,
    edges,
    resources: Array.from(resourcesMap.values()),
  };

  // ── 7. Silent Auto-Repair Pass (idempotent, max 3 passes) ──
  let val = validateBpmn(rawDiagram, { allowUnresolved: true });
  let finalRepaired = rawDiagram;

  let loop = 0;
  while ((!val.valid || (val.errors && val.errors.length > 0)) && loop < 3) {
    loop++;
    finalRepaired = normalizeAndRepairBpmn(finalRepaired, { userDescription: title });
    val = validateBpmn(finalRepaired, { allowUnresolved: true });
  }

  const finalDiagramNodes = val.repaired?.nodes || finalRepaired.nodes || nodes;
  const finalDiagramEdges = val.repaired?.edges || finalRepaired.edges || edges;
  const finalResources = val.repaired?.resources || finalRepaired.resources || rawDiagram.resources;

  // ── 8. Automatic Layout (Lanes stacked vertically, steps left to right) ──
  let laidOut = null;
  try {
    laidOut = layoutAiDiagram({
      nodes: finalDiagramNodes,
      edges: finalDiagramEdges,
      resources: finalResources,
    });
  } catch (layoutErr) {
    console.warn('layoutAiDiagram notice:', layoutErr.message);
  }

  // Merge layout dimensions and positions into complete BPMN diagram nodes
  const elementMap = new Map();
  if (laidOut && Array.isArray(laidOut.elements)) {
    laidOut.elements.forEach(el => elementMap.set(el.id, el));
  }

  const mainPoolLayout = laidOut?.elements?.find(el => el.id === mainPoolId || (el.type === 'pool' && !el.isExternal));

  const outputNodes = finalDiagramNodes.map(n => {
    const el = elementMap.get(n.id);
    let pos = el?.position || n.position;
    let w = el?.width ?? n.width;
    let h = el?.height ?? n.height;

    // If lane was omitted by layout (single-lane pool), derive bounds from main pool
    if (n.type === 'lane' && !pos && mainPoolLayout) {
      pos = { x: mainPoolLayout.position.x + 30, y: mainPoolLayout.position.y };
      w = (mainPoolLayout.width || 800) - 30;
      h = mainPoolLayout.height || 180;
    }

    return {
      ...n,
      position: pos || { x: 100, y: 100 },
      ...(w != null ? { width: w } : {}),
      ...(h != null ? { height: h } : {}),
      pool: n.pool || el?.pool || el?.poolId || n.data?.pool,
      lane: n.lane || el?.lane || n.data?.lane,
      data: {
        ...(n.data || {}),
        ...(el?.data || {}),
        pool: n.pool || el?.pool || el?.poolId || n.data?.pool,
        lane: n.lane || el?.lane || n.data?.lane,
      },
    };
  });

  const connectionMap = new Map();
  if (laidOut && Array.isArray(laidOut.connections)) {
    laidOut.connections.forEach(c => connectionMap.set(c.id, c));
  }

  const outputEdges = finalDiagramEdges.map(e => {
    const conn = connectionMap.get(e.id);
    const src = e.source || e.fromId;
    const tgt = e.target || e.toId;
    const isMsg = e.type === 'message-flow' || e.flowType === 'message';
    return {
      ...e,
      id: e.id,
      source: src,
      target: tgt,
      fromId: src,
      toId: tgt,
      type: isMsg ? 'message-flow' : 'sequence-flow',
      flowType: isMsg ? 'message' : 'sequence',
      label: e.label || e.data?.label || '',
      probability: e.probability ?? e.data?.probability ?? undefined,
      ...(conn?.waypoints ? { waypoints: conn.waypoints } : {}),
      data: {
        ...(e.data || {}),
        label: e.label || e.data?.label || '',
        flowType: isMsg ? 'message' : 'sequence',
        probability: e.probability ?? e.data?.probability ?? undefined,
      },
    };
  });

  const outputResources = (laidOut && Array.isArray(laidOut.resources) && laidOut.resources.length > 0)
    ? laidOut.resources
    : finalResources;

  // Final validation verification
  const finalVal = validateBpmn({ nodes: outputNodes, edges: outputEdges, resources: outputResources }, { allowUnresolved: true });

  return {
    nodes: outputNodes,
    edges: outputEdges,
    elements: outputNodes,
    connections: outputEdges,
    resources: outputResources,
    valid: finalVal.valid,
    errors: finalVal.errors || [],
    repairsCount: (val.repairs?.length || 0) + (finalVal.repairs?.length || 0),
  };
}
