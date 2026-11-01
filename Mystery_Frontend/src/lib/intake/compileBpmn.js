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
  const nonPersonWords = /^(store|shop|system|organization|company|facility|hospital|clinic|warehouse|bank)$/i;
  if (nonPersonWords.test(name)) {
    return null;
  }
  return name || null;
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
  return role ? `${role} arrives` : 'Start';
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
  return role ? `${role} leaves` : 'End';
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

  // Defensive normalization of pools, steps and branches
  pools.forEach((p) => {
    if (!Array.isArray(p.steps)) p.steps = [];
    p.steps.forEach((s, sIdx) => {
      if (!s.id) s.id = `step_${sIdx + 1}`;
      if (!s.label) s.label = s.id;
    });

    for (const b of p.branches || []) {
      if (b.afterStepId && !p.steps.some((s) => s.id === b.afterStepId)) {
        const alt = p.steps.find(
          (s) =>
            s.id === b.afterStepId.replace(/^step_/, '') ||
            s.id === 'step_' + b.afterStepId ||
            s.id.includes(b.afterStepId) ||
            b.afterStepId.includes(s.id)
        );
        if (alt) b.afterStepId = alt.id;
      }

      if (!Array.isArray(b.options)) continue;
      for (const opt of b.options) {
        if (!Array.isArray(opt.steps)) continue;
        opt.steps = opt.steps.map((item) => {
          if (item && typeof item === 'object') {
            const stepId = item.id || `step_${Math.random().toString(36).slice(2, 7)}`;
            if (!p.steps.some((s) => s.id === stepId)) {
              p.steps.push({
                id: stepId,
                label: item.label || stepId,
                lane: item.lane || p.name,
                duration: item.duration || 5,
                duration_unit: item.duration_unit || 'minutes',
                resource: item.resource || null,
                resources: item.resources || {},
              });
            }
            return stepId;
          }
          return String(item);
        });

        // Remap string IDs if slight mismatch or synthesize if missing
        opt.steps = opt.steps.map((stepId) => {
          if (p.steps.some((s) => s.id === stepId)) return stepId;
          if (stepId.startsWith('step_')) {
            const stripped = stepId.replace(/^step_/, '');
            const match = p.steps.find((s) => s.id === stripped);
            if (match) return match.id;
          } else {
            const prefixed = 'step_' + stepId;
            const match = p.steps.find((s) => s.id === prefixed);
            if (match) return match.id;
          }
          const partial = p.steps.find(
            (s) => s.id.includes(stepId) || stepId.includes(s.id)
          );
          if (partial) return partial.id;

          // Auto-synthesize step in pool steps if LLM declared it in branch but omitted from top-level steps
          p.steps.push({
            id: stepId,
            label: stepId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
            lane: p.name,
            duration: 5,
            duration_unit: 'minutes',
            resource: null,
            resources: {},
          });
          return stepId;
        });
      }
    }
  });

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
        if (!opt.steps || opt.steps.length === 0) {
          const isKnownTerminal =
            opt.empty ||
            opt.direct ||
            opt.rejoin === true ||
            opt.rejoin === false ||
            opt.terminal === true ||
            /^(no|denied|deny|rejected|reject|cancelled|cancel|decline|declined|exit|quit|abort|failed|fail|none|not needed|n\/a)$/i.test(
              String(opt.label || '').trim()
            );

          if (!isKnownTerminal) {
            return {
              valid: false,
              question: `In "${b.question || 'the process'}", what happens for option "${opt.label || 'this path'}"?`,
            };
          }
          opt.steps = [];
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
        origin: 'structural',
        data: { label: startLbl, implicitLane: !hasExplicitLanes, origin: 'structural' },
      });
    }

    // Register all pool step nodes
    poolSteps.forEach((step) => {
      // Rule 2h: origin is set by code, not by the LLM
      const isUserStated = step.origin !== 'inferred' && step.origin !== 'structural';
      const nodeOrigin = step.origin || (isUserStated ? 'stated' : 'structural');
      const duration = step.origin === 'inferred' ? 0 : (step.duration != null ? Number(step.duration) : 5);
      const durationUnit = step.duration_unit || 'minutes';

      // Rule 2c: Anything that takes time or uses staff is a task. Events are only start, end, and a true external trigger.
      let nodeType = 'task';
      if (step.kind === 'wait_for_message') {
        nodeType = (step.id === firstStep.id) ? 'message-start-event' : 'message-intermediate-catch';
      } else if (step.kind === 'send_message') {
        nodeType = (step.id === lastStep.id) ? 'message-end-event' : 'message-intermediate-throw';
      }

      const stepResources = step.resources && Object.keys(step.resources).length > 0
        ? step.resources
        : (step.resource ? { [step.resource]: 1 } : {});
      const primaryRes = step.resource || Object.keys(stepResources)[0] || null;

      const assignedLane = hasExplicitLanes ? (step.lane || poolName) : (step.lane || poolName);

      nodes.push({
        id: step.id,
        type: nodeType,
        label: step.label,
        pool: poolId,
        lane: assignedLane,
        implicitLane: !hasExplicitLanes,
        origin: nodeOrigin,
        kept: Boolean(step.kept),
        data: {
          label: step.label,
          origin: nodeOrigin,
          kept: Boolean(step.kept),
          estimated: Boolean(step.estimated),
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

    function getOrCreatePoolEndId(laneName) {
      const endId = `end_${poolSlug}_${poolIdx}`;
      if (!nodes.some((n) => n.id === endId)) {
        const endLbl = getEndEventLabel(pool);
        nodes.push({
          id: endId,
          type: 'end-event',
          label: endLbl,
          pool: poolId,
          lane: hasExplicitLanes ? (laneName || explicitLanes[explicitLanes.length - 1] || poolName) : poolName,
          implicitLane: !hasExplicitLanes,
          origin: 'structural',
          data: { label: endLbl, implicitLane: !hasExplicitLanes, origin: 'structural' },
        });
      }
      return endId;
    }

    const compiledBranches = new Set();

    function compileBranchTree(currentBranch, entryNodeId, branchKey, targetNodeId, stepLane) {
      compiledBranches.add(currentBranch);

      const splitId = `gw_split_${sanitizeSlug(entryNodeId)}_${branchKey}`;
      const splitLabel = currentBranch.question || 'Decision?';
      nodes.push({
        id: splitId,
        type: 'exclusive-gateway',
        label: splitLabel,
        pool: poolId,
        lane: stepLane || poolName,
        origin: 'structural',
        data: { label: splitLabel, gateway_type: 'exclusive', origin: 'structural' },
      });

      edges.push({
        id: `seq_${entryNodeId}_${splitId}`,
        source: entryNodeId,
        target: splitId,
        flowType: 'sequence',
        data: {},
      });

      const options = currentBranch.options || [];
      const normalizedProbs = options.map((opt) =>
        opt.probability != null && !isNaN(Number(opt.probability))
          ? Number(opt.probability)
          : undefined
      );

      const rejoiningOptions = [];
      const nonRejoiningOptions = [];

      options.forEach((opt, optIdx) => {
        const optSteps = opt.steps || [];

        if (optSteps.length === 0) {
          if (opt.rejoin === true) {
            rejoiningOptions.push({ ...opt, isEmptyBranch: true, optIdx });
          } else {
            const branchEndId = `end_${sanitizeSlug(entryNodeId)}_opt_${branchKey}_${optIdx}`;
            nodes.push({
              id: branchEndId,
              type: 'end-event',
              label: `${opt.label || 'Branch'} End`,
              pool: poolId,
              lane: stepLane || poolName,
              origin: 'structural',
              data: { label: `${opt.label || 'Branch'} End`, origin: 'structural' },
            });

            edges.push({
              id: `seq_${splitId}_${branchEndId}`,
              source: splitId,
              target: branchEndId,
              flowType: 'sequence',
              data: {
                label: opt.label || `Option ${optIdx + 1}`,
                ...(normalizedProbs[optIdx] != null ? { probability: normalizedProbs[optIdx] } : {}),
              },
            });
          }
          return;
        }

        edges.push({
          id: `seq_${splitId}_${optSteps[0]}`,
          source: splitId,
          target: optSteps[0],
          flowType: 'sequence',
          data: {
            label: opt.label || `Option ${optIdx + 1}`,
            ...(normalizedProbs[optIdx] != null ? { probability: normalizedProbs[optIdx] } : {}),
          },
        });

        for (let k = 0; k < optSteps.length - 1; k++) {
          edges.push({
            id: `seq_${optSteps[k]}_${optSteps[k + 1]}`,
            source: optSteps[k],
            target: optSteps[k + 1],
            flowType: 'sequence',
            data: {},
          });
        }

        if (opt.rejoin === true) {
          rejoiningOptions.push({ ...opt, optIdx });
        } else {
          nonRejoiningOptions.push({ ...opt, optIdx });
        }
      });

      nonRejoiningOptions.forEach((opt) => {
        const lastOptStepId = opt.steps[opt.steps.length - 1];
        const branchEndId = `end_${sanitizeSlug(entryNodeId)}_opt_${branchKey}_${opt.optIdx}`;
        nodes.push({
          id: branchEndId,
          type: 'end-event',
          label: `${opt.label || 'Branch'} End`,
          pool: poolId,
          lane: stepLane || poolName,
          origin: 'structural',
          data: { label: `${opt.label || 'Branch'} End`, origin: 'structural' },
        });

        edges.push({
          id: `seq_${lastOptStepId}_${branchEndId}`,
          source: lastOptStepId,
          target: branchEndId,
          flowType: 'sequence',
          data: {},
        });
      });

      const stepIdsInThisBranch = new Set();
      options.forEach((opt) => (opt.steps || []).forEach((s) => stepIdsInThisBranch.add(s)));
      const chainedBranch = (pool.branches || []).find(
        (b) => !compiledBranches.has(b) && stepIdsInThisBranch.has(b.afterStepId)
      );

      let exitNodeId = null;

      if (rejoiningOptions.length >= 2) {
        const joinId = `gw_join_${sanitizeSlug(entryNodeId)}_${branchKey}`;
        nodes.push({
          id: joinId,
          type: 'exclusive-gateway',
          label: 'Rejoin',
          pool: poolId,
          lane: stepLane || poolName,
          origin: 'structural',
          data: { label: 'Rejoin', gateway_type: 'exclusive', origin: 'structural' },
        });

        rejoiningOptions.forEach((opt) => {
          if (opt.isEmptyBranch) {
            edges.push({
              id: `seq_${splitId}_${joinId}_empty_${opt.optIdx}`,
              source: splitId,
              target: joinId,
              flowType: 'sequence',
              data: {
                label: opt.label || 'Direct flow',
                ...(normalizedProbs[opt.optIdx] != null ? { probability: normalizedProbs[opt.optIdx] } : {}),
              },
            });
          } else {
            const lastOptStepId = opt.steps[opt.steps.length - 1];
            edges.push({
              id: `seq_${lastOptStepId}_${joinId}_${opt.optIdx}`,
              source: lastOptStepId,
              target: joinId,
              flowType: 'sequence',
              data: {},
            });
          }
        });

        exitNodeId = joinId;
      } else if (rejoiningOptions.length === 1) {
        const singleOpt = rejoiningOptions[0];
        exitNodeId = singleOpt.isEmptyBranch ? splitId : singleOpt.steps[singleOpt.steps.length - 1];
      }

      if (exitNodeId) {
        if (chainedBranch) {
          compileBranchTree(chainedBranch, exitNodeId, `${branchKey}_c`, targetNodeId, stepLane);
        } else if (targetNodeId) {
          edges.push({
            id: `seq_${exitNodeId}_${targetNodeId}`,
            source: exitNodeId,
            target: targetNodeId,
            flowType: 'sequence',
            data: {},
          });
        } else {
          const endId = getOrCreatePoolEndId(stepLane);
          edges.push({
            id: `seq_${exitNodeId}_${endId}`,
            source: exitNodeId,
            target: endId,
            flowType: 'sequence',
            data: {},
          });
        }
      }
    }

    // Traverse main steps and connect to next step, branch split, or end
    mainSteps.forEach((step, idx) => {
      const branch = branchesByAfterStep.get(step.id);

      if (branch) {
        const nextStepId = idx < mainSteps.length - 1 ? mainSteps[idx + 1].id : null;
        compileBranchTree(branch, step.id, idx, nextStepId, step.lane || poolName);
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
            const endId = getOrCreatePoolEndId(step.lane);
            edges.push({
              id: `seq_${step.id}_${endId}`,
              source: step.id,
              target: endId,
              flowType: 'sequence',
              data: {},
            });
          }
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
