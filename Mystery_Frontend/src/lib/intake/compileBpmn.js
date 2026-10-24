/**
 * lib/intake/compileBpmn.js
 *
 * Deterministic compiler from high-level BPMN SPEC to standard SPOT rawDiagram.
 *
 * SPEC structure:
 * {
 *   pools: [
 *     {
 *       name: string,
 *       steps: [
 *         {
 *           id: string,
 *           label: string,
 *           kind: 'task' | 'wait_for_message' | 'send_message',
 *           lane?: string,
 *           origin?: 'stated' | 'inferred',
 *           duration?: number,
 *           duration_unit?: 'minutes' | 'hours' | 'days',
 *           resource?: string,
 *           resources?: Record<string, number>
 *         }
 *       ],
 *       branches: [
 *         {
 *           afterStepId: string,
 *           question: string,
 *           options: [
 *             {
 *               label: string,
 *               probability?: number,
 *               steps: string[],
 *               rejoin: boolean
 *             }
 *           ]
 *         }
 *       ]
 *     }
 *   ],
 *   handoffs: [
 *     { fromStepId: string, toStepId: string }
 *   ],
 *   resources?: Array<object>
 * }
 */

function sanitizeSlug(str) {
  return String(str || 'default')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'item';
}

export function getPoolRole(pool) {
  if (pool.role && typeof pool.role === 'string' && pool.role.trim()) {
    return pool.role.trim();
  }
  const name = String(pool.name || '').trim();
  const nonRoleWords = [
    'store', 'shop', 'kitchen', 'warehouse', 'restaurant', 'company',
    'office', 'bank', 'system', 'pizzeria', 'department', 'desk',
    'room', 'clinic', 'hospital', 'library', 'platform', 'app',
    'portal', 'server', 'service', 'database', 'backend', 'frontend'
  ];
  const isOrg = nonRoleWords.some(w => name.toLowerCase().includes(w));
  if (!isOrg && name) {
    return name;
  }
  return null;
}

export function getStartEventLabel(pool) {
  if (pool.startEventLabel) {
    const custom = String(pool.startEventLabel).trim();
    if (/^start\s+/i.test(custom)) {
      const remainder = custom.replace(/^start\s+/i, '').trim();
      const role = getPoolRole({ ...pool, name: remainder || pool.name });
      return role ? `${role} arrives` : 'Start';
    }
    return custom;
  }
  const role = getPoolRole(pool);
  if (role) return `${role} arrives`;
  return 'Start';
}

export function getEndEventLabel(pool) {
  if (pool.endEventLabel) {
    const custom = String(pool.endEventLabel).trim();
    if (/^end\s+/i.test(custom)) {
      const remainder = custom.replace(/^end\s+/i, '').trim();
      const role = getPoolRole({ ...pool, name: remainder || pool.name });
      return role ? `${role} leaves` : 'End';
    }
    return custom;
  }
  const role = getPoolRole(pool);
  if (role) return `${role} leaves`;
  return 'End';
}

/**
 * Validates whether the SPEC is structurally complete.
 * If incomplete (e.g. branch with no steps, handoff referencing missing step),
 * returns { valid: false, question: string }.
 *
 * @param {object} spec
 * @returns {{ valid: boolean, question?: string, errors?: string[] }}
 */
