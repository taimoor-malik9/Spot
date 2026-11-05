import React, { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { t } from './intake/i18n.js';
import { LanguageContext } from '../context/LanguageContextDef.js';

/**
 * labels.js - Plain-language dictionary and helpers for owner-facing views.
 *
 * Translates technical simulation and modeling jargon into plain business language.
 * Localized across English (en), Roman Urdu (ur-roman), and Urdu script (ur).
 * Provides the <Hint> component for inline tooltips and the shared formatter for
 * replacing internal node/string IDs with user-facing labels.
 */

function getActiveLanguage(explicitLang) {
  if (explicitLang && ['en', 'ur-roman', 'ur'].includes(explicitLang)) {
    return explicitLang;
  }
  try {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('spot_preferredLanguage');
      if (stored && ['en', 'ur-roman', 'ur'].includes(stored)) {
        return stored;
      }
    }
  } catch {}
  return 'en';
}

const LABELS_FALLBACK = {
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
  case: {
    plain: 'Customer visit / Job',
    technical: 'Instance (Token)',
    hint: 'A single complete run of an event or calculation during a test.',
  },
  cases: {
    plain: 'Customer visits / Jobs',
    technical: 'Instances (Tokens)',
    hint: 'Complete runs of events or calculations during a test.',
  },
  arrival_rate: {
    plain: 'Arrival frequency',
    technical: 'Arrival Rate',
    hint: 'How often new customers or jobs arrive at your business.',
  },
  arrival_rates: {
    plain: 'Arrival frequency',
    technical: 'Arrival Rates',
    hint: 'How often new customers or jobs arrive at your business across different times.',
  },
  monte_carlo: {
    plain: 'Reality-tested simulation',
    technical: 'Monte Carlo Simulation',
    hint: 'A method that runs your process with realistic real-world variation and random arrivals to show true performance.',
  },
};

export function getLabelEntry(key, lang = 'en') {
  const normKey = String(key || '').toLowerCase();
  const plain = t(`label_${normKey}_plain`, lang);
  const technical = t(`label_${normKey}_technical`, lang);
  const hint = t(`label_${normKey}_hint`, lang);

  if (plain && !plain.startsWith('⚠')) {
    return { plain, technical, hint };
  }
  if (LABELS_FALLBACK[normKey]) {
    return LABELS_FALLBACK[normKey];
  }
  return { plain: key, technical: key, hint: '' };
}

export const LABELS = new Proxy(LABELS_FALLBACK, {
  get(target, prop) {
    if (typeof prop !== 'string') return undefined;
    const lang = getActiveLanguage();
    const entry = getLabelEntry(prop, lang);
    return entry || target[prop];
  }
});

const PALETTE_TOOLTIPS_FALLBACK = {
  'task': 'Step: a piece of work done by a person or system',
  'user-task': 'Staff Step: work done by a human team member',
  'service-task': 'Automated Step: work completed automatically by software or equipment',
  'start-event': 'Starting Point: where the customer arrives or the request begins',
  'end-event': 'Finish Point: where work completes or the customer leaves',
  'intermediate-event': 'Milestone: an event that occurs midway through the process',
  'timer-intermediate-catch': 'Delay / Wait: pauses for a fixed duration before continuing',
  'gateway': 'Decision Point: splits the path into options or recombines them',
  'exclusive-gateway': 'Either / Or Choice: only one of the outgoing paths is taken',
  'parallel-gateway': 'All at Once: all outgoing paths happen at the same time',
  'inclusive-gateway': 'One or More: any combination of outgoing paths can be taken',
  'data-object': 'Document / Info: an invoice, form, or document used during a step',
  'data-store': 'Database / Records: stored customer, inventory, or financial data',
  'pool': 'Organization boundary: represents your entire company or an external party',
  'lane': 'Role lane: partitions a department by job title (e.g. Cashier, Chef)',
  'group': 'Visual Group: highlights related steps without changing the flow',
  'text-annotation': 'Note: an explanatory note attached to any step',
};

