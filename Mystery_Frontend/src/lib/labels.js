import React, { useState, useEffect, useCallback, useRef } from 'react';

/**
 * labels.js - Plain-language dictionary and helpers for owner-facing views.
 *
 * Translates technical simulation and modeling jargon into plain business language.
 * Provides the <Hint> component for inline tooltips and the shared formatter for
 * replacing internal node/string IDs with user-facing labels.
 */

export const LABELS = {
  cycle_time: {
    plain: 'Time from arrival to leaving',
    technical: 'Cycle Time',
    hint: 'The total time a customer or job takes from the moment it arrives until completion.',
  },
  throughput: {
    plain: 'Customers served per hour',
    technical: 'Throughput',
    hint: 'How many customers or units the process completes in one hour.',
  },
  utilization: {
    plain: 'How busy staff are',
    technical: 'Utilization',
    hint: 'The percentage of working hours staff spend actively doing work versus waiting.',
  },
  idle_cost: {
    plain: 'Paid time with no work',
    technical: 'Idle Cost',
    hint: 'The payroll cost paid to staff while they are waiting between tasks with no active work.',
  },
  active_cost: {
    plain: 'Cost of active work',
    technical: 'Active Cost',
    hint: 'Cost of staff and equipment time spent actively working on tasks.',
  },
  bottleneck: {
    plain: 'Where customers wait',
    technical: 'Bottleneck',
    hint: 'The step or constraint with the longest wait, limiting total process speed.',
  },
  baseline: {
    plain: 'Current setup',
    technical: 'Baseline',
    hint: 'Your original, existing process configuration used as a benchmark for comparison.',
  },
  scenario: {
    plain: 'Idea to try',
    technical: 'Scenario',
    hint: 'A what-if change to staff or steps to see if the process improves before making real changes.',
  },
  scenarios: {
    plain: 'Ideas to try',
    technical: 'Scenarios',
    hint: 'What-if changes to staff or steps tested against your current process.',
  },
  simulation: {
    plain: 'Test run',
    technical: 'Simulation',
    hint: 'A computer test running hundreds of customer visits to measure time, queues, and cost.',
  },
  simulations: {
    plain: 'Test runs',
    technical: 'Simulations',
    hint: 'Computer tests running customer visits to measure time, queues, and cost.',
  },
  gateway: {
    plain: 'Decision point',
    technical: 'Gateway',
    hint: 'A point in the flow where paths split into options or recombine.',
  },
  gateways: {
    plain: 'Decision points',
    technical: 'Gateways',
    hint: 'Points in the flow where paths split into options or recombine.',
  },
  swimlane: {
    plain: 'Role / Lane',
    technical: 'Swimlane',
    hint: 'A visual track showing which role, person, or department does each task.',
  },
  swimlanes: {
    plain: 'Roles & Lanes',
    technical: 'Swimlanes',
    hint: 'Visual tracks showing which role, person, or department does each task.',
  },
  pool: {
    plain: 'Organization',
    technical: 'Pool',
    hint: 'A boundary showing your business or an outside partner such as a supplier or customer.',
  },
  pools: {
    plain: 'Organizations',
    technical: 'Pools',
    hint: 'Boundaries showing your business or outside partners such as suppliers or customers.',
  },
  bpmn: {
    plain: 'Process diagram',
    technical: 'BPMN Diagram',
    hint: 'Standard visual representation of steps, choices, and responsibilities.',
  },
  replication: {
    plain: 'Repeated run',
    technical: 'Replication',
    hint: 'Repeating a test run multiple times with random customer arrivals to ensure reliable results.',
  },
  replications: {
    plain: 'Repeated runs',
    technical: 'Replications',
    hint: 'Repeating test runs multiple times to ensure reliable results.',
  },
  seed: {
    plain: 'Random variation key',
    technical: 'Random Seed',
    hint: 'A number that controls random arrival patterns so you can reproduce exact test conditions.',
  },
  iteration: {
    plain: 'Test step',
    technical: 'Iteration',
    hint: 'A single complete run of an event or calculation during a test.',
  },
  iterations: {
    plain: 'Test steps',
    technical: 'Iterations',
    hint: 'Complete runs of events or calculations during a test.',
  },
  arrival_rate: {
    plain: 'Arrival frequency',
    technical: 'Arrival Rate',
    hint: 'How often new customers or jobs arrive at your business.',
  },
};

/**
 * Plain-language tooltips for the Elements Palette items
 */
