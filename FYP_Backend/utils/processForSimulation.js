// Convert a stored Process document into the engine's compact BPMN shape.
// Kept shared so every simulation entry point applies the same normalization.
function processForSimulation(processDoc) {
  const processData = typeof processDoc.toJSON === 'function' ? processDoc.toJSON() : processDoc;

  const nodePoolMap = {};
  (processData.nodes || []).forEach(node => {
    nodePoolMap[node.id] = node.pool || node.data?.pool || null;
  });

  const rawEdges = processData.edges || [];
  const msgEdges = rawEdges.filter(e =>
    e.flowType === 'message' || e.type === 'message' || e.data?.flowType === 'message'
  );

  const outMsgSources = new Set(
    msgEdges
      .filter(e => nodePoolMap[e.source] && nodePoolMap[e.target] && nodePoolMap[e.source] !== nodePoolMap[e.target])
      .map(e => e.source)
  );

  const inMsgTargets = new Set(
    msgEdges
      .filter(e => nodePoolMap[e.source] && nodePoolMap[e.target] && nodePoolMap[e.source] !== nodePoolMap[e.target])
      .map(e => e.target)
  );

  const cleanNodes = (processData.nodes || []).map(node => {
    const d = node.data || {};
    let taskResources = d.resources || {};
    if (taskResources instanceof Map) taskResources = Object.fromEntries(taskResources);

    let resourceName = d.resource || d.resource_id || null;
    if (typeof resourceName === 'string') resourceName = resourceName.trim().toLowerCase();
    if (!resourceName && Object.keys(taskResources).length > 0) {
      const firstKey = Object.keys(taskResources).find(
        key => taskResources[key] > 0 && !key.startsWith('$') && !key.startsWith('_')
      );
      if (firstKey) resourceName = firstKey.trim().toLowerCase();
    }

    return {
      id: node.id,
      type: node.type,
      pool: node.pool || node.data?.pool || null,
      data: {
        label: d.label || node.label || '',
        duration: (d.duration !== undefined && d.duration !== null) ? Number(d.duration) : ((node.duration !== undefined && node.duration !== null) ? Number(node.duration) : null),
        duration_min: (d.duration_min !== undefined && d.duration_min !== null) ? Number(d.duration_min) : ((node.duration_min !== undefined && node.duration_min !== null) ? Number(node.duration_min) : null),
        duration_max: (d.duration_max !== undefined && d.duration_max !== null) ? Number(d.duration_max) : ((node.duration_max !== undefined && node.duration_max !== null) ? Number(node.duration_max) : null),
        duration_unit: d.duration_unit || node.duration_unit || 'minutes',
        origin: d.origin ?? node.origin ?? null,
        kept: d.kept ?? node.kept ?? false,
        resource: resourceName,
        resources: taskResources,
      },
    };
  });

  const cleanEdges = rawEdges
    .filter(edge => {
      const src = edge.source;
      const tgt = edge.target;
      const isIntraPool = nodePoolMap[src] && nodePoolMap[tgt] && nodePoolMap[src] === nodePoolMap[tgt];
      if (isIntraPool && outMsgSources.has(src) && inMsgTargets.has(tgt)) {
        return false;
      }
      return true;
    })
    .map(edge => {
      let edgeData = edge.data || {};
      if (typeof edgeData === 'string') {
        try { edgeData = JSON.parse(edgeData); } catch { edgeData = {}; }
      }
      return {
        source: edge.source,
        target: edge.target,
        probability: edgeData.probability ?? null,
        data: edgeData,
      };
    });

  return { resources: processData.resources || [], nodes: cleanNodes, edges: cleanEdges };
}

module.exports = { processForSimulation };