export function getPaletteTooltip(id, lang = 'en') {
  const normKey = 'palette_' + String(id || '').replace(/-/g, '_');
  const text = t(normKey, lang);
  if (text && !text.startsWith('⚠')) return text;
  return PALETTE_TOOLTIPS_FALLBACK[id] || '';
}

export const PALETTE_TOOLTIPS = new Proxy(PALETTE_TOOLTIPS_FALLBACK, {
  get(target, prop) {
    if (typeof prop !== 'string') return undefined;
    const lang = getActiveLanguage();
    const text = getPaletteTooltip(prop, lang);
    return text || target[prop];
  }
});

export function getDefaultProcessTitle(lang) {
  const effectiveLang = getActiveLanguage(lang);
  const now = new Date();
  const dateStr = now.toLocaleDateString(effectiveLang === 'ur' ? 'ur-PK' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return t('newProcessDefaultTitle', effectiveLang, dateStr);
}

export function useAnalystView() {
  const [isAnalystView, setIsAnalystView] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const val = localStorage.getItem('spot:analyst_mode');
      if (val !== null) return val === 'true';
      return localStorage.getItem('spot:analyst_view') === 'true';
    } catch {
      return false;
    }
  });

  const toggle = useCallback(() => {
    setIsAnalystView((prev) => {
      const next = !prev;
      if (typeof window === 'undefined') return next;
      try {
        localStorage.setItem('spot:analyst_mode', String(next));
        localStorage.setItem('spot:analyst_view', String(next));
        window.dispatchEvent(
          new CustomEvent('spot:analyst_mode_change', {
            detail: { isAnalystView: next },
          })
        );
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleStorage = (e) => {
      if (e.key === 'spot:analyst_mode' || e.key === 'spot:analyst_view') {
        setIsAnalystView(e.newValue === 'true');
      }
    };
    const handleCustom = (e) => {
      if (e.detail?.isAnalystView !== undefined) {
        setIsAnalystView(e.detail.isAnalystView);
      }
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('spot:analyst_mode_change', handleCustom);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('spot:analyst_mode_change', handleCustom);
    };
  }, []);

  return [isAnalystView, toggle];
}

export function getLabel(key, isAnalystView = false, lang) {
  const effectiveLang = getActiveLanguage(lang);
  const entry = getLabelEntry(key, effectiveLang);
  if (!entry) return key;
  return isAnalystView ? entry.technical : entry.plain;
}

const JARGON_REPLACEMENTS = {
  en: [
    [/\bresource utilization\b/gi, 'how busy staff are'],
    [/\bcycle time\b/gi, 'time from arrival to leaving'],
    [/\bthroughput rate\b/gi, 'customers served per hour'],
    [/\bthroughput\b/gi, 'customers served per hour'],
    [/\bidle cost\b/gi, 'paid time with no work'],
    [/\bactive cost\b/gi, 'cost of active work'],
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
    [/\bexclusive gateway\b/gi, 'either/or choice'],
    [/\bparallel gateway\b/gi, 'all-at-once split'],
    [/\binclusive gateway\b/gi, 'choice point'],
    [/\bgateway routing\b/gi, 'decision routing'],
    [/\bgateway\b/gi, 'decision point'],
    [/\bgateways\b/gi, 'decision points'],
    [/\bswimlanes\b/gi, 'roles & lanes'],
    [/\bswimlane\b/gi, 'role / lane'],
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
  ],
  'ur-roman': [
    [/\bexclusive gateway\b/gi, 'ya-yeh-ya-woh intikhab'],
    [/\bparallel gateway\b/gi, 'yak-waqt marhale'],
    [/\bresource utilization\b/gi, 'staff kitna masroof hai'],
    [/\bcycle time\b/gi, 'aane se jane tak ka waqt'],
    [/\bthroughput rate\b/gi, 'fi ghanta niptaye gaye customers'],
    [/\bthroughput\b/gi, 'fi ghanta niptaye gaye customers'],
    [/\bidle cost\b/gi, 'baghair kaam ke ada shuda waqt'],
    [/\bactive cost\b/gi, "fa'al kaam ka kharcha"],
    [/\bbottleneck\b/gi, 'jahan customers rukte hain'],
    [/\bwhat-if scenario\b/gi, 'aazmane ka khayal'],
    [/\bwhat-if scenarios\b/gi, 'aazmane ke khayalat'],
    [/\bscenario\b/gi, 'aazmane ka khayal'],
    [/\bscenarios\b/gi, 'aazmane ke khayalat'],
    [/\bsimulation run\b/gi, 'test run'],
    [/\bsimulation runs\b/gi, 'test runs'],
    [/\bsimulation\b/gi, 'test run'],
    [/\bsimulations\b/gi, 'test runs'],
    [/\bbaseline process\b/gi, 'mojooda setup'],
    [/\bbaseline results\b/gi, 'mojooda setup ke nataij'],
    [/\bbaseline\b/gi, 'mojooda setup'],
    [/\bgateway\b/gi, 'faislay ka muqam'],
    [/\bgateways\b/gi, 'faislay ke muqamat'],
    [/\bswimlane\b/gi, 'kirdar / lane'],
    [/\bswimlanes\b/gi, 'kirdar / lanes'],
    [/\bpool\b/gi, 'idara'],
    [/\bpools\b/gi, 'idaray'],
    [/\butilization\b/gi, 'staff kitna masroof hai'],
  ],
  ur: [
    [/\bexclusive gateway\b/gi, 'یا یہ یا وہ انتخاب'],
    [/\bparallel gateway\b/gi, 'یک وقتی مراحل'],
    [/\bresource utilization\b/gi, 'عملہ کتنا مصروف ہے'],
    [/\bcycle time\b/gi, 'آمد سے روانگی تک کا وقت'],
    [/\bthroughput rate\b/gi, 'فی گھنٹہ نمٹائے گئے گاہک'],
    [/\bthroughput\b/gi, 'فی گھنٹہ نمٹائے گئے گاہک'],
    [/\bidle cost\b/gi, 'بغیر کام کے ادا شدہ وقت کی لاگت'],
    [/\bactive cost\b/gi, 'فعال کام کی لاگت'],
    [/\bbottleneck\b/gi, 'جہاں گاہک رکتے ہیں'],
    [/\bwhat-if scenario\b/gi, 'آزمانے کا خیال'],
    [/\bwhat-if scenarios\b/gi, 'آزمانے کے خیالات'],
    [/\bscenario\b/gi, 'آزمانے کا خیال'],
    [/\bscenarios\b/gi, 'آزمانے کے خیالات'],
    [/\bsimulation run\b/gi, 'ٹیسٹ رن'],
    [/\bsimulation runs\b/gi, 'ٹیسٹ رنز'],
    [/\bsimulation\b/gi, 'ٹیسٹ رن'],
    [/\bsimulations\b/gi, 'ٹیسٹ رنز'],
    [/\bbaseline process\b/gi, 'موجودہ سیٹ اپ'],
    [/\bbaseline results\b/gi, 'موجودہ سیٹ اپ کے نتائج'],
    [/\bbaseline\b/gi, 'موجودہ سیٹ اپ'],
    [/\bgateway\b/gi, 'فیصلے کا مقام'],
    [/\bgateways\b/gi, 'فیصلے کے مقامات'],
    [/\bswimlane\b/gi, 'کردار / لین'],
    [/\bswimlanes\b/gi, 'کردار / لینز'],
    [/\bpool\b/gi, 'شعبہ'],
    [/\bpools\b/gi, 'شعبے'],
    [/\butilization\b/gi, 'عملہ کتنا مصروف ہے'],
  ],
};

export function formatPlainLanguage(text, options = {}, lang) {
  if (text == null) return '';
  let str = String(text);
  const { nodeMap = {}, isAnalystView = false, lang: optionLang } =
    typeof options === 'boolean' ? { isAnalystView: options } : options;

  const effectiveLang = getActiveLanguage(lang || optionLang);

  // 1. Replace exact node ID occurrences
  const idRegex = /\b(?:node[-_][a-zA-Z0-9_-]+|task[-_][a-zA-Z0-9_-]+|step[-_][a-zA-Z0-9_-]+|[a-f0-9]{24})\b/g;
  str = str.replace(idRegex, (match) => {
    if (nodeMap[match]) return nodeMap[match];
    if (nodeMap[match.toLowerCase()]) return nodeMap[match.toLowerCase()];
    return match
      .replace(/^node[-_]/i, 'Step ')
      .replace(/^task[-_]/i, 'Task ')
      .replace(/^step[-_]/i, 'Step ');
  });

  // 2. In Simple view, replace technical keywords with localized plain language
  if (!isAnalystView) {
    const list = JARGON_REPLACEMENTS[effectiveLang] || JARGON_REPLACEMENTS.en;
    for (const [re, replacement] of list) {
      str = str.replace(re, (match) => {
        if (match.charAt(0) === match.charAt(0).toUpperCase()) {
          return replacement.charAt(0).toUpperCase() + replacement.slice(1);
        }
        return replacement;
      });
    }
  }

  return str;
}

export function Hint({
  term,
  children,
  className = '',
  isAnalystView: propAnalystView,
  lang: propLang,
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [storedAnalystView] = useAnalystView();
  const isAnalystView = propAnalystView !== undefined ? propAnalystView : storedAnalystView;

  let ctxLang = null;
  try {
    const ctx = useContext(LanguageContext);
    if (ctx?.preferredLanguage) ctxLang = ctx.preferredLanguage;
  } catch {}

  const effectiveLang = getActiveLanguage(propLang || ctxLang);
  const entry = getLabelEntry(term, effectiveLang);

  const displayText = children || (isAnalystView ? entry.technical : entry.plain);
  const hintText = entry.hint;

  if (isAnalystView && !entry.hint) {
    return React.createElement('span', { className }, displayText);
  }

  const tooltipEl = showTooltip
    ? React.createElement(
        'span',
        {
          role: 'tooltip',
          className:
            'spot-hint-tooltip absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 text-xs rounded-md shadow-lg pointer-events-none text-left min-w-[200px] max-w-[280px]',
          style: {
            backgroundColor: '#0f172a',
            color: '#f8fafc',
            lineHeight: 1.35,
            fontSize: '11px',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          },
        },
        React.createElement(
          'span',
          { style: { display: 'block', fontWeight: 600, color: '#93c5fd', marginBottom: '2px' } },
          isAnalystView ? entry.plain : entry.technical
        ),
        hintText,
        React.createElement('span', {
          className:
            'spot-hint-arrow absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#0f172a]',
          style: {
            width: 0,
            height: 0,
            borderLeft: '4px solid transparent',
            borderRight: '4px solid transparent',
            borderTop: '4px solid #0f172a',
          },
        })
      )
    : null;

  return React.createElement(
    'span',
    {
      className: `spot-hint-wrap inline-flex items-center relative cursor-help ${className}`,
      style: { display: 'inline-flex', verticalAlign: 'baseline' },
      onMouseEnter: () => setShowTooltip(true),
      onMouseLeave: () => setShowTooltip(false),
      onFocus: () => setShowTooltip(true),
      onBlur: () => setShowTooltip(false),
      tabIndex: 0,
      'aria-label': `${typeof displayText === 'string' ? displayText : entry.plain}: ${hintText}`,
    },
    React.createElement(
      'span',
      {
        className: 'spot-hint-term',
        style: {
          borderBottom: isAnalystView ? '1px dotted #94a3b8' : '1px dashed #64748b',
          transition: 'border-color 0.15s ease',
        },
      },
      displayText
    ),
    tooltipEl
  );
}

export function mapToPlainError(error, lang) {
  const effectiveLang = getActiveLanguage(lang);
  const raw = error?.message || String(error || '');

  // 1. Missing Staff
  if (/must be assigned to a swimlane|no staff assigned|unassigned task/i.test(raw)) {
    return {
      message: t('err_missing_staff', effectiveLang),
      fixAction: t('err_missing_staff_fix', effectiveLang),
      details: raw,
    };
  }

  // 2. Missing Duration
  if (/Missing Task Duration|need a duration|needs a duration/i.test(raw)) {
    return {
      message: t('err_missing_duration', effectiveLang),
      fixAction: t('err_missing_duration_fix', effectiveLang),
      details: raw,
    };
  }

  // 3. Unconfigured Resource
  if (/Missing Resource Setup|isn't set up|is not set up/i.test(raw)) {
    return {
      message: t('err_missing_resource_setup', effectiveLang),
      fixAction: t('err_missing_resource_setup_fix', effectiveLang),
      details: raw,
    };
  }

  // 4. Missing Start Event
  if (/at least one start event|no start event/i.test(raw)) {
    return {
      message: t('err_missing_start_event', effectiveLang),
      fixAction: t('err_missing_start_event_fix', effectiveLang),
      details: raw,
    };
  }

  // 5. Missing End Event
  if (/End event|no end event/i.test(raw)) {
    return {
      message: t('err_missing_end_event', effectiveLang),
      fixAction: t('err_missing_end_event_fix', effectiveLang),
      details: raw,
    };
  }

  // 6. Missing Probabilities / Decision Split
  if (/How often does each path happen|missing probabilities|probabilities sum/i.test(raw)) {
    return {
      message: t('err_missing_probabilities', effectiveLang),
      fixAction: t('err_missing_probabilities_fix', effectiveLang),
      details: raw,
    };
  }

  // 7. Disconnected step
  if (/not reachable from any start event|disconnected/i.test(raw)) {
    return {
      message: t('err_disconnected_step', effectiveLang),
      fixAction: t('err_disconnected_step_fix', effectiveLang),
      details: raw,
    };
  }

  // 8. Service / Engine down
  if (/ECONNREFUSED|simulation engine isn't reachable/i.test(raw)) {
    return {
      message: t('err_service_down', effectiveLang),
      fixAction: t('err_service_down_fix', effectiveLang),
      details: raw,
    };
  }

  // Fallback
  const plainMsg = formatPlainLanguage(raw, { isAnalystView: false, lang: effectiveLang }, effectiveLang);
  const isRawEnglish = plainMsg === raw && /^[a-zA-Z0-9\s.,!?:;'"_()-]+$/.test(raw);
  const message = (effectiveLang !== 'en' && isRawEnglish)
    ? t('err_fallback_message', effectiveLang)
    : plainMsg;

  return {
    message,
    fixAction: t('err_fallback_fix', effectiveLang),
    details: raw,
  };
}

export function FriendlyErrorView({ error, onRetry, lang: propLang }) {
  let ctxLang = null;
  try {
    const ctx = useContext(LanguageContext);
    if (ctx?.preferredLanguage) ctxLang = ctx.preferredLanguage;
  } catch {}

  const effectiveLang = getActiveLanguage(propLang || ctxLang);
  const err = mapToPlainError(error, effectiveLang);

  const suggestedFixText = t('suggestedFix', effectiveLang);
  const technicalDetailsText = t('technicalDetails', effectiveLang);
  const tryAgainText = t('tryAgain', effectiveLang);

  const children = [
    React.createElement('div', { key: 'msg', style: { fontWeight: 600, marginBottom: '4px' } }, err.message),
    React.createElement('div', { key: 'fix', style: { color: '#b91c1c', fontSize: '12px', marginBottom: '8px' } },
      React.createElement('strong', null, `${suggestedFixText} `),
      err.fixAction
    )
  ];

  if (err.details) {
    children.push(
      React.createElement('details', { key: 'details', style: { marginTop: '6px', fontSize: '11px', color: '#64748b' } },
        React.createElement('summary', { style: { cursor: 'pointer', fontWeight: 500, color: '#475569' } }, technicalDetailsText),
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
      }, tryAgainText)
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
