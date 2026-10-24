/**
 * utils/cloneProcessToScenario.js
 *
 * MODULE S1 / S1c: Shared helper cloneProcessToScenario(process, overrides)
 * used by every creation path (manual, AI apply-option, what_if_scenario,
 * and Implement Suggestion on Results page).
 *
 * - Deep-clones ALL process fields (nodes with type, position, pool, lane, parent;
 *   edges with data as objects, not JSON strings; layoutElements; resources).
 * - Applies only the overrides:
 *     - resource quantities matched by name case-insensitively
 *     - duration, duration_min, duration_max x multiplier, keeping duration_unit
 * - Does not run full validateBpmn when saving a scenario that only changed
 *   resources or durations. Replaces it with a structure-equality check against
 *   the base (same node ids and types, same edge source/target/type, same pool
 *   and lane per node, same layoutElements count). Blocks only when structure differs.
 */

const path = require('path');

let validateBpmnFn = null;
async function getValidateBpmn() {
  if (!validateBpmnFn) {
    const validatorPath = path.resolve(__dirname, '../../Mystery_Frontend/src/lib/intake/validateBpmn.js');
    const mod = await import(validatorPath);
    validateBpmnFn = mod.validateBpmn;
  }
  return validateBpmnFn;
}

function normalizeEdgeData(data) {
  if (!data) return {};
  if (typeof data === 'object' && !Array.isArray(data)) return data;
  if (typeof data === 'string') {
    let current = data.trim();
    for (let i = 0; i < 3; i++) {
      try {
        const parsed = JSON.parse(current);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed;
        }
        if (typeof parsed === 'string') {
          current = parsed;
          continue;
        }
        break;
      } catch {
        break;
      }
    }
    return { type: current };
  }
  return {};
}

function normalizeEdges(edges) {
  if (!Array.isArray(edges)) return [];
  return edges.map((edge) => {
    if (!edge || typeof edge !== 'object') return edge;
    const plain = typeof edge.toObject === 'function' ? edge.toObject() : (edge._doc ? edge._doc : edge);
    const cleanEdge = { ...plain };
    cleanEdge.data = normalizeEdgeData(cleanEdge.data);
    const src = cleanEdge.source || cleanEdge.fromId;
    const tgt = cleanEdge.target || cleanEdge.toId;
    cleanEdge.source = src;
    cleanEdge.target = tgt;
    const isMsg =
      cleanEdge.data?.type === 'message-flow' ||
      cleanEdge.type === 'message-flow' ||
      cleanEdge.type === 'message' ||
      cleanEdge.flowType === 'message' ||
      cleanEdge.data?.flowType === 'message';
    cleanEdge.flowType = isMsg ? 'message' : 'sequence';
    cleanEdge.type = isMsg ? 'message-flow' : 'sequence-flow';
    return cleanEdge;
  });
}

function deepClone(val) {
  if (val === undefined || val === null) return val;
  return JSON.parse(JSON.stringify(val));
}

/**
 * Checks structure-equality between base process and cloned scenario.
 * Verifies:
 *  1. Same node ids and types
 *  2. Same edge source, target, and type
 *  3. Same pool and lane per node
 *  4. Same layoutElements count
 *
 * @param {object} base - Base process
 * @param {object} cloned - Cloned scenario
 * @returns {{ equal: boolean, reason?: string }}
 */
