/**
 * friendlyErrors.js - Single mapping layer for plain-language validation messages.
 * Converts technical BPMN validator output into plain, layman-friendly sentences.
 * Never renders raw validator output.
 */

import { stripTrailingPunctuation } from './stepListHelper.js';

export function friendlyError(error, lang = 'en', diagram = null, options = {}) {
  if (!error) return '';

  const selectedLang = lang === 'ur-roman' || lang === 'ur' ? 'ur-roman' : 'en';

  const errStr = typeof error === 'string'
    ? error
    : (error.message || error.question || error.description || '');
  const errLower = errStr.toLowerCase();

  // 1. Probabilities sum != 100%
  const isProbSum =
    (typeof error === 'object' && error.type === 'probability-sum') ||
    errLower.includes('sum to 1') ||
    errLower.includes('must sum') ||
    errLower.includes('100%') ||
    errLower.includes('add up') ||
    errLower.includes('must be 100');

  if (isProbSum) {
    const sumMatch = errStr.match(/(\d+)%/) || errStr.match(/found ([\d.]+)/i);
    let sumVal = null;
    if (sumMatch) {
      const parsed = parseFloat(sumMatch[1]);
      sumVal = parsed <= 2.5 ? Math.round(parsed * 100) : Math.round(parsed);
    }
    if (typeof error === 'object' && error.sum != null) {
      sumVal = Math.round(error.sum);
    }

    if (selectedLang === 'ur-roman') {
      return sumVal != null
        ? `Total ${sumVal}%, 100 hona zaroori hai`
        : 'Percentages ka jor 100% hona chahiye.';
    }
    return sumVal != null
      ? `Total ${sumVal}%, must be 100`
      : 'The branch percentages must add up to 100%.';
  }

  // 2. Missing branch probabilities on a decision gateway
  const isMissingProb =
    (typeof error === 'object' && error.type === 'unresolved-gateway') ||
    (typeof error === 'object' && Array.isArray(error.branches)) ||
    errLower.includes('how often does each path happen') ||
    errLower.includes('missing probability') ||
    (errLower.includes('exclusive split') && (errLower.includes('probability') || errLower.includes('path')));

  if (isMissingProb) {
    let branchLabels = [];

    if (typeof error === 'object' && Array.isArray(error.branches)) {
      branchLabels = error.branches
        .map((b) => (b.label || '').trim())
        .filter(Boolean);
    } else if (diagram) {
      // Find gateway in diagram
      const match = errStr.match(/"([^"]+)"/);
      const targetName = match ? stripTrailingPunctuation(match[1]).toLowerCase() : '';

      const gwNode = (diagram.nodes || []).find((n) => {
        const isGw = n.type?.includes('gateway');
        if (!isGw) return false;
        const rawLbl = n.data?.label || n.label || n.id || '';
        const cleanLbl = stripTrailingPunctuation(rawLbl).toLowerCase();
        return (
          (targetName && (cleanLbl === targetName || cleanLbl.includes(targetName) || targetName.includes(cleanLbl))) ||
          errStr.includes(rawLbl) ||
          (cleanLbl && errStr.toLowerCase().includes(cleanLbl))
        );
      });
      if (gwNode) {
        const outEdges = (diagram.edges || []).filter((e) => e.source === gwNode.id);
        branchLabels = outEdges
          .map((e) => (e.label || e.data?.label || '').trim())
          .filter(Boolean);
      }
    }

    // Clean branch labels from any trailing punctuation
    branchLabels = branchLabels.map((l) => stripTrailingPunctuation(l));

    if (selectedLang === 'ur-roman') {
      if (branchLabels.length === 2) {
        return `Customer ya to ${branchLabels[0]} ya ${branchLabels[1]}. Kitne % log kaunsa lete hain? (jaise 60% / 40%)`;
      } else if (branchLabels.length > 2) {
        return `Customer ya to ${branchLabels.slice(0, -1).join(', ')} ya ${branchLabels[branchLabels.length - 1]}. Kitne % log kaunsa lete hain? (jaise 60% / 40%)`;
      }
      return 'Kitne % log kaunsa lete hain? (jaise 60% / 40%)';
    } else {
      if (branchLabels.length === 2) {
        return `Customers either ${branchLabels[0]} or ${branchLabels[1]}. Roughly what % choose each? (e.g. 60% / 40%)`;
      } else if (branchLabels.length > 2) {
        return `Customers either ${branchLabels.slice(0, -1).join(', ')} or ${branchLabels[branchLabels.length - 1]}. Roughly what % choose each? (e.g. 60% / 40%)`;
      }
      return 'Roughly what % choose each? (e.g. 60% / 40%)';
    }
  }

  // 2b. Quality check ending prematurely instead of looping back
  if (
    (typeof error === 'object' && error.type === 'quality-check-dead-end') ||
    (errLower.includes('quality') && (errLower.includes('loop') || errLower.includes('dead end') || errLower.includes('ends the process')))
  ) {
    if (selectedLang === 'ur-roman') {
      return 'Quality check fail hone par process khatam ho raha hai jabke dobara theek karne ke liye wapas jana chahiye.';
    }
    return 'The failed quality check ends the process instead of looping back to the earlier step.';
  }

  // 3. Duration errors (missing duration or invalid bounds)
  if (errLower.includes('duration') || errLower.includes('needs a duration')) {
    const stepMatch = errStr.match(/Step "([^"]+)"/i) || errStr.match(/"([^"]+)"/);
    const stepName = stepMatch ? stripTrailingPunctuation(stepMatch[1]) : '';

    if (errLower.includes('cannot be greater than') || errLower.includes('between')) {
      if (selectedLang === 'ur-roman') {
        return stepName
          ? `"${stepName}" ka kam se kam waqt zyada se zyada waqt se bara nahi ho sakta.`
          : 'Kam se kam waqt zyada se zyada waqt se bara nahi ho sakta.';
      }
      return stepName
        ? `The minimum time for "${stepName}" cannot be greater than the maximum.`
        : 'Minimum duration cannot be greater than maximum duration.';
    }

    if (selectedLang === 'ur-roman') {
      return stepName
        ? `"${stepName}" mein kitna waqt lagta hai?`
        : 'Steps ka waqt batana zaroori hai.';
    }
    return stepName
      ? `"${stepName}" needs a duration.`
      : 'Some steps need a duration.';
  }

  // 4. Structural BPMN errors (missing lanes, unconnected flows, sequence flows, reachability, start/end events)
  const isStructural =
    errLower.includes('sequence flow') ||
    errLower.includes('message flow') ||
    errLower.includes('lane') ||
    errLower.includes('pool') ||
    errLower.includes('reachable') ||
    errLower.includes('reach') ||
    errLower.includes('start event') ||
    errLower.includes('end event') ||
    errLower.includes('gateway') ||
    errLower.includes('split') ||
    errLower.includes('join') ||
    errLower.includes('incoming') ||
    errLower.includes('outgoing') ||
    errLower.includes('connected') ||
    errLower.includes('orphan') ||
    errLower.includes('dangling');

  if (isStructural) {
    // Extract step name if present in the technical error
    const stepMatch = errStr.match(/Task "([^"]+)"/i) ||
      errStr.match(/Node "([^"]+)" \(([^)]+)\)/i) ||
      errStr.match(/Step "([^"]+)"/i) ||
      errStr.match(/"([^"]+)"/);

    let stepName = '';
    if (stepMatch) {
      stepName = stepMatch[2] || stepMatch[1];
      if (stepName.startsWith('task_') || stepName.startsWith('node_') || stepName.startsWith('seq_')) {
        stepName = '';
      }
    }

    // Name specific step if requested or if error specifically references connectivity/orphan
    const shouldNameStep = options.nameStep ||
      errLower.includes('not connected') ||
      errLower.includes('jura nahi') ||
      errLower.includes('orphan');

    if (stepName && shouldNameStep) {
      const cleanStep = stripTrailingPunctuation(stepName);
      if (selectedLang === 'ur-roman') {
        return `'${cleanStep}' baqi steps se jura nahi hai.`;
      }
      return `'${cleanStep}' isn't connected to the other steps.`;
    }

    if (selectedLang === 'ur-roman') {
      return 'Kuch steps aapas mein jurre nahi hain.';
    }
    return "Some steps aren't connected properly.";
  }

  // General fallback
  if (selectedLang === 'ur-roman') {
    return 'Kuch steps aapas mein jurre nahi hain.';
  }
  return "Some steps aren't connected properly.";
}