export const PALETTE_TOOLTIPS = {
  // Events
  'start-event': 'Start of the process: where customer or work arrives',
  'message-start-event': 'External trigger: begins when a message, order, or email arrives',
  'timer-start-event': 'Scheduled start: begins automatically at a specific time or day',
  'conditional-start-event': 'Rule start: begins when a business condition is satisfied',
  'signal-start-event': 'Broadcast start: begins when a system signal is received',
  'intermediate-event': 'Milestone: an event that occurs midway through the process',
  'message-intermediate-catch': 'Wait for message: pauses until external information arrives',
  'message-intermediate-throw': 'Send message: notifies an outside party or system',
  'timer-intermediate-catch': 'Delay / Wait: pauses for a fixed duration before continuing',
  'conditional-intermediate-catch': 'Wait for condition: pauses until a rule is met',
  'signal-intermediate-catch': 'Wait for signal: pauses until a broadcast is received',
  'signal-intermediate-throw': 'Send signal: broadcasts an update across the process',
  'end-event': 'End of the process: customer leaves or work is fully complete',
  'message-end-event': 'End with message: finishes and sends final notification',
  'error-end-event': 'End with problem: finishes due to an unrecoverable error',
  'escalation-end-event': 'End with escalation: finishes by passing to higher management',
  'signal-end-event': 'End with signal: finishes and alerts related systems',
  'terminate-end-event': 'Immediate stop: stops all active parallel tasks immediately',

  // Activities
  'task': 'Task: a unit of work performed by staff or system',
  'user-task': 'Staff task: work done manually by a team member',
  'service-task': 'Automated step: work done automatically by software',
  'script-task': 'Calculation / Script: automated data or formula step',
  'manual-task': 'Physical task: work done by hand without software',
  'send-task': 'Dispatch task: sends out an invoice, package, or notice',
  'receive-task': 'Intake task: waits to accept a deliverable or request',
  'business-rule-task': 'Policy check: validates against business rules',
  'subprocess': 'Sub-workflow: a detailed multi-step process inside this step',
  'call-activity': 'Reusable process: calls another standard business process',

  // Gateways
  'exclusive-gateway': 'Decision point: the process goes one way or another based on a choice',
  'parallel-gateway': 'Split or join: tasks happen at the same time in parallel',
  'inclusive-gateway': 'Flexible choice: one or more paths can be taken simultaneously',
  'complex-gateway': 'Advanced decision: multiple conditions determine routing',
  'event-based-gateway': 'Event choice: whichever customer response happens first decides the path',

  // Flows
  'sequence-flow': 'Next step arrow: directs the flow from one activity to the next',
  'message-flow': 'Communication flow: exchanges messages across organizations',
  'association': 'Connection: attaches notes or documents to steps',

  // Swimlanes
  'pool': 'Organization boundary: represents your entire company or an external party',
  'lane': 'Role / Department: assigns steps to a specific person or team',

  // Artifacts
  'data-object': 'Document / Record: paperwork or digital file used in a step',
  'data-store': 'Database / Storage: where files or records are saved',
  'document': 'Paper or electronic form: paperwork filled or viewed',
  'annotation': 'Note: explanatory comment explaining a step',
  'group': 'Visual group: highlights related steps together',
  'input': 'Input item: item required to start a step',
  'output': 'Output item: item produced after a step finishes',
};

/**
 * Returns readable default name for a newly created process: "New process, <date>"
 */
export function getDefaultProcessTitle() {
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `New process, ${dateStr}`;
}

/**
 * Reads Analyst View preference from localStorage per user
 */
export function getAnalystView(userId) {
  if (typeof window === 'undefined') return false;
  try {
    const key = userId ? `spot:analyst_view:${userId}` : 'spot:analyst_view';
    const val = localStorage.getItem(key);
    if (val !== null) return val === 'true';
    return localStorage.getItem('spot:analyst_view') === 'true';
  } catch {
    return false;
  }
}

/**
 * Stores Analyst View preference in localStorage per user and dispatches event
 */
export function setAnalystView(value, userId) {
  if (typeof window === 'undefined') return;
  try {
    const str = value ? 'true' : 'false';
    if (userId) {
      localStorage.setItem(`spot:analyst_view:${userId}`, str);
    }
    localStorage.setItem('spot:analyst_view', str);
    window.dispatchEvent(new CustomEvent('spot:analyst_view_change', { detail: { isAnalystView: !!value } }));
  } catch {}
}

/**
 * React hook to read and toggle Analyst View
 */
