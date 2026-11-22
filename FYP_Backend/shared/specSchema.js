/**
 * shared/specSchema.js
 *
 * Defines and validates the domain-agnostic Stage 1 Spec Schema for SPOT process generation.
 *
 * Schema Structure:
 * {
 *   participants: {
 *     internal_roles: [{ name: string, count?: number }],
 *     external_parties: [{ name: string }]
 *   },
 *   triggers: [
 *     {
 *       name: string,
 *       type: 'arrival' | 'schedule' | 'message' | 'condition',
 *       rate?: number,
 *       unit?: 'minute' | 'hour' | 'day' | 'week',
 *       interval?: number
 *     }
 *   ],
 *   activities: [
 *     {
 *       name: string,
 *       performer_role: string,
 *       duration?: number,
 *       cost?: number,
 *       depends_on?: string
 *     }
 *   ],
 *   decisions: [
 *     {
 *       question: string,
 *       branches: [
 *         {
 *           label: string,
 *           probability?: number
 *         }
 *       ]
 *     }
 *   ],
 *   resources_and_costs: [
 *     {
 *       role_or_item: string,
 *       quantity?: number,
 *       salary?: number,
 *       unit_cost?: number,
 *       capital?: number,
 *       currency?: string
 *     }
 *   ],
 *   quantities: [
 *     {
 *       name: string,
 *       value: number,
 *       unit: string
 *     }
 *   ],
 *   goals_or_issues: string[],
 *   missing_or_ambiguous: [
 *     {
 *       field: string,
 *       reason: string,
 *       suggested_default?: any
 *     }
 *   ]
 * }
 */

export const TRIGGER_TYPES = ['arrival', 'schedule', 'message', 'condition'];
export const RATE_UNITS = ['minute', 'hour', 'day', 'week', 'minutes', 'hours', 'days', 'weeks'];

