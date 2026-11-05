'use client';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, RefreshCw, Target, CheckCircle, AlertTriangle, 
  LayoutDashboard, Clock, Zap, ShieldAlert,
  GitCompare, TrendingUp, TrendingDown, History, ChevronDown, Layers, Loader2, Trash2,
  Globe, Download
} from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, LabelList
} from 'recharts';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { getScenarios, listRuns, getRun, deleteRun, runSimulation, runScenarioSimulation } from '../lib/apiService';
import AIInsightsPanel from './AIInsightsPanel';
import AIChatWidget from './AIChatWidget';
import { computeComparisonMetrics } from '../lib/whatIfComparison';
import { getBottleneckView, prepareResultForMetrics } from '../lib/resultsHelper';
import { useAnalystView, Hint, LABELS, formatPlainLanguage } from '../lib/labels';
import { t, formatDuration, formatRate, formatCurrency } from '../lib/intake/i18n';

/* ═══════════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════════ */

function fmt(mins, lang = 'en') {
  if (mins == null || isNaN(mins)) return '—';
  if (lang === 'ur') {
    if (mins < 1) return `${Math.round(mins * 60)} سیکنڈ`;
    if (mins < 60) return `${mins < 10 ? mins.toFixed(1) : Math.round(mins)} منٹ`;
    if (mins < 1440) {
      const h = Math.floor(mins / 60), m = Math.round(mins % 60);
      return m ? `${h} گھنٹے ${m} منٹ` : `${h} گھنٹے`;
    }
    return `${(mins / 1440).toFixed(1)} دن`;
  }
  if (lang === 'ur-roman') {
    if (mins < 1) return `${Math.round(mins * 60)}s`;
    if (mins < 60) return `${mins < 10 ? mins.toFixed(1) : Math.round(mins)}m`;
    if (mins < 1440) {
      const h = Math.floor(mins / 60), m = Math.round(mins % 60);
      return m ? `${h}h ${m}m` : `${h}h`;
    }
    return `${(mins / 1440).toFixed(1)}d`;
  }
  if (mins < 1) return `${Math.round(mins * 60)}s`;
  if (mins < 60) return `${Math.round(mins)}m`;
  if (mins < 1440) {
    const h = Math.floor(mins / 60), m = Math.round(mins % 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${(mins / 1440).toFixed(1)}d`;
}

function buildIdToLabel() {
  try {
    const raw = localStorage.getItem('spot:model:nodes');
    if (!raw) return {};
    const data = JSON.parse(raw);
    const nodes = Array.isArray(data) ? data : (data.nodes || []);
    const map = {};
    nodes.forEach(n => {
      if (n.id) {
        const rawLbl = n.label || n.data?.label || n.id;
        map[n.id] = typeof rawLbl === 'string' ? rawLbl : (rawLbl?.label ?? rawLbl?.name ?? rawLbl?.title ?? String(n.id));
      }
    });
    return map;
  } catch { return {}; }
}

function buildIdToResource() {
  try {
    const raw = localStorage.getItem('spot:model:nodes');
    if (!raw) return {};
    const data = JSON.parse(raw);
    const nodes = Array.isArray(data) ? data : (data.nodes || []);
    const map = {};
    nodes.forEach(n => {
      if (n.id) {
        const res = n.data?.resource || (n.data?.resources && Object.keys(n.data.resources).length > 0 ? Object.keys(n.data.resources)[0] : null);
        map[n.id] = res;
      }
    });
    return map;
  } catch { return {}; }
}

function extractThroughput(results) {
  const raw = results?.throughput_rates ?? results?.throughput_rate ?? results?.throughput ?? 0;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'object' && raw !== null) {
    return raw.avg ?? raw.value ?? raw.per_hour ?? raw.per_unit ?? Object.values(raw)[0] ?? 0;
  }
  return 0;
}

/**
 * Picks the primary bottleneck for a results object, or returns nulls if
 * nothing actually rises to the level of a bottleneck.
 *
 * The raw bottleneck_score from the backend always has a "highest" entry,
 * even in a well-balanced process where nothing is truly constrained — and
 * that top-scored node isn't always the one actually backing up the queue
 * (score can reward a step that's simply slow to process). So instead of
 * just trusting the backend's top pick, this looks directly at wait times
 * across activities and asks: which one, if any, actually stands out?
 *
 *  1. There has to be *some* waiting happening anywhere in the process —
 *     if total wait time across every activity is ~0, nothing is congested.
 *  2. The activity with the largest wait time has to clearly stand out
 *     from the average wait across activities (>= 1.5x). That distinguishes
 *     "this step is genuinely backing up the line" from noise where every
 *     activity waits about the same modest amount.
 */
function getPrimaryBottleneck(results, idToLabel) {
  const actObj = results?.activity_results || {};
  const ids = Object.keys(actObj);
  if (ids.length === 0) return { id: null, label: null, data: null };

  const waitTimes = ids.map(id => actObj[id]?.avg_wait_time ?? 0);
  const totalWait = waitTimes.reduce((a, b) => a + b, 0);
  if (totalWait <= 0) return { id: null, label: null, data: null };

  const avgWait = totalWait / ids.length;

  let topId = ids[0], topWait = waitTimes[0];
  for (let i = 1; i < ids.length; i++) {
    if (waitTimes[i] > topWait) { topWait = waitTimes[i]; topId = ids[i]; }
  }

  if (topWait < avgWait * 1.5) return { id: null, label: null, data: null };

  // Prefer the backend's own bottleneck_identification entry for this node
  // (it may carry extra fields like bottleneck_score); fall back to building
  // the display data straight from activity_results if it's not present there.
  const bnObj = results?.bottleneck_identification || {};
  const data = bnObj[topId] || {
    processing_time_avg: actObj[topId]?.avg_processing_time ?? 0,
    wait_time_avg: actObj[topId]?.avg_wait_time ?? 0,
  };

  const rawLabel = idToLabel?.[topId] || topId;
  const label = typeof rawLabel === 'string' ? rawLabel : (rawLabel?.label ?? rawLabel?.name ?? rawLabel?.title ?? String(topId));
  return { id: topId, label, data };
}

/**
 * Plain-language numbers for non-technical users. Everything is derived from
 * the real simulation output (nothing is hard-coded):
 *  - work / wait per customer: activity_results, weighted by how many of the
 *    customers actually visited each step (processing_histogram counts / runs)
 *  - per hour: throughput_rates (customers finished per minute) x 60
 *  - per day: per hour x working hours from the user's own resource settings
 *  - capacity: resource capacity / avg_busy_time_per_item, tightest resource
 *  - arrival speed: results.arrival_rate (saved by the Simulate page)
 */
function buildPlainSummary(results, idToLabel = {}) {
  const runs = results?.runs || 1;
  const tis = results?.time_in_system || {};
  const total = tis.avg ?? 0;

  let work = 0;
  const steps = [];
  Object.entries(results?.activity_results || {}).forEach(([id, a]) => {
    const visits = (a?.processing_histogram || []).reduce((n, b) => n + (b.count || 0), 0) / runs;
    const w = (a?.avg_processing_time || 0) * (visits || 0);
    const q = (a?.avg_wait_time || 0) * (visits || 0);
    work += w;
    if (w + q > 0.0001) steps.push({ id, work: w, wait: q });
  });
  steps.sort((a, b) => (b.work + b.wait) - (a.work + a.wait));
  if (total > 0) work = Math.min(work, total);
  const wait = Math.max(0, total - work);

  let hoursPerDay = null;
  try {
    const list = JSON.parse(localStorage.getItem('spot:globalResources') || '[]');
    const hrs = (Array.isArray(list) ? list : []).map(r => Number(r.hours_per_day)).filter(h => h > 0 && h <= 24);
    if (hrs.length) hoursPerDay = Math.max(...hrs);
  } catch { /* ignore */ }
  const dayHours = hoursPerDay || 8;

  const perHour = extractThroughput(results) * 60;
  const perDay = perHour * dayHours;

  const bnView = getBottleneckView(results, idToLabel);
  const tight = bnView.tight;
  const arrivalPerHr = bnView.arrivalPerHr;
  const status = bnView.status;

  return {
    runs, total, work, wait, min: tis.min ?? 0, max: tis.max ?? 0, p95: tis.p95 ?? null,
    perHour, perDay, dayHours, dayHoursFromSettings: Boolean(hoursPerDay),
    tight, arrivalPerHr, status, overloaded: status === 'overloaded',
    steps: steps.slice(0, 6),
    bottleneckView: bnView,
  };
}

/* ═══════════════════════════════════════════════════════════════
   COMPONENTS
   ═══════════════════════════════════════════════════════════════ */

/**
 * Small "i" marker on a box. Hovering the box (or the "i", or tapping it on a
 * touch screen) opens a short plain-English explanation of what that box means.
 * It is drawn in a portal so cards, scroll areas and animations never clip it.
 *   whole  = open when the whole box is hovered (false = only the "i" opens it)
 *   corner = 'tr' (top right) or 'br' (bottom right)
 */
function InfoTip({ title, children, whole = true, corner = 'tr' }) {
  const [pos, setPos] = useState(null);
  const btn = useRef(null);

  const open = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const w = 280;
    const left = Math.min(Math.max(10, r.right - w), window.innerWidth - w - 10);
    const below = window.innerHeight - r.bottom > 200;
    setPos({ left, top: below ? r.bottom + 8 : null, bottom: below ? null : window.innerHeight - r.top + 8 });
  };
  const close = () => setPos(null);

  useEffect(() => {
    if (!whole) return;
    const box = btn.current?.parentElement;
    if (!box) return;
    box.addEventListener('mouseenter', open);
    box.addEventListener('mouseleave', close);
    return () => { box.removeEventListener('mouseenter', open); box.removeEventListener('mouseleave', close); };
  }, [whole]);

  useEffect(() => {
    if (!pos) return;
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [pos]);

  const place = corner === 'br' ? { bottom: 10, right: 10 } : { top: 10, right: 10 };
  return (
    <>
      <button
        ref={btn} type="button" aria-label={`What does "${title}" mean?`}
        onMouseEnter={open} onMouseLeave={close} onFocus={open} onBlur={close}
        onClick={(e) => { e.stopPropagation(); pos ? close() : open(); }}
        style={{ position: 'absolute', ...place, width: 20, height: 20, borderRadius: '50%', border: '1px solid #cbd5e1', background: '#fff', color: '#64748b', fontSize: 11, fontWeight: 700, fontStyle: 'italic', fontFamily: 'Georgia, serif', cursor: 'help', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1, zIndex: 2 }}
      >i</button>
      {pos && createPortal(
        <div role="tooltip" style={{ position: 'fixed', left: pos.left, top: pos.top ?? 'auto', bottom: pos.bottom ?? 'auto', width: 280, zIndex: 10000, pointerEvents: 'none', background: '#ffffff', border: '1px solid #e2e8f0', color: '#475569', borderRadius: 10, padding: '12px 14px', fontSize: 12.5, lineHeight: 1.55, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)', fontFamily: "'Inter', sans-serif", textAlign: 'left' }}>
          <p style={{ margin: '0 0 4px', fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>{title}</p>
          <p style={{ margin: 0 }}>{children}</p>
        </div>,
        document.body
      )}
    </>
  );
}

function verdict(results, idToLabel, simMode, currency = 'Rs', isAnalystView = false, lang = 'en') {
  const tis = results?.time_in_system || {};
  const avg = tis.avg ?? 0;
  const min = tis.min ?? 0;
  const max = tis.max ?? 0;
  const spread = max - min;
  const throughput = extractThroughput(results);
  const bnView = getBottleneckView(results, idToLabel);
  const { label: bnLabel } = getPrimaryBottleneck(results, idToLabel);
  const effectiveBnLabel = bnLabel || (bnView.bottleneckName !== 'None' ? bnView.bottleneckName : null);
  const util = results?.resource_utilization || {};
  const criticalResource = Object.entries(util).find(([, v]) => {
    const p = typeof v === 'object' ? (v?.utilization_pct ?? v?.pct ?? 0) : Number(v) || 0;
    return p > 85;
  });

  const lines = [];
  if (simMode === 'quick') {
    lines.push({ type: 'info', text: t('results_verdictBestCase', lang, fmt(avg, lang)) });
    lines.push({
      type: 'success',
      text: t('results_verdictOptimalBaseline', lang, isAnalystView)
    });
  } else {
    const ov = buildPlainSummary(results, idToLabel);
    if (ov.overloaded && ov.tight) {
      lines.push({
        type: 'warn',
        text: t('results_verdictOverloaded', lang, ov.tight.name, fmt(avg, lang), fmt(ov.work, lang), throughput.toFixed(2))
      });
    } else {
      lines.push({
        type: 'info',
        text: t('results_verdictNormal', lang, fmt(avg, lang), throughput.toFixed(2))
      });
      if (spread / avg < 0.15) {
        lines.push({ type: 'success', text: t('results_verdictReliable', lang) });
      } else {
        lines.push({
          type: 'warn',
          text: t('results_verdictHighRisk', lang, fmt(min, lang), fmt(max, lang))
        });
      }
    }
  }

  if (effectiveBnLabel) {
    if (simMode === 'quick') {
      lines.push({ type: 'alert', text: t('results_verdictSlowestStep', lang, effectiveBnLabel) });
    } else {
      lines.push({
        type: 'alert',
        text: t('results_verdictPrimaryBottleneck', lang, effectiveBnLabel, isAnalystView)
      });
    }
  }
  if (criticalResource && simMode !== 'quick') {
    const rawName = criticalResource[1]?.name ?? criticalResource[1]?.resource ?? criticalResource[0];
    const critName = typeof rawName === 'string' ? rawName : (rawName?.name ?? rawName?.label ?? 'Staff');
    const rawPct = criticalResource[1]?.utilization_pct ?? criticalResource[1]?.pct ?? 0;
    const critPct = typeof rawPct === 'number' ? rawPct : (Number(rawPct) || 0);
    lines.push({
      type: 'alert',
      text: t('results_verdictResourceOverloaded', lang, critName, critPct.toFixed(0))
    });
  }

  if (simMode !== 'quick') {
    const fin = results?.financial_summary;
    if (fin && fin.total_cost > 0) {
      const runType = isAnalystView ? (lang === 'ur' ? 'سمولیشن رن' : lang === 'ur-roman' ? 'simulation run' : 'simulation run') : (lang === 'ur' ? 'ٹیسٹ رن' : lang === 'ur-roman' ? 'test run' : 'test run');
      const formattedCurrencyTotal = formatCurrency(fin.total_cost, lang, currency);
      lines.push({
        type: 'info',
        text: t('results_verdictTotalCost', lang, runType, formattedCurrencyTotal)
      });

      if (fin.total_active_cost === 0) {
        lines.push({
          type: 'warn',
          text: t('results_verdictNoStaffTime', lang)
        });
      } else if (fin.total_idle_cost > 0) {
        const wastePct = (fin.total_idle_cost / fin.total_cost) * 100;
        const idleFmt = formatCurrency(fin.total_idle_cost, lang, currency);
        if (wastePct >= 20) {
          lines.push({
            type: 'warn',
            text: t('results_verdictHighWaste', lang, idleFmt, wastePct.toFixed(1))
          });
        } else {
          lines.push({
            type: 'info',
            text: t('results_verdictIdleSpent', lang, idleFmt, wastePct.toFixed(1))
          });
        }
      }
    }
  }

  return lines;
}

function PlainSummaryCard({ plain, simMode, idToLabel = {}, isAnalystView = false, lang = 'en' }) {
  if (!plain) return null;
  const { total, work, wait, min, max, perHour, perDay, dayHours, tight, arrivalPerHr, status, runs, steps } = plain;
  const isQuick = simMode === 'quick';
  const workPct = total > 0 ? Math.round((work / total) * 100) : 100;
  const waitPct = 100 - workPct;
  const maxStep = Math.max(...steps.map(s => s.work + s.wait), 0.0001);
  const overloaded = !isQuick && status === 'overloaded';
  const chip = isQuick || !status ? null
    : status === 'overloaded' ? { t: t('results_cantKeepUp', lang), c: '#b91c1c', bg: '#fee2e2' }
    : status === 'tight' ? { t: t('results_closeToLimit', lang), c: '#92400e', bg: '#fef3c7' }
    : { t: t('results_runningSmoothly', lang), c: '#15803d', bg: '#dcfce7' };

  const section = { borderTop: '1px solid #f1f5f9', paddingTop: 22, marginTop: 24 };
  const dot = (c) => ({ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: c, marginRight: 6 });

  const Heading = ({ title, hint }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 4, height: 16, background: '#6b4de6', borderRadius: 2 }} />
        <h4 style={{ fontSize: 14, fontWeight: 700, color: '#334155', margin: 0 }}>{title}</h4>
      </div>
      {hint && <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0 12px', lineHeight: 1.5 }}>{hint}</p>}
    </div>
  );

  const Stat = ({ icon, bg, title, val, text, tip, muted, badge }) => (
    <div style={{ position: 'relative', border: '1px solid #e2e8f0', borderRadius: 12, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
      {tip && <InfoTip title={title}>{tip}</InfoTip>}
      <div style={{ width: 48, height: 48, borderRadius: 12, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: '#64748b', margin: '0 0 2px' }}>
          {title}
          {badge && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: badge.c, background: badge.bg, borderRadius: 999, padding: '2px 8px', verticalAlign: 'middle' }}>{badge.t}</span>}
        </p>
        <p style={{ fontSize: 24, fontWeight: 800, color: muted ? '#94a3b8' : '#0f172a', margin: 0, lineHeight: 1.15 }}>{val}</p>
        <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0', lineHeight: 1.4 }}>{text}</p>
      </div>
    </div>
  );

  const who = tight ? (typeof tight.name === 'string' ? tight.name : (tight.name?.name ?? tight.name?.label ?? 'Staff')) : '';
  const callout = (() => {
    if (isQuick || !tight || !status) return null;
    const perHrStr = typeof tight.perHr === 'number' ? tight.perHr.toFixed(1) : String(tight.perHr || 0);
    const utilStr = typeof tight.util === 'number' ? tight.util.toFixed(0) : String(tight.util || 0);
    const targetArrivalStr = typeof tight.perHr === 'number' ? (tight.perHr * 0.8).toFixed(1) : '0.0';
    if (status === 'overloaded') {
      return {
        color: '#ef4444',
        text: arrivalPerHr != null
          ? t('results_calloutOverloadedWithArrival', lang, who, arrivalPerHr.toFixed(1), perHrStr, targetArrivalStr)
          : t('results_calloutOverloadedNoArrival', lang, who, utilStr, perHrStr)
      };
    }
    if (status === 'tight') {
      return {
        color: '#f59e0b',
        text: t('results_calloutTight', lang, who, utilStr, perHrStr)
      };
    }
    return {
      color: '#10b981',
      text: t('results_calloutOk', lang, who, perHrStr, arrivalPerHr != null ? arrivalPerHr.toFixed(1) : null)
    };
  })();

  const top = tight ? (Math.max(arrivalPerHr ?? 0, tight.perHr) * 1.05 || 1) : 1;
  const bar = (name, val, color) => (
    <div key={typeof name === 'string' ? name : 'bar'}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
        <span style={{ color: '#475569' }}>{name}</span>
        <span style={{ fontWeight: 700, color: '#0f172a' }}><bdi dir="ltr">{formatRate(val, 'hr', lang)}</bdi></span>
      </div>
      <div style={{ height: 10, background: '#f1f5f9', borderRadius: 5, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(100, (val / top) * 100)}%`, background: color, borderRadius: 5 }} />
      </div>
    </div>
  );

  return (
    <div style={{ position: 'relative', background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', padding: '28px' }}>
      <InfoTip title={t('results_perfOverview', lang)} whole={false}>
        {t('results_perfOverviewTip', lang)}
      </InfoTip>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: '#f5f3ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <LayoutDashboard size={20} color="#6b4de6" />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 17, fontWeight: 800, color: '#0f172a', margin: 0 }}>{t('results_perfOverview', lang)}</h3>
            {chip && <span style={{ fontSize: 11, fontWeight: 700, color: chip.c, background: chip.bg, borderRadius: 999, padding: '3px 10px' }}>{chip.t}</span>}
          </div>
          <p style={{ fontSize: 13, color: '#64748b', margin: '3px 0 0', lineHeight: 1.5, paddingRight: 28 }} dir="auto">
            {t('results_customerNeedsWork', lang, fmt(work, lang))}
            {overloaded && tight
              ? <> {t('results_customersArriveFaster', lang, who)}</>
              : !isQuick && wait > 0 ? <> {t('results_averageWaitInLine', lang, fmt(wait, lang))}</> : null}
            {isQuick ? ` ${t('results_bestCaseNoWait', lang)}` : ` ${t('results_workedOutFromCustomers', lang, runs)}`}
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        <Stat
          icon={<Clock size={22} color="#6b4de6" />}
          bg="#f5f3ff"
          title={t('results_timePerCustomer', lang)}
          badge={overloaded ? { t: t('results_realTime', lang), c: '#15803d', bg: '#dcfce7' } : null}
          tip={t('results_timePerCustomerTip', lang)}
          val={<bdi dir="ltr">{fmt(work, lang)}</bdi>}
          text={isQuick ? t('results_workNoWait', lang) : t('results_workNotCountingWait', lang)}
        />
        {!isQuick && (
          <>
            <Stat
              icon={<Zap size={22} color="#10b981" />}
              bg="#ecfdf5"
              title={t('results_customersPerHour', lang)}
              tip={t('results_customersPerHourTip', lang)}
              val={<bdi dir="ltr">{perHour.toFixed(1)}</bdi>}
              text={t('results_finishedEveryHour', lang)}
            />
            <Stat
              icon={<Layers size={22} color="#0ea5e9" />}
              bg="#f0f9ff"
              title={t('results_customersPerDay', lang)}
              tip={t('results_customersPerDayTip', lang)}
              val={<bdi dir="ltr">{Math.round(perDay).toLocaleString()}</bdi>}
              text={t('results_inADayHours', lang, dayHours)}
            />
          </>
        )}
        <Stat
          icon={<Target size={22} color="#f59e0b" />}
          bg="#fffbeb"
          title={isAnalystView ? t('results_avgCycleTime', lang) : <Hint term="cycle_time">{t('results_avgCompletionTime', lang)}</Hint>}
          muted={overloaded}
          badge={overloaded ? { t: t('results_inflatedByLine', lang), c: '#b91c1c', bg: '#fee2e2' } : null}
          tip={t('results_avgCycleTimeTip', lang)}
          val={<bdi dir="ltr">{fmt(total, lang)}</bdi>}
          text={isQuick ? t('results_startToFinish', lang) : overloaded ? t('results_pushedUpByGrowingLine', lang) : t('results_fastestSlowest', lang, fmt(min, lang), fmt(max, lang))}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 36, ...section }}>
        <div>
          <Heading title={t('results_howTimeSpent', lang)} hint={t('results_howTimeSpentHint', lang)} />
          <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: '#f1f5f9' }}>
            <div style={{ flex: Math.max(workPct, 1), background: '#6b4de6' }} />
            {waitPct > 0 && <div style={{ flex: waitPct, background: '#06b6d4' }} />}
          </div>
          <p style={{ fontSize: 13, color: '#475569', margin: '12px 0 0' }}>
            <span style={dot('#6b4de6')} /><bdi dir="ltr">{fmt(work, lang)}</bdi> {t('results_workingPct', lang, '', workPct)}
            <span style={{ margin: '0 10px', color: '#cbd5e1' }}>|</span>
            <span style={dot('#06b6d4')} /><bdi dir="ltr">{fmt(wait, lang)}</bdi> {t('results_inLinePct', lang, '', waitPct)}
          </p>
        </div>

        {!isQuick && tight && (
          <div>
            <Heading title={t('results_arrivalsVsRole', lang, who)} hint={t('results_arrivalsVsRoleHint', lang)} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {arrivalPerHr != null && bar(t('results_customersArriving', lang), arrivalPerHr, arrivalPerHr > tight.perHr ? '#ef4444' : '#6b4de6')}
              {bar(t('results_roleCanHandle', lang, who), tight.perHr, '#10b981')}
            </div>
          </div>
        )}
      </div>

      {steps.length > 0 && (
        <div style={section}>
          <Heading title={t('results_stepByStep', lang)} hint={t('results_stepByStepHint', lang, isQuick)} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {steps.map(s => (
              <div key={s.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, marginBottom: 5 }}>
                  <span style={{ fontWeight: 600, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <bdi dir="auto">{idToLabel[s.id] || s.id}</bdi>
                  </span>
                  <span style={{ color: '#64748b', whiteSpace: 'nowrap' }}>
                    <bdi dir="ltr">{fmt(s.work, lang)}</bdi> {t('results_stepWorkWait', lang, '', fmt(s.wait, lang), isQuick)}
                  </span>
                </div>
                <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: '#f1f5f9' }}>
                  <div style={{ width: `${(s.work / maxStep) * 100}%`, minWidth: s.work > 0 ? 3 : 0, background: '#6b4de6' }} />
                  <div style={{ width: `${(s.wait / maxStep) * 100}%`, minWidth: s.wait > 0 ? 3 : 0, background: '#06b6d4' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {callout && (
        <div style={{ marginTop: 24 }}>
          <div style={{ background: '#fafbff', borderLeft: `4px solid ${callout.color}`, borderRadius: '0 8px 8px 0', padding: '14px 18px', fontSize: 14, color: '#334155', lineHeight: 1.6 }} dir="auto">
            {callout.text}
          </div>
        </div>
      )}

      {!isQuick && (
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '16px 0 0', lineHeight: 1.5 }} dir="auto">
          {t('results_cycleTimeFooter', lang, runs, isAnalystView)}
        </p>
      )}
    </div>
  );
}

function InfoIcon({ size = 20, color = '#6b4de6' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function SectionHeader({ icon, bg, title, subtitle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</div>
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>{title}</h3>
        {subtitle && <p style={{ fontSize: 13, color: '#94a3b8', margin: '2px 0 0' }}>{subtitle}</p>}
      </div>
    </div>
  );
}

function ResourceUtilizationSection({ results, isAnalystView = false, lang = 'en' }) {
  const entries = Object.entries(results?.resource_utilization || {});
  if (entries.length === 0) return null;
  const R = 22, CIRC = 2 * Math.PI * R;
  return (
    <div style={{ position: 'relative', background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
      <InfoTip title={isAnalystView ? t('results_tabResources', lang) : t('results_tabStaffActivity', lang)}>
        {isAnalystView
          ? "How much of the time each resource was busy. Above 85% (Overloaded) it cannot keep up and queues form. Below 30% (Underused) it is mostly idle. In between is healthy."
          : "How much of the time each team member was busy. Above 85% (Overloaded) they cannot keep up and lines form. Below 30% (Underused) they are mostly idle. In between is healthy."}
      </InfoTip>
      <SectionHeader
        icon={<Zap size={20} color="#10b981" />}
        bg="#ecfdf5"
        title={isAnalystView ? t('results_resourceUtilization', lang) : <Hint term="utilization">{t('results_howBusyStaffAre', lang)}</Hint>}
        subtitle={isAnalystView ? t('results_howBusySimSubtitle', lang) : t('results_howBusySubtitle', lang)}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {entries.map(([name, u]) => {
          const pct = Math.max(0, Math.min(100, u?.utilization_pct || 0));
          const st = pct >= 85
            ? { label: t('results_badgeOverloaded', lang), color: '#ef4444', text: '#b91c1c', bg: '#fee2e2' }
            : pct < 30
              ? { label: t('results_badgeUnderused', lang), color: '#06b6d4', text: '#0e7490', bg: '#cffafe' }
              : { label: t('results_badgeHealthy', lang), color: '#10b981', text: '#15803d', bg: '#dcfce7' };
          return (
            <div key={name} style={{ background: '#fafbff', border: '1px solid #eef0f6', borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
                  <svg width="56" height="56" viewBox="0 0 56 56">
                    <circle cx="28" cy="28" r={R} fill="none" stroke="#eef0f6" strokeWidth="6" />
                    <circle cx="28" cy="28" r={R} fill="none" stroke={st.color} strokeWidth="6" strokeLinecap="round"
                      strokeDasharray={`${(pct / 100) * CIRC} ${CIRC}`} transform="rotate(-90 28 28)" />
                  </svg>
                  <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#0f172a' }}>{pct.toFixed(0)}</span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: '0 0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <bdi dir="auto">{name}</bdi>
                  </p>
                  <span style={{ fontSize: 11, fontWeight: 700, color: st.text, background: st.bg, borderRadius: 6, padding: '3px 8px' }}>{st.label}</span>
                </div>
              </div>
              <p style={{ fontSize: 12, color: '#94a3b8', margin: '12px 0 0' }}>
                <bdi dir="ltr">{pct.toFixed(0)}%</bdi> {t('results_busyIdleStat', lang, '', (100 - pct).toFixed(0))}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KeyTakeaways({ lines, isAnalystView = false, lang = 'en' }) {
  if (!lines || lines.length === 0) return null;
  const look = {
    info:    { bg: '#f5f3ff', border: '#e9e5ff', color: '#334155', icon: <InfoIcon color="#6b4de6" /> },
    success: { bg: '#f0fdf4', border: '#bbf7d0', color: '#166534', icon: <CheckCircle size={20} color="#10b981" style={{ flexShrink: 0 }} /> },
    warn:    { bg: '#fffbeb', border: '#fde68a', color: '#78350f', icon: <AlertTriangle size={20} color="#f59e0b" style={{ flexShrink: 0 }} /> },
    alert:   { bg: '#fef2f2', border: '#fecaca', color: '#7f1d1d', icon: <ShieldAlert size={20} color="#ef4444" style={{ flexShrink: 0 }} /> },
  };
  return (
    <div style={{ position: 'relative', background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
      <InfoTip title={t('results_keyTakeaways', lang)}>
        {isAnalystView
          ? "The most important findings from this simulation, written in plain sentences. Red points need attention, yellow are warnings, blue are information."
          : "The most important findings from this test, written in plain sentences. Red points need attention, yellow are warnings, blue are information."}
      </InfoTip>
      <SectionHeader
        icon={<CheckCircle size={20} color="#6b4de6" />}
        bg="#f5f3ff"
        title={t('results_keyTakeaways', lang)}
        subtitle={t('results_keyTakeawaysSubtitle', lang, isAnalystView)}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {lines.map((l, i) => {
          const s = look[l.type] || look.info;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10, padding: '14px 18px' }}>
              {s.icon}
              <p style={{ margin: 0, fontSize: 14, color: s.color, lineHeight: 1.5 }}>
                <RichText text={formatPlainLanguage(l.text, { isAnalystView })} />
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RichText({ text }) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return <span>{parts.map((p, i) => i % 2 === 1 ? <strong key={i} style={{ color: '#0f172a', fontWeight: 600 }}>{p}</strong> : <span key={i}>{p}</span>)}</span>;
}

function SpotButton({ onClick, children, size = 'md', variant = 'primary' }) {
  const [hovered, setHovered] = useState(false);
  const pad = size === 'sm' ? '8px 16px' : '12px 24px';
  const fs = size === 'sm' ? 12 : 14;
  
  const bg = variant === 'primary' 
    ? (hovered ? '#5b39e0' : '#6b4de6')
    : (hovered ? '#f8fafc' : '#ffffff');
    
  const color = variant === 'primary' ? '#ffffff' : '#475569';
  const border = variant === 'primary' ? 'none' : '1px solid #e2e8f0';

  return (
    <button onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, padding: pad, fontSize: fs, fontWeight: 700, borderRadius: 8, border, cursor: 'pointer', color, background: bg,
      transition: 'all 0.2s ease', transform: hovered ? 'translateY(-1px)' : 'none'
    }}>{children}</button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PAGE
   ═══════════════════════════════════════════════════════════════ */

export default function ResultsPage() {
  const navigate = useNavigate();
  const { user } = useAuth() || {};
  const { preferredLanguage } = useLanguage();
  const [viewLanguageOverride, setViewLanguageOverride] = useState(null);
  const effectiveLanguage = viewLanguageOverride || preferredLanguage;
  const [isAnalystView] = useAnalystView(user?.id || user?._id);
  const currency = user?.currency || localStorage.getItem('spot:profile:currency') || 'Rs';
  const [results, setResults] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('spot:simulationResults');
        if (stored) return JSON.parse(stored);
      } catch {}
    }
    return null;
  });
  const [idToLabel, setIdToLabel] = useState({});
  const [idToResource, setIdToResource] = useState({});
  const [ready, setReady] = useState(() => {
    if (typeof window !== 'undefined') {
      return Boolean(localStorage.getItem('spot:simulationResults'));
    }
    return false;
  });
  const [activeTab, setActiveTab] = useState('overview');
  const [simMode, setSimMode] = useState('quick');
  const [hasNodes, setHasNodes] = useState(true);

  // What-If comparison states
  const [hasWhatIf, setHasWhatIf] = useState(false);
  const [whatifResults, setWhatifResults] = useState(null);
  const [baselineResults, setBaselineResults] = useState(null);
  const [whatifName, setWhatifName] = useState('What-If Scenario');

  // Scenario history states (lets user revisit any previously run scenario)
  const [scenarioList, setScenarioList] = useState([]); // [{id, name, results}]
  const [activeScenarioKey, setActiveScenarioKey] = useState('baseline');
  const [scenarioPickerOpen, setScenarioPickerOpen] = useState(false);
  const [loadingScenarios, setLoadingScenarios] = useState(false);

  // Run history states (Module H1)
  const [runsList, setRunsList] = useState([]);
  const [runsCursor, setRunsCursor] = useState(null);
  const [hasMoreRuns, setHasMoreRuns] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingMoreRuns, setLoadingMoreRuns] = useState(false);
  const [runsError, setRunsError] = useState(null);
  const [selectedRun, setSelectedRun] = useState(null);
  const [reRunning, setReRunning] = useState(false);

  const handleExportReport = useCallback(() => {
    const lang = effectiveLanguage;
    const isUr = lang === 'ur-roman' || lang === 'ur';
    const sum = selectedRun?.summary || results?.metrics || results || {};
    const reportLines = [
      `SPOT SIMULATION REPORT (${lang.toUpperCase()})`,
      `Generated on: ${new Date().toLocaleString()}`,
      `----------------------------------------`,
      `${isUr ? 'Kul waqt (Cycle time)' : 'Average Cycle Time'}: ${fmt(sum.avg_cycle_time)}`,
      `${isUr ? 'Intezar ka waqt (Wait time)' : 'Average Wait Time'}: ${fmt(sum.avg_wait_time)}`,
      `${isUr ? 'Kharcha (Total cost)' : 'Total Cost'}: Rs ${sum.total_cost || results?.financial?.total_cost || 0}`,
      `----------------------------------------`,
      `Account preferredLanguage: ${preferredLanguage}`,
      `Export view language: ${lang}`,
    ];

    const blob = new Blob([reportLines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spot-simulation-report-${lang}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [effectiveLanguage, preferredLanguage, selectedRun, results]);

  const fetchRuns = useCallback(async (cursor = null) => {
    const processId = localStorage.getItem('spot:processId');
    if (!processId) return;
    if (cursor) {
      setLoadingMoreRuns(true);
    } else {
      setLoadingRuns(true);
      setRunsError(null);
    }
    try {
      const res = await listRuns({ processId, limit: 10, cursor });
      const newRuns = res?.runs || [];
      if (cursor) {
        setRunsList(prev => [...prev, ...newRuns]);
      } else {
        setRunsList(newRuns);
      }
      setRunsCursor(res?.nextCursor || null);
      setHasMoreRuns(Boolean(res?.nextCursor));
    } catch (err) {
      console.warn('Failed to load runs history:', err.message);
      if (err.message && err.message.includes('404')) {
        setRunsError('Process or runs not found.');
      } else {
        setRunsError(err.message || 'Failed to load run history');
      }
    } finally {
      setLoadingRuns(false);
      setLoadingMoreRuns(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  async function handleSelectRun(runItem) {
    setRunsError(null);
    try {
      const fullRun = await getRun(runItem._id);
      if (fullRun && fullRun.results) {
        setSelectedRun(fullRun);
        setResults(fullRun.results);
        setActiveTab('overview');
        setScenarioPickerOpen(false);
      }
    } catch (err) {
      console.error('Failed to load full run:', err);
      if (err.message && err.message.includes('404')) {
        alert('This simulation run was not found or has been deleted.');
      } else {
        alert(err.message || 'Unable to open saved run');
      }
    }
  }

  async function handleDeleteRun(e, runId) {
    e.stopPropagation();
    if (!window.confirm('Delete this saved simulation run?')) return;
    try {
      await deleteRun(runId);
      setRunsList(prev => prev.filter(r => r._id !== runId));
      if (selectedRun?._id === runId) {
        setSelectedRun(null);
        const raw = localStorage.getItem('spot:simulationResults');
        if (raw) setResults(JSON.parse(raw));
      }
    } catch (err) {
      alert(err.message || 'Failed to delete run');
    }
  }

  async function handleReRun() {
    if (!selectedRun) return;
    setReRunning(true);
    try {
      const processId = selectedRun.processId;
      const scenarioId = selectedRun.scenarioId;
      const config = {
        mode: 'deep',
        arrival_rate: selectedRun.config?.arrival ?? 1.0,
        total_instances: selectedRun.config?.instances ?? 1000,
        seed: selectedRun.config?.seed ?? 42,
        replications: selectedRun.config?.replications ?? 1,
      };

      let res;
      if (scenarioId) {
        res = await runScenarioSimulation(scenarioId, config);
      } else {
        res = await runSimulation(processId, config);
      }

      const freshResults = res?.results || res;
      if (freshResults) {
        setResults(freshResults);
        setSelectedRun(null);
        if (!scenarioId) {
          localStorage.setItem('spot:simulationResults', JSON.stringify(freshResults));
          localStorage.setItem('spot:hasWhatIfResults', 'false');
        } else {
          localStorage.setItem('spot:whatifResults', JSON.stringify(freshResults));
          localStorage.setItem('spot:hasWhatIfResults', 'true');
        }
        fetchRuns();
      }
    } catch (err) {
      console.error('Re-run failed:', err);
      alert(err.message || 'Failed to re-run simulation');
    } finally {
      setReRunning(false);
    }
  }

  const anySalaryEstimated = useMemo(() => {
    if (results?.anySalaryEstimated) return true;
    if (typeof window !== 'undefined') {
      if (localStorage.getItem('spot:anySalaryEstimated') === 'true') return true;
      try {
        const stored = JSON.parse(localStorage.getItem('spot:globalResources') || '[]');
        if (Array.isArray(stored)) {
          return stored.some(
            (r) =>
              r.type === 'staff' &&
              (r.costSource === 'assumed' || r.costSource === 'estimated' || r.salaryEstimated)
          );
        }
      } catch {}
    }
    return false;
  }, [results]);

  useEffect(() => {
    setIdToLabel(buildIdToLabel());
    setIdToResource(buildIdToResource());
    try {
      // Baseline results should be available for comparison/history purposes
      // regardless of whether the *current* view is a what-if run or not —
      // otherwise the "Previous Scenarios" picker has nothing to compare against
      // right after a plain baseline run.
      const rawBase = localStorage.getItem('spot:baselineResults');
      const baseParsed = rawBase ? JSON.parse(rawBase) : null;
      setBaselineResults(baseParsed);

      const rawHasWhatIf = localStorage.getItem('spot:hasWhatIfResults') === 'true';
      if (rawHasWhatIf) {
        setHasWhatIf(true);
        setActiveTab('whatif');
        const rawWI = localStorage.getItem('spot:whatifResults');
        const wiParsed = rawWI ? JSON.parse(rawWI) : null;
        setWhatifResults(wiParsed);

        const winame = localStorage.getItem('spot:whatifName');
        if (winame) setWhatifName(winame);
        
        // Show what-if results by default in standard widgets
        if (wiParsed) {
          setResults(wiParsed);
          const mode = wiParsed?.mode || localStorage.getItem('spot:simulationMode') || 'quick';
          setSimMode(mode);
        }
      } else {
        setHasWhatIf(false);
        const raw = localStorage.getItem('spot:simulationResults');
        if (raw) {
          const parsed = JSON.parse(raw);
          setResults(parsed);
          const mode = parsed?.mode || localStorage.getItem('spot:simulationMode') || 'quick';
          setSimMode(mode);
        }
      }
      
      const rawNodes = localStorage.getItem('spot:model:nodes');
      let nodesArray = [];
      if (rawNodes) {
        const parsedNodes = JSON.parse(rawNodes);
        nodesArray = Array.isArray(parsedNodes) ? parsedNodes : (parsedNodes.nodes || []);
      }

      const activeRes = rawHasWhatIf ? localStorage.getItem('spot:whatifResults') : localStorage.getItem('spot:simulationResults');
      const hasValidResults = Boolean(activeRes && activeRes !== 'null' && activeRes !== '{}');
      setHasNodes(nodesArray.length > 0 || hasValidResults);
      setTimeout(() => setReady(true), 100);
    } catch { }
  }, []);

  // Load the full scenario history so any previously run scenario can be re-viewed
  useEffect(() => {
    const baseProcessId = localStorage.getItem('spot:processId');
    if (!baseProcessId) return;
    setLoadingScenarios(true);
    getScenarios(baseProcessId)
      .then((res) => {
        const list = res?.scenarios || res || [];
        const withResults = (Array.isArray(list) ? list : [])
          .filter(s => s.simulationResults)
          .map(s => ({ id: s._id, name: s.title || s.name || 'Untitled Scenario', results: s.simulationResults }));
        setScenarioList(withResults);
      })
      .catch(() => { /* backend unavailable — history simply won't be offered */ })
      .finally(() => setLoadingScenarios(false));
  }, []);

  // Switch the dashboard to show baseline only, or a baseline-vs-scenario comparison
  function selectScenario(key) {
    setScenarioPickerOpen(false);
    setActiveScenarioKey(key);

    if (key === 'baseline') {
      const baseRaw = localStorage.getItem('spot:baselineResults') || localStorage.getItem('spot:simulationResults');
      const baseParsed = baseRaw ? JSON.parse(baseRaw) : baselineResults;
      setHasWhatIf(false);
      setResults(baseParsed);
      try {
        localStorage.setItem('spot:hasWhatIfResults', 'false');
      } catch {}
      return;
    }

    const entry = scenarioList.find(s => s.id === key);
    if (!entry) return;

    setWhatifResults(entry.results);
    setWhatifName(entry.name);
    setHasWhatIf(true);
    setActiveTab('whatif');
    setResults(entry.results);
    try {
      localStorage.setItem('spot:whatifResults', JSON.stringify(entry.results));
      localStorage.setItem('spot:whatifName', entry.name);
      localStorage.setItem('spot:hasWhatIfResults', 'true');
    } catch {}
  }

  const tis = results?.time_in_system || {};
  const totalAvg = tis.avg ?? 0;
  const maxTime = tis.max ?? 0;
  const minTime = tis.min ?? 0;
  const throughput = extractThroughput(results);
  const runs = results?.runs ?? 1;
  const spread = maxTime - minTime;
  
  // What-if comparison metrics
  const comparisonMetrics = useMemo(() => {
    if (!hasWhatIf || !baselineResults || !whatifResults) return null;
    const safeBase = prepareResultForMetrics(baselineResults, idToLabel);
    const safeWI = prepareResultForMetrics(whatifResults, idToLabel);
    return computeComparisonMetrics(safeBase, safeWI, idToLabel);
  }, [hasWhatIf, baselineResults, whatifResults, idToLabel]);
  
  const { id: bnId, label: bnLabel, data: bnData } = getPrimaryBottleneck(results, idToLabel);

  const actObj = results?.activity_results || {};
  const actRows = useMemo(() => Object.entries(actObj).map(([id, v]) => ({
    name: idToLabel[id] || id,
    cycle: v.avg_cycle_time ?? 0,
    proc: v.avg_processing_time ?? 0,
    wait: v.avg_wait_time ?? 0,
  })).sort((a, b) => b.cycle - a.cycle), [actObj, idToLabel]);

  const totalProc = actRows.reduce((acc, row) => acc + row.proc, 0);
  const totalWait = actRows.reduce((acc, row) => acc + row.wait, 0);
  const pieData = [{ name: 'Active', value: totalProc || 1, color: '#6b4de6' }, { name: 'Waiting', value: totalWait, color: '#06b6d4' }];

  const queuesObj = results?.queue_levels || {};
  const queueRows = useMemo(() => {
    // All tasks from activity_results appear in WIP — tasks without resources
    // show 0s wait (correct), tasks with resources show actual wait from queue_levels
    const allTaskIds = Object.keys(results?.activity_results || {});
    return allTaskIds.map(id => {
      const qData = queuesObj[id];
      const aData = (results?.activity_results || {})[id];
      return {
        name: idToLabel[id] || id,
        avg: qData?.avg_queue_length ?? 0,
        avgWait: qData?.avg_wait_time ?? aData?.avg_wait_time ?? 0,
      };
    }).sort((a, b) => b.avgWait - a.avgWait);
  }, [queuesObj, results, idToLabel]);

  const maxWait = useMemo(() => Math.max(...queueRows.map(q => q.avgWait), 1), [queueRows]);
  const summaryLines = useMemo(() => results ? verdict(results, idToLabel, simMode, currency, isAnalystView, effectiveLanguage) : [], [results, idToLabel, simMode, currency, isAnalystView, effectiveLanguage]);
  const plain = useMemo(() => results ? buildPlainSummary(results, idToLabel) : null, [results, idToLabel]);
  const fade = (i) => ({ opacity: ready ? 1 : 0, transform: ready ? 'translateY(0)' : 'translateY(15px)', transition: `all 0.5s ease ${i * 0.07}s` });

  if (!ready) return null; // Prevent flicker before useEffect resolves

  if (!results || !hasNodes) {
    return (
      <div style={{ height: '100%', overflowY: 'auto', background: '#f8fafc', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ background: '#fff', padding: 48, borderRadius: 24, boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', textAlign: 'center', maxWidth: 480, border: '1px solid #e2e8f0' }}>
          <div style={{ width: 80, height: 80, background: '#f5f3ff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
            <LayoutDashboard size={40} color="#6b4de6" />
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>
            {t('results_noResultsTitle', effectiveLanguage)}
          </h2>
          <p style={{ fontSize: 15, color: '#64748b', lineHeight: 1.6, marginBottom: 32 }}>
            {!hasNodes 
              ? t('results_noResultsDescNoNodes', effectiveLanguage)
              : t('results_noResultsDescNeedRun', effectiveLanguage)}
          </p>
          <SpotButton onClick={() => navigate(!hasNodes ? '/model' : '/simulate')} size="md">
            {!hasNodes ? t('results_buildModel', effectiveLanguage) : (isAnalystView ? t('results_rerunSim', effectiveLanguage) : t('results_runTest', effectiveLanguage))}
          </SpotButton>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'overview', label: t('results_tabOverview', effectiveLanguage), icon: <LayoutDashboard size={15} /> },
    { id: 'bottlenecks', label: isAnalystView ? t('results_tabBottlenecks', effectiveLanguage) : t('results_tabWhereWait', effectiveLanguage), icon: <Target size={15} /> },
    ...(simMode !== 'quick' && Object.keys(results?.resource_utilization || {}).length > 0 ? [{ id: 'resources', label: isAnalystView ? t('results_tabResources', effectiveLanguage) : t('results_tabStaffActivity', effectiveLanguage), icon: <Zap size={15} /> }] : []),
    ...(simMode !== 'quick' ? [{ id: 'financial', label: t('results_tabFinancial', effectiveLanguage), icon: <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1 }}>{currency}</span> }] : []),
    ...(hasWhatIf && comparisonMetrics ? [{ id: 'whatif', label: isAnalystView ? t('results_tabWhatIfComparison', effectiveLanguage) : t('results_tabIdeaComparison', effectiveLanguage), icon: <GitCompare size={15} /> }] : []),
    { id: 'takeaways', label: t('results_tabKeyTakeaways', effectiveLanguage), icon: <CheckCircle size={15} /> },
  ];
  const tab = tabs.some(t => t.id === activeTab) ? activeTab : 'overview';

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#f8fafc', fontFamily: "'Inter', sans-serif", paddingBottom: 40 }}>

      <AIChatWidget results={results} idToLabel={idToLabel} simMode={simMode} language={effectiveLanguage} />

      {/* HEADER */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => navigate('/simulate')} style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><ArrowLeft size={18} color="#64748b" /></button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                {isAnalystView ? t('results_simResults', effectiveLanguage) : t('results_testResults', effectiveLanguage)}
              </h1>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: simMode === 'deep' ? '#1e1b4b' : '#f5f3ff', color: simMode === 'deep' ? '#c7d2fe' : '#6b4de6', border: '1px solid #ddd6fe' }}>
                {simMode === 'deep' ? t('results_deepAnalysisBadge', effectiveLanguage) : t('results_quickAnalysisBadge', effectiveLanguage)}
              </span>
            </div>
            <p style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
              {isAnalystView ? t('results_basedOnIterations', effectiveLanguage, runs) : t('results_basedOnRuns', effectiveLanguage, runs)}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
          <div style={{ position: 'relative' }}>
            <SpotButton onClick={() => setScenarioPickerOpen(o => !o)} variant="secondary" size="sm">
              <History size={14} /> {loadingRuns ? t('results_loadingRuns', effectiveLanguage) : (isAnalystView ? t('results_runHistory', effectiveLanguage) : t('results_testHistory', effectiveLanguage))} <ChevronDown size={14} />
            </SpotButton>
            {scenarioPickerOpen && (
              <div onClick={() => setScenarioPickerOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 15 }} />
            )}
            {scenarioPickerOpen && (
              <div style={{
                position: 'absolute', top: '110%', right: 0, background: '#fff', border: '1px solid #e2e8f0',
                borderRadius: 10, boxShadow: '0 8px 24px rgba(15,23,42,0.12)', minWidth: 320, zIndex: 20,
                padding: 8, maxHeight: 380, overflowY: 'auto'
              }}>
                <div style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {isAnalystView ? t('results_savedSimRuns', effectiveLanguage) : t('results_savedTestRuns', effectiveLanguage)}
                </div>

                {loadingRuns && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 10px', color: '#6b4de6', fontSize: 13 }}>
                    <Loader2 size={16} className="animate-spin" /> {t('results_loadingRuns', effectiveLanguage)}
                  </div>
                )}

                {runsError && (
                  <p style={{ fontSize: 12.5, color: '#dc2626', padding: '8px 10px', margin: 0 }}>
                    {runsError}
                  </p>
                )}

                {!loadingRuns && runsList.length === 0 && !runsError && (
                  <p style={{ fontSize: 12.5, color: '#94a3b8', padding: '12px 10px', margin: 0 }}>
                    {isAnalystView ? t('results_noSavedSimRuns', effectiveLanguage) : t('results_noSavedRuns', effectiveLanguage)}
                  </p>
                )}

                {runsList.map(r => {
                  const isSelected = selectedRun?._id === r._id;
                  const isBaseline = !r.scenarioId;
                  const dateStr = new Date(r.createdAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit'
                  });
                  return (
                    <div
                      key={r._id}
                      onClick={() => handleSelectRun(r)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                        background: isSelected ? '#f5f3ff' : 'transparent',
                        marginBottom: 2
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = isSelected ? '#ede9fe' : '#f8fafc'}
                      onMouseLeave={e => e.currentTarget.style.background = isSelected ? '#f5f3ff' : 'transparent'}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {isBaseline ? <Layers size={13} color="#6b4de6" /> : <GitCompare size={13} color="#06b6d4" />}
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.title || (isBaseline ? (isAnalystView ? 'Baseline' : 'Current setup') : (isAnalystView ? 'Scenario' : 'Idea to try'))}
                          </span>
                          <span style={{ fontSize: 11, color: '#64748b' }}>• {dateStr}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: '#475569', paddingLeft: 19 }}>
                          Wait: {r.summary?.avg_wait_time != null ? `${r.summary.avg_wait_time}m` : '—'} · Cycle: {r.summary?.avg_cycle_time != null ? `${r.summary.avg_cycle_time}m` : '—'}
                        </div>
                      </div>
                      <button
                        title="Delete run"
                        onClick={(e) => handleDeleteRun(e, r._id)}
                        style={{
                          background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer',
                          padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                        onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}

                {hasMoreRuns && (
                  <button
                    onClick={() => fetchRuns(runsCursor)}
                    disabled={loadingMoreRuns}
                    style={{
                      width: '100%', marginTop: 6, padding: '8px 12px', background: '#f8fafc',
                      border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      color: '#475569', cursor: loadingMoreRuns ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {loadingMoreRuns ? t('results_loadingRuns', effectiveLanguage) : t('results_loadMore', effectiveLanguage)}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* One-off Language Override for View/Export */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f8fafc', padding: '4px 10px', borderRadius: 8, border: '1px solid #e2e8f0' }} title="Override language for this view or export only, without changing your account preferredLanguage">
            <Globe size={13} color="#64748b" />
            <span style={{ fontSize: 11.5, fontWeight: 600, color: '#475569' }}>{t('results_viewExportIn', effectiveLanguage)}</span>
            <select
              value={viewLanguageOverride || ''}
              onChange={(e) => setViewLanguageOverride(e.target.value || null)}
              style={{
                border: 'none',
                background: 'transparent',
                fontSize: 12,
                fontWeight: 600,
                color: '#5E43F3',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="">{t('results_viewExportDefault', effectiveLanguage, preferredLanguage.toUpperCase())}</option>
              <option value="en">English (en)</option>
              <option value="ur-roman">Roman Urdu (ur-roman)</option>
              <option value="ur">اردو (ur)</option>
            </select>
          </div>

          <SpotButton onClick={handleExportReport} variant="secondary" size="sm" title="Export simulation report in chosen language">
            <Download size={13} /> {t('results_export', effectiveLanguage)}
          </SpotButton>

          <SpotButton onClick={() => navigate('/simulate')} size="sm">
            <RefreshCw size={14} /> {isAnalystView ? t('results_rerunSim', effectiveLanguage) : t('results_rerunTest', effectiveLanguage)}
          </SpotButton>
        </div>
      </header>

      {/* Saved Run Read-Only Banner */}
      {selectedRun && (
        <div style={{
          background: '#f5f3ff',
          borderBottom: '1px solid #ddd6fe',
          padding: '12px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <History size={18} color="#6b4de6" />
            <div>
              <span style={{ fontWeight: 700, color: '#1e1b4b', fontSize: 13.5 }}>
                {t('results_savedRunFrom', effectiveLanguage, new Date(selectedRun.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}
              </span>
              <span style={{ marginLeft: 8, fontSize: 11.5, color: '#6b4de6', background: '#ede9fe', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
                {selectedRun.title || (selectedRun.scenarioId ? (isAnalystView ? 'Scenario' : 'Idea to try') : (isAnalystView ? 'Baseline' : 'Current setup'))} (Read-Only)
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <SpotButton
              size="sm"
              onClick={handleReRun}
              disabled={reRunning}
            >
              <RefreshCw size={13} className={reRunning ? "animate-spin" : ""} /> {reRunning ? t('results_rerunning', effectiveLanguage) : t('results_rerun', effectiveLanguage)}
            </SpotButton>
            <button
              onClick={() => {
                setSelectedRun(null);
                const raw = localStorage.getItem('spot:simulationResults');
                if (raw) setResults(JSON.parse(raw));
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#64748b',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
                textDecoration: 'underline'
              }}
            >
              {t('results_exitSavedView', effectiveLanguage)}
            </button>
          </div>
        </div>
      )}

      {/* DASHBOARD CONTAINER */}
      <main style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* TABS */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e2e8f0', overflowX: 'auto' }}>
          {tabs.map(t => {
            const on = t.id === tab;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 18px', background: 'transparent',
                  border: 'none', borderBottom: on ? '2px solid #6b4de6' : '2px solid transparent', marginBottom: -1,
                  fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer',
                  color: on ? '#6b4de6' : '#64748b', transition: 'color 0.15s ease'
                }}
                onMouseEnter={e => { if (!on) e.currentTarget.style.color = '#334155'; }}
                onMouseLeave={e => { if (!on) e.currentTarget.style.color = '#64748b'; }}
              >
                {t.icon} {t.label}
              </button>
            );
          })}
        </div>

        {tab === 'overview' && (
          <>
        <AIInsightsPanel results={results} idToLabel={idToLabel} simMode={simMode} idToResource={idToResource} processId={typeof window !== 'undefined' ? localStorage.getItem('spot:processId') : null} language={effectiveLanguage} />

        <PlainSummaryCard plain={plain} simMode={simMode} idToLabel={idToLabel} isAnalystView={isAnalystView} lang={effectiveLanguage} />

        {/* ROW 1: Dynamic Top Level Stats based on Mode */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, ...fade(0) }}>
          
          <div style={{ position: 'relative', background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '24px', display: 'flex', alignItems: 'center', gap: 20 }}>
<InfoTip title={isAnalystView ? t('results_avgCycleTime', effectiveLanguage) : t('results_avgCompletionTime', effectiveLanguage)}>{t('results_avgCycleTimeTip', effectiveLanguage)}</InfoTip>
            <div style={{ width: 56, height: 56, borderRadius: 12, background: '#f5f3ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Clock size={24} color="#6b4de6" /></div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>{simMode === 'quick' ? t('results_bestCaseDuration', effectiveLanguage) : (isAnalystView ? t('results_avgCycleTime', effectiveLanguage) : <Hint term="cycle_time">{t('results_avgCompletionTime', effectiveLanguage)}</Hint>)}</p>
              <p style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}><bdi dir="ltr">{fmt(totalAvg, effectiveLanguage)}</bdi></p>
              {simMode !== 'quick' && plain?.overloaded && <p style={{ fontSize: 11, color: '#b45309', marginTop: 4 }}>{t('results_inflatedByQueue', effectiveLanguage)}</p>}
            </div>
          </div>

          {simMode !== 'quick' && (
            <div style={{ position: 'relative', background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '24px', display: 'flex', alignItems: 'center', gap: 20 }}>
<InfoTip title={isAnalystView ? t('results_productionSpeed', effectiveLanguage) : t('results_customersServedPerHour', effectiveLanguage)}>{t('results_customersPerHourTip', effectiveLanguage)}</InfoTip>
              <div style={{ width: 56, height: 56, borderRadius: 12, background: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Zap size={24} color="#10b981" /></div>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>{isAnalystView ? t('results_productionSpeed', effectiveLanguage) : <Hint term="throughput">{t('results_customersServedPerHour', effectiveLanguage)}</Hint>}</p>
                <p style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}><bdi dir="ltr">{formatRate(throughput * 60, 'hour', effectiveLanguage)}</bdi></p>
              </div>
            </div>
          )}

          {/* Conditional Metric: Predictability vs. Worst-Case Risk */}
          <div style={{ position: 'relative', background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '24px', display: 'flex', alignItems: 'center', gap: 20 }}>
<InfoTip title={simMode === 'deep' ? t('results_worstCaseScenario', effectiveLanguage) : t('results_predictability', effectiveLanguage)}>{simMode === 'deep' ? t('results_worstCaseScenario', effectiveLanguage) : t('results_predictability', effectiveLanguage)}</InfoTip>
            <div style={{ width: 56, height: 56, borderRadius: 12, background: simMode === 'deep' ? '#fef2f2' : '#fffbeb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {simMode === 'deep' ? <ShieldAlert size={24} color="#ef4444" /> : <Target size={24} color="#f59e0b" />}
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>{simMode === 'deep' ? t('results_worstCaseScenario', effectiveLanguage) : t('results_predictability', effectiveLanguage)}</p>
              <p style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>{simMode === 'deep' ? <bdi dir="ltr">{fmt(maxTime, effectiveLanguage)}</bdi> : (spread === 0 ? t('results_consistent', effectiveLanguage) : t('results_variable', effectiveLanguage))}</p>
            </div>
          </div>

          {/* Critical Alert Card */}
          <div style={{ position: 'relative', background: bnLabel ? '#fef2f2' : '#fff', borderRadius: 12, border: `1px solid ${bnLabel ? '#fecaca' : '#e2e8f0'}`, padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
<InfoTip title={simMode === 'quick' ? t('results_slowestTask', effectiveLanguage) : (isAnalystView ? t('results_criticalBottleneck', effectiveLanguage) : t('results_tabWhereWait', effectiveLanguage))}>{isAnalystView ? t('results_criticalBottleneck', effectiveLanguage) : t('results_tabWhereWait', effectiveLanguage)}</InfoTip>
            {bnLabel ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 800, color: '#dc2626', textTransform: 'uppercase', marginBottom: 4 }}>{simMode === 'quick' ? t('results_slowestTask', effectiveLanguage) : (isAnalystView ? t('results_criticalBottleneck', effectiveLanguage) : <Hint term="bottleneck">{t('results_tabWhereWait', effectiveLanguage)}</Hint>)}</p>
                  <p style={{ fontSize: 20, fontWeight: 700, color: '#991b1b' }}>"<bdi dir="auto">{bnLabel}</bdi>"</p>
                </div>
                <button onClick={() => navigate('/model')} style={{ padding: '8px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{t('results_fixNow', effectiveLanguage)}</button>
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: '#94a3b8' }}><CheckCircle size={24} style={{ marginBottom: 8 }} /> <p style={{ fontSize: 14 }}>{t('results_noIssuesDetected', effectiveLanguage)}</p></div>
            )}
          </div>
        </div>


        {/* Context bar */}
        <div style={{ background: '#fff', padding: '16px 24px', borderRadius: 12, border: '1px solid #e2e8f0', ...fade(1) }}>
          <p style={{ fontSize: 15, color: '#475569', margin: 0 }} dir="auto">
            {simMode === 'deep' && spread > 0 ? (
              <span>{t('results_timesVary', effectiveLanguage, fmt(spread, effectiveLanguage), bnLabel)}</span>
            ) : (
              <span>{bnLabel ? t('results_throughputLimitedBy', effectiveLanguage, bnLabel) : t('results_processOperatingEfficiently', effectiveLanguage)}</span>
            )}
          </p>
        </div>
          </>
        )}

        {tab === 'bottlenecks' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 24 }}>
            {/* Pie Chart Card */}
            {simMode !== 'quick' && (
              <div style={{ position: 'relative', background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
<InfoTip title={t('results_systemEfficiency', effectiveLanguage)}>{t('results_systemEfficiencyTip', effectiveLanguage)}</InfoTip>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 24 }}>{t('results_systemEfficiency', effectiveLanguage)}</h3>
                <div style={{ height: 260, position: 'relative' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={4} dataKey="value">
                        {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                    <p style={{ fontSize: 32, fontWeight: 800, color: '#6b4de6', margin: 0 }}><bdi dir="ltr">{((totalProc / (totalProc + totalWait)) * 100).toFixed(0)}%</bdi></p>
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>{t('results_activeLabel', effectiveLanguage)}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Roadblock Analysis Card */}
            <div style={{ position: 'relative', background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px', display: 'flex', flexDirection: 'column' }}>
<InfoTip title={t('results_constraintAnalysis', effectiveLanguage)}>{t('results_constraintAnalysisTip', effectiveLanguage)}</InfoTip>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 24 }}>{t('results_constraintAnalysis', effectiveLanguage)}</h3>
              <div style={{ flex: 1, background: '#fafbff', border: '2px dashed #e2e8f0', borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
                {bnLabel ? (
                  <>
                    <div style={{ width: 64, height: 64, background: '#f5f3ff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                      <AlertTriangle size={32} color="#6b4de6" />
                    </div>
                    <h4 style={{ fontSize: 24, fontWeight: 700, color: '#1e1b4b', marginBottom: 8 }}><bdi dir="auto">{bnLabel}</bdi></h4>
                    <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, marginBottom: 24 }} dir="auto">
                      {t('results_constraintDesc', effectiveLanguage, fmt(bnData?.processing_time_avg, effectiveLanguage), fmt(bnData?.wait_time_avg, effectiveLanguage))}
                    </p>
                    <SpotButton onClick={() => navigate('/model')} variant="secondary" size="sm">{t('results_editProperties', effectiveLanguage)}</SpotButton>
                  </>
                ) : <p style={{ color: '#94a3b8' }}>{t('results_noMajorRoadblocks', effectiveLanguage)}</p>}
              </div>
            </div>

            {/* Queue Visualization Card */}
            {simMode !== 'quick' && (
              <div style={{ position: 'relative', background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
<InfoTip title={t('results_queueBacklog', effectiveLanguage)}>{t('results_queueBacklogTip', effectiveLanguage)}</InfoTip>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 24 }}>{t('results_queueBacklog', effectiveLanguage)}</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {queueRows.length > 0 ? queueRows.slice(0, 4).map((q, i) => (
                    <div key={i}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                        <span style={{ fontWeight: 600, color: '#334155' }}><bdi dir="auto">{q.name}</bdi></span>
                        <span style={{ color: '#64748b' }}>
                          <bdi dir="ltr">{t('results_queueItemDesc', effectiveLanguage, fmt(q.avgWait, effectiveLanguage), q.avg.toFixed(1))}</bdi>
                        </span>
                      </div>
                      <div style={{ height: 12, background: '#f1f5f9', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min((q.avgWait / maxWait) * 100, 100)}%`, background: q.avgWait > 0 ? '#6b4de6' : '#e2e8f0', borderRadius: 6 }} />
                      </div>
                    </div>
                  )) : <p style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', marginTop: 40 }}>{t('results_noQueueBuildUp', effectiveLanguage)}</p>}
                </div>
              </div>
            )}
            </div>
        )}

        {tab === 'resources' && <ResourceUtilizationSection results={results} isAnalystView={isAnalystView} lang={effectiveLanguage} />}

        {tab === 'financial' && (
          <>
            {!(results?.financial_summary?.total_cost > 0) && (
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', borderLeft: '4px solid #06b6d4', padding: '18px 22px' }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: '0 0 6px' }}>{t('results_noCostFigures', effectiveLanguage)}</p>
                <p style={{ fontSize: 14, color: '#475569', margin: 0, lineHeight: 1.6 }}>
                  {t('results_noCostFiguresDesc', effectiveLanguage)}
                </p>
              </div>
            )}
            {/* Financial Analysis Section */}
            {results?.financial_summary && simMode !== 'quick' && (
              <div style={{ position: 'relative', background: 'linear-gradient(to bottom right, #ffffff, #faf5ff)', borderRadius: 16, border: '1px solid #e2e8f0', padding: '28px', boxShadow: '0 4px 20px rgba(107, 77, 230, 0.04)' }}>
<InfoTip title={t('results_financialAnalysis', effectiveLanguage)} whole={false}>{t('results_verdictIdleSpent', effectiveLanguage, '', '')}</InfoTip>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#6b4de6', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(107, 77, 230, 0.2)' }}>
                    <span style={{ color: '#fff', fontSize: 16, fontWeight: 700 }}>{currency}</span>
                  </div>
                  <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>{t('results_financialAnalysis', effectiveLanguage)}</h3>
                </div>

                {/* Warning card if active == 0 && paid > 0 */}
                {results.financial_summary.total_active_cost === 0 && results.financial_summary.total_cost > 0 && (
                  <div style={{
                    background: '#fffbeb',
                    border: '1px solid #fef3c7',
                    borderLeft: '4px solid #f59e0b',
                    borderRadius: 12,
                    padding: '16px 20px',
                    marginBottom: 20,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12
                  }}>
                    <AlertTriangle size={20} color="#d97706" style={{ flexShrink: 0 }} />
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 700, color: '#92400e', margin: '0 0 2px' }}>
                        {t('results_verdictNoStaffTime', effectiveLanguage)}
                      </p>
                    </div>
                  </div>
                )}

                {(() => {
                  const fin = results.financial_summary;
                  const nCustomers = fin.customers ?? results?.time_in_system?.count ?? results?.total_runs ?? results?.instances_completed ?? 0;
                  const periodHours = fin.period_hours != null ? Number(fin.period_hours).toFixed(1) : (results?.total_sim_time ? (results.total_sim_time / 60).toFixed(1) : '0.0');
                  const costPerCustomer = fin.cost_per_customer != null && fin.cost_per_customer > 0 ? fin.cost_per_customer : (nCustomers > 0 ? (fin.total_cost / nCustomers) : 0);

                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 32 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div style={{ padding: '20px', background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.02)', position: 'relative', overflow: 'hidden' }}>
                          <div style={{ position: 'absolute', top: 0, left: 0, width: 4, height: '100%', background: '#0f172a' }} />
                          <p style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }} dir="auto">
                            {t('results_costForThisRun', effectiveLanguage, nCustomers, periodHours)}
                          </p>
                          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                            <p style={{ fontSize: 32, fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: -0.5 }}>
                              <bdi dir="ltr">{formatCurrency(fin.total_cost || 0, effectiveLanguage, currency)}</bdi>
                            </p>
                            {anySalaryEstimated && (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '4px 8px',
                                  borderRadius: 6,
                                  background: '#fef3c7',
                                  border: '1px solid #fde68a',
                                  color: '#92400e',
                                  fontSize: 11,
                                  fontWeight: 600,
                                }}
                              >
                                <AlertTriangle size={12} color="#d97706" /> {t('results_basedOnEstimatedValues', effectiveLanguage)}
                              </span>
                            )}
                          </div>
                        </div>
                        
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                          <div style={{ padding: '14px', background: 'linear-gradient(to bottom, #ffffff, #f5f3ff)', borderRadius: 12, border: '1px solid #ddd6fe', boxShadow: '0 2px 4px rgba(107, 77, 230, 0.05)' }}>
                            <p style={{ fontSize: 11, fontWeight: 700, color: '#6b4de6', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{isAnalystView ? t('results_activeCost', effectiveLanguage) : <Hint term="active_cost">{t('results_activeCostHint', effectiveLanguage)}</Hint>}</p>
                            <p style={{ fontSize: 16, fontWeight: 800, color: '#4338ca', margin: 0 }}>
                              <bdi dir="ltr">{formatCurrency(fin.total_active_cost || 0, effectiveLanguage, currency)}</bdi>
                            </p>
                          </div>
                          <div style={{ padding: '14px', background: 'linear-gradient(to bottom, #ffffff, #ecfeff)', borderRadius: 12, border: '1px solid #a5f3fc', boxShadow: '0 2px 4px rgba(6, 182, 212, 0.06)' }}>
                            <p style={{ fontSize: 11, fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{isAnalystView ? t('results_idleCost', effectiveLanguage) : <Hint term="idle_cost">{t('results_idleCostHint', effectiveLanguage)}</Hint>}</p>
                            <p style={{ fontSize: 16, fontWeight: 800, color: '#0e7490', margin: 0 }}>
                              <bdi dir="ltr">{formatCurrency(fin.total_idle_cost || 0, effectiveLanguage, currency)}</bdi>
                            </p>
                          </div>
                          <div style={{ padding: '14px', background: 'linear-gradient(to bottom, #ffffff, #f8fafc)', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                            <p style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{t('results_costPerCustomer', effectiveLanguage)}</p>
                            <p style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: 0 }}>
                              <bdi dir="ltr">{formatCurrency(costPerCustomer, effectiveLanguage, currency)}</bdi>
                            </p>
                          </div>
                        </div>
                      </div>
                      
                      {/* Financial Donut Chart */}
                      <div style={{ position: 'relative', height: 280, display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
                        <InfoTip title={t('results_costDistribution', effectiveLanguage)}>{t('results_costDistribution', effectiveLanguage)}</InfoTip>
                        <h4 style={{ fontSize: 14, fontWeight: 700, color: '#475569', marginBottom: 12, alignSelf: 'flex-start' }}>{t('results_costDistribution', effectiveLanguage)}</h4>
                        <div style={{ flex: 1, width: '100%', minHeight: 0 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={[
                                  { name: isAnalystView ? t('results_activeCost', effectiveLanguage) : t('results_activeLabel', effectiveLanguage), value: fin.total_active_cost || 0, color: '#6b4de6' },
                                  { name: isAnalystView ? t('results_idleCost', effectiveLanguage) : t('results_idleCostHint', effectiveLanguage), value: fin.total_idle_cost || 0, color: '#06b6d4' }
                                ]}
                                cx="45%" cy="50%" innerRadius={55} outerRadius={75} paddingAngle={3} dataKey="value" stroke="none"
                              >
                                {[ '#6b4de6', '#06b6d4' ].map((color, index) => (
                                  <Cell key={`cell-${index}`} fill={color} />
                                ))}
                              </Pie>
                              <Tooltip 
                                formatter={(value) => formatCurrency(Number(value), effectiveLanguage, currency)}
                                contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontWeight: 600 }}
                              />
                              <Legend layout="vertical" verticalAlign="middle" align="right" iconType="circle" wrapperStyle={{ fontSize: 13, fontWeight: 600, color: '#475569' }}/>
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Resource Cost Breakdown Chart & Summary */}
                {results.financial_summary.resources && Object.keys(results.financial_summary.resources).length > 0 && (
                  (() => {
                    const filteredData = Object.values(results.financial_summary.resources)
                      .map(r => ({
                        name: r.name || r.id || 'Unnamed',
                        displayName: `${r.name || r.id} (${r.utilization_pct != null ? r.utilization_pct : 0}% ${isAnalystView ? (effectiveLanguage === 'ur' ? 'استعمال' : 'util') : (effectiveLanguage === 'ur' ? 'مصروف' : 'busy')})`,
                        Active: r.active_cost || 0,
                        Idle: r.idle_cost || 0,
                        Total: r.total_cost != null ? r.total_cost : ((r.active_cost || 0) + (r.idle_cost || 0)),
                        utilization_pct: r.utilization_pct ?? 0,
                        type: r.type || 'staff',
                        quantity: r.quantity || 1,
                        hourly_rate: r.hourly_rate || 0,
                        busy_hours: r.busy_hours || 0,
                        paid_hours: r.paid_hours || 0
                      }))
                      .filter(r => r.Active > 0 || r.Idle > 0 || r.Total > 0)
                      .sort((a,b) => (b.Active + b.Idle) - (a.Active + a.Idle));

                    if (filteredData.length === 0) return null;

                    return (
                      <div style={{ marginTop: 32, paddingTop: 28, borderTop: '1px dashed #cbd5e1' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 20 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 4, height: 16, background: '#64748b', borderRadius: 2 }} />
                            <h4 style={{ fontSize: 14, fontWeight: 700, color: '#334155', margin: 0 }}>{isAnalystView ? t('results_costBreakdownByResource', effectiveLanguage) : t('results_costBreakdownByStaff', effectiveLanguage)}</h4>
                          </div>
                          <span style={{ fontSize: 12, color: '#64748b' }}>{t('results_stackedCostDesc', effectiveLanguage, isAnalystView)}</span>
                        </div>
                        <div style={{ position: 'relative', height: Math.max(220, filteredData.length * 60), background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', padding: '24px 24px 16px 0', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
                          <InfoTip title={isAnalystView ? t('results_costBreakdownByResource', effectiveLanguage) : t('results_costBreakdownByStaff', effectiveLanguage)}>{t('results_stackedCostDesc', effectiveLanguage, isAnalystView)}</InfoTip>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={filteredData}
                              margin={{ top: 0, right: 30, left: 10, bottom: 0 }}
                              layout="vertical"
                            >
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                              <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 500 }} axisLine={false} tickLine={false} tickFormatter={v => formatCurrency(v, effectiveLanguage, currency)} />
                              <YAxis dataKey="displayName" type="category" tick={{ fontSize: 12, fill: '#475569', fontWeight: 600 }} axisLine={false} tickLine={false} width={180} />
                              <Tooltip 
                                formatter={(value, name) => [formatCurrency(Number(value), effectiveLanguage, currency), name]} 
                                cursor={{fill: '#f8fafc'}}
                                contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontWeight: 600 }}
                              />
                              <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 600 }} />
                              <Bar dataKey="Active" name={isAnalystView ? t('results_activeCost', effectiveLanguage) : t('results_activeLabel', effectiveLanguage)} stackId="a" fill="#6b4de6" barSize={20} radius={[0, 0, 0, 0]}>
                                <LabelList dataKey="Active" position="inside" formatter={v => v > 0 ? formatCurrency(Math.round(v), effectiveLanguage, currency) : ''} style={{ fill: '#fff', fontSize: 10, fontWeight: 700 }} />
                              </Bar>
                              <Bar dataKey="Idle" name={isAnalystView ? t('results_idleCost', effectiveLanguage) : t('results_idleCostHint', effectiveLanguage)} stackId="a" fill="#06b6d4" barSize={20} radius={[0, 4, 4, 0]}>
                                <LabelList dataKey="Idle" position="inside" formatter={v => v > 0 ? formatCurrency(Math.round(v), effectiveLanguage, currency) : ''} style={{ fill: '#fff', fontSize: 10, fontWeight: 700 }} />
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>

                        {/* Resource Summary Table */}
                        <div style={{ marginTop: 20, overflowX: 'auto', background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '16px' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, textAlign: 'left' }}>
                            <thead>
                              <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b' }}>
                                <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('results_colResource', effectiveLanguage)}</th>
                                <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('results_colType', effectiveLanguage)}</th>
                                <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('results_colQty', effectiveLanguage)}</th>
                                <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('results_colRate', effectiveLanguage)}</th>
                                <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('results_colBusyHours', effectiveLanguage)}</th>
                                <th style={{ padding: '8px 10px', fontWeight: 600 }}>{isAnalystView ? t('results_activeCost', effectiveLanguage) : <Hint term="active_cost">{t('results_activeLabel', effectiveLanguage)}</Hint>}</th>
                                <th style={{ padding: '8px 10px', fontWeight: 600 }}>{isAnalystView ? t('results_idleCost', effectiveLanguage) : <Hint term="idle_cost">{t('results_idleCostHint', effectiveLanguage)}</Hint>}</th>
                                <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('results_colTotalCost', effectiveLanguage)}</th>
                                <th style={{ padding: '8px 10px', fontWeight: 600 }}>{isAnalystView ? t('results_colUtilization', effectiveLanguage) : <Hint term="utilization">{t('results_howBusyStaffAre', effectiveLanguage)}</Hint>}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredData.map((r, idx) => (
                                <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                  <td style={{ padding: '9px 10px', fontWeight: 600, color: '#1e293b' }}><bdi dir="auto">{r.name}</bdi></td>
                                  <td style={{ padding: '9px 10px', textTransform: 'capitalize', color: '#64748b' }}>{r.type}</td>
                                  <td style={{ padding: '9px 10px', color: '#334155' }}><bdi dir="ltr">{r.quantity}</bdi></td>
                                  <td style={{ padding: '9px 10px', color: '#334155' }}><bdi dir="ltr">{formatCurrency(r.hourly_rate || 0, effectiveLanguage, currency)}/h</bdi></td>
                                  <td style={{ padding: '9px 10px', color: '#334155' }}><bdi dir="ltr">{r.busy_hours?.toFixed(2)}h</bdi></td>
                                  <td style={{ padding: '9px 10px', color: '#4338ca', fontWeight: 600 }}><bdi dir="ltr">{formatCurrency(r.Active || 0, effectiveLanguage, currency)}</bdi></td>
                                  <td style={{ padding: '9px 10px', color: '#0e7490', fontWeight: 600 }}><bdi dir="ltr">{formatCurrency(r.Idle || 0, effectiveLanguage, currency)}</bdi></td>
                                  <td style={{ padding: '9px 10px', color: '#0f172a', fontWeight: 700 }}><bdi dir="ltr">{formatCurrency(r.Total || 0, effectiveLanguage, currency)}</bdi></td>
                                  <td style={{ padding: '9px 10px', fontWeight: 700, color: r.utilization_pct > 80 ? '#dc2626' : (r.utilization_pct > 0 ? '#16a34a' : '#94a3b8') }}>
                                    <bdi dir="ltr">{r.utilization_pct != null ? `${r.utilization_pct}%` : '0.0%'}</bdi>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()
                )}
              </div>
            )}
          </>
        )}

        {tab === 'whatif' && (
          <>
        {/* Comparison Section (What-If vs Baseline) */}
        {hasWhatIf && comparisonMetrics && (
          <div style={{ position: 'relative',
            background: 'linear-gradient(to right, #faf5ff, #f0fdf4)',
            border: '1.5px solid #ddd6fe',
            borderRadius: 16,
            padding: '24px',
            boxShadow: '0 4px 20px rgba(107, 77, 230, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            ...fade(0)
          }}>
<InfoTip title={isAnalystView ? t('results_tabWhatIfComparison', effectiveLanguage) : t('results_tabIdeaComparison', effectiveLanguage)} whole={false}>
  {isAnalystView
    ? t('results_comparingBaselineVsWhatIf', effectiveLanguage, '')
    : t('results_comparingCurrentVsIdea', effectiveLanguage, '')}
</InfoTip>
            {/* Title */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#6b4de6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <GitCompare size={18} color="#fff" />
                </div>
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 800, color: '#1e1b4b', margin: 0 }}>
                    {isAnalystView ? t('results_baselineVsWhatIf', effectiveLanguage) : t('results_currentSetupVsIdea', effectiveLanguage)}
                  </h2>
                  <p style={{ fontSize: 12, color: '#6b7280', margin: '2px 0 0' }}>
                    {isAnalystView ? t('results_comparingBaselineVsWhatIf', effectiveLanguage, whatifName) : t('results_comparingCurrentVsIdea', effectiveLanguage, whatifName)}
                  </p>
                </div>
              </div>
              <div style={{ background: '#e0e7ff', color: '#4338ca', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999 }}>
                {isAnalystView ? t('results_whatIfActive', effectiveLanguage) : t('results_ideaActive', effectiveLanguage)}
              </div>
            </div>

            {comparisonMetrics.modeMismatch ? (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '20px 24px', display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <AlertTriangle size={22} color="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#92400e', margin: '0 0 6px' }}>
                    {t('results_diffModesTitle', effectiveLanguage, isAnalystView)}
                  </p>
                  <p style={{ fontSize: 13, color: '#78350f', lineHeight: 1.6, margin: 0 }}>
                    {t('results_diffModesDesc', effectiveLanguage)}
                  </p>
                  <button onClick={() => navigate('/simulate')} style={{ marginTop: 14, padding: '8px 16px', background: '#d97706', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{t('results_goToSimulate', effectiveLanguage)}</button>
                </div>
              </div>
            ) : (
              <>
            {/* Visual Metrics Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
              
              {/* Metric 1: Cycle Time */}
              <div style={{ position: 'relative', background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 18 }}>
<InfoTip title={isAnalystView ? t('results_avgCycleTime', effectiveLanguage) : t('results_avgCompletionTime', effectiveLanguage)} corner="br">{t('results_avgCycleTimeTip', effectiveLanguage)}</InfoTip>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>
                    {isAnalystView ? t('results_avgCycleTime', effectiveLanguage) : <Hint term="cycle_time">{t('results_avgCompletionTime', effectiveLanguage)}</Hint>}
                  </span>
                  {comparisonMetrics.cycleMeaningful ? (
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                      background: comparisonMetrics.cycleTimeDelta < 0 ? '#dcfce7' : '#fee2e2',
                      color: comparisonMetrics.cycleTimeDelta < 0 ? '#15803d' : '#b91c1c',
                      display: 'inline-flex', alignItems: 'center', gap: 4
                    }}>
                      {comparisonMetrics.cycleTimeDelta < 0 ? <TrendingDown size={14} /> : <TrendingUp size={14} />}
                      <bdi dir="ltr">{comparisonMetrics.cycleTimeDelta < 0 ? '' : '+'}{comparisonMetrics.cycleTimeDelta.toFixed(1)}%</bdi>
                    </span>
                  ) : (
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                      background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0',
                      display: 'inline-flex', alignItems: 'center', gap: 4
                    }}>
                      {t('results_noMeaningfulChange', effectiveLanguage)}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: '#64748b' }}>{isAnalystView ? t('results_baseline', effectiveLanguage) : t('results_currentSetup', effectiveLanguage)}</span>
                      <span style={{ fontWeight: 700, color: '#0f172a' }}><bdi dir="ltr">{comparisonMetrics.baseCycleFormatted || fmt(comparisonMetrics.baseAvg, effectiveLanguage)}</bdi></span>
                    </div>
                    <div style={{ height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: '100%', background: '#94a3b8', borderRadius: 4 }} />
                    </div>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: '#6b4de6', fontWeight: 600 }}>{isAnalystView ? t('results_whatIfScenario', effectiveLanguage) : t('results_ideaToTry', effectiveLanguage)}</span>
                      <span style={{ fontWeight: 700, color: '#6b4de6' }}><bdi dir="ltr">{comparisonMetrics.wiCycleFormatted || fmt(comparisonMetrics.wiAvg, effectiveLanguage)}</bdi></span>
                    </div>
                    <div style={{ height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(100, (comparisonMetrics.wiAvg / (comparisonMetrics.baseAvg || 1)) * 100)}%`,
                        background: !comparisonMetrics.cycleMeaningful ? '#94a3b8' : (comparisonMetrics.cycleTimeDelta < 0 ? '#10b981' : '#ef4444'),
                        borderRadius: 4
                      }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Metric 2: Throughput */}
              {simMode !== 'quick' && (
                <div style={{ position: 'relative', background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 18 }}>
<InfoTip title={isAnalystView ? t('results_productionSpeed', effectiveLanguage) : t('results_customersServedPerHour', effectiveLanguage)} corner="br">{t('results_customersPerHourTip', effectiveLanguage)}</InfoTip>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>
                      {isAnalystView ? t('results_productionSpeed', effectiveLanguage) : <Hint term="throughput">{t('results_customersServedPerHour', effectiveLanguage)}</Hint>}
                    </span>
                    {comparisonMetrics.throughputMeaningful ? (
                      <span style={{
                        fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                        background: comparisonMetrics.throughputDelta > 0 ? '#dcfce7' : '#fee2e2',
                        color: comparisonMetrics.throughputDelta > 0 ? '#15803d' : '#b91c1c',
                        display: 'inline-flex', alignItems: 'center', gap: 4
                      }}>
                        {comparisonMetrics.throughputDelta > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                        <bdi dir="ltr">{comparisonMetrics.throughputDelta > 0 ? '+' : ''}{comparisonMetrics.throughputDelta.toFixed(1)}%</bdi>
                      </span>
                    ) : (
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                        background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0',
                        display: 'inline-flex', alignItems: 'center', gap: 4
                      }}>
                        {t('results_noMeaningfulChange', effectiveLanguage)}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: '#64748b' }}>{isAnalystView ? t('results_baseline', effectiveLanguage) : t('results_currentSetup', effectiveLanguage)}</span>
                        <span style={{ fontWeight: 700, color: '#0f172a' }}><bdi dir="ltr">{formatRate(comparisonMetrics.baseThroughput, 'hr', effectiveLanguage)}</bdi></span>
                      </div>
                      <div style={{ height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${Math.min(100, (comparisonMetrics.baseThroughput / (Math.max(comparisonMetrics.baseThroughput, comparisonMetrics.wiThroughput) || 1)) * 100)}%`,
                          background: '#94a3b8',
                          borderRadius: 4
                        }} />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: '#6b4de6', fontWeight: 600 }}>{isAnalystView ? t('results_whatIfScenario', effectiveLanguage) : t('results_ideaToTry', effectiveLanguage)}</span>
                        <span style={{ fontWeight: 700, color: '#6b4de6' }}><bdi dir="ltr">{formatRate(comparisonMetrics.wiThroughput, 'hr', effectiveLanguage)}</bdi></span>
                      </div>
                      <div style={{ height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${Math.min(100, (comparisonMetrics.wiThroughput / (Math.max(comparisonMetrics.baseThroughput, comparisonMetrics.wiThroughput) || 1)) * 100)}%`,
                          background: !comparisonMetrics.throughputMeaningful ? '#94a3b8' : (comparisonMetrics.throughputDelta > 0 ? '#10b981' : '#ef4444'),
                          borderRadius: 4
                        }} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Metric 3: Primary Bottleneck */}
              <div style={{ position: 'relative', background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 18, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
<InfoTip title={isAnalystView ? t('results_bottleneckShift', effectiveLanguage) : t('results_waitPointShift', effectiveLanguage)} corner="br">{t('results_constraintAnalysisTip', effectiveLanguage)}</InfoTip>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 8, display: 'block' }}>{simMode === 'quick' ? t('results_slowestStepShift', effectiveLanguage) : (isAnalystView ? t('results_bottleneckShift', effectiveLanguage) : t('results_waitPointShift', effectiveLanguage))}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>{isAnalystView ? `${t('results_baseline', effectiveLanguage)}:` : `${t('results_currentSetup', effectiveLanguage)}:`}</span>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      "<bdi dir="auto">{typeof comparisonMetrics.baseBnLabel === 'string' ? comparisonMetrics.baseBnLabel : (comparisonMetrics.baseBnLabel?.name ?? comparisonMetrics.baseBnLabel?.label ?? 'None')}</bdi>"
                    </div>
                  </div>
                  <div style={{ fontSize: 16, color: '#6b4de6', fontWeight: 700 }}>➔</div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 11, color: '#6b4de6', display: 'block' }}>{isAnalystView ? `${t('results_whatIfScenario', effectiveLanguage)}:` : `${t('results_ideaToTry', effectiveLanguage)}:`}</span>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#6b4de6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      "<bdi dir="auto">{typeof comparisonMetrics.wiBnLabel === 'string' ? comparisonMetrics.wiBnLabel : (comparisonMetrics.wiBnLabel?.name ?? comparisonMetrics.wiBnLabel?.label ?? 'None')}</bdi>"
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* Comparison Charts */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
              <div style={{ position: 'relative', background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '18px' }}>
<InfoTip title={t('results_timeComparisonTitle', effectiveLanguage, isAnalystView)}>{t('results_timeComparisonTitle', effectiveLanguage, isAnalystView)}</InfoTip>
                <h4 style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>{t('results_timeComparisonTitle', effectiveLanguage, isAnalystView)}</h4>
                <div style={{ height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[
                      { name: isAnalystView ? t('results_baseline', effectiveLanguage) : t('results_currentSetup', effectiveLanguage), value: comparisonMetrics.baseAvg },
                      { name: whatifName.length > 14 ? (isAnalystView ? t('results_whatIfScenario', effectiveLanguage) : t('results_ideaToTry', effectiveLanguage)) : whatifName, value: comparisonMetrics.wiAvg },
                    ]} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => fmt(v, effectiveLanguage)} />
                      <Tooltip formatter={(v) => fmt(v, effectiveLanguage)} />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={56}>
                        <Cell fill="#94a3b8" />
                        <Cell fill={!comparisonMetrics.cycleMeaningful ? '#94a3b8' : (comparisonMetrics.cycleTimeDelta < 0 ? '#10b981' : '#ef4444')} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div style={{ position: 'relative', background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '18px' }}>
<InfoTip title={t('results_throughputComparisonTitle', effectiveLanguage, isAnalystView)}>{t('results_throughputComparisonTitle', effectiveLanguage, isAnalystView)}</InfoTip>
                <h4 style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>{t('results_throughputComparisonTitle', effectiveLanguage, isAnalystView)}</h4>
                <div style={{ height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[
                      { name: isAnalystView ? t('results_baseline', effectiveLanguage) : t('results_currentSetup', effectiveLanguage), value: comparisonMetrics.baseThroughput },
                      { name: whatifName.length > 14 ? (isAnalystView ? t('results_whatIfScenario', effectiveLanguage) : t('results_ideaToTry', effectiveLanguage)) : whatifName, value: comparisonMetrics.wiThroughput },
                    ]} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatRate(v, 'hr', effectiveLanguage)} />
                      <Tooltip formatter={(v) => formatRate(v, 'hr', effectiveLanguage)} />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={56}>
                        <Cell fill="#94a3b8" />
                        <Cell fill={!comparisonMetrics.throughputMeaningful ? '#94a3b8' : (comparisonMetrics.throughputDelta > 0 ? '#10b981' : '#ef4444')} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Descriptive callout */}
            <div style={{
              background: '#fff',
              borderLeft: '4px solid #6b4de6',
              borderRadius: '0 8px 8px 0',
              padding: '14px 18px',
              fontSize: 14,
              color: '#334155',
              lineHeight: 1.5,
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
            }}>
              <RichText text={formatPlainLanguage(comparisonMetrics.descText, { isAnalystView })} />
            </div>
              </>
            )}

          </div>
        )}
         </>
        )}
        {tab === 'takeaways' && <KeyTakeaways lines={summaryLines} isAnalystView={isAnalystView} lang={effectiveLanguage} />}
      </main>
    </div>
  );
}