export function validateSpec(spec) {
  if (!spec || typeof spec !== 'object') {
    return { valid: false, question: 'Could you describe the main steps of your process?' };
  }

  const pools = Array.isArray(spec.pools) ? spec.pools : [];
  if (pools.length === 0) {
    return { valid: false, question: 'Who are the people or departments involved in this process?' };
  }

  const allStepMap = new Map();
  pools.forEach((p) => {
    (p.steps || []).forEach((s) => {
      if (s && s.id) allStepMap.set(s.id, { ...s, poolName: p.name });
    });
  });

  if (allStepMap.size === 0) {
    return { valid: false, question: 'What is the first step that happens when the process starts?' };
  }

  // Check branches completeness
  for (const p of pools) {
    for (const b of p.branches || []) {
      if (b.afterStepId && !allStepMap.has(b.afterStepId)) {
        return {
          valid: false,
          question: `The decision "${b.question || 'Check'}" follows a step that is not defined. Which step should come right before this decision?`,
        };
      }

      if (!Array.isArray(b.options) || b.options.length < 2) {
        return {
          valid: false,
          question: `For the decision "${b.question || 'Check'}", what are the possible outcomes or choices?`,
        };
      }

      for (const opt of b.options) {
        if (!Array.isArray(opt.steps) || opt.steps.length === 0) {
          return {
            valid: false,
            question: `When "${opt.label || 'this option'}" happens under "${b.question || 'the decision'}", what step is taken next?`,
          };
        }

        for (const stepId of opt.steps) {
          if (!allStepMap.has(stepId)) {
            return {
              valid: false,
              question: `In option "${opt.label}", step "${stepId}" was mentioned but not detailed. What happens during this step?`,
            };
          }
        }
      }
    }
  }

  // Check handoffs completeness
  for (const h of spec.handoffs || []) {
    if (!h.fromStepId || !allStepMap.has(h.fromStepId)) {
      return {
        valid: false,
        question: `A step is sending a message or handoff, but the sending step is missing. Which step sends it?`,
      };
    }
    if (!h.toStepId || !allStepMap.has(h.toStepId)) {
      const sender = allStepMap.get(h.fromStepId);
      return {
        valid: false,
        question: `After "${sender?.label || h.fromStepId}", who receives the handoff and what step do they perform?`,
      };
    }
  }

  return { valid: true };
}

/**
 * Compiles a BPMN SPEC into a standard SPOT rawDiagram { type: 'diagram', nodes, edges, resources }.
 *
 * @param {object} spec
 * @returns {object} rawDiagram
 */
