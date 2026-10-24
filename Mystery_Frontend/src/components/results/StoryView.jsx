import { useMemo } from 'react';
import { Hourglass, User, Frown, Smile, Meh, Lightbulb, ArrowRight, FlaskConical, Table2 } from 'lucide-react';

const SUBJECT = 'Sam'; // the imaginary customer we follow through the process

/** Put steps in the order a customer actually meets them (follows the model's arrows). */
function orderIds(ids, connections) {
  if (!connections?.length) return ids;
  const wanted = new Set(ids);
  const next = {};
  const hasIncoming = new Set();
  connections.forEach(c => {
    (next[c.fromId] = next[c.fromId] || []).push(c.toId);
    hasIncoming.add(c.toId);
  });
  const starts = Object.keys(next).filter(id => !hasIncoming.has(id));
  const seen = new Set();
  const out = [];
  const queue = [...starts];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    if (wanted.has(id)) out.push(id);
    (next[id] || []).forEach(n => queue.push(n));
  }
  ids.forEach(id => { if (!out.includes(id)) out.push(id); });
  return out;
}

function readConnections() {
  try {
    const raw = JSON.parse(localStorage.getItem('spot:model:nodes') || '{}');
    return Array.isArray(raw) ? [] : (raw.connections || []);
  } catch { return []; }
}

/** Turn a duration in minutes into something people can picture. */
function comparison(mins) {
  if (!mins || mins <= 0) return null;
  if (mins < 10) return 'about as long as making a cup of tea';
  if (mins < 60) return 'about as long as a coffee break';
  if (mins < 480) return 'about as long as a long lunch plus a meeting';
  if (mins < 1440) return 'a whole working day';
  if (mins < 4320) return 'like ordering a pizza and getting it the day after tomorrow';
  return 'like ordering a pizza and getting it next week';
}

