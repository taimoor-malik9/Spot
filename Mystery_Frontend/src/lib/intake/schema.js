/**
 * lib/intake/schema.js
 *
 * Defines the schema, mappings, constants, and value-wrapping utilities
 * for the guided Intake mode in SPOT.
 *
 * Answer shape:
 * {
 *   steps: {
 *     [nodeId]: {
 *       speed: 'quick' | 'normal' | 'slow' | 'unsure',
 *       staffRoles: string[],
 *       kept?: boolean
 *     }
 *   },
 *   busyness: 'quiet' | 'steady' | 'packed' | 'unsure',
 *   exceptions: any[],
 *   hasLimitedSpace: boolean | null,
 *   spaceName?: string,
 *   spaceUnits?: number,
 *   spaceStepId?: string,
 *   goal: 'waiting' | 'cost' | 'throughput',
 *   costs?: { [role: string]: number }
 * }
 *
 * Every value carries { source: 'tap' | 'typed' | 'default', estimated: boolean }.
 */

export const SPEED_MAPPINGS = Object.freeze({
  quick: Object.freeze({
    duration_min: 1,
    duration: 1,
    duration_max: 2,
    duration_unit: 'minutes',
  }),
  normal: Object.freeze({
    duration_min: 3,
    duration: 5,
    duration_max: 8,
    duration_unit: 'minutes',
  }),
  slow: Object.freeze({
    duration_min: 10,
    duration: 15,
    duration_max: 25,
    duration_unit: 'minutes',
  }),
});

export const DEFAULT_SPEED = 'normal';

export const BUSYNESS_MAPPINGS = Object.freeze({
  quiet: Object.freeze({
    customers_per_hour: 5,
    arrival_gap_minutes: 12, // 60 / 5 = 12 min between arrivals
    arrival_rate: 5 / 60,    // 0.0833 cases per minute
  }),
  steady: Object.freeze({
    customers_per_hour: 20,
    arrival_gap_minutes: 3,  // 60 / 20 = 3 min between arrivals
    arrival_rate: 20 / 60,   // 0.3333 cases per minute
  }),
  packed: Object.freeze({
    customers_per_hour: 45,
    arrival_gap_minutes: 60 / 45, // 1.3333 min between arrivals
    arrival_rate: 45 / 60,        // 0.75 cases per minute
  }),
});

export const DEFAULT_BUSYNESS = 'steady';

export const VALID_GOALS = Object.freeze(['waiting', 'cost', 'throughput']);
export const DEFAULT_GOAL = 'waiting';

export const DEFAULT_HAS_LIMITED_SPACE = false;
export const DEFAULT_SPACE_NAME = 'Space';
export const DEFAULT_SPACE_UNITS = 1;

export const VALUE_SOURCES = Object.freeze(['tap', 'typed', 'default']);

/**
 * Wraps a value with intake provenance metadata.
 *
 * @param {*} value
 * @param {'tap'|'typed'|'default'} source
 * @param {boolean} estimated
 * @returns {{ value: *, source: string, estimated: boolean }}
 */
export function wrapValue(value, source = 'tap', estimated = false) {
  return {
    value,
    source,
    estimated: Boolean(estimated),
  };
}

/**
 * Extracts { value, source, estimated } from an answer field.
 * Handles raw values, wrapped objects, null/undefined, and 'unsure' entries.
 *
 * @param {*} entry
 * @param {*} fallbackValue
 * @returns {{ value: *, source: 'tap'|'typed'|'default', estimated: boolean }}
 */
export function unwrapValue(entry, fallbackValue) {
  if (entry === undefined || entry === null) {
    return {
      value: fallbackValue,
      source: 'default',
      estimated: true,
    };
  }

  // Wrapped object shape: { value, source?, estimated? }
  if (typeof entry === 'object' && !Array.isArray(entry) && 'value' in entry) {
    if (entry.value === 'unsure' || entry.value === undefined || entry.value === null) {
      return {
        value: fallbackValue,
        source: entry.source || 'default',
        estimated: true,
      };
    }
    return {
      value: entry.value,
      source: entry.source || 'tap',
      estimated: entry.estimated !== undefined ? Boolean(entry.estimated) : false,
    };
  }

  // Primitive 'unsure' keyword
  if (entry === 'unsure') {
    return {
      value: fallbackValue,
      source: 'tap',
      estimated: true,
    };
  }

  // Raw primitive value
  return {
    value: entry,
    source: 'tap',
    estimated: false,
  };
}

/**
 * Represents an intake assumption.
 */
export class Assumption {
  constructor(text, { field = null, estimated = true, ...rest } = {}) {
    this.text = text;
    this.message = text;
    this.field = field;
    this.estimated = Boolean(estimated);
    Object.assign(this, rest);
  }

  toString() {
    return this.text;
  }

  toJSON() {
    return {
      text: this.text,
      message: this.message,
      field: this.field,
      estimated: this.estimated,
    };
  }
}

/**
 * Helper to generate default answers object, optionally seeded from an existing diagram.
 */
export function createDefaultAnswers(rawDiagram = null) {
  const steps = {};
  if (rawDiagram?.nodes && Array.isArray(rawDiagram.nodes)) {
    for (const node of rawDiagram.nodes) {
      if (node.type === 'task') {
        steps[node.id] = {
          speed: wrapValue(DEFAULT_SPEED, 'default', true),
          staffRoles: wrapValue([], 'default', true),
          kept: node.origin === 'inferred' ? Boolean(node.kept) : true,
        };
      }
    }
  }

  return {
    steps,
    busyness: wrapValue(DEFAULT_BUSYNESS, 'default', true),
    exceptions: wrapValue([], 'default', false),
    hasLimitedSpace: wrapValue(DEFAULT_HAS_LIMITED_SPACE, 'default', true),
    spaceName: wrapValue(DEFAULT_SPACE_NAME, 'default', true),
    spaceUnits: wrapValue(DEFAULT_SPACE_UNITS, 'default', true),
    goal: wrapValue(DEFAULT_GOAL, 'default', true),
    costs: wrapValue({}, 'default', true),
  };
}
