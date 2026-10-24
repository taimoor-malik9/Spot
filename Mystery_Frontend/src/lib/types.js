/**
 * @typedef {('start' | 'task' | 'end')} NodeType
 */

/**
 * @typedef {Object} ProcessNodeData
 * @property {string} id
 * @property {string} label
 * @property {NodeType} type
 * @property {number} [duration] - in seconds
 * @property {string} [description]
 */

/**
 * @typedef {Object} ProcessNode
 * @property {string} id
 * @property {NodeType} type
 * @property {{x: number, y: number}} position
 * @property {ProcessNodeData} data
 */

/**
 * @typedef {Object} ProcessEdge
 * @property {string} source
 * @property {string} target
 * @property {string} [id]
 */

/**
 * @typedef {Object} ProcessMetadata
 * @property {string} [name]
 * @property {string} [description]
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 */

/**
 * @typedef {Object} ProcessModel
 * @property {ProcessNode[]} nodes
 * @property {ProcessEdge[]} edges
 * @property {ProcessMetadata} [metadata]
 */

/**
 * @typedef {('hour' | 'day' | 'week' | 'month')} DurationUnit
 */

/**
 * @typedef {Object} SimulationSettings
 * @property {DurationUnit} duration
 * @property {number} instances
 * @property {Record<string, number>} [resourceAllocation]
 * @property {boolean} [captureDetailedMetrics]
 * @property {boolean} [enableCostAnalysis]
 * @property {boolean} [identifyBottlenecks]
 */

/**
 * @typedef {Object} DayBreakdown
 * @property {number} day
 * @property {number} tasksCompleted
 * @property {string} avgDuration
 * @property {number} resourceUsage
 */

/**
 * @typedef {Object} SimulationResult
 * @property {number} completionRate
 * @property {string} avgCycleTime
 * @property {number} throughput
 * @property {number} costPerInstance
 * @property {number} efficiency
 * @property {number} resourceUtilization
 * @property {('completed' | 'in-progress' | 'failed')} status
 * @property {number} progress
 * @property {DayBreakdown[]} [dayWiseBreakdown]
 */

/**
 * @typedef {Object} ValidationError
 * @property {('error' | 'warning')} type
 * @property {string} message
 * @property {string[]} [nodeIds]
 */

module.exports = {
  // Types are exported as JSDoc comments above
};
