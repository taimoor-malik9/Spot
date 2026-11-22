/**
 * shapeBackendToFrontend.js
 * Shared adapter to map backend process documents into frontend canvas elements and connections.
 */

export function backendTypeToFrontend(type) {
  if (type === 'start') return 'start-event';
  if (type === 'end') return 'end-event';
  if (type === 'gateway') return 'exclusive-gateway';
  return type || 'task';
}

export function shapeBackendToFrontend(process) {
  let layoutElements = (process.layoutElements || []).map(layout => ({
    id: layout.id,
    type: layout.type,
    label: layout.label || layout.data?.label || layout.id,
    pool: layout.pool || layout.poolId,
    poolId: layout.poolId || layout.pool,
    position: layout.position || { x: 100, y: 100 },
    width: layout.width,
    height: layout.height,
    rowIndex: layout.rowIndex,
    isExternal: Boolean(layout.isExternal || layout.data?.isExternal),
    data: layout.data || {},
  }));

  if (layoutElements.length === 0 && Array.isArray(process.nodes)) {
    layoutElements = process.nodes
      .filter(n => ['pool', 'lane'].includes(n.type))
      .map(n => ({
        id: n.id,
        type: n.type,
        label: n.label || n.data?.label || n.id,
        pool: n.pool || n.poolId,
        poolId: n.poolId || n.pool,
        position: n.position || { x: 100, y: 100 },
        width: n.width,
        height: n.height,
        rowIndex: n.rowIndex,
        isExternal: Boolean(n.isExternal || n.data?.isExternal),
        data: n.data || {},
      }));
  }

  const nodeElements = (process.nodes || [])
    .filter(node => !['pool', 'lane'].includes(node.type))
    .map(node => {
    const origin = node.data?.origin || node.origin || 'user';
    const kept = node.data?.kept !== undefined ? Boolean(node.data.kept) : (node.kept !== undefined ? Boolean(node.kept) : false);
    const estimated = Boolean(node.data?.estimated ?? node.estimated);
    const rawLabel = node.data?.label != null && node.data.label !== '' ? node.data.label : (node.label || '');
    const cleanLabel = /^(gw_|task_|step_|node_|end_|start_).+|_\d+$/i.test(rawLabel || node.id) ? '' : rawLabel;
    return {
      id: node.id,
      type: node.data?.customType || backendTypeToFrontend(node.type),
      label: cleanLabel,
      pool: node.pool || null,
      lane: node.lane || null,
      parent: node.parent || null,
      position: node.position || { x: 100, y: 100 },
      width: node.width,
      height: node.height,
      origin,
      kept,
      data: {
        label: node.data?.label || '',
        duration: node.data?.duration,
        duration_min: node.data?.duration_min,
        duration_max: node.data?.duration_max,
        duration_unit: node.data?.duration_unit || 'minutes',
        origin,
        kept,
        estimated,
        resources: node.data?.resources || {},
        gateway_type: node.data?.gateway_type || null,
        customType: node.data?.customType || null,
      },
    };
  });

  const elements = [...layoutElements, ...nodeElements];

  const connections = (process.edges || []).map((edge, i) => {
    const isMessage =
      edge.flowType === 'message' ||
      edge.type === 'message-flow' ||
      edge.type === 'message' ||
      edge.data?.type === 'message-flow' ||
      edge.data?.flowType === 'message';
    return {
      id: edge._id || edge.id || `edge-${i}`,
      fromId: edge.source,
      toId: edge.target,
      from: edge.source,
      to: edge.target,
      type: isMessage ? 'message-flow' : 'sequence-flow',
      flowType: isMessage ? 'message' : 'sequence',
      probability: edge.data?.probability ?? edge.probability,
      data: edge.data || {},
    };
  });

  return { elements, connections };
}