/**
 * Validates the simple JSON process description (Stage 1 LLM output):
 * - actors (internal roles)
 * - external_parties (optional)
 * - steps in execution order: name, actor, type (task / decision / wait / parallel / message send / message receive)
 * - decisions: question, branches with target step and probability
 * - parallel_groups, loops/rework, and endings
 *
 * @param {any} json
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateProcessDescriptionSchema(json) {
  const errors = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { valid: false, errors: ['Process description must be a JSON object.'] };
  }

  // 1. Actors / Internal Roles
  const actors = Array.isArray(json.actors)
    ? json.actors
    : (Array.isArray(json.participants?.internal_roles) ? json.participants.internal_roles : []);

  if (!Array.isArray(actors) || actors.length === 0) {
    errors.push('Process description must define at least one internal role in "actors".');
  } else {
    actors.forEach((act, idx) => {
      const name = typeof act === 'string' ? act.trim() : (act?.name || '').trim();
      if (!name) {
        errors.push(`Actor at index ${idx} must have a non-empty name.`);
      }
    });
  }

  // 2. Steps in order
  const steps = Array.isArray(json.steps)
    ? json.steps
    : (Array.isArray(json.activities) ? json.activities : []);

  if (!Array.isArray(steps) || steps.length === 0) {
    errors.push('Process description must define a non-empty array of "steps" in execution order.');
  } else {
    const validTypes = new Set([
      'task', 'decision', 'wait', 'timer', 'parallel',
      'message send', 'message receive',
      'message_send', 'message_receive',
      'messagesend', 'messagereceive',
      'message-send', 'message-receive',
      'send_message', 'receive_message',
      'send', 'receive'
    ]);

    steps.forEach((step, idx) => {
      if (!step || typeof step !== 'object') {
        errors.push(`Step at index ${idx} must be an object.`);
        return;
      }
      const name = step.name || step.label;
      if (!name || typeof name !== 'string' || !name.trim()) {
        errors.push(`Step at index ${idx} must have a non-empty "name".`);
      }
      const rawType = String(step.type || step.kind || 'task').toLowerCase().trim();
      if (!validTypes.has(rawType)) {
        errors.push(`Step at index ${idx} ("${name || idx}") has unsupported type "${step.type}". Must be task, decision, wait, parallel, message send, or message receive.`);
      }
    });
  }

  // 3. Decisions
  const decisions = Array.isArray(json.decisions) ? json.decisions : [];
  decisions.forEach((dec, idx) => {
    if (!dec || typeof dec !== 'object') {
      errors.push(`Decision at index ${idx} must be an object.`);
      return;
    }
    if (!dec.question || typeof dec.question !== 'string' || !dec.question.trim()) {
      errors.push(`Decision at index ${idx} must have a non-empty "question".`);
    }
    const branches = Array.isArray(dec.branches) ? dec.branches : (Array.isArray(dec.options) ? dec.options : []);
    if (branches.length < 2) {
      errors.push(`Decision "${dec.question || idx}" must have at least 2 branches.`);
    } else {
      branches.forEach((b, bIdx) => {
        const label = b?.label || b?.condition;
        if (!label || typeof label !== 'string' || !label.trim()) {
          errors.push(`Branch ${bIdx + 1} of decision "${dec.question || idx}" must have a label.`);
        }
      });
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates a parsed JSON object against the Stage 1 Spec Schema.
 *
 * @param {any} spec
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSpecJson(spec) {
  const errors = [];

  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return { valid: false, errors: ['Spec must be a non-null object.'] };
  }

  // 0. process_name (optional)
  if (spec.process_name != null && (typeof spec.process_name !== 'string' || !spec.process_name.trim())) {
    errors.push('spec.process_name must be a non-empty string if provided.');
  }

  // 1. participants
  if (!spec.participants || typeof spec.participants !== 'object') {
    errors.push('spec.participants is required and must be an object.');
  } else {
    if (!Array.isArray(spec.participants.internal_roles)) {
      errors.push('spec.participants.internal_roles must be an array.');
    } else {
      spec.participants.internal_roles.forEach((r, idx) => {
        if (!r || typeof r.name !== 'string' || !r.name.trim()) {
          errors.push(`spec.participants.internal_roles[${idx}] must have a non-empty name string.`);
        }
        if (r.count != null && (typeof r.count !== 'number' || isNaN(r.count) || r.count < 0)) {
          errors.push(`spec.participants.internal_roles[${idx}].count must be a positive number if provided.`);
        }
      });
    }

    if (spec.participants.external_parties != null) {
      if (!Array.isArray(spec.participants.external_parties)) {
        errors.push('spec.participants.external_parties must be an array if provided.');
      } else {
        spec.participants.external_parties.forEach((p, idx) => {
          if (!p || typeof p.name !== 'string' || !p.name.trim()) {
            errors.push(`spec.participants.external_parties[${idx}] must have a non-empty name string.`);
          }
        });
      }
    }
  }

  // 2. triggers
  if (!Array.isArray(spec.triggers) || spec.triggers.length === 0) {
    errors.push('spec.triggers must be a non-empty array with at least one process trigger.');
  } else {
    spec.triggers.forEach((t, idx) => {
      if (!t || typeof t.name !== 'string' || !t.name.trim()) {
        errors.push(`spec.triggers[${idx}] must have a non-empty name.`);
      }
      if (!t || !TRIGGER_TYPES.includes(String(t.type || '').toLowerCase())) {
        errors.push(`spec.triggers[${idx}].type must be one of: ${TRIGGER_TYPES.join(', ')}.`);
      }
      if (t?.rate != null && (typeof t.rate !== 'number' || isNaN(t.rate) || t.rate <= 0)) {
        errors.push(`spec.triggers[${idx}].rate must be a positive number if specified.`);
      }
      if (t?.interval != null && (typeof t.interval !== 'number' || isNaN(t.interval) || t.interval <= 0)) {
        errors.push(`spec.triggers[${idx}].interval must be a positive number if specified.`);
      }
      if (t?.independent != null && typeof t.independent !== 'boolean') {
        errors.push(`spec.triggers[${idx}].independent must be a boolean if specified.`);
      }
    });
  }

  // 3. activities
  if (!Array.isArray(spec.activities)) {
    errors.push('spec.activities must be an array.');
  } else {
    spec.activities.forEach((a, idx) => {
      if (!a || typeof a.name !== 'string' || !a.name.trim()) {
        errors.push(`spec.activities[${idx}] must have a non-empty name.`);
      }
      if (!a || typeof a.performer_role !== 'string' || !a.performer_role.trim()) {
        errors.push(`spec.activities[${idx}] must specify performer_role.`);
      }
      if (a?.duration != null && (typeof a.duration !== 'number' || isNaN(a.duration) || a.duration < 0)) {
        errors.push(`spec.activities[${idx}].duration must be a non-negative number if specified.`);
      }
      if (a?.secondary_roles != null && !Array.isArray(a.secondary_roles)) {
        errors.push(`spec.activities[${idx}].secondary_roles must be an array of strings if provided.`);
      }
    });
  }

  // 4. decisions
  if (spec.decisions != null) {
    if (!Array.isArray(spec.decisions)) {
      errors.push('spec.decisions must be an array if provided.');
    } else {
      spec.decisions.forEach((d, idx) => {
        if (!d || typeof d.question !== 'string' || !d.question.trim()) {
          errors.push(`spec.decisions[${idx}] must have a non-empty question.`);
        }
        if (!Array.isArray(d?.branches) || d.branches.length < 2) {
          errors.push(`spec.decisions[${idx}].branches must be an array of at least 2 branch options.`);
        } else {
          d.branches.forEach((b, bIdx) => {
            if (!b || typeof b.label !== 'string' || !b.label.trim()) {
              errors.push(`spec.decisions[${idx}].branches[${bIdx}] must have a non-empty label.`);
            }
          });
        }
      });
    }
  }

  // 5. resources_and_costs
  if (spec.resources_and_costs != null && !Array.isArray(spec.resources_and_costs)) {
    errors.push('spec.resources_and_costs must be an array if provided.');
  }

  // 6. quantities
  if (spec.quantities != null && !Array.isArray(spec.quantities)) {
    errors.push('spec.quantities must be an array if provided.');
  }

  // 7. goals_or_issues
  if (spec.goals_or_issues != null && !Array.isArray(spec.goals_or_issues)) {
    errors.push('spec.goals_or_issues must be an array if provided.');
  }

  // 8. missing_or_ambiguous
  if (spec.missing_or_ambiguous != null) {
    if (!Array.isArray(spec.missing_or_ambiguous)) {
      errors.push('spec.missing_or_ambiguous must be an array if provided.');
    } else {
      spec.missing_or_ambiguous.forEach((m, idx) => {
        if (!m || typeof m.field !== 'string' || !m.field.trim()) {
          errors.push(`spec.missing_or_ambiguous[${idx}] must specify field.`);
        }
        if (!m || typeof m.reason !== 'string' || !m.reason.trim()) {
          errors.push(`spec.missing_or_ambiguous[${idx}] must specify reason.`);
        }
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Normalizes a raw spec object into safe defaults without inventing numbers.
 *
 * @param {any} rawSpec
 * @returns {object} cleanSpec
 */