function checkStructureEquality(base, cloned) {
  const baseNodes = Array.isArray(base.nodes) ? base.nodes : [];
  const clonedNodes = Array.isArray(cloned.nodes) ? cloned.nodes : [];
  if (baseNodes.length !== clonedNodes.length) {
    return {
      equal: false,
      reason: `Node count differs: base has ${baseNodes.length}, scenario has ${clonedNodes.length}.`
    };
  }

  const baseNodeMap = new Map();
  for (const n of baseNodes) {
    baseNodeMap.set(String(n.id), n);
  }

  for (const cn of clonedNodes) {
    const bn = baseNodeMap.get(String(cn.id));
    if (!bn) {
      return { equal: false, reason: `Scenario has unexpected node "${cn.id}".` };
    }
    if (cn.type !== bn.type) {
      return { equal: false, reason: `Node "${cn.id}" type differs: base is "${bn.type}", scenario is "${cn.type}".` };
    }
    const basePool = bn.pool !== undefined ? bn.pool : (bn.data?.pool || null);
    const clonePool = cn.pool !== undefined ? cn.pool : (cn.data?.pool || null);
    if (basePool !== clonePool) {
      return { equal: false, reason: `Node "${cn.id}" pool differs: base is "${basePool}", scenario is "${clonePool}".` };
    }
    const baseLane = bn.lane !== undefined ? bn.lane : (bn.data?.lane || null);
    const cloneLane = cn.lane !== undefined ? cn.lane : (cn.data?.lane || null);
    if (baseLane !== cloneLane) {
      return { equal: false, reason: `Node "${cn.id}" lane differs: base is "${baseLane}", scenario is "${cloneLane}".` };
    }
  }

  const baseEdges = normalizeEdges(base.edges || []);
  const clonedEdges = normalizeEdges(cloned.edges || []);
  if (baseEdges.length !== clonedEdges.length) {
    return {
      equal: false,
      reason: `Edge count differs: base has ${baseEdges.length}, scenario has ${clonedEdges.length}.`
    };
  }

  for (let i = 0; i < baseEdges.length; i++) {
    const be = baseEdges[i];
    const beSrc = be.source || be.fromId;
    const beTgt = be.target || be.toId;
    const ce = clonedEdges.find(
      (e) => (e.source || e.fromId) === beSrc && (e.target || e.toId) === beTgt
    );
    if (!ce) {
      return { equal: false, reason: `Missing matching edge for "${beSrc}->${beTgt}".` };
    }
    const isBeMsg = be.flowType === 'message' || be.type === 'message-flow' || be.type === 'message' || be.data?.type === 'message-flow' || be.data?.flowType === 'message';
    const beType = isBeMsg ? 'message-flow' : 'sequence-flow';
    const isCeMsg = ce.flowType === 'message' || ce.type === 'message-flow' || ce.type === 'message' || ce.data?.type === 'message-flow' || ce.data?.flowType === 'message';
    const ceType = isCeMsg ? 'message-flow' : 'sequence-flow';
    if (beType !== ceType) {
      return { equal: false, reason: `Edge "${beSrc}->${beTgt}" type differs: base is "${beType}", scenario is "${ceType}".` };
    }
  }

  const baseLayoutCount = Array.isArray(base.layoutElements) ? base.layoutElements.length : 0;
  const cloneLayoutCount = Array.isArray(cloned.layoutElements) ? cloned.layoutElements.length : 0;
  if (baseLayoutCount !== cloneLayoutCount) {
    return {
      equal: false,
      reason: `layoutElements count differs: base has ${baseLayoutCount}, scenario has ${cloneLayoutCount}.`
    };
  }

  return { equal: true };
}

/**
 * Clones a baseline Process document/object into a Scenario structure,
 * applying only specified overrides (resource quantities, node durations),
 * normalizing edges, and performing structure-equality check against base.
 *
 * @param {object} process - Base process document or POJO
 * @param {object} overrides - Overrides object { title, resourceChanges, nodeChanges, variantDefinition, ... }
 * @returns {Promise<object>} Cloned scenario payload ready for Scenario model
 */