export function compileBpmn(spec) {
  const specCheck = validateSpec(spec);
  if (!specCheck.valid) {
    throw new Error(specCheck.question || 'Incomplete process specification.');
  }

  const nodes = [];
  const edges = [];
  const pools = spec.pools || [];

  // Index all step objects and which steps belong to branches
  const stepMap = new Map();
  const branchStepIds = new Set();

  pools.forEach((pool) => {
    (pool.steps || []).forEach((step) => {
      stepMap.set(step.id, { ...step, poolName: pool.name });
    });
    (pool.branches || []).forEach((branch) => {
      (branch.options || []).forEach((opt) => {
        (opt.steps || []).forEach((sId) => branchStepIds.add(sId));
      });
    });
  });

  pools.forEach((pool, poolIdx) => {
    const poolName = pool.name || `Pool ${poolIdx + 1}`;
    const poolSlug = sanitizeSlug(poolName);
    const poolId = `pool_${poolSlug}_${poolIdx}`;
    const laneId = `lane_${poolSlug}_${poolIdx}`;

    const poolSteps = pool.steps || [];

    // Module I2h: Check explicit sub-lanes
    // A pool with no real sub-lanes renders as ONE pool band with a single title.
    const explicitLanes = [...new Set(
      poolSteps
        .map(s => s.lane)
        .filter(l => l && typeof l === 'string' && l.trim() !== '' && l.trim().toLowerCase() !== poolName.trim().toLowerCase())
    )];
    const hasExplicitLanes = explicitLanes.length >= 2;

    // Visual pool node
    nodes.push({
      id: poolId,
      type: 'pool',
      label: poolName,
      data: { label: poolName, hasExplicitLanes },
    });

    if (hasExplicitLanes) {
      // Draw lane headers only when a pool has 2+ explicit lanes
      explicitLanes.forEach((laneName, lIdx) => {
        const explicitLaneId = `lane_${poolSlug}_${sanitizeSlug(laneName)}_${lIdx}`;
        nodes.push({
          id: explicitLaneId,
          type: 'lane',
          label: laneName,
          pool: poolId,
          implicitLane: false,
          data: { label: laneName, implicitLane: false },
        });
      });
    } else {
      // Keep lane = pool name as a logical assignment for validation and resource mapping, flagged implicitLane: true
      nodes.push({
        id: laneId,
        type: 'lane',
        label: poolName,
        pool: poolId,
        implicitLane: true,
        data: { label: poolName, implicitLane: true },
      });
    }

    if (poolSteps.length === 0) return;

    const firstStep = poolSteps[0];
    const lastStep = poolSteps[poolSteps.length - 1];

    const isFirstStepMsg = firstStep.kind === 'wait_for_message';
    const isLastStepMsg = lastStep.kind === 'send_message';

    // Map branches by afterStepId within this pool
    const branchesByAfterStep = new Map();
    (pool.branches || []).forEach((branch) => {
      branchesByAfterStep.set(branch.afterStepId, branch);
    });

    // Create Start Event: "<Role> arrives" or "Start", never "Start Customer"
    let startNodeId;
    if (isFirstStepMsg) {
      // First step is itself the message-start-event
      startNodeId = firstStep.id;
    } else {
      startNodeId = `start_${poolSlug}_${poolIdx}`;
      const startLbl = getStartEventLabel(pool);
      nodes.push({
        id: startNodeId,
        type: 'start-event',
        label: startLbl,
        pool: poolId,
        lane: hasExplicitLanes ? (firstStep.lane || explicitLanes[0] || poolName) : poolName,
        implicitLane: !hasExplicitLanes,
        data: { label: startLbl, implicitLane: !hasExplicitLanes },
      });
    }

    // Register all pool step nodes
    poolSteps.forEach((step) => {
      const isInferred = step.origin === 'inferred';
      const duration = isInferred ? 0 : (step.duration != null ? Number(step.duration) : 5);
      const durationUnit = step.duration_unit || 'minutes';

      let nodeType = 'task';
      if (step.id === firstStep.id && isFirstStepMsg) {
        nodeType = 'message-start-event';
      } else if (step.id === lastStep.id && isLastStepMsg) {
        nodeType = 'message-end-event';
      } else if (step.kind === 'wait_for_message') {
        nodeType = 'message-intermediate-catch';
      } else if (step.kind === 'send_message') {
        nodeType = 'message-intermediate-throw';
      }

      // Inferred step zero-time rule: duration = 0, no capacity resources
      const stepResources = isInferred
        ? {}
        : (step.resources && Object.keys(step.resources).length > 0
            ? step.resources
            : (step.resource ? { [step.resource]: 1 } : {}));
      const primaryRes = isInferred
        ? null
        : (step.resource || Object.keys(stepResources)[0] || null);

      const assignedLane = hasExplicitLanes ? (step.lane || poolName) : poolName;

      nodes.push({
        id: step.id,
        type: nodeType,
        label: step.label,
        pool: poolId,
        lane: assignedLane,
        implicitLane: !hasExplicitLanes,
        origin: step.origin || 'stated',
        data: {
          label: step.label,
          origin: step.origin || 'stated',
          implicitLane: !hasExplicitLanes,
          duration,
          duration_unit: durationUnit,
          duration_min: step.duration_min != null ? Number(step.duration_min) : null,
          duration_max: step.duration_max != null ? Number(step.duration_max) : null,
          resources: stepResources,
          resource: primaryRes,
        },
      });
    });

    // Sequence flow chaining for main flow and branches
    // Main steps are pool steps that are NOT inner branch steps
    const mainSteps = poolSteps.filter((s) => !branchStepIds.has(s.id));

    // Connect Start Event to the first step (if separate start-event node was added)
    if (!isFirstStepMsg && mainSteps.length > 0) {
      edges.push({
        id: `seq_${startNodeId}_${mainSteps[0].id}`,
        source: startNodeId,
        target: mainSteps[0].id,
        flowType: 'sequence',
        data: {},
      });
    }

    // Traverse main steps and connect to next step, branch split, or end
    mainSteps.forEach((step, idx) => {
      const branch = branchesByAfterStep.get(step.id);

      if (branch) {
        // Build exclusive gateway split
        const splitId = `gw_split_${sanitizeSlug(step.id)}_${idx}`;
        const splitLabel = branch.question || 'Decision?';
        nodes.push({
          id: splitId,
          type: 'exclusive-gateway',
          label: splitLabel,
          pool: poolId,
          lane: step.lane || poolName,
          data: { label: splitLabel, gateway_type: 'exclusive' },
        });

        edges.push({
          id: `seq_${step.id}_${splitId}`,
          source: step.id,
          target: splitId,
          flowType: 'sequence',
          data: {},
        });

        // Normalize branch probabilities so they sum to 1.0
        const options = branch.options || [];
        const count = options.length;
        const equalProb = Math.round((1.0 / count) * 100) / 100;
        let sumProb = 0;
        const normalizedProbs = options.map((opt, oIdx) => {
          if (opt.probability != null && !isNaN(opt.probability)) {
            sumProb += Number(opt.probability);
            return Number(opt.probability);
          }
          const p = oIdx === count - 1 ? Number((1.0 - equalProb * (count - 1)).toFixed(2)) : equalProb;
          sumProb += p;
          return p;
        });
        if (Math.abs(sumProb - 1.0) > 0.01 && sumProb > 0) {
          normalizedProbs.forEach((p, oIdx) => {
            normalizedProbs[oIdx] = Number((p / sumProb).toFixed(2));
          });
        }

        const rejoiningOptions = [];
        const nonRejoiningOptions = [];

        options.forEach((opt, optIdx) => {
          const optSteps = opt.steps || [];
          if (optSteps.length === 0) return;

          // Split gateway to first step of branch
          edges.push({
            id: `seq_${splitId}_${optSteps[0]}`,
            source: splitId,
            target: optSteps[0],
            flowType: 'sequence',
            data: {
              label: opt.label || `Option ${optIdx + 1}`,
              probability: normalizedProbs[optIdx],
            },
          });

          // Chain intermediate steps inside this option
          for (let k = 0; k < optSteps.length - 1; k++) {
            edges.push({
              id: `seq_${optSteps[k]}_${optSteps[k + 1]}`,
              source: optSteps[k],
              target: optSteps[k + 1],
              flowType: 'sequence',
              data: {},
            });
          }

          if (opt.rejoin !== false) {
            rejoiningOptions.push(opt);
          } else {
            nonRejoiningOptions.push(opt);
          }
        });

        // Non-rejoining options terminate at an end event
        nonRejoiningOptions.forEach((opt, nIdx) => {
          const lastOptStepId = opt.steps[opt.steps.length - 1];
          const branchEndId = `end_${sanitizeSlug(step.id)}_opt_${nIdx}`;
          nodes.push({
            id: branchEndId,
            type: 'end-event',
            label: `${opt.label || 'Branch'} End`,
            pool: poolId,
            lane: step.lane || poolName,
            data: { label: `${opt.label || 'Branch'} End` },
          });

          edges.push({
            id: `seq_${lastOptStepId}_${branchEndId}`,
            source: lastOptStepId,
            target: branchEndId,
            flowType: 'sequence',
            data: {},
          });
        });

        // Rejoining options connect to a join gateway
        if (rejoiningOptions.length > 0) {
          const joinId = `gw_join_${sanitizeSlug(step.id)}_${idx}`;
          nodes.push({
            id: joinId,
            type: 'exclusive-gateway',
            label: 'Rejoin',
            pool: poolId,
            lane: step.lane || poolName,
            data: { label: 'Rejoin', gateway_type: 'exclusive' },
          });

          rejoiningOptions.forEach((opt) => {
            const lastOptStepId = opt.steps[opt.steps.length - 1];
            edges.push({
              id: `seq_${lastOptStepId}_${joinId}`,
              source: lastOptStepId,
              target: joinId,
              flowType: 'sequence',
              data: {},
            });
          });

          // Connect join gateway to the next main step or pool end event
          if (idx < mainSteps.length - 1) {
            edges.push({
              id: `seq_${joinId}_${mainSteps[idx + 1].id}`,
              source: joinId,
              target: mainSteps[idx + 1].id,
              flowType: 'sequence',
              data: {},
            });
          } else {
            // Rejoin is at the end of the pool -> insert zero-time complete task before end event
            // to satisfy rule: no gateway directly connected to event
            const completeTaskId = `task_complete_${poolSlug}_${idx}`;
            nodes.push({
              id: completeTaskId,
              type: 'task',
              label: 'Complete Process',
              pool: poolId,
              lane: step.lane || poolName,
              origin: 'inferred',
              data: {
                label: 'Complete Process',
                origin: 'inferred',
                duration: 0,
                duration_unit: 'minutes',
                resources: {},
                resource: null,
              },
            });

            const endId = `end_${poolSlug}_${poolIdx}`;
            const endLbl = getEndEventLabel(pool);
            nodes.push({
              id: endId,
              type: 'end-event',
              label: endLbl,
              pool: poolId,
              lane: hasExplicitLanes ? (step.lane || explicitLanes[explicitLanes.length - 1] || poolName) : poolName,
              implicitLane: !hasExplicitLanes,
              data: { label: endLbl, implicitLane: !hasExplicitLanes },
            });

            edges.push({
              id: `seq_${joinId}_${completeTaskId}`,
              source: joinId,
              target: completeTaskId,
              flowType: 'sequence',
              data: {},
            });

            edges.push({
              id: `seq_${completeTaskId}_${endId}`,
              source: completeTaskId,
              target: endId,
              flowType: 'sequence',
              data: {},
            });
          }
        }
      } else {
        // Normal sequential step with no branch
        if (idx < mainSteps.length - 1) {
          edges.push({
            id: `seq_${step.id}_${mainSteps[idx + 1].id}`,
            source: step.id,
            target: mainSteps[idx + 1].id,
            flowType: 'sequence',
            data: {},
          });
        } else {
          // Terminal step in this pool
          if (step.id !== lastStep.id || !isLastStepMsg) {
            const endId = `end_${poolSlug}_${poolIdx}`;
            const endLbl = getEndEventLabel(pool);
            nodes.push({
              id: endId,
              type: 'end-event',
              label: endLbl,
              pool: poolId,
              lane: hasExplicitLanes ? (step.lane || explicitLanes[explicitLanes.length - 1] || poolName) : poolName,
              implicitLane: !hasExplicitLanes,
              data: { label: endLbl, implicitLane: !hasExplicitLanes },
            });

            edges.push({
              id: `seq_${step.id}_${endId}`,
              source: step.id,
              target: endId,
              flowType: 'sequence',
              data: {},
            });
          }
          // If step.id === lastStep.id && isLastStepMsg:
          // it is a message-end-event with 0 outgoing sequence flows and outgoing message flow
        }
      }
    });
  });

  // Turn handoffs into cross-pool message flows
  (spec.handoffs || []).forEach((h, hIdx) => {
    const fromNode = nodes.find((n) => n.id === h.fromStepId);
    const toNode = nodes.find((n) => n.id === h.toStepId);
    if (!fromNode || !toNode) return;

    // Cross-pool message flow rule (sequence flows never cross pools, message flows only across pools)
    if (fromNode.pool && toNode.pool && fromNode.pool !== toNode.pool) {
      edges.push({
        id: `flow_msg_${h.fromStepId}_${h.toStepId}_${hIdx}`,
        source: h.fromStepId,
        target: h.toStepId,
        flowType: 'message',
        data: {},
      });
    }
  });

  // Resources: normalize resources array
  let resources = Array.isArray(spec.resources) ? spec.resources : [];
  if (resources.length === 0) {
    // Infer default resources from tasks that have resources specified
    const inferredResNames = new Set();
    nodes.forEach((n) => {
      if (n.type === 'task' && n.data?.resource) {
        inferredResNames.add(n.data.resource);
      }
      if (n.type === 'task' && n.data?.resources) {
        Object.keys(n.data.resources).forEach((name) => inferredResNames.add(name));
      }
    });

    if (inferredResNames.size > 0) {
      resources = Array.from(inferredResNames).map((name) => ({
        id: name,
        name,
        displayName: name,
        type: 'staff',
        quantity: 1,
        quantitySource: 'assumed',
        costSource: 'assumed',
      }));
    } else {
      resources = [
        {
          id: 'Staff',
          name: 'Staff',
          displayName: 'Staff',
          type: 'staff',
          quantity: 1,
          quantitySource: 'assumed',
          costSource: 'assumed',
        },
      ];
    }
  }

  return {
    type: 'diagram',
    nodes,
    edges,
    resources,
  };
}