/**
 * Ensures any exclusive split gateway without branch probabilities is prefilled
 * with sensible estimated defaults (e.g. 50/50 for 2 branches, equal share for N branches)
 * flagged with probabilityEstimated: true.
 */
export function ensureDefaultBranchProbabilities(diagram) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) {
    return diagram;
  }

  let modified = false;
  const deep = JSON.parse(JSON.stringify(diagram));
  const edges = deep.edges || [];

  deep.nodes.forEach((n) => {
    const isGw = n.type?.includes('gateway');
    if (!isGw) return;
    const outEdges = edges.filter((e) => e.source === n.id);
    if (outEdges.length >= 2) {
      const anyMissing = outEdges.some(
        (e) =>
          (e.probability == null && e.data?.probability == null) ||
          isNaN(Number(e.probability ?? e.data?.probability))
      );
      if (anyMissing) {
        modified = true;
        const count = outEdges.length;
        const equalShare = Number((1.0 / count).toFixed(2));
        let runningSum = 0;
        outEdges.forEach((e, idx) => {
          let prob;
          if (idx === count - 1) {
            prob = Number((1.0 - runningSum).toFixed(2));
          } else {
            prob = equalShare;
            runningSum += equalShare;
          }
          e.probability = prob;
          e.data = {
            ...(e.data || {}),
            probability: prob,
            probabilityEstimated: true,
          };
        });
      }
    }
  });

  return modified ? deep : diagram;
}