async function cloneProcessToScenario(process, overrides = {}) {
  if (!process) {
    throw new Error('Base process is required to create a scenario.');
  }

  // Handle Mongoose document vs plain POJO
  const raw = typeof process.toObject === 'function' ? process.toObject() : process;

  // Preserve layoutElements from _doc if Mongoose schema previously omitted it
  if (process._doc && process._doc.layoutElements && (!raw.layoutElements || raw.layoutElements.length === 0)) {
    raw.layoutElements = process._doc.layoutElements;
  }
  // Preserve nodes if _doc had additional fields
  if (process._doc && process._doc.nodes && (!raw.nodes || raw.nodes.length === 0)) {
    raw.nodes = process._doc.nodes;
  }

  const baseProcessId = raw._id || raw.id || process._id || process.id;

  // 1. Deep-clone ALL process fields (preserving nodes with type, position, pool, lane, parent)
  const clonedNodes = (raw.nodes || []).map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position ? { ...node.position } : null,
    width: node.width ?? null,
    height: node.height ?? null,
    pool: node.pool !== undefined ? node.pool : (node.data?.pool || null),
    lane: node.lane !== undefined ? node.lane : (node.data?.lane || null),
    parent: node.parent !== undefined ? node.parent : (node.data?.parent || null),
    data: deepClone(node.data || {}),
  }));

  const clonedEdges = normalizeEdges(deepClone(raw.edges || []));
  const clonedResources = deepClone(raw.resources || []);
  const clonedLayoutElements = deepClone(raw.layoutElements || []);
  const simulationConfig = deepClone(overrides.simulationConfig || raw.simulationConfig || null);
  const goal = overrides.goal || raw.goal || null;

  const title =
    overrides.title ||
    overrides.label ||
    overrides.variantDefinition?.label ||
    (raw.title ? `${raw.title} - Scenario` : 'Scenario');

  // 2. Apply resource overrides: resource quantities (match by name, case-insensitive)
  const variantDef = overrides.variantDefinition || {};
  const resChanges = overrides.resourceChanges || variantDef.resourceChanges || [];

  for (const change of resChanges) {
    const wanted = String(change.name || change.id || '').trim().toLowerCase();
    const qty = Number(change.quantity != null ? change.quantity : change.qty);
    if (!Number.isFinite(qty)) continue;
    const target = clonedResources.find(
      (r) =>
        String(r.name || '').trim().toLowerCase() === wanted ||
        (change.id && String(r.id || '').trim().toLowerCase() === String(change.id).trim().toLowerCase())
    );
    if (target) {
      target.quantity = qty;
    }
  }

  // Support map-style resource overrides: { resource_quantities: { "Chef": 3 } }
  if (overrides.resource_quantities && typeof overrides.resource_quantities === 'object' && !Array.isArray(overrides.resource_quantities)) {
    for (const [resName, qty] of Object.entries(overrides.resource_quantities)) {
      const wanted = String(resName).trim().toLowerCase();
      const numQty = Number(qty);
      if (!Number.isFinite(numQty)) continue;
      const target = clonedResources.find((r) => String(r.name || '').trim().toLowerCase() === wanted);
      if (target) {
        target.quantity = numQty;
      }
    }
  }

  // If overrides.resources is directly passed as an array (e.g. manual creation / AI suggestion)
  if (Array.isArray(overrides.resources) && resChanges.length === 0 && !overrides.resource_quantities) {
    for (const overrideRes of overrides.resources) {
      const wanted = String(overrideRes.name || overrideRes.id || '').trim().toLowerCase();
      const qty = Number(overrideRes.quantity);
      if (!Number.isFinite(qty)) continue;
      const target = clonedResources.find(
        (r) =>
          String(r.name || '').trim().toLowerCase() === wanted ||
          (overrideRes.id && String(r.id || '').trim().toLowerCase() === String(overrideRes.id).trim().toLowerCase())
      );
      if (target) {
        target.quantity = qty;
      }
    }
  }

  // 3. Apply duration overrides: duration fields x multiplier (keep duration_unit)
  const nodeChanges = overrides.nodeChanges || variantDef.nodeChanges || [];

  for (const change of nodeChanges) {
    const wantedId = String(change.id || change.nodeId || '').trim().toLowerCase();
    const wantedLabel = String(change.label || change.name || '').trim().toLowerCase();
    const mult = Number(change.duration_multiplier != null ? change.duration_multiplier : change.multiplier);
    const node = clonedNodes.find((n) => {
      const nid = String(n.id || '').trim().toLowerCase();
      const nlabel = String(n.data?.label || n.data?.name || n.label || n.name || '').trim().toLowerCase();
      return (wantedId && nid === wantedId) || (wantedLabel && nlabel === wantedLabel);
    });
    if (!node) continue;
    const data = node.data && typeof node.data === 'object' ? node.data : node;

    if (Number.isFinite(mult)) {
      for (const field of ['duration', 'duration_min', 'duration_max']) {
        if (data[field] !== undefined && data[field] !== null && Number.isFinite(Number(data[field]))) {
          data[field] = Number((Number(data[field]) * mult).toFixed(4));
        }
      }
    } else {
      // Explicit absolute durations (e.g. from implementSuggestion)
      if (typeof change.duration === 'number') data.duration = change.duration;
      if (typeof change.duration_min === 'number') data.duration_min = change.duration_min;
      if (typeof change.duration_max === 'number') data.duration_max = change.duration_max;
    }
    // duration_unit is kept strictly untouched
  }

  // Support map-style node multipliers: { node_multipliers: { "bake_pizza": 0.5 } }
  if (overrides.node_multipliers && typeof overrides.node_multipliers === 'object' && !Array.isArray(overrides.node_multipliers)) {
    for (const [nodeKey, multVal] of Object.entries(overrides.node_multipliers)) {
      const wanted = String(nodeKey).trim().toLowerCase();
      const mult = Number(multVal);
      if (!Number.isFinite(mult)) continue;
      const node = clonedNodes.find((n) => {
        const nid = String(n.id || '').trim().toLowerCase();
        const nlabel = String(n.data?.label || n.data?.name || n.label || n.name || '').trim().toLowerCase();
        return nid === wanted || nlabel === wanted;
      });
      if (!node) continue;
      const data = node.data && typeof node.data === 'object' ? node.data : node;
      for (const field of ['duration', 'duration_min', 'duration_max']) {
        if (data[field] !== undefined && data[field] !== null && Number.isFinite(Number(data[field]))) {
          data[field] = Number((Number(data[field]) * mult).toFixed(4));
        }
      }
    }
  }

  // Support global duration multiplier at root: { duration_multiplier: 1.5 }
  const globalMult = Number(overrides.duration_multiplier != null ? overrides.duration_multiplier : overrides.multiplier);
  if (Number.isFinite(globalMult) && nodeChanges.length === 0 && !overrides.node_multipliers) {
    for (const node of clonedNodes) {
      const data = node.data && typeof node.data === 'object' ? node.data : node;
      for (const field of ['duration', 'duration_min', 'duration_max']) {
        if (data[field] !== undefined && data[field] !== null && Number.isFinite(Number(data[field]))) {
          data[field] = Number((Number(data[field]) * globalMult).toFixed(4));
        }
      }
    }
  }

  // If overrides.nodes is explicitly provided in manual / implement-suggestion path,
  // update matching node data without modifying layout or structure unless structure differs
  let finalNodes = clonedNodes;
  if (Array.isArray(overrides.nodes) && nodeChanges.length === 0 && !overrides.node_multipliers && !Number.isFinite(globalMult)) {
    if (overrides.nodes.length !== clonedNodes.length) {
      finalNodes = deepClone(overrides.nodes);
    } else {
      let hasStructuralDiff = false;
      for (const overrideNode of overrides.nodes) {
        const target = clonedNodes.find((n) => String(n.id) === String(overrideNode.id));
        if (!target || (overrideNode.type && overrideNode.type !== target.type)) {
          hasStructuralDiff = true;
          break;
        }
        if (overrideNode.pool !== undefined && overrideNode.pool !== target.pool) {
          hasStructuralDiff = true;
          break;
        }
        if (overrideNode.lane !== undefined && overrideNode.lane !== target.lane) {
          hasStructuralDiff = true;
          break;
        }
        if (overrideNode.data && typeof overrideNode.data === 'object') {
          const targetData = target.data && typeof target.data === 'object' ? target.data : target;
          for (const field of ['duration', 'duration_min', 'duration_max', 'resources', 'resource']) {
            if (overrideNode.data[field] !== undefined) {
              targetData[field] = overrideNode.data[field];
            }
          }
        }
      }
      if (hasStructuralDiff) {
        finalNodes = deepClone(overrides.nodes);
      }
    }
  }

  let finalEdges = clonedEdges;
  if (Array.isArray(overrides.edges)) {
    if (overrides.edges.length !== clonedEdges.length) {
      finalEdges = normalizeEdges(deepClone(overrides.edges));
    }
  }

  let finalLayoutElements = clonedLayoutElements;
  if (Array.isArray(overrides.layoutElements)) {
    if (overrides.layoutElements.length !== clonedLayoutElements.length) {
      finalLayoutElements = deepClone(overrides.layoutElements);
    }
  }

  // 4. Structure-equality check against base (do NOT run full validateBpmn when only resources or durations changed)
  const struct = checkStructureEquality(raw, {
    nodes: finalNodes,
    edges: finalEdges,
    layoutElements: finalLayoutElements,
  });

  if (!struct.equal) {
    const msg = `Cannot save scenario: BPMN structure differs from base process: ${struct.reason}`;
    const err = new Error(msg);
    err.name = 'BpmnValidationError';
    err.errors = [struct.reason];
    throw err;
  }

  return {
    baseProcessId,
    title,
    nodes: finalNodes,
    edges: finalEdges,
    layoutElements: finalLayoutElements,
    resources: clonedResources,
    simulationConfig,
    goal,
  };
}

module.exports = {
  cloneProcessToScenario,
  checkStructureEquality,
  normalizeEdges,
  normalizeEdgeData,
  deepClone,
  getValidateBpmn,
};
