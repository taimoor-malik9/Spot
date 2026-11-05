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
  const layoutElements = (process.layoutElements || []).map(layout => ({
    id: layout.id,
    type: layout.type,
    label: layout.label || layout.data?.label || layout.id,
    poolId: layout.poolId,
    position: layout.position || { x: 100, y: 100 },
    width: layout.width,
    height: layout.height,
    rowIndex: layout.rowIndex,
    data: layout.data || {},
  }));

  const nodeElements = (process.nodes || []).map(node => {
    const origin = node.data?.origin || node.origin || 'user';
    const kept = node.data?.kept !== undefined ? Boolean(node.data.kept) : (node.kept !== undefined ? Boolean(node.kept) : false);
    const estimated = Boolean(node.data?.estimated ?? node.estimated);
    return {
      id: node.id,
      type: node.data?.customType || backendTypeToFrontend(node.type),
      label: node.data?.label || node.id,
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