export function useAnalystView(userId) {
  const [isAnalystView, setIsAnalystViewState] = useState(() => getAnalystView(userId));

  useEffect(() => {
    setIsAnalystViewState(getAnalystView(userId));
    const handleStorage = () => setIsAnalystViewState(getAnalystView(userId));
    window.addEventListener('storage', handleStorage);
    window.addEventListener('spot:analyst_view_change', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('spot:analyst_view_change', handleStorage);
    };
  }, [userId]);

  const toggle = useCallback((val) => {
    setIsAnalystViewState((prev) => {
      const next = typeof val === 'boolean' ? val : !prev;
      setAnalystView(next, userId);
      return next;
    });
  }, [userId]);

  return [isAnalystView, toggle];
}

/**
 * Get plain or technical wording for a dictionary key
 */
export function getLabel(key, isAnalystView = false) {
  const entry = LABELS[key];
  if (!entry) return key;
  return isAnalystView ? entry.technical : entry.plain;
}

/**
 * Internal ID regex: matches tokens like task_1, start_event_2, receive_order, etc.
 */
export const INTERNAL_ID_REGEX = /^[a-z]+(_[a-z0-9]+)+$/i;

/**
 * Shared Formatter:
 * 1. Replaces known node IDs or tokens matching /^[a-z]+(_[a-z0-9]+)+$/ with the step's label.
 * 2. In simple view (!isAnalystView), replaces forbidden technical jargon with plain wording.
 */
export function formatPlainLanguage(text, options = {}) {
  if (text == null) return '';
  let str = String(text);

  const { isAnalystView = false, nodes = [], idToLabel = {} } = options;

  // Build lookup map from elements
  const nodeMap = { ...idToLabel };
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      if (!n) continue;
      const id = n.id || n._id;
      const lbl = n.data?.label || n.label;
      if (id && lbl && lbl.trim()) {
        nodeMap[id] = lbl.trim();
        nodeMap[String(id).toLowerCase()] = lbl.trim();
      }
    }
  }

  // Also check localStorage if available and nodes array was empty
  if (Object.keys(nodeMap).length === 0 && typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('spot:model:nodes');
      if (raw) {
        const parsed = JSON.parse(raw);
        const list = parsed.nodes || (Array.isArray(parsed) ? parsed : []);
        list.forEach(n => {
          const id = n.id || n._id;
          const lbl = n.data?.label || n.label;
          if (id && lbl && lbl.trim()) {
            nodeMap[id] = lbl.trim();
            nodeMap[String(id).toLowerCase()] = lbl.trim();
          }
        });
      }
    } catch {}
  }

  // 1. Replace exact node ID occurrences
  for (const [id, label] of Object.entries(nodeMap)) {
    if (!id || !label || id === label) continue;
    const escaped = id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    str = str.replace(new RegExp(`\\b${escaped}\\b`, 'g'), label);
  }

  // 2. Replace any remaining snake_case internal IDs matching /^[a-z]+(_[a-z0-9]+)+$/i
  str = str.replace(/\b([a-z]+(_[a-z0-9]+)+)\b/gi, (match) => {
    if (nodeMap[match]) return nodeMap[match];
    if (nodeMap[match.toLowerCase()]) return nodeMap[match.toLowerCase()];
    // Humanize snake_case into Title Words (e.g. order_receive -> Order Receive)
    return match
      .split('_')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  });

  // 3. In Simple view, replace forbidden technical jargon words with plain language
  if (!isAnalystView) {
    str = replaceForbiddenJargon(str);
  }

  return str;
}

/**
 * Replaces technical keywords when in simple view (case-preserving)
 */