/**
 * Checks for hidden structural errors in the diagram, such as a failed quality
 * check ending the process at an end-event instead of looping back to an earlier step.
 */
export function findHiddenStructuralIssues(rawDiagram) {
  if (!rawDiagram?.nodes || !rawDiagram?.edges) return [];
  const issues = [];
  const nodes = rawDiagram.nodes;
  const edges = rawDiagram.edges;

  const qualityKeywords = [
    'quality', 'check', 'inspect', 'test', 'review', 'verify',
    'saaf', 'meyaar', 'taste', 'pasand'
  ];
  const failKeywords = [
    'fail', 'reject', 'defect', 'kharab', 'wrong', 'no', 'nahi',
    'rework', 'bad', 'na-pasand', 'napasand'
  ];

  nodes.forEach((n) => {
    const isGw = n.type?.includes('gateway');
    const label = (n.data?.label || n.label || '').toLowerCase();
    const isQualityGw = isGw && qualityKeywords.some((k) => label.includes(k));

    if (isQualityGw) {
      const outEdges = edges.filter((e) => e.source === n.id);
      outEdges.forEach((e) => {
        const edgeLabel = (e.label || e.data?.label || '').toLowerCase();
        const isFailBranch = failKeywords.some((k) => edgeLabel.includes(k));
        if (isFailBranch) {
          const targetNode = nodes.find((tn) => tn.id === e.target);
          const isEnd =
            targetNode &&
            (targetNode.type?.includes('end') ||
              edges.filter((oe) => oe.source === targetNode.id).length === 0);
          if (isEnd) {
            // Find the task immediately preceding this decision
            const incomingToGw = edges.filter((ie) => ie.target === n.id);
            const prevTaskId = incomingToGw.length > 0 ? incomingToGw[0].source : null;

            issues.push({
              type: 'quality-check-dead-end',
              gatewayId: n.id,
              gatewayLabel: n.data?.label || n.label,
              edgeId: e.id,
              edgeLabel: e.label || e.data?.label,
              targetId: targetNode.id,
              loopBackTargetId: prevTaskId,
              messageEn:
                'The failed quality check ends the process instead of looping back to try again.',
              messageRu:
                'Quality check fail hone par process khatam ho raha hai jabke dobara theek karne ke liye wapas jana chahiye.',
            });
          }
        }
      });
    }
  });

  return issues;
}