export function cleanAndNormalizeSpec(rawSpec) {
  if (!rawSpec || typeof rawSpec !== 'object') {
    return {
      participants: { internal_roles: [], external_parties: [] },
      triggers: [{ name: 'Process Start', type: 'arrival' }],
      activities: [],
      decisions: [],
      resources_and_costs: [],
      quantities: [],
      goals_or_issues: [],
      missing_or_ambiguous: [],
    };
  }

  const spec = JSON.parse(JSON.stringify(rawSpec));

  // Process name
  spec.process_name = rawSpec.process_name && typeof rawSpec.process_name === 'string' && rawSpec.process_name.trim()
    ? rawSpec.process_name.trim()
    : undefined;

  // Participants
  spec.participants = spec.participants || {};
  spec.participants.internal_roles = Array.isArray(spec.participants.internal_roles)
    ? spec.participants.internal_roles
        .filter((r) => r && typeof r.name === 'string' && r.name.trim())
        .map((r) => ({
          name: r.name.trim(),
          count: r.count != null && !isNaN(Number(r.count)) ? Number(r.count) : undefined,
        }))
    : [];

  spec.participants.external_parties = Array.isArray(spec.participants.external_parties)
    ? spec.participants.external_parties
        .filter((p) => p && typeof p.name === 'string' && p.name.trim())
        .map((p) => ({ name: p.name.trim() }))
    : [];

  // Triggers
  spec.triggers = Array.isArray(spec.triggers) && spec.triggers.length > 0
    ? spec.triggers
        .filter((t) => t && typeof t.name === 'string' && t.name.trim())
        .map((t) => {
          const typeStr = String(t.type || 'arrival').toLowerCase();
          const validTrigType = TRIGGER_TYPES.includes(typeStr) ? typeStr : 'arrival';
          const rateVal = t.rate != null && !isNaN(Number(t.rate)) ? Number(t.rate) : undefined;
          const intervalVal = t.interval != null && !isNaN(Number(t.interval)) ? Number(t.interval) : undefined;
          return {
            name: t.name.trim(),
            type: validTrigType,
            rate: rateVal,
            unit: t.unit ? String(t.unit).toLowerCase().trim() : undefined,
            interval: intervalVal,
            independent: Boolean(t.independent),
          };
        })
    : [{ name: 'Process Start', type: 'arrival', independent: false }];

  // Activities
  spec.activities = Array.isArray(spec.activities)
    ? spec.activities
        .filter((a) => a && typeof a.name === 'string' && a.name.trim())
        .map((a) => {
          const performer = a.performer_role ? String(a.performer_role).trim() : 'Staff';
          const secondaryRoles = Array.isArray(a.secondary_roles)
            ? a.secondary_roles
                .filter((r) => r && typeof r === 'string' && r.trim())
                .map((r) => r.trim())
            : undefined;
          const durationVal = a.duration != null && !isNaN(Number(a.duration)) ? Number(a.duration) : undefined;
          const costVal = a.cost != null && !isNaN(Number(a.cost)) ? Number(a.cost) : undefined;
          return {
            name: a.name.trim(),
            performer_role: performer,
            secondary_roles: secondaryRoles && secondaryRoles.length > 0 ? secondaryRoles : undefined,
            duration: durationVal,
            duration_unit: a.duration_unit ? String(a.duration_unit).toLowerCase().trim() : 'minutes',
            cost: costVal,
            depends_on: a.depends_on ? String(a.depends_on).trim() : undefined,
          };
        })
    : [];

  // Decisions
  spec.decisions = Array.isArray(spec.decisions)
    ? spec.decisions
        .filter((d) => d && typeof d.question === 'string' && d.question.trim())
        .map((d) => {
          const branches = Array.isArray(d.branches)
            ? d.branches
                .filter((b) => b && typeof b.label === 'string' && b.label.trim())
                .map((b) => ({
                  label: b.label.trim(),
                  probability: b.probability != null && !isNaN(Number(b.probability)) ? Number(b.probability) : undefined,
                }))
            : [
                { label: 'Yes', probability: undefined },
                { label: 'No', probability: undefined },
              ];
          return {
            question: d.question.trim(),
            branches: branches.length >= 2 ? branches : [
              { label: 'Yes', probability: undefined },
              { label: 'No', probability: undefined },
            ],
          };
        })
    : [];

  // Resources and costs
  spec.resources_and_costs = Array.isArray(spec.resources_and_costs)
    ? spec.resources_and_costs.map((rc) => ({
        role_or_item: String(rc.role_or_item || '').trim(),
        quantity: rc.quantity != null && !isNaN(Number(rc.quantity)) ? Number(rc.quantity) : undefined,
        salary: rc.salary != null && !isNaN(Number(rc.salary)) ? Number(rc.salary) : undefined,
        unit_cost: rc.unit_cost != null && !isNaN(Number(rc.unit_cost)) ? Number(rc.unit_cost) : undefined,
        capital: rc.capital != null && !isNaN(Number(rc.capital)) ? Number(rc.capital) : undefined,
        currency: rc.currency ? String(rc.currency).toUpperCase().trim() : 'USD',
      }))
    : [];

  // Quantities
  spec.quantities = Array.isArray(spec.quantities)
    ? spec.quantities.map((q) => ({
        name: String(q.name || '').trim(),
        value: Number(q.value) || 0,
        unit: String(q.unit || '').trim(),
      }))
    : [];

  // Goals or issues
  spec.goals_or_issues = Array.isArray(spec.goals_or_issues)
    ? spec.goals_or_issues.map((g) => String(g).trim()).filter(Boolean)
    : [];

  // Missing or ambiguous
  spec.missing_or_ambiguous = Array.isArray(spec.missing_or_ambiguous)
    ? spec.missing_or_ambiguous.map((m) => ({
        field: String(m.field || '').trim(),
        reason: String(m.reason || '').trim(),
        suggested_default: m.suggested_default,
      }))
    : [];

  return spec;
}
