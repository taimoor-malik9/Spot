/**
 * BPMN Element Definitions
 * Organized by category with metadata for rendering and interaction
 */

import {
  Circle,
  CircleDot,
  CircleDashed,
  Square,
  SquareDashedBottom,
  Diamond,
  Hexagon,
  Octagon,
  ArrowRight,
  ArrowRightDashed,
  RectangleHorizontal,
  Columns,
  File,
  MessageSquare,
} from 'lucide-react';

export const BPMN_CATEGORIES = [
  'events',
  'activities',
  'gateways',
  'flows',
  'swimlanes',
  'artifacts',
];

export const BPMN_ELEMENT_DEFINITIONS = [
  // EVENTS (Category 1)
  {
    id: 'start-event',
    type: 'start-event',
    label: 'Start Event',
    category: 'events',
    isAdvanced: false,
    icon: Circle,
    description: 'Triggers the start of a process',
  },
  {
    id: 'end-event',
    type: 'end-event',
    label: 'End Event',
    category: 'events',
    isAdvanced: false,
    icon: CircleDot,
    description: 'Marks the end of a process path',
  },
  {
    id: 'intermediate-event',
    type: 'intermediate-event',
    label: 'Intermediate Event',
    category: 'events',
    isAdvanced: true,
    icon: CircleDashed,
    description: 'Occurs during process execution',
  },

  // ACTIVITIES (Category 2)
  {
    id: 'task',
    type: 'task',
    label: 'Task',
    category: 'activities',
    isAdvanced: false,
    icon: Square,
    description: 'Atomic work unit in the process',
  },
  {
    id: 'subprocess',
    type: 'subprocess',
    label: 'Sub-Process',
    category: 'activities',
    isAdvanced: true,
    icon: SquareDashedBottom,
    description: 'Complex activity composed of sub-tasks',
  },

  // GATEWAYS (Category 3)
  {
    id: 'exclusive-gateway',
    type: 'exclusive-gateway',
    label: 'Exclusive Gateway',
    category: 'gateways',
    isAdvanced: false,
    icon: Diamond,
    description: 'Single decision point with exclusive branches',
  },
  {
    id: 'parallel-gateway',
    type: 'parallel-gateway',
    label: 'Parallel Gateway',
    category: 'gateways',
    isAdvanced: false,
    icon: Hexagon,
    description: 'Splits into parallel paths or joins them',
  },
  {
    id: 'inclusive-gateway',
    type: 'inclusive-gateway',
    label: 'Inclusive Gateway',
    category: 'gateways',
    isAdvanced: true,
    icon: Octagon,
    description: 'Multi-choice decision logic',
  },

  // FLOWS (Category 4)
  {
    id: 'sequence-flow',
    type: 'sequence-flow',
    label: 'Sequence Flow',
    category: 'flows',
    isAdvanced: false,
    icon: ArrowRight,
    description: 'Defines order of execution between elements',
  },
  {
    id: 'message-flow',
    type: 'message-flow',
    label: 'Message Flow',
    category: 'flows',
    isAdvanced: true,
    icon: ArrowRightDashed,
    description: 'Communication flow between processes',
  },

  // SWIMLANES (Category 5)
  {
    id: 'pool',
    type: 'pool',
    label: 'Pool',
    category: 'swimlanes',
    isAdvanced: false,
    icon: RectangleHorizontal,
    description: 'Contains a complete process',
  },
  {
    id: 'lane',
    type: 'lane',
    label: 'Lane',
    category: 'swimlanes',
    isAdvanced: false,
    icon: Columns,
    description: 'Subdivisions within a pool',
  },

  // ARTIFACTS (Category 6)
  {
    id: 'data-object',
    type: 'data-object',
    label: 'Data Object',
    category: 'artifacts',
    isAdvanced: false,
    icon: File,
    description: 'Represents data required by the process',
  },
  {
    id: 'annotation',
    type: 'annotation',
    label: 'Annotation',
    category: 'artifacts',
    isAdvanced: false,
    icon: MessageSquare,
    description: 'Adds notes and documentation to diagram',
  },
];

/**
 * Group elements by category
 */
export const BPMN_ELEMENTS_BY_CATEGORY = BPMN_CATEGORIES.reduce(
  (acc, category) => {
    acc[category] = BPMN_ELEMENT_DEFINITIONS.filter(
      (element) => element.category === category
    );
    return acc;
  },
  {}
);

/**
 * Get basic elements (non-advanced) for a category
 */
export const getBasicElements = (category) => {
  return BPMN_ELEMENTS_BY_CATEGORY[category]?.filter((el) => !el.isAdvanced) || [];
};

/**
 * Get advanced elements for a category
 */
export const getAdvancedElements = (category) => {
  return BPMN_ELEMENTS_BY_CATEGORY[category]?.filter((el) => el.isAdvanced) || [];
};

/**
 * Get category display name
 */
export const getCategoryDisplayName = (category) => {
  const names = {
    events: 'Events',
    activities: 'Activities',
    gateways: 'Gateways',
    flows: 'Flows',
    swimlanes: 'Swimlanes',
    artifacts: 'Artifacts',
  };
  return names[category] || category;
};