function replaceForbiddenJargon(text) {
  let s = text;

  const replacements = [
    // Multi-word phrases first
    [/\bresource utilization\b/gi, 'how busy staff are'],
    [/\bcycle time\b/gi, 'time from arrival to leaving'],
    [/\bthroughput rate\b/gi, 'customers served per hour'],
    [/\bthroughput\b/gi, 'customers served per hour'],
    [/\bidle cost\b/gi, 'paid time with no work'],
    [/\bbottleneck\b/gi, 'where customers wait'],
    [/\bwhat-if scenario\b/gi, 'idea to try'],
    [/\bwhat-if scenarios\b/gi, 'ideas to try'],
    [/\bscenario\b/gi, 'idea to try'],
    [/\bscenarios\b/gi, 'ideas to try'],
    [/\bsimulation run\b/gi, 'test run'],
    [/\bsimulation runs\b/gi, 'test runs'],
    [/\bsimulation\b/gi, 'test run'],
    [/\bsimulations\b/gi, 'test runs'],
    [/\bbaseline process\b/gi, 'current setup'],
    [/\bbaseline results\b/gi, 'current setup results'],
    [/\bbaseline\b/gi, 'current setup'],
    [/\bexclusive gateway\b/gi, 'decision point'],
    [/\bparallel gateway\b/gi, 'parallel branch'],
    [/\binclusive gateway\b/gi, 'choice point'],
    [/\bgateway routing\b/gi, 'decision routing'],
    [/\bgateway\b/gi, 'decision point'],
    [/\bgateways\b/gi, 'decision points'],
    [/\bswimlanes\b/gi, 'roles & lanes'],
    [/\bswimlane\b/gi, 'role lane'],
    [/\bpools\b/gi, 'organizations'],
    [/\bpool\b/gi, 'organization'],
    [/\bBPMN diagram\b/gi, 'process diagram'],
    [/\bBPMN elements\b/gi, 'process elements'],
    [/\bBPMN issue\b/gi, 'process issue'],
    [/\bBPMN issues\b/gi, 'process issues'],
    [/\bBPMN validation\b/gi, 'process check'],
    [/\bBPMN\b/gi, 'Process diagram'],
    [/\breplications\b/gi, 'repeated runs'],
    [/\breplication\b/gi, 'repeated run'],
    [/\brandom seed\b/gi, 'random variation key'],
    [/\bseed\b/gi, 'random variation key'],
    [/\butilization\b/gi, 'how busy staff are'],
    [/\biterations\b/gi, 'test steps'],
    [/\biteration\b/gi, 'test step'],
  ];

  for (const [re, replacement] of replacements) {
    s = s.replace(re, (match) => {
      // Preserve first character capitalization
      if (match.charAt(0) === match.charAt(0).toUpperCase()) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      return replacement;
    });
  }

  return s;
}

/**
 * <Hint> Component:
 * Shows the technical name and a one-line meaning on hover/focus.
 * In Simple view: renders plain wording with hover hint.
 * In Analyst view: renders technical wording directly.
 */
