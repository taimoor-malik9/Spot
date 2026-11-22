/**
 * shared/specSimulationBinding.js
 *
 * Stage 4: Binds validated Stage 1 Spec directly into BPMN diagram properties,
 * simulation configurations, and scenario/KPI settings.
 *
 * Core Rules:
 *  - Exactly ONE arrival rate bound to the single start event and to simulationConfig.arrival_rate.
 *  - Convert stated rates to arrivals-per-hour using stated operating hours (default 8h/day,
 *    5 days/week unless 24/7 or stated otherwise). Never convert a rate into an interval in days.
 *  - If an independent secondary start was confirmed, bind its rate/interval to that start event.
 *  - Non-start triggers bind to their corresponding intermediate events or decision gateway
 *    branch probabilities, NOT to the process arrival rate.
 *  - Stated values bind directly and are flagged stated (so they are never re-asked).
 *  - Capital and cost parameters populate scenario/KPI settings so Results report cost,
 *    cash balance, and utilization.
 */

import { cleanAndNormalizeSpec } from './specSchema.js';

/**
 * Converts a frequency rate (e.g. 400/day, 20/hour, 0.5/min) into customers per hour.
 *
 * @param {number} rate - raw frequency rate count
 * @param {string} unit - time unit ('minute' | 'hour' | 'day' | 'week')
 * @param {number} [operatingHours=8] - daily operating hours (default 8)
 * @returns {number} ratePerHour
 */
export function convertRateToPerHour(rate, unit = 'hour', operatingHours = 8) {
  if (rate == null || isNaN(Number(rate)) || Number(rate) <= 0) return 20;
  const r = Number(rate);
  const u = String(unit || 'hour').toLowerCase().trim();

  if (u.startsWith('min')) {
    return r * 60;
  }
  if (u.startsWith('day')) {
    const hours = operatingHours > 0 ? operatingHours : 8;
    return r / hours;
  }
  if (u.startsWith('week')) {
    const hours = (operatingHours > 0 ? operatingHours : 8) * 5;
    return r / hours;
  }
  return r;
}

/**
 * Converts an elapsed interval duration into minutes.
 *
 * @param {number} interval
 * @param {string} unit
 * @returns {number} minutes
 */
export function convertIntervalToMinutes(interval, unit = 'minutes') {
  if (interval == null || isNaN(Number(interval))) return 3;
  const num = Number(interval);
  const u = String(unit || 'minutes').toLowerCase().trim();

  if (u.startsWith('sec')) return num / 60;
  if (u.startsWith('min')) return num;
  if (u.startsWith('hour')) return num * 60;
  if (u.startsWith('day')) return num * 24 * 60;
  return num;
}

/**
 * Binds Stage 1 Spec values onto the BPMN diagram and extracts simulation/scenario configs.
 *
 * @param {object} rawSpec - Validated Stage 1 Spec
 * @param {object} rawDiagram - Generated BPMN Diagram
 * @param {object} [options]
 * @returns {{ diagram: object, simulationConfig: object, scenarioSettings: object }}
 */