const TONES = {
  red:   { bg: '#fef2f2', border: '#fecaca', text: '#991b1b', dot: '#ef4444', label: 'Needs attention' },
  amber: { bg: '#fffbeb', border: '#fde68a', text: '#92400e', dot: '#f59e0b', label: 'Could be better' },
  green: { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534', dot: '#10b981', label: 'Looking good' },
  blue:  { bg: '#f5f3ff', border: '#ddd6fe', text: '#4c1d95', dot: '#6b4de6', label: 'Best-case estimate' },
};

export default function StoryView({ results, idToLabel, simMode, bnLabel, fmt, onShowNumbers, onTryFix }) {
  const isQuick = simMode === 'quick';
  const avg = results?.time_in_system?.avg ?? 0;

  const steps = useMemo(() => {
    const act = results?.activity_results || {};
    return orderIds(Object.keys(act), readConnections())
      .map(id => ({
        id,
        name: idToLabel[id] || id,
        work: act[id]?.avg_processing_time ?? 0,
        wait: act[id]?.avg_wait_time ?? 0,
      }))
      .filter(s => s.work + s.wait > 0);
  }, [results, idToLabel]);

  const totalWork = steps.reduce((a, s) => a + s.work, 0);
  const totalWait = steps.reduce((a, s) => a + s.wait, 0);
  const waitShare = totalWork + totalWait > 0 ? totalWait / (totalWork + totalWait) : 0;

  const people = useMemo(() => Object.entries(results?.resource_utilization || {})
    .map(([name, v]) => ({ name, pct: Math.round(v.utilization_pct ?? 0) }))
    .sort((a, b) => b.pct - a.pct), [results]);
  const overloaded = people.filter(p => p.pct > 85);
  const spare = people.filter(p => p.pct <= 35);

  // Where is the customer stuck the longest?
  const key = isQuick ? 'work' : 'wait';
  const worst = steps.length ? steps.reduce((a, b) => (b[key] > a[key] ? b : a), steps[0]) : null;
  const maxVal = worst ? Math.max(worst[key], 1e-9) : 1;

  // One overall verdict
  let tone = 'green';
  let headline; let detail;
  if (isQuick) {
    tone = 'blue';
    headline = `In the best case, ${SUBJECT} is done in about ${fmt(avg)}.`;
    detail = 'This quick estimate assumes nobody ever has to wait in line. Run the Deep Analysis to see what happens with real crowds.';
  } else if (waitShare > 0.5 || overloaded.length) {
    tone = 'red';
    headline = `${SUBJECT} spends most of the time waiting, not being served.`;
    detail = `From start to finish ${SUBJECT} needs about ${fmt(avg)}, and roughly ${Math.round(waitShare * 100)}% of that is waiting.`;
  } else if (waitShare > 0.2) {
    tone = 'amber';
    headline = `${SUBJECT} gets through, but waits more than necessary.`;
    detail = `A trip takes about ${fmt(avg)}. About ${Math.round(waitShare * 100)}% of it is waiting.`;
  } else {
    headline = `${SUBJECT} gets through smoothly.`;
    detail = `A trip takes about ${fmt(avg)}, and almost all of it is real work.`;
  }
  const t = TONES[tone];
  const compare = isQuick ? null : comparison(avg);

  // What to do next
  const todo = [];
  overloaded.forEach(p => todo.push(`Add another person or machine for “${p.name}”. It is working non-stop.`));
  if (!isQuick && worst) todo.push(`Speed up “${worst.name}”. This is where customers get stuck the longest.`);
  if (isQuick && worst) todo.push(`Look at “${worst.name}”. It is the slowest step.`);
  if (!isQuick && overloaded.length && spare.length) todo.push(`“${spare[0].name}” has spare time. Could it help out?`);
  if (!todo.length) todo.push('Nothing urgent. Your process is running smoothly.');

  const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 24 };

  if (!steps.length) {
    return <div style={{ ...card, color: '#64748b', fontSize: 14 }}>There are no step timings to show yet. Run a simulation first.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* 1. THE VERDICT */}
      <div style={{ background: t.bg, border: `1.5px solid ${t.border}`, borderRadius: 16, padding: '24px 28px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 800, color: t.text, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.dot }} /> {t.label}
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: t.text, margin: '0 0 8px', lineHeight: 1.3 }}>{headline}</h2>
        <p style={{ fontSize: 15, color: t.text, margin: 0, lineHeight: 1.6 }}>{detail}</p>
        {compare && (
          <p style={{ fontSize: 14, color: t.text, margin: '10px 0 0', opacity: 0.85 }}>
            In everyday terms, that is {compare}.
          </p>
        )}
      </div>

      {/* 2. THE JOURNEY MAP */}
      <div style={card}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 4px' }}>Follow {SUBJECT} through your process</h3>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>
          {SUBJECT} visits each stop in order. {isQuick ? 'Taller bars mean the step takes longer.' : 'Taller, redder bars mean a longer wait at that stop.'}
        </p>

        <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', minWidth: steps.length * 130 + 140, gap: 0 }}>
            <Endpoint label={`${SUBJECT} arrives`} />
            {steps.map((s, i) => {
              const ratio = s[key] / maxVal;
              const isWorst = worst && s.id === worst.id && (isQuick || waitShare > 0.2);
              const color = isQuick ? '#6b4de6' : (waitShare <= 0.2 ? '#10b981' : ratio >= 0.7 ? '#ef4444' : ratio >= 0.35 ? '#f59e0b' : '#10b981');
              return (
                <div key={s.id} style={{ flex: 1, minWidth: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                  {isWorst && (
                    <div style={{ background: '#0f172a', color: '#fff', fontSize: 11, fontWeight: 600, padding: '6px 10px', borderRadius: 8, marginBottom: 8, textAlign: 'center', maxWidth: 130 }}>
                      {isQuick ? `Slowest step` : `${SUBJECT} is stuck here the longest`}
                    </div>
                  )}
                  <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 6 }}>
                    {!isQuick && <Hourglass size={12} style={{ marginRight: 4, verticalAlign: -1 }} />}
                    {fmt(s[key])}
                  </div>
                  <div style={{ width: 44, height: 20 + Math.round(ratio * 110), background: color, borderRadius: '8px 8px 0 0', opacity: 0.9, transition: 'height 0.6s ease' }} />
                  <div style={{ width: '100%', height: 4, background: '#cbd5e1', position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '50%', top: -6, width: 16, height: 16, marginLeft: -8, borderRadius: '50%', background: '#fff', border: `3px solid ${color}` }} />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', textAlign: 'center', marginTop: 14, padding: '0 6px', lineHeight: 1.3 }}>
                    {i + 1}. {s.name}
                  </div>
                  {!isQuick && (
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>real work: {fmt(s.work)}</div>
                  )}
                </div>
              );
            })}
            <Endpoint label={`${SUBJECT} leaves`} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 16, fontSize: 12, color: '#64748b' }}>
          {!isQuick && <span><Hourglass size={12} style={{ verticalAlign: -1 }} /> = time spent waiting in line</span>}
          <span>“Real work” = time someone is actually serving {SUBJECT}</span>
        </div>
      </div>

      {/* 3. THE TEAM */}
      {!isQuick && people.length > 0 && (
        <div style={card}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 4px' }}>How is your team doing?</h3>
          <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>Each person or machine, shown by how busy they are.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {people.map(p => {
              const hot = p.pct > 85, calm = p.pct <= 35;
              const Face = hot ? Frown : calm ? Smile : Meh;
              const c = hot ? '#dc2626' : calm ? '#0284c7' : '#16a34a';
              const bg = hot ? '#fef2f2' : calm ? '#f0f9ff' : '#f0fdf4';
              const line = hot ? 'Working non-stop. Never gets a break.'
                : calm ? `Mostly waiting around. Free about ${100 - p.pct}% of the time.`
                : 'Busy, but coping well.';
              return (
                <div key={p.name} style={{ background: bg, borderRadius: 12, padding: 16, display: 'flex', gap: 14, alignItems: 'center' }}>
                  <Face size={40} color={c} strokeWidth={1.6} style={{ flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{p.name}</div>
                    <div style={{ fontSize: 13, color: c, marginTop: 2 }}>{line}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. WHAT TO DO NEXT */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Lightbulb size={20} color="#f59e0b" />
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>What you could do next</h3>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {todo.map((line, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 15, color: '#334155', lineHeight: 1.5 }}>
              <ArrowRight size={16} color="#6b4de6" style={{ marginTop: 4, flexShrink: 0 }} /> <span>{line}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 20 }}>
          <button onClick={onTryFix} style={btn('#6b4de6', '#fff', 'none')}><FlaskConical size={14} /> Try a fix in What-If</button>
          <button onClick={onShowNumbers} style={btn('#fff', '#475569', '1px solid #e2e8f0')}><Table2 size={14} /> See the full numbers</button>
        </div>
      </div>
    </div>
  );
}

function Endpoint({ label }) {
  return (
    <div style={{ width: 70, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
        <User size={22} color="#6b4de6" />
      </div>
      <div style={{ width: '100%', height: 4, background: '#cbd5e1' }} />
      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginTop: 14, textAlign: 'center' }}>{label}</div>
    </div>
  );
}

const btn = (bg, color, border) => ({
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', fontSize: 13, fontWeight: 700,
  borderRadius: 8, border, cursor: 'pointer', color, background: bg,
});