export function Hint({
  term,
  children,
  isAnalystView = false,
  technical: customTechnical,
  meaning: customMeaning,
  className = '',
  style = {},
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const entry = LABELS[term] || {};

  const technicalName = customTechnical || entry.technical || (term ? term.replace(/_/g, ' ') : '');
  const meaningText = customMeaning || entry.hint || '';
  const displayText = children || (isAnalystView ? entry.technical : entry.plain) || term;

  const tooltipEl = showTooltip
    ? React.createElement(
        'span',
        {
          className: 'spot-hint-bubble',
          style: {
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#0f172a',
            color: '#f8fafc',
            padding: '6px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            lineHeight: '1.4',
            whiteSpace: 'normal',
            minWidth: '180px',
            maxWidth: '260px',
            zIndex: 99999,
            pointerEvents: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            textAlign: 'left',
          },
        },
        React.createElement('strong', { style: { color: '#38bdf8', display: 'block', fontSize: '11px', marginBottom: '2px' } }, technicalName),
        React.createElement('span', { style: { color: '#e2e8f0', fontSize: '10px' } }, meaningText)
      )
    : null;

  return React.createElement(
    'span',
    {
      className: `spot-hint-wrap inline-flex items-center relative cursor-help ${className}`,
      style: { display: 'inline-flex', position: 'relative', alignItems: 'center', ...style },
      onMouseEnter: () => setShowTooltip(true),
      onMouseLeave: () => setShowTooltip(false),
      onFocus: () => setShowTooltip(true),
      onBlur: () => setShowTooltip(false),
      tabIndex: 0,
      role: 'tooltip',
      'aria-label': `${technicalName}: ${meaningText}`,
    },
    React.createElement(
      'span',
      {
        style: {
          borderBottom: !isAnalystView ? '1px dotted rgba(94, 67, 243, 0.4)' : '1px dotted rgba(100, 116, 139, 0.3)',
          transition: 'border-color 0.15s ease',
        },
      },
      displayText
    ),
    tooltipEl
  );
}

/**
 * Maps known failures to plain sentences with one fix action,
 * keeping technical details separate for a collapsed "Details" fold.
 */
export function mapToPlainError(error) {
  const raw = error?.message || String(error || '');

  // 1. Missing Staff
  if (/must be assigned to a swimlane|no staff assigned|unassigned task/i.test(raw)) {
    return {
      message: 'A step has no staff assigned. Assign staff or mark it as customer time.',
      fixAction: 'Click the step on the canvas and assign a staff role or lane.',
      details: raw,
    };
  }

  // 2. Missing Duration
  if (/Missing Task Duration|need a duration|needs a duration/i.test(raw)) {
    return {
      message: 'Some steps are missing time estimates. Set a duration for each step before running.',
      fixAction: 'Click the highlighted steps and enter how many minutes they take.',
      details: raw,
    };
  }

  // 3. Unconfigured Resource
  if (/Missing Resource Setup|isn't set up|is not set up/i.test(raw)) {
    return {
      message: 'A step uses a staff member or resource that is not set up yet.',
      fixAction: 'Open Setup to configure this staff role, or assign an existing person.',
      details: raw,
    };
  }

  // 4. Missing Start Event
  if (/at least one start event|no start event/i.test(raw)) {
    return {
      message: 'Your process needs a starting point. Add a start event where the customer arrives.',
      fixAction: 'Drag a Start Event from the Elements palette to begin the process.',
      details: raw,
    };
  }

  // 5. Missing End Event
  if (/End event .* must have|no end event/i.test(raw)) {
    return {
      message: 'Your process needs a finish point where customers leave or work completes.',
      fixAction: 'Connect the final steps to an End Event.',
      details: raw,
    };
  }

  // 6. Missing Probabilities / Decision Split
  if (/How often does each path happen|missing probabilities|probabilities sum/i.test(raw)) {
    return {
      message: 'A decision point needs path percentages so the test knows how often each branch happens.',
      fixAction: 'Click the decision diamond and set the percentage for each outgoing path to add up to 100%.',
      details: raw,
    };
  }

  // 7. Disconnected step
  if (/not reachable from any start event|disconnected/i.test(raw)) {
    return {
      message: 'A step is disconnected from the process flow.',
      fixAction: 'Draw sequence arrows connecting this step into the customer journey.',
      details: raw,
    };
  }

  // 8. Service / Engine down
  if (/ECONNREFUSED|simulation engine isn't reachable/i.test(raw)) {
    return {
      message: 'The test service is not reachable right now. Please try again in a few moments.',
      fixAction: 'Wait a moment and click Retry.',
      details: raw,
    };
  }

  // Fallback
  return {
    message: formatPlainLanguage(raw, { isAnalystView: false }),
    fixAction: 'Check your steps and connections, then try again.',
    details: raw,
  };
}

/**
 * <FriendlyErrorView>
 * Renders a plain-language error banner with fix action and collapsed "Details" fold.
 */
export function FriendlyErrorView({ error, onRetry }) {
  const err = mapToPlainError(error);
  const children = [
    React.createElement('div', { key: 'msg', style: { fontWeight: 600, marginBottom: '4px' } }, err.message),
    React.createElement('div', { key: 'fix', style: { color: '#b91c1c', fontSize: '12px', marginBottom: '8px' } },
      React.createElement('strong', null, 'Suggested fix: '),
      err.fixAction
    )
  ];

  if (err.details) {
    children.push(
      React.createElement('details', { key: 'details', style: { marginTop: '6px', fontSize: '11px', color: '#64748b' } },
        React.createElement('summary', { style: { cursor: 'pointer', fontWeight: 500, color: '#475569' } }, 'Technical Details'),
        React.createElement('pre', {
          style: {
            marginTop: '4px',
            padding: '6px 8px',
            background: '#f8fafc',
            borderRadius: '4px',
            overflowX: 'auto',
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#334155',
          }
        }, err.details)
      )
    );
  }

  if (onRetry) {
    children.push(
      React.createElement('button', {
        key: 'retry',
        type: 'button',
        onClick: onRetry,
        style: {
          marginTop: '8px',
          padding: '4px 10px',
          fontSize: '12px',
          borderRadius: '6px',
          border: '1px solid #fca5a5',
          background: '#ffffff',
          color: '#b91c1c',
          cursor: 'pointer',
          fontWeight: 500,
        }
      }, 'Try Again')
    );
  }

  return React.createElement('div', {
    style: {
      background: '#fef2f2',
      border: '1px solid #fecaca',
      borderRadius: '8px',
      padding: '12px 16px',
      color: '#991b1b',
      fontSize: '13px',
      lineHeight: '1.5',
    }
  }, children);
}