export function bindSpecToSimulation(rawSpec, rawDiagram, options = {}) {
  const spec = cleanAndNormalizeSpec(rawSpec);
  const diagram = JSON.parse(JSON.stringify(rawDiagram || { nodes: [], edges: [], resources: [] }));
  const nodes = diagram.nodes || [];
  const edges = diagram.edges || [];
  const resources = diagram.resources || [];

  const operatingHours = options.operatingHours || (options.is24Hour ? 24 : 8);

  // 1. Primary Trigger -> Exactly ONE Arrival Rate
  const triggers = spec.triggers || [];
  let primaryRatePerHour = null;
  let primaryArrivalGapMinutes = null;
  let primaryBusynessSource = 'assumed';

  const primaryTrigger = triggers.find((t) => t.type === 'arrival') ||
                         triggers.find((t) => t.type === 'message') ||
                         triggers.find((t) => !t.independent && t.type !== 'condition') ||
                         triggers[0] ||
                         { name: 'Process Start', type: 'arrival' };

  if (primaryTrigger) {
    if (primaryTrigger.rate != null && !isNaN(Number(primaryTrigger.rate))) {
      const ratePerHour = convertRateToPerHour(primaryTrigger.rate, primaryTrigger.unit, operatingHours);
      const arrivalGapMinutes = ratePerHour > 0 ? 60 / ratePerHour : 3;
      primaryRatePerHour = ratePerHour;
      primaryArrivalGapMinutes = arrivalGapMinutes;
      primaryBusynessSource = 'stated';
    } else if (primaryTrigger.interval != null && !isNaN(Number(primaryTrigger.interval))) {
      const gapMinutes = convertIntervalToMinutes(primaryTrigger.interval, primaryTrigger.unit);
      const ratePerHour = gapMinutes > 0 ? 60 / gapMinutes : 20;
      primaryRatePerHour = ratePerHour;
      primaryArrivalGapMinutes = gapMinutes;
      primaryBusynessSource = 'stated';
    }
  }

  // Fallback: check quantities if triggers did not provide an explicit rate
  if (primaryRatePerHour == null && Array.isArray(spec.quantities)) {
    const rateQty = spec.quantities.find(
      (q) => q && q.value != null && !isNaN(Number(q.value)) &&
             (/rate|frequency|volume|count|arrival|trigger|unit|item|request|intake|throughput|cases/i.test(q.name || '') ||
              /day|daily|hour|hourly|min|minute|sec|second|week|monthly/i.test(q.unit || ''))
    );
    if (rateQty) {
      const unit = /hour|hr/i.test(rateQty.unit || rateQty.name || '') ? 'hour' : 'day';
      const ratePerHour = convertRateToPerHour(Number(rateQty.value), unit, operatingHours);
      const arrivalGapMinutes = ratePerHour > 0 ? 60 / ratePerHour : 3;
      primaryRatePerHour = ratePerHour;
      primaryArrivalGapMinutes = arrivalGapMinutes;
      primaryBusynessSource = 'stated';
    }
  }

  // Bind to primary start event
  const primaryStartNode = nodes.find(
    (n) => n.id === 'start_primary_flow' || n.id === 'start_flow_0' || n.type === 'start-event' || n.type?.endsWith('-start-event')
  );

  if (primaryStartNode && primaryRatePerHour != null) {
    primaryStartNode.data = primaryStartNode.data || {};
    primaryStartNode.data.arrival_rate = Number(primaryRatePerHour.toFixed(4));
    primaryStartNode.data.arrival_rate_per_minute = Number((primaryRatePerHour / 60).toFixed(4));
    primaryStartNode.data.arrival_gap_minutes = Number(primaryArrivalGapMinutes.toFixed(4));
    primaryStartNode.data.rate_unit = primaryTrigger.unit || 'hour';
    primaryStartNode.data.rate_source = 'stated';
    primaryStartNode.data.isRate = primaryTrigger.rate != null;
    primaryStartNode.data.isInterval = primaryTrigger.interval != null;
  }

  // If confirmed secondary start nodes exist, bind their independent trigger rate/interval
  const secondaryTriggers = triggers.filter((t) => t !== primaryTrigger);
  secondaryTriggers.forEach((secTrig, idx) => {
    const secStartNode = nodes.find(
      (n) => n.id === `start_secondary_${idx}` || n.id === `start_flow_${idx + 1}` || n.label === secTrig.name
    );
    if (secStartNode) {
      secStartNode.data = secStartNode.data || {};
      if (secTrig.rate != null && !isNaN(Number(secTrig.rate))) {
        const ratePerHour = convertRateToPerHour(secTrig.rate, secTrig.unit, operatingHours);
        secStartNode.data.arrival_rate = Number(ratePerHour.toFixed(4));
        secStartNode.data.arrival_gap_minutes = Number((60 / ratePerHour).toFixed(4));
        secStartNode.data.rate_source = 'stated';
      } else if (secTrig.interval != null && !isNaN(Number(secTrig.interval))) {
        const gapMinutes = convertIntervalToMinutes(secTrig.interval, secTrig.unit);
        secStartNode.data.timer_interval = Number(secTrig.interval);
        secStartNode.data.interval_unit = secTrig.unit || 'minutes';
        secStartNode.data.arrival_gap_minutes = Number(gapMinutes.toFixed(4));
        secStartNode.data.rate_source = 'stated';
      }
    }
  });

  // 2. Roles & Costs -> Resources
  const specResources = spec.resources_and_costs || [];
  const internalRoles = spec.participants.internal_roles || [];

  internalRoles.forEach((role) => {
    let res = resources.find(
      (r) => r.name.toLowerCase() === role.name.toLowerCase() || r.id === role.name
    );
    if (!res) {
      res = {
        id: role.name,
        name: role.name,
        type: 'staff',
        quantity: 1,
        hours_per_day: operatingHours,
        working_days_per_month: 22,
        monthly_salary: null,
      };
      resources.push(res);
    }

    if (role.count != null && !isNaN(Number(role.count))) {
      res.quantity = Number(role.count);
      res.quantitySource = 'stated';
    }

    const rc = specResources.find((item) => item.role_or_item.toLowerCase() === role.name.toLowerCase());
    if (rc) {
      if (rc.quantity != null && !isNaN(Number(rc.quantity))) {
        res.quantity = Number(rc.quantity);
        res.quantitySource = 'stated';
      }
      if (rc.salary != null && !isNaN(Number(rc.salary))) {
        res.monthly_salary = Number(rc.salary);
        res.costSource = 'stated';
      }
    }
  });

  // 3. Activity Durations & Costs
  const specActivities = spec.activities || [];
  nodes.forEach((node) => {
    const isActionableNode =
      node.type === 'task' ||
      node.type?.endsWith('-task') ||
      node.type?.includes('intermediate') ||
      node.type?.includes('catch');
    if (!isActionableNode) return;

    const nodeLabel = (node.data?.label || node.label || '').toLowerCase().trim();
    const match =
      specActivities.find((a) => (a.name || '').toLowerCase().trim() === nodeLabel) ||
      specActivities.find((a) => {
        const actName = (a.name || '').toLowerCase().trim();
        return actName && (actName.includes(nodeLabel) || nodeLabel.includes(actName));
      });
    if (match) {
      node.data = node.data || {};
      if (match.duration != null && !isNaN(Number(match.duration))) {
        node.data.duration = Number(match.duration);
        node.data.duration_min = Number(match.duration);
        node.data.duration_max = Number(match.duration);
        node.data.duration_unit = match.duration_unit || 'minutes';
        node.data.duration_source = 'stated';
        node.duration = Number(match.duration);
        node.duration_source = 'stated';
      } else {
        node.data.duration = null;
        node.data.duration_source = null;
        node.duration = null;
        node.duration_source = null;
      }
      if (match.cost != null && !isNaN(Number(match.cost))) {
        node.data.cost = Number(match.cost);
      }
    }
  });

  // 4. Decision Probabilities
  const specDecisions = spec.decisions || [];
  nodes.forEach((node) => {
    if (!node.type.includes('gateway') || node.gateway_role === 'merge') return;
    const q = (node.data?.label || node.label || '').toLowerCase();
    const match = specDecisions.find((d) => d.question.toLowerCase() === q || q.includes(d.question.toLowerCase()));
    if (match && Array.isArray(match.branches)) {
      const outEdges = edges.filter((e) => e.source === node.id);
      outEdges.forEach((edge) => {
        const edgeLabel = String(edge.data?.label || edge.label || '').toLowerCase();
        const branchMatch = match.branches.find((b) => b.label.toLowerCase() === edgeLabel);
        if (branchMatch && branchMatch.probability != null && !isNaN(Number(branchMatch.probability))) {
          edge.data = edge.data || {};
          edge.data.probability = Number(branchMatch.probability);
          edge.probability = Number(branchMatch.probability);
        }
      });
    }
  });

  // 5. Capital & Costs -> Scenario / KPI Settings
  let capital = null;
  let currency = 'USD';
  specResources.forEach((rc) => {
    if (rc.capital != null && !isNaN(Number(rc.capital))) {
      capital = Number(rc.capital);
    }
    if (rc.currency) {
      currency = rc.currency;
    }
  });

  (spec.quantities || []).forEach((q) => {
    if (/capital|cash|balance|budget|funds/i.test(q.name)) {
      capital = Number(q.value);
    }
    if (/currency/i.test(q.name) || /pkr|rs|rupee|\$/i.test(q.unit || '')) {
      if (/pkr|rs|rupee/i.test(q.unit || q.name || '')) currency = 'PKR';
    }
  });

  const finalRatePerHour = primaryRatePerHour || 20;
  const finalGapMinutes = primaryArrivalGapMinutes || 60 / finalRatePerHour;

  const simulationConfig = {
    arrival_rate: Number((finalRatePerHour / 60).toFixed(4)),
    arrivalRate: Number(finalRatePerHour.toFixed(2)),
    arrival_gap_minutes: Number(finalGapMinutes.toFixed(4)),
    customers_per_hour: Number(finalRatePerHour.toFixed(2)),
    busynessSource: primaryBusynessSource,
    busyness_source: primaryBusynessSource,
    busyness: finalRatePerHour <= 8 ? 'quiet' : finalRatePerHour >= 35 ? 'packed' : 'steady',
    goal: spec.goals_or_issues?.[0] ? 'custom' : 'waiting',
    mode: 'deep',
    total_instances: 500,
    capital: capital,
    currency: currency,
    quantities: spec.quantities || [],
  };

  const scenarioSettings = {
    initialCapital: capital,
    budget: capital,
    currency: currency,
    operatingHours: operatingHours,
    quantities: spec.quantities || [],
  };

  diagram.simulationConfig = simulationConfig;
  diagram.scenarioSettings = scenarioSettings;
  diagram.busynessSource = primaryBusynessSource;
  diagram.resources = resources;
  diagram.nodes = nodes;
  diagram.edges = edges;

  return {
    diagram,
    simulationConfig,
    scenarioSettings,
  };
}
