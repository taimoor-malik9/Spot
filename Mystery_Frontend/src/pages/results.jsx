'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, RefreshCw, Target, CheckCircle, AlertTriangle, 
  LayoutDashboard, Clock, Zap, ShieldAlert,
  GitCompare, TrendingUp, TrendingDown, History, ChevronDown, Layers
} from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend
} from 'recharts';
import { getScenarios } from '../lib/apiService';
import AIInsightsPanel from './AIInsightsPanel';
import AIChatWidget from './AIChatWidget';
import { computeComparisonMetrics } from '../lib/whatIfComparison';

/* ═══════════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════════ */

function fmt(mins) {
  if (mins == null || isNaN(mins)) return '—';
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
        map[n.id] = n.label || n.data?.label || n.id;
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

  return { id: topId, label: idToLabel[topId] || topId, data };
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
function buildPlainSummary(results) {
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

  let tight = null;
  Object.entries(results?.resource_utilization || {}).forEach(([name, u]) => {
    const busy = u?.avg_busy_time_per_item || 0;
    if (busy <= 0) return;
    const cap = u.capacity || 1;
    const perHr = (cap * 60) / busy;
    if (!tight || perHr < tight.perHr) tight = { name, cap, perHr, util: u.utilization_pct || 0 };
  });
  const arrivalPerHr = results?.arrival_rate > 0 ? results.arrival_rate * 60 : null;
  let status = null; // 'overloaded' | 'tight' | 'ok'
  if (tight) {
    if ((arrivalPerHr != null && arrivalPerHr > tight.perHr) || tight.util >= 95) status = 'overloaded';
    else if ((arrivalPerHr != null && arrivalPerHr > tight.perHr * 0.85) || tight.util >= 85) status = 'tight';
    else status = 'ok';
  }

  return {
    runs, total, work, wait, min: tis.min ?? 0, max: tis.max ?? 0, p95: tis.p95 ?? null,
    perHour, perDay, dayHours, dayHoursFromSettings: Boolean(hoursPerDay),
    tight, arrivalPerHr, status, overloaded: status === 'overloaded',
    steps: steps.slice(0, 6),
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

function verdict(results, idToLabel, simMode) {
  const tis = results?.time_in_system || {};
  const avg = tis.avg ?? 0;
  const min = tis.min ?? 0;
  const max = tis.max ?? 0;
  const spread = max - min;
  const throughput = extractThroughput(results);
  const { label: bnLabel } = getPrimaryBottleneck(results, idToLabel);
  const util = results?.resource_utilization || {};
  const criticalResource = Object.entries(util).find(([, v]) => (v.utilization_pct || 0) > 85);

  const lines = [];
  if (simMode === 'quick') {
    lines.push({ type: 'info', text: `Theoretical best-case duration is **${fmt(avg)}** per unit.` });
    lines.push({ type: 'success', text: `Optimal path baseline established. Run Deep Analysis for accurate constraints and throughput.` });
  } else {
    const ov = buildPlainSummary(results);
    if (ov.overloaded && ov.tight) {
      lines.push({ type: 'warn', text: `Customers arrive faster than **${ov.tight.name}** can serve them, so a line keeps building up. That is why the average completion time (**${fmt(avg)}**) looks so large: one customer's real work takes only about **${fmt(ov.work)}**, and only about **${throughput.toFixed(2)} units/hr** get through.` });
    } else {
      lines.push({ type: 'info', text: `Average completion time is **${fmt(avg)}**, delivering **${throughput.toFixed(2)} units/hr**.` });
      if (spread / avg < 0.15) lines.push({ type: 'success', text: `Process is **Highly Reliable** under load. Variance is minimal.` });
      else lines.push({ type: 'warn', text: `**High Risk Detected:** Completion times fluctuate drastically between ${fmt(min)} and ${fmt(max)}.` });
    }
  }
  
  if (bnLabel) {
    if (simMode === 'quick') {
      lines.push({ type: 'alert', text: `**"${bnLabel}"** is the slowest step in your process.` });
    } else {
      lines.push({ type: 'alert', text: `**"${bnLabel}"** is your primary bottleneck constraint.` });
    }
  }
  if (criticalResource && simMode !== 'quick') lines.push({ type: 'alert', text: `**${criticalResource[0]}** is overloaded (${criticalResource[1].utilization_pct}% capacity).` });

  if (simMode !== 'quick') {
    const fin = results?.financial_summary;
    if (fin && fin.total_cost > 0) {
      const totalFmt = fin.total_cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      lines.push({ type: 'info', text: `Total operational cost for this simulation run was **Rs ${totalFmt}**.` });
      
      if (fin.total_idle_cost > 0) {
        const wastePct = (fin.total_idle_cost / fin.total_cost) * 100;
        const idleFmt = fin.total_idle_cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (wastePct >= 20) {
          lines.push({ type: 'warn', text: `**High Financial Waste:** **Rs ${idleFmt}** (${wastePct.toFixed(1)}% of total cost) was lost to idle resource wait times.` });
        } else {
          lines.push({ type: 'info', text: `**Rs ${idleFmt}** (${wastePct.toFixed(1)}% of total cost) was spent on idle resources.` });
        }
      }
    }
  }

  return lines;
}

function PlainSummaryCard({ plain, simMode, idToLabel = {} }) {
  if (!plain) return null;
  const { total, work, wait, min, max, perHour, perDay, dayHours, tight, arrivalPerHr, status, runs, steps } = plain;
  const isQuick = simMode === 'quick';
  const workPct = total > 0 ? Math.round((work / total) * 100) : 100;
  const waitPct = 100 - workPct;
  const maxStep = Math.max(...steps.map(s => s.work + s.wait), 0.0001);
  const overloaded = !isQuick && status === 'overloaded';
  const chip = isQuick || !status ? null
    : status === 'overloaded' ? { t: "Can't keep up", c: '#b91c1c', bg: '#fee2e2' }
    : status === 'tight' ? { t: 'Close to the limit', c: '#92400e', bg: '#fef3c7' }
    : { t: 'Running smoothly', c: '#15803d', bg: '#dcfce7' };

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

  const who = tight ? <strong>{tight.name}</strong> : null;
  const callout = (() => {
    if (isQuick || !tight || !status) return null;
    if (status === 'overloaded') {
      return { color: '#ef4444', text: <>Customers are arriving faster than {who} can serve them.{arrivalPerHr != null ? <> About <strong>{arrivalPerHr.toFixed(1)}</strong> arrive per hour, but {who} can handle about <strong>{tight.perHr.toFixed(1)}</strong>.</> : <> {who} is busy <strong>{tight.util.toFixed(0)}%</strong> of the time and can handle about <strong>{tight.perHr.toFixed(1)}</strong> per hour.</>} The line keeps growing, which is why the waiting time and cycle time look so big. Adding more {who}{arrivalPerHr != null ? <> or slowing arrivals to about <strong>{(tight.perHr * 0.8).toFixed(1)}</strong> per hour</> : null} should fix it.</> };
    }
    if (status === 'tight') {
      return { color: '#f59e0b', text: <>{who} is almost at its limit ({tight.util.toFixed(0)}% busy, about <strong>{tight.perHr.toFixed(1)}</strong> customers per hour at most). A small rise in customers will start a queue.</> };
    }
    return { color: '#10b981', text: <>Capacity looks fine. {who} can handle about <strong>{tight.perHr.toFixed(1)}</strong> customers per hour{arrivalPerHr != null ? <> and <strong>{arrivalPerHr.toFixed(1)}</strong> arrive</> : null}.</> };
  })();

  const top = tight ? (Math.max(arrivalPerHr ?? 0, tight.perHr) * 1.05 || 1) : 1;
  const bar = (name, val, color) => (
    <div key={name}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
        <span style={{ color: '#475569' }}>{name}</span>
        <span style={{ fontWeight: 700, color: '#0f172a' }}>{val.toFixed(1)} / hr</span>
      </div>
      <div style={{ height: 10, background: '#f1f5f9', borderRadius: 5, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(100, (val / top) * 100)}%`, background: color, borderRadius: 5 }} />
      </div>
    </div>
  );

  return (
    <div style={{ position: 'relative', background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', padding: '28px' }}>
<InfoTip title="Performance overview" whole={false}>A plain-language summary of the simulation: how long one customer needs, how many you can serve per hour and per day, and where the time is lost. Hover any box inside for its own explanation.</InfoTip>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: '#f5f3ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <LayoutDashboard size={20} color="#6b4de6" />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 17, fontWeight: 800, color: '#0f172a', margin: 0 }}>Performance Overview</h3>
            {chip && <span style={{ fontSize: 11, fontWeight: 700, color: chip.c, background: chip.bg, borderRadius: 999, padding: '3px 10px' }}>{chip.t}</span>}
          </div>
          <p style={{ fontSize: 13, color: '#64748b', margin: '3px 0 0', lineHeight: 1.5, paddingRight: 28 }}>
            A customer needs about <strong style={{ color: '#334155' }}>{fmt(work)}</strong> of actual work.
            {overloaded && tight
              ? <> But customers arrive faster than <strong style={{ color: '#334155' }}>{tight.name}</strong> can serve them, so a line keeps building up.</>
              : !isQuick && wait > 0 ? <> On average they also wait about <strong style={{ color: '#334155' }}>{fmt(wait)}</strong> in line.</> : null}
            {isQuick ? ' This is the best case, with no waiting.' : ` Worked out from ${runs} simulated customers.`}
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        <Stat icon={<Clock size={22} color="#6b4de6" />} bg="#f5f3ff" title="Time per customer" badge={overloaded ? { t: 'Real time', c: '#15803d', bg: '#dcfce7' } : null} tip="How long one customer's own tasks take when added together, with no waiting counted. This is the best time your process can ever reach." val={fmt(work)}
          text={isQuick ? 'of work, no waiting in this mode' : 'of work, not counting the wait'} />
        {!isQuick && (
          <>
            <Stat icon={<Zap size={22} color="#10b981" />} bg="#ecfdf5" title="Customers per hour" tip="How many customers get all the way through your process every hour, measured in this simulation." val={perHour.toFixed(1)} text="finished every hour" />
            <Stat icon={<Layers size={22} color="#0ea5e9" />} bg="#f0f9ff" title="Customers per day" tip="Customers per hour multiplied by the working hours in a day. The hours come from your resource settings, or 8 hours if none are set." val={Math.round(perDay).toLocaleString()} text={`in a ${dayHours}-hour day`} />
          </>
        )}
        <Stat icon={<Target size={22} color="#f59e0b" />} bg="#fffbeb" title="Average cycle time" muted={overloaded} badge={overloaded ? { t: 'Inflated by the line', c: '#b91c1c', bg: '#fee2e2' } : null} tip="The average time from start to finish, waiting in line included. Customers keep arriving without a break, so if staff cannot keep up the line grows and this number climbs. A big gap from Time per customer means customers mostly wait." val={fmt(total)}
          text={isQuick ? 'start to finish' : overloaded ? 'pushed up by the growing line, not one real customer\'s time' : `fastest ${fmt(min)}, slowest ${fmt(max)}`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 36, ...section }}>
        <div>
          <Heading title="How a customer's time is spent" hint="Purple is real work, teal is time spent waiting in line." />
          <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: '#f1f5f9' }}>
            <div style={{ flex: Math.max(workPct, 1), background: '#6b4de6' }} />
            {waitPct > 0 && <div style={{ flex: waitPct, background: '#06b6d4' }} />}
          </div>
          <p style={{ fontSize: 13, color: '#475569', margin: '12px 0 0' }}>
            <span style={dot('#6b4de6')} />{fmt(work)} working ({workPct}%)
            <span style={{ margin: '0 10px', color: '#cbd5e1' }}>|</span>
            <span style={dot('#06b6d4')} />{fmt(wait)} in line ({waitPct}%)
          </p>
        </div>

        {!isQuick && tight && (
          <div>
            <Heading title={`Arrivals vs. what ${tight.name} can handle`} hint="If customers arrive faster than this, a queue builds up." />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {arrivalPerHr != null && bar('Customers arriving', arrivalPerHr, arrivalPerHr > tight.perHr ? '#ef4444' : '#6b4de6')}
              {bar(`${tight.name} can handle`, tight.perHr, '#10b981')}
            </div>
          </div>
        )}
      </div>

      {steps.length > 0 && (
        <div style={section}>
          <Heading title="Step by step" hint={`The longest steps come first.${isQuick ? '' : ' Teal shows how long customers wait before each step.'}`} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {steps.map(s => (
              <div key={s.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, marginBottom: 5 }}>
                  <span style={{ fontWeight: 600, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{idToLabel[s.id] || s.id}</span>
                  <span style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{fmt(s.work)} work{!isQuick && <> · {fmt(s.wait)} wait</>}</span>
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
          <div style={{ background: '#fafbff', borderLeft: `4px solid ${callout.color}`, borderRadius: '0 8px 8px 0', padding: '14px 18px', fontSize: 14, color: '#334155', lineHeight: 1.6 }}>
            {callout.text}
          </div>
        </div>
      )}

      {!isQuick && (
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '16px 0 0', lineHeight: 1.5 }}>
          Cycle time is an average over all {runs} customers, so a growing queue pushes it up. "Time per customer" shows the work itself.
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

function ResourceUtilizationSection({ results }) {
  const entries = Object.entries(results?.resource_utilization || {});
  if (entries.length === 0) return null;
  const R = 22, CIRC = 2 * Math.PI * R;
  return (
    <div style={{ position: 'relative', background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
<InfoTip title="Resource utilization">How much of the time each resource was busy. Above 85% (Overloaded) it cannot keep up and queues form. Below 30% (Underused) it is mostly idle. In between is healthy.</InfoTip>
      <SectionHeader icon={<Zap size={20} color="#10b981" />} bg="#ecfdf5" title="Resource Utilization" subtitle="How busy each resource was during the simulation" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {entries.map(([name, u]) => {
          const pct = Math.max(0, Math.min(100, u?.utilization_pct || 0));
          const st = pct >= 85
            ? { label: 'Overloaded', color: '#ef4444', text: '#b91c1c', bg: '#fee2e2' }
            : pct < 30
              ? { label: 'Underused', color: '#06b6d4', text: '#0e7490', bg: '#cffafe' }
              : { label: 'Healthy', color: '#10b981', text: '#15803d', bg: '#dcfce7' };
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
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: '0 0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
                  <span style={{ fontSize: 11, fontWeight: 700, color: st.text, background: st.bg, borderRadius: 6, padding: '3px 8px' }}>{st.label}</span>
                </div>
              </div>
              <p style={{ fontSize: 12, color: '#94a3b8', margin: '12px 0 0' }}>
                {pct.toFixed(0)}% busy <span style={{ margin: '0 6px' }}>·</span> {(100 - pct).toFixed(0)}% idle
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KeyTakeaways({ lines }) {
  if (!lines || lines.length === 0) return null;
  const look = {
    info:    { bg: '#f5f3ff', border: '#e9e5ff', color: '#334155', icon: <InfoIcon color="#6b4de6" /> },
    success: { bg: '#f0fdf4', border: '#bbf7d0', color: '#166534', icon: <CheckCircle size={20} color="#10b981" style={{ flexShrink: 0 }} /> },
    warn:    { bg: '#fffbeb', border: '#fde68a', color: '#78350f', icon: <AlertTriangle size={20} color="#f59e0b" style={{ flexShrink: 0 }} /> },
    alert:   { bg: '#fef2f2', border: '#fecaca', color: '#7f1d1d', icon: <ShieldAlert size={20} color="#ef4444" style={{ flexShrink: 0 }} /> },
  };
  return (
    <div style={{ position: 'relative', background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
<InfoTip title="Key takeaways">The most important findings from this simulation, written in plain sentences. Red points need attention, yellow are warnings, blue are information.</InfoTip>
      <SectionHeader icon={<CheckCircle size={20} color="#6b4de6" />} bg="#f5f3ff" title="Key Takeaways" subtitle="The main points from this simulation" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {lines.map((l, i) => {
          const s = look[l.type] || look.info;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10, padding: '14px 18px' }}>
              {s.icon}
              <p style={{ margin: 0, fontSize: 14, color: s.color, lineHeight: 1.5 }}><RichText text={l.text} /></p>
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
  const [results, setResults] = useState(null);
  const [idToLabel, setIdToLabel] = useState({});
  const [idToResource, setIdToResource] = useState({});
  const [ready, setReady] = useState(false);
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
    return computeComparisonMetrics(baselineResults, whatifResults, idToLabel);
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
  const summaryLines = useMemo(() => results ? verdict(results, idToLabel, simMode) : [], [results, idToLabel, simMode]);
  const plain = useMemo(() => results ? buildPlainSummary(results) : null, [results]);
  const fade = (i) => ({ opacity: ready ? 1 : 0, transform: ready ? 'translateY(0)' : 'translateY(15px)', transition: `all 0.5s ease ${i * 0.07}s` });

  if (!ready) return null; // Prevent flicker before useEffect resolves

  if (!results || !hasNodes) {
    return (
      <div style={{ height: '100%', overflowY: 'auto', background: '#f8fafc', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ background: '#fff', padding: 48, borderRadius: 24, boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', textAlign: 'center', maxWidth: 480, border: '1px solid #e2e8f0' }}>
          <div style={{ width: 80, height: 80, background: '#f5f3ff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
            <LayoutDashboard size={40} color="#6b4de6" />
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>No Results to Display</h2>
          <p style={{ fontSize: 15, color: '#64748b', lineHeight: 1.6, marginBottom: 32 }}>
            {!hasNodes 
              ? "You haven't built a process model yet. Create a model and run a simulation to see your analytics here."
              : "You need to run a simulation first to view the analytics dashboard."}
          </p>
          <SpotButton onClick={() => navigate(!hasNodes ? '/model' : '/simulate')} size="md">
            {!hasNodes ? "Build a Model" : "Run Simulation"}
          </SpotButton>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={15} /> },
    { id: 'bottlenecks', label: 'Bottlenecks & Queues', icon: <Target size={15} /> },
    ...(simMode !== 'quick' && Object.keys(results?.resource_utilization || {}).length > 0 ? [{ id: 'resources', label: 'Resources', icon: <Zap size={15} /> }] : []),
    ...(simMode !== 'quick' ? [{ id: 'financial', label: 'Financial', icon: <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1 }}>₨</span> }] : []),
    ...(hasWhatIf && comparisonMetrics ? [{ id: 'whatif', label: 'What-If Comparison', icon: <GitCompare size={15} /> }] : []),
    { id: 'takeaways', label: 'Key Takeaways', icon: <CheckCircle size={15} /> },
  ];
  const tab = tabs.some(t => t.id === activeTab) ? activeTab : 'overview';

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#f8fafc', fontFamily: "'Inter', sans-serif", paddingBottom: 40 }}>

      <AIChatWidget results={results} idToLabel={idToLabel} simMode={simMode} />

      {/* HEADER */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => navigate('/simulate')} style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><ArrowLeft size={18} color="#64748b" /></button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>Simulation Results</h1>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: simMode === 'deep' ? '#1e1b4b' : '#f5f3ff', color: simMode === 'deep' ? '#c7d2fe' : '#6b4de6', border: '1px solid #ddd6fe' }}>
                {simMode === 'deep' ? 'DEEP ANALYSIS' : 'QUICK ANALYSIS'}
              </span>
            </div>
            <p style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>Based on {runs} iterations</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
          {(scenarioList.length > 0 || hasWhatIf) && (
            <div style={{ position: 'relative' }}>
              <SpotButton onClick={() => setScenarioPickerOpen(o => !o)} variant="secondary" size="sm">
                <History size={14} /> {loadingScenarios ? 'Loading…' : 'Previous Scenarios'} <ChevronDown size={14} />
              </SpotButton>
              {scenarioPickerOpen && (
                <div onClick={() => setScenarioPickerOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 15 }} />
              )}
              {scenarioPickerOpen && (
                <div style={{
                  position: 'absolute', top: '110%', right: 0, background: '#fff', border: '1px solid #e2e8f0',
                  borderRadius: 10, boxShadow: '0 8px 24px rgba(15,23,42,0.12)', minWidth: 260, zIndex: 20,
                  padding: 6, maxHeight: 320, overflowY: 'auto'
                }}>
                  <div
                    onClick={() => selectScenario('baseline')}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                      background: activeScenarioKey === 'baseline' ? '#f5f3ff' : 'transparent'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = activeScenarioKey === 'baseline' ? '#f5f3ff' : 'transparent'}
                  >
                    <Layers size={14} color="#6b4de6" />
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1e1b4b' }}>Baseline (Original)</span>
                  </div>
                  {scenarioList.length === 0 ? (
                    <p style={{ fontSize: 12, color: '#94a3b8', padding: '10px 12px', margin: 0 }}>No what-if scenarios run yet.</p>
                  ) : scenarioList.map(s => (
                    <div
                      key={s.id}
                      onClick={() => selectScenario(s.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                        background: activeScenarioKey === s.id ? '#f5f3ff' : 'transparent'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={e => e.currentTarget.style.background = activeScenarioKey === s.id ? '#f5f3ff' : 'transparent'}
                    >
                      <GitCompare size={14} color="#6b4de6" />
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <SpotButton onClick={() => navigate('/simulate')} size="sm"><RefreshCw size={14} /> Re-run Simulation</SpotButton>
        </div>
      </header>

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
        <AIInsightsPanel results={results} idToLabel={idToLabel} simMode={simMode} idToResource={idToResource} processId={typeof window !== 'undefined' ? localStorage.getItem('spot:processId') : null} />

        <PlainSummaryCard plain={plain} simMode={simMode} idToLabel={idToLabel} />

        {/* ROW 1: Dynamic Top Level Stats based on Mode */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, ...fade(0) }}>
          
          <div style={{ position: 'relative', background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '24px', display: 'flex', alignItems: 'center', gap: 20 }}>
<InfoTip title="Average cycle time">The average time a customer takes from entering to leaving, waiting in line included. In this simulation customers keep arriving without a break, so if staff cannot keep up the line grows and this number climbs to hours or even days. Compare it with Time per customer to see how much of it is just waiting.</InfoTip>
            <div style={{ width: 56, height: 56, borderRadius: 12, background: '#f5f3ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Clock size={24} color="#6b4de6" /></div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>{simMode === 'quick' ? 'Best-Case / Theoretical Duration' : 'Avg. Cycle Time'}</p>
              <p style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>{fmt(totalAvg)}</p>
              {simMode !== 'quick' && plain?.overloaded && <p style={{ fontSize: 11, color: '#b45309', marginTop: 4 }}>Inflated by a growing queue (see summary above)</p>}
            </div>
          </div>

          {simMode !== 'quick' && (
            <div style={{ position: 'relative', background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '24px', display: 'flex', alignItems: 'center', gap: 20 }}>
<InfoTip title="Production speed">How many customers your process finishes every hour in this simulation. Higher is better. If it is much lower than the number of customers arriving, a queue will keep growing.</InfoTip>
              <div style={{ width: 56, height: 56, borderRadius: 12, background: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Zap size={24} color="#10b981" /></div>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Production Speed</p>
                <p style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>{(throughput * 60).toFixed(2)} /hr</p>
              </div>
            </div>
          )}

          {/* Conditional Metric: Predictability vs. Worst-Case Risk */}
          <div style={{ position: 'relative', background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '24px', display: 'flex', alignItems: 'center', gap: 20 }}>
<InfoTip title="Worst case / predictability">Deep mode: the longest time any single customer took. A big gap from the average means some customers have a much worse experience. Quick mode: shows whether every customer takes the same time (Consistent) or it varies.</InfoTip>
            <div style={{ width: 56, height: 56, borderRadius: 12, background: simMode === 'deep' ? '#fef2f2' : '#fffbeb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {simMode === 'deep' ? <ShieldAlert size={24} color="#ef4444" /> : <Target size={24} color="#f59e0b" />}
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>{simMode === 'deep' ? 'Worst-Case Scenario' : 'Predictability'}</p>
              <p style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>{simMode === 'deep' ? fmt(maxTime) : (spread === 0 ? 'Consistent' : 'Variable')}</p>
            </div>
          </div>

          {/* Critical Alert Card */}
          <div style={{ position: 'relative', background: bnLabel ? '#fef2f2' : '#fff', borderRadius: 12, border: `1px solid ${bnLabel ? '#fecaca' : '#e2e8f0'}`, padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
<InfoTip title="Critical bottleneck">The step where customers wait the longest before they can be served. Speeding it up or adding staff here improves the whole process more than fixing any other step.</InfoTip>
            {bnLabel ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 800, color: '#dc2626', textTransform: 'uppercase', marginBottom: 4 }}>{simMode === 'quick' ? 'Slowest Task' : 'Critical Bottleneck'}</p>
                  <p style={{ fontSize: 20, fontWeight: 700, color: '#991b1b' }}>"{bnLabel}"</p>
                </div>
                <button onClick={() => navigate('/model')} style={{ padding: '8px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Fix Now</button>
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: '#94a3b8' }}><CheckCircle size={24} style={{ marginBottom: 8 }} /> <p style={{ fontSize: 14 }}>No issues detected</p></div>
            )}
          </div>
        </div>


        {/* Context bar */}
        <div style={{ background: '#fff', padding: '16px 24px', borderRadius: 12, border: '1px solid #e2e8f0', ...fade(1) }}>
          <p style={{ fontSize: 15, color: '#475569', margin: 0 }}>
            {simMode === 'deep' && spread > 0 ? (
              <span>Times vary by <strong>{fmt(spread)}</strong>. {bnLabel ? `Stabilize "${bnLabel}" to reduce variance.` : ''}</span>
            ) : (
              <span>{bnLabel ? `Current throughput is limited by ${bnLabel}.` : 'Your process is operating efficiently.'}</span>
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
<InfoTip title="System efficiency">Out of all the time customers spend in your steps, how much is real work (purple) and how much is waiting (teal). A low Active % means customers mostly wait instead of being served.</InfoTip>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 24 }}>System Efficiency</h3>
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
                    <p style={{ fontSize: 32, fontWeight: 800, color: '#6b4de6', margin: 0 }}>{((totalProc / (totalProc + totalWait)) * 100).toFixed(0)}%</p>
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Active</p>
                  </div>
                </div>
              </div>
            )}

            {/* Roadblock Analysis Card */}
            <div style={{ position: 'relative', background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px', display: 'flex', flexDirection: 'column' }}>
<InfoTip title="Constraint analysis">The one step that holds the whole process back. It shows how long the step takes to do and how long customers wait for it. Improve this step first.</InfoTip>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 24 }}>Constraint Analysis</h3>
              <div style={{ flex: 1, background: '#fafbff', border: '2px dashed #e2e8f0', borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
                {bnLabel ? (
                  <>
                    <div style={{ width: 64, height: 64, background: '#f5f3ff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                      <AlertTriangle size={32} color="#6b4de6" />
                    </div>
                    <h4 style={{ fontSize: 24, fontWeight: 700, color: '#1e1b4b', marginBottom: 8 }}>{bnLabel}</h4>
                    <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, marginBottom: 24 }}>
                      This step takes <strong>{fmt(bnData?.processing_time_avg)}</strong> to process and causes <strong>{fmt(bnData?.wait_time_avg)}</strong> of waiting time per unit, making it your most resource-intensive constraint.
                    </p>
                    <SpotButton onClick={() => navigate('/model')} variant="secondary" size="sm">Edit Properties</SpotButton>
                  </>
                ) : <p style={{ color: '#94a3b8' }}>No major roadblocks identified.</p>}
              </div>
            </div>

            {/* Queue Visualization Card */}
            {simMode !== 'quick' && (
              <div style={{ position: 'relative', background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
<InfoTip title="Queue backlog">The steps where customers wait in line the longest. The bar shows the average wait, and 'units' is the average number of customers standing in that line.</InfoTip>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 24 }}>Queue Backlog</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {queueRows.length > 0 ? queueRows.slice(0, 4).map((q, i) => (
                    <div key={i}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                        <span style={{ fontWeight: 600, color: '#334155' }}>{q.name}</span>
                        <span style={{ color: '#64748b' }}>
                          {fmt(q.avgWait)} wait <span style={{ color: '#cbd5e1', margin: '0 6px' }}>|</span> {q.avg.toFixed(1)} units
                        </span>
                      </div>
                      <div style={{ height: 12, background: '#f1f5f9', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min((q.avgWait / maxWait) * 100, 100)}%`, background: q.avgWait > 0 ? '#6b4de6' : '#e2e8f0', borderRadius: 6 }} />
                      </div>
                    </div>
                  )) : <p style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', marginTop: 40 }}>No queue build-up detected.</p>}
                </div>
              </div>
            )}
            </div>
        )}

        {tab === 'resources' && <ResourceUtilizationSection results={results} />}

        {tab === 'financial' && (
          <>
            {!(results?.financial_summary?.total_cost > 0) && (
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', borderLeft: '4px solid #06b6d4', padding: '18px 22px' }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: '0 0 6px' }}>No cost figures to show yet</p>
                <p style={{ fontSize: 14, color: '#475569', margin: 0, lineHeight: 1.6 }}>
                  Costs are worked out from the details you enter on each resource in <strong>Simulate</strong>: monthly salary for staff, purchase price and running cost for equipment, rent for facilities.
                  Fill those in and run a Deep Analysis again to see the total cost, idle waste and cost per resource.
                </p>
              </div>
            )}
            {/* Financial Analysis Section */}
            {results?.financial_summary && simMode !== 'quick' && (
              <div style={{ position: 'relative', background: 'linear-gradient(to bottom right, #ffffff, #faf5ff)', borderRadius: 16, border: '1px solid #e2e8f0', padding: '28px', boxShadow: '0 4px 20px rgba(107, 77, 230, 0.04)' }}>
<InfoTip title="Financial analysis" whole={false}>What this simulation cost to run. Active cost is paid while staff are working. Idle cost (waste) is paid while staff are waiting for work. Hover the charts below for more.</InfoTip>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#6b4de6', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(107, 77, 230, 0.2)' }}>
                    <span style={{ color: '#fff', fontSize: 18, fontWeight: 700 }}>₨</span>
                  </div>
                  <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>Financial Analysis</h3>
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 32 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ padding: '20px', background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.02)', position: 'relative', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', top: 0, left: 0, width: 4, height: '100%', background: '#0f172a' }} />
                      <p style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Total Operational Cost</p>
                      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                        <p style={{ fontSize: 32, fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: -0.5 }}>
                          Rs {results.financial_summary.total_cost?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
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
                            title="At least one staff salary was estimated rather than explicitly stated"
                          >
                            <AlertTriangle size={12} color="#d97706" /> Based on estimated values
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div style={{ padding: '16px', background: 'linear-gradient(to bottom, #ffffff, #f5f3ff)', borderRadius: 12, border: '1px solid #ddd6fe', boxShadow: '0 2px 4px rgba(107, 77, 230, 0.05)' }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: '#6b4de6', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Active Cost</p>
                        <p style={{ fontSize: 18, fontWeight: 800, color: '#4338ca', margin: 0 }}>
                          Rs {results.financial_summary.total_active_cost?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                        </p>
                      </div>
                      <div style={{ padding: '16px', background: 'linear-gradient(to bottom, #ffffff, #ecfeff)', borderRadius: 12, border: '1px solid #a5f3fc', boxShadow: '0 2px 4px rgba(6, 182, 212, 0.06)' }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Idle Cost (Waste)</p>
                        <p style={{ fontSize: 18, fontWeight: 800, color: '#0e7490', margin: 0 }}>
                          Rs {results.financial_summary.total_idle_cost?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Financial Donut Chart */}
                  <div style={{ position: 'relative', height: 280, display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
<InfoTip title="Cost distribution">Splits the total cost into money spent while staff were working (purple) and money spent while they were idle (teal). A big teal slice means you are paying for people who are waiting.</InfoTip>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: '#475569', marginBottom: 12, alignSelf: 'flex-start' }}>Cost Distribution</h4>
                    <div style={{ flex: 1, width: '100%', minHeight: 0 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={[
                              { name: 'Active Cost', value: results.financial_summary.total_active_cost || 0, color: '#6b4de6' },
                              { name: 'Idle Cost', value: results.financial_summary.total_idle_cost || 0, color: '#06b6d4' }
                            ]}
                            cx="45%" cy="50%" innerRadius={55} outerRadius={75} paddingAngle={3} dataKey="value" stroke="none"
                          >
                            {[ '#6b4de6', '#06b6d4' ].map((color, index) => (
                              <Cell key={`cell-${index}`} fill={color} />
                            ))}
                          </Pie>
                          <Tooltip 
                            formatter={(value) => `Rs ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                            contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontWeight: 600 }}
                          />
                          <Legend layout="vertical" verticalAlign="middle" align="right" iconType="circle" wrapperStyle={{ fontSize: 13, fontWeight: 600, color: '#475569' }}/>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                {/* Resource Cost Breakdown Chart */}
                {results.financial_summary.resources && Object.keys(results.financial_summary.resources).length > 0 && (
                  (() => {
                    const filteredData = Object.values(results.financial_summary.resources)
                      .map(r => ({
                        name: r.name || r.id || 'Unnamed',
                        Active: r.active_cost || 0,
                        Idle: r.idle_cost || 0
                      }))
                      .filter(r => r.Active > 0 || r.Idle > 0)
                      .sort((a,b) => (b.Active + b.Idle) - (a.Active + a.Idle));

                    if (filteredData.length === 0) return null;

                    return (
                      <div style={{ marginTop: 32, paddingTop: 28, borderTop: '1px dashed #cbd5e1' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                          <div style={{ width: 4, height: 16, background: '#64748b', borderRadius: 2 }} />
                          <h4 style={{ fontSize: 14, fontWeight: 700, color: '#334155', margin: 0 }}>Cost Breakdown by Resource</h4>
                        </div>
                        <div style={{ position: 'relative', height: Math.max(220, filteredData.length * 60), background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', padding: '24px 24px 16px 0', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
<InfoTip title="Cost breakdown by resource">The same cost, shown for each staff member or resource. Long teal bars point to resources that are paid for but often waiting with nothing to do.</InfoTip>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={filteredData}
                              margin={{ top: 0, right: 10, left: 10, bottom: 0 }}
                              layout="vertical"
                            >
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                              <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 500 }} axisLine={false} tickLine={false} tickFormatter={v => `Rs ${v}`} />
                              <YAxis dataKey="name" type="category" tick={{ fontSize: 12, fill: '#475569', fontWeight: 600 }} axisLine={false} tickLine={false} width={150} />
                              <Tooltip 
                                formatter={(value) => `Rs ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} 
                                cursor={{fill: '#f8fafc'}}
                                contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontWeight: 600 }}
                              />
                              <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 600 }} />
                              <Bar dataKey="Active" stackId="a" fill="#6b4de6" barSize={18} radius={[0, 0, 0, 0]} />
                              <Bar dataKey="Idle" stackId="a" fill="#06b6d4" barSize={18} radius={[0, 4, 4, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
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
<InfoTip title="Baseline vs What-If" whole={false}>Compares your original process (baseline) with the scenario you changed (what-if), so you can see whether your change helped.</InfoTip>
            {/* Title */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#6b4de6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <GitCompare size={18} color="#fff" />
                </div>
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 800, color: '#1e1b4b', margin: 0 }}>Baseline vs What-If Performance Comparison</h2>
                  <p style={{ fontSize: 12, color: '#6b7280', margin: '2px 0 0' }}>Comparing baseline process with scenario: <strong>"{whatifName}"</strong></p>
                </div>
              </div>
              <div style={{ background: '#e0e7ff', color: '#4338ca', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999 }}>
                What-If Active
              </div>
            </div>

            {comparisonMetrics.modeMismatch ? (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '20px 24px', display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <AlertTriangle size={22} color="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#92400e', margin: '0 0 6px' }}>Baseline and What-If used different simulation modes</p>
                  <p style={{ fontSize: 13, color: '#78350f', lineHeight: 1.6, margin: 0 }}>
                    {comparisonMetrics.baseRuns <= 1 && comparisonMetrics.wiRuns > 1
                      ? `Your baseline (${fmt(comparisonMetrics.baseAvg)}) was run in Quick Analysis — a single pass with no queuing or resource contention at all — while your what-if scenario (${fmt(comparisonMetrics.wiAvg)}) ran Deep Analysis with ${comparisonMetrics.wiRuns} iterations of real congestion. `
                      : `Your what-if scenario (${fmt(comparisonMetrics.wiAvg)}) was run in Quick Analysis — a single pass with no queuing or resource contention at all — while your baseline (${fmt(comparisonMetrics.baseAvg)}) ran Deep Analysis with ${comparisonMetrics.baseRuns} iterations of real congestion. `}
                    These aren't comparable — go to <strong>Simulate</strong> and re-run the baseline in Deep Analysis mode to get an accurate comparison.
                  </p>
                  <button onClick={() => navigate('/simulate')} style={{ marginTop: 14, padding: '8px 16px', background: '#d97706', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Go to Simulate</button>
                </div>
              </div>
            ) : (
              <>
            {/* Visual Metrics Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
              
              {/* Metric 1: Cycle Time */}
              <div style={{ position: 'relative', background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 18 }}>
<InfoTip title="Average cycle time" corner="br">Average time one customer takes from start to finish. The percentage shows how much it changed with your scenario. Lower is better.</InfoTip>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>Avg. Cycle Time</span>
                  {comparisonMetrics.cycleMeaningful ? (
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                      background: comparisonMetrics.cycleTimeDelta < 0 ? '#dcfce7' : '#fee2e2',
                      color: comparisonMetrics.cycleTimeDelta < 0 ? '#15803d' : '#b91c1c',
                      display: 'inline-flex', alignItems: 'center', gap: 4
                    }}>
                      {comparisonMetrics.cycleTimeDelta < 0 ? <TrendingDown size={14} /> : <TrendingUp size={14} />}
                      {comparisonMetrics.cycleTimeDelta < 0 ? '' : '+'}{comparisonMetrics.cycleTimeDelta.toFixed(1)}%
                    </span>
                  ) : (
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                      background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0',
                      display: 'inline-flex', alignItems: 'center', gap: 4
                    }}>
                      No meaningful change
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: '#64748b' }}>Baseline</span>
                      <span style={{ fontWeight: 700, color: '#0f172a' }}>{comparisonMetrics.baseCycleFormatted || fmt(comparisonMetrics.baseAvg)}</span>
                    </div>
                    <div style={{ height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: '100%', background: '#94a3b8', borderRadius: 4 }} />
                    </div>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: '#6b4de6', fontWeight: 600 }}>What-If Scenario</span>
                      <span style={{ fontWeight: 700, color: '#6b4de6' }}>{comparisonMetrics.wiCycleFormatted || fmt(comparisonMetrics.wiAvg)}</span>
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
<InfoTip title="Production throughput" corner="br">How many customers are finished per hour. The percentage shows how much it changed with your scenario. Higher is better.</InfoTip>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>Production Throughput</span>
                    {comparisonMetrics.throughputMeaningful ? (
                      <span style={{
                        fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                        background: comparisonMetrics.throughputDelta > 0 ? '#dcfce7' : '#fee2e2',
                        color: comparisonMetrics.throughputDelta > 0 ? '#15803d' : '#b91c1c',
                        display: 'inline-flex', alignItems: 'center', gap: 4
                      }}>
                        {comparisonMetrics.throughputDelta > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                        {comparisonMetrics.throughputDelta > 0 ? '+' : ''}{comparisonMetrics.throughputDelta.toFixed(1)}%
                      </span>
                    ) : (
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                        background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0',
                        display: 'inline-flex', alignItems: 'center', gap: 4
                      }}>
                        No meaningful change
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: '#64748b' }}>Baseline</span>
                        <span style={{ fontWeight: 700, color: '#0f172a' }}>{comparisonMetrics.baseThroughput.toFixed(1)}/hr</span>
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
                        <span style={{ color: '#6b4de6', fontWeight: 600 }}>What-If Scenario</span>
                        <span style={{ fontWeight: 700, color: '#6b4de6' }}>{comparisonMetrics.wiThroughput.toFixed(1)}/hr</span>
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
<InfoTip title="Bottleneck shift" corner="br">The bottleneck is the step that holds the process back most. If it moves to a different step after your change, the original problem was fixed and a new one is now the biggest.</InfoTip>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 8, display: 'block' }}>{simMode === 'quick' ? 'Slowest Task Shift' : 'Bottleneck Shift'}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Baseline:</span>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      "{comparisonMetrics.baseBnLabel}"
                    </div>
                  </div>
                  <div style={{ fontSize: 16, color: '#6b4de6', fontWeight: 700 }}>➔</div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 11, color: '#6b4de6', display: 'block' }}>What-If:</span>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#6b4de6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      "{comparisonMetrics.wiBnLabel}"
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* Comparison Charts */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
              <div style={{ position: 'relative', background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '18px' }}>
