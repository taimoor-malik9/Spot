/**
 * Validate a process model (frontend validation before sending to backend)
 * @param {any} model - The process model to validate
 * @returns {string[]} Array of validation error messages
 */
export function validateProcess(model) {
  const errors = [];

  if (model.nodes.length === 0) {
    errors.push('Process must have at least one node');
    return errors;
  }

  // Check for start node
  const hasStart = model.nodes.some(n => n.type === 'start');
  if (!hasStart) {
    errors.push('Process must have a Start node');
  }

  // Check for end node
  const hasEnd = model.nodes.some(n => n.type === 'end');
  if (!hasEnd) {
    errors.push('Process must have an End node');
  }

  // Check for disconnected nodes
  const connectedNodeIds = new Set();
  model.edges.forEach(edge => {
    connectedNodeIds.add(edge.source);
    connectedNodeIds.add(edge.target);
  });

  model.nodes.forEach(node => {
    if (!connectedNodeIds.has(node.id)) {
      // Start node can be unconnected if it's the only node
      if (!(node.type === 'start' && model.nodes.length === 1)) {
        errors.push(`Node "${node.data.label}" is not connected to the workflow`);
      }
    }
  });

  // Check task durations
  model.nodes.forEach(node => {
    if (node.type === 'task' && node.data.duration && node.data.duration <= 0) {
      errors.push(`Task "${node.data.label}" must have a duration greater than 0`);
    }
  });

  return errors;
}
