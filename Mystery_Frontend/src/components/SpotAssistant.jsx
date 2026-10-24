import { useState } from 'react';
import { Loader2, Send, Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { applyAiOption, solveProblem } from '../lib/apiService';

const panelStyle = {
  position: 'fixed', right: 24, bottom: 24, zIndex: 60,
  width: 500, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 48px)',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
  boxShadow: '0 16px 48px rgba(15,23,42,0.2)', fontFamily: 'Inter, sans-serif',
};

function number(value, digits = 2) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : '—';
}

function changeText(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(2)}%`;
}

function changeColor(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return '#64748b';
  return numeric < 0 ? '#15803d' : '#dc2626';
}

export default function SpotAssistant({ open, onClose, processId, ensureProcessSaved }) {
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [submittedMessage, setSubmittedMessage] = useState('');
  const [question, setQuestion] = useState(null);
  const [minutes, setMinutes] = useState('');
  const [evidence, setEvidence] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [applying, setApplying] = useState({});
  const [applyError, setApplyError] = useState(null);
  const [createdScenarios, setCreatedScenarios] = useState({});

  if (!open) return null;

  async function currentProcessId() {
    if (processId) return processId;
    const saved = await ensureProcessSaved();
    return typeof saved === 'string' ? saved : localStorage.getItem('spot:processId');
  }

  async function sendProblem(text = message, config) {
    const trimmed = String(text || '').trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    setApplyError(null);
    try {
      const id = await currentProcessId();
      if (!id) throw new Error('Save your process before testing options.');
      let activeConfig = config;
      if (!activeConfig || activeConfig.arrival_rate === undefined) {
        try {
          const stored = JSON.parse(localStorage.getItem('spot:simulationConfig') || '{}');
          const storedGoal = localStorage.getItem('spot:goal') || stored.goal;
          activeConfig = {
            arrival_rate: stored.arrival_rate,
            goal: storedGoal,
            ...(activeConfig || {}),
          };
        } catch {}
      }
      const response = await solveProblem(id, trimmed, activeConfig);
      setSubmittedMessage(trimmed);
      if (response.type === 'question') {
        setQuestion(response.question);
        setEvidence(null);
      } else if (response.type === 'evidence') {
        if (!response.baseline || !Array.isArray(response.variants)) {
          throw new Error('The simulator returned an incomplete option comparison.');
        }
        setEvidence(response);
        setQuestion(null);
      } else {
        throw new Error('The assistant returned an unexpected response.');
      }
      setMessage('');
    } catch (err) {
      setError(err.message || 'Unable to test options right now.');
    } finally {
      setLoading(false);
    }
  }

  async function submitArrivalRate() {
    const value = Number(minutes);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter a number of minutes greater than zero.');
      return;
    }
    await sendProblem(submittedMessage, { arrival_rate: 1 / value });
  }

  async function applyVariant(variant) {
    const definition = evidence?.variant_definitions?.find(item => item.label === variant.label);
    if (!definition || applying[variant.label]) return;
    setApplying(previous => ({ ...previous, [variant.label]: true }));
    setApplyError(null);
    try {
      const id = await currentProcessId();
      if (!id) throw new Error('Save your process before creating a scenario.');
      const scenario = await applyAiOption(id, definition);
      const scenarioId = scenario?._id || scenario?.id;
      setCreatedScenarios(previous => ({ ...previous, [variant.label]: { id: scenarioId, label: variant.label } }));
    } catch (err) {
      setApplyError(err.message || 'Unable to create the scenario.');
    } finally {
      setApplying(previous => ({ ...previous, [variant.label]: false }));
    }
  }

  function openScenario(scenario) {
    if (scenario?.id) localStorage.setItem('spot:activeScenarioId', scenario.id);
    navigate('/scenarios');
  }

  const rows = evidence ? [
    { label: 'Baseline', metrics: evidence.baseline, change: null, baseline: true },
    ...evidence.variants.map(variant => ({
      label: variant.label,
      metrics: variant.metrics,
      change: variant.delta_vs_baseline?.wait_pct,
      variant,
    })),
  ] : [];
  const recommendedLabel = evidence?.best?.label;

  return (
    <div style={panelStyle} role="dialog" aria-label="Solve a process problem">
      <div style={{ padding: '14px 16px', background: '#6b4de6', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff' }}>
          <Sparkles size={16} />
          <span style={{ fontSize: 14, fontWeight: 700 }}>Ask AI / Solve a problem</span>
        </div>
        <button onClick={onClose} aria-label="Close assistant" style={{ border: 0, background: 'transparent', color: '#fff', cursor: 'pointer', display: 'flex', padding: 4 }}><X size={18} /></button>
      </div>

      <div style={{ overflowY: 'auto', padding: 16, background: '#f8fafc', minHeight: 260 }}>
        {!evidence && !question && !loading && !error && (
          <div style={{ color: '#64748b', fontSize: 13, lineHeight: 1.5, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14 }}>
            Ask a business question and SPOT will test improvement options in your simulator before answering.
          </div>
        )}

        {question && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ alignSelf: 'flex-start', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px 12px 12px 4px', padding: '10px 12px', fontSize: 13, color: '#334155' }}>{question}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input aria-label="Minutes between arrivals" type="number" min="0.01" step="any" value={minutes} onChange={event => setMinutes(event.target.value)} placeholder="Minutes between arrivals" style={{ flex: 1, minWidth: 0, padding: '9px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13 }} />
              <button onClick={submitArrivalRate} disabled={loading} style={{ border: 0, borderRadius: 8, background: loading ? '#cbd5e1' : '#6b4de6', color: '#fff', padding: '0 12px', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer' }}>Submit</button>
            </div>
          </div>
        )}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#5b21b6', fontSize: 13, padding: '14px 0' }}><Loader2 size={17} className="animate-spin" /> Testing options in the simulator…</div>
        )}

        {error && <div role="alert" style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', fontSize: 13 }}>{error}</div>}

        {evidence && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: '#fff', border: '1px solid #ddd6fe', borderRadius: 12, padding: 13, color: '#334155', fontSize: 13, lineHeight: 1.5 }}>{evidence.summary}</div>
            <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
              <table style={{ width: '100%', minWidth: 620, borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead><tr style={{ background: '#f8fafc', color: '#475569', textAlign: 'left' }}>
                  <th style={{ padding: '10px 12px' }}>Option</th><th style={{ padding: '10px 8px' }}>Avg wait (min)</th><th style={{ padding: '10px 8px' }}>Change vs baseline (%)</th><th style={{ padding: '10px 8px' }}>Throughput</th><th style={{ padding: '10px 8px' }}>Cost for this run</th><th style={{ padding: '10px 12px' }} />
                </tr></thead>
                <tbody>{rows.map(row => {
                  const recommended = row.label === recommendedLabel;
                  const created = createdScenarios[row.label];
                  return <tr key={row.label} style={{ background: recommended ? '#f0fdf4' : '#fff', borderTop: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '10px 12px', fontWeight: row.baseline || recommended ? 700 : 600, color: '#334155' }}>{row.label} {recommended && <span style={{ marginLeft: 5, color: '#166534', background: '#dcfce7', borderRadius: 999, padding: '2px 6px', fontSize: 10, fontWeight: 700 }}>Recommended</span>}</td>
                    <td style={{ padding: '10px 8px', color: '#334155' }}>{number(row.metrics?.avg_wait_time)}</td>
                    <td style={{ padding: '10px 8px', color: changeColor(row.change), fontWeight: 700 }}>{row.baseline ? '—' : changeText(row.change)}</td>
                    <td style={{ padding: '10px 8px', color: '#334155' }}>{number(row.metrics?.throughput_per_hour)}</td>
                    <td style={{ padding: '10px 8px', color: '#334155' }}>Rs {number(row.metrics?.total_cost)}</td>
                    <td style={{ padding: '7px 12px' }}>{row.variant && (created ? <button onClick={() => openScenario(created)} style={{ whiteSpace: 'nowrap', border: '1px solid #bbf7d0', borderRadius: 7, background: '#f0fdf4', color: '#166534', padding: '6px 8px', fontWeight: 700, cursor: 'pointer' }}>Scenario created · Open it</button> : <button onClick={() => applyVariant(row.variant)} disabled={Boolean(applying[row.label])} style={{ whiteSpace: 'nowrap', border: '1px solid #c4b5fd', borderRadius: 7, background: applying[row.label] ? '#f1f5f9' : '#f5f3ff', color: applying[row.label] ? '#94a3b8' : '#6b4de6', padding: '6px 8px', fontWeight: 700, cursor: applying[row.label] ? 'not-allowed' : 'pointer' }}>{applying[row.label] ? 'Creating…' : 'Apply as scenario'}</button>)}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <p style={{ margin: 0, color: '#64748b', fontSize: 11.5 }}>Simulated over 300 customers, 3 runs. Results depend on run length.</p>
            {applyError && <div role="alert" style={{ padding: '10px 12px', borderRadius: 8, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', fontSize: 13 }}>{applyError}</div>}
          </div>
        )}
      </div>

      <form onSubmit={event => { event.preventDefault(); sendProblem(); }} style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #e2e8f0', background: '#fff' }}>
        <input value={message} onChange={event => setMessage(event.target.value)} disabled={loading} placeholder="How can I reduce waiting?" style={{ flex: 1, minWidth: 0, border: '1px solid #cbd5e1', borderRadius: 8, padding: '9px 10px', fontSize: 13 }} />
        <button type="submit" disabled={loading || !message.trim()} aria-label="Send question" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, border: 0, borderRadius: 8, background: loading || !message.trim() ? '#cbd5e1' : '#6b4de6', color: '#fff', cursor: loading || !message.trim() ? 'not-allowed' : 'pointer' }}><Send size={16} /></button>
      </form>
    </div>
  );
}