<InfoTip title="Cycle time comparison">Average time per customer before (baseline) and after (what-if) your change. A green bar means your change made it faster; red means slower.</InfoTip>
                <h4 style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>Cycle Time: Baseline vs What-If</h4>
                <div style={{ height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[
                      { name: 'Baseline', value: comparisonMetrics.baseAvg },
                      { name: whatifName.length > 14 ? 'What-If' : whatifName, value: comparisonMetrics.wiAvg },
                    ]} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => fmt(v)} />
                      <Tooltip formatter={(v) => fmt(v)} />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={56}>
                        <Cell fill="#94a3b8" />
                        <Cell fill={!comparisonMetrics.cycleMeaningful ? '#94a3b8' : (comparisonMetrics.cycleTimeDelta < 0 ? '#10b981' : '#ef4444')} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div style={{ position: 'relative', background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '18px' }}>
<InfoTip title="Throughput comparison">Customers finished per hour before (baseline) and after (what-if) your change. A green bar means more customers were served; red means fewer.</InfoTip>
                <h4 style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>Throughput: Baseline vs What-If</h4>
                <div style={{ height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[
                      { name: 'Baseline', value: comparisonMetrics.baseThroughput },
                      { name: whatifName.length > 14 ? 'What-If' : whatifName, value: comparisonMetrics.wiThroughput },
                    ]} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v.toFixed(0)}/hr`} />
                      <Tooltip formatter={(v) => `${v.toFixed(2)}/hr`} />
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
              <RichText text={comparisonMetrics.descText} />
            </div>
              </>
            )}

          </div>
        )}
         </>
        )}
        {tab === 'takeaways' && <KeyTakeaways lines={summaryLines} />}
      </main>
    </div>
  );
}
