'use client';
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, RefreshCw, AlertTriangle, AlertCircle, CheckCircle, Info } from 'lucide-react';
import { buildResultsSummary } from './aiSummary';
import { useImplementSuggestion } from '../lib/useImplementSuggestion';

const AI_API_BASE = import.meta.env.VITE_AI_API_URL || '';

function RichText({ text }) {
  const parts = String(text || '').split(/\*\*(.*?)\*\*/g);
  return <span>{parts.map((p, i) => i % 2 === 1 ? <strong key={i} style={{ color: '#0f172a', fontWeight: 700 }}>{p}</strong> : <span key={i}>{p}</span>)}</span>;
}

const ICONS = {
  alert: { Icon: AlertCircle, color: '#ef4444' },
  warn: { Icon: AlertTriangle, color: '#f59e0b' },
  info: { Icon: Info, color: '#6b4de6' },
  success: { Icon: CheckCircle, color: '#10b981' },
};

export default function AIInsightsPanel({ results, idToLabel, simMode, idToResource = {}, processId: propProcessId }) {
  const navigate = useNavigate();
  const [insights, setInsights] = useState(null);
  const [noneReason, setNoneReason] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { implementSuggestion, implementingId, implementError } = useImplementSuggestion(navigate);

  async function fetchInsights() {
    const processId = propProcessId || (typeof window !== 'undefined' ? localStorage.getItem('spot:processId') : null);
    if (!processId) {
      setError('Please open or save a process first to find tested improvements.');
      return;
    }
    setLoading(true);
    setError(null);
    setNoneReason(null);
    try {
      const token = localStorage.getItem('spot_token') || sessionStorage.getItem('spot_token');
      const res = await fetch(`${AI_API_BASE}/api/ai/tested-suggestions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ processId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || data?.detail || 'Failed to generate tested insights');
      }
      if (data.none) {
        setInsights([]);
        setNoneReason(data.reason || 'No change worth making at this load');
      } else {
        setInsights(data.candidates || []);
      }
    } catch (err) {
      setError(err.message || 'Something went wrong while testing suggestions');
    } finally {
      setLoading(false);
    }
  }

  // Never auto-fetch on page load. Suggestions run ONLY on explicit user action
  // ("Find improvements" button click or Refresh).

  return (
    <div style={{
      background: 'linear-gradient(to bottom right, #ffffff, #faf5ff)',
      border: '1px solid #e2e8f0',
      borderRadius: 16,
      padding: '18px 22px',
      boxShadow: '0 4px 20px rgba(107, 77, 230, 0.04)',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#6b4de6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Sparkles size={15} color="#fff" />
          </div>
          <h3 style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', margin: 0 }}>AI Insights</h3>
        </div>

        {insights !== null && (
          <button
            onClick={fetchInsights}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none',
              color: '#6b4de6', fontSize: 12, fontWeight: 700, cursor: loading ? 'default' : 'pointer', padding: '4px 6px',
            }}
          >
            <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            Refresh
          </button>
        )}
      </div>

      {insights === null && !loading && !error && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Simulate tested changes to see measured improvements before applying them.</p>
          <button
            onClick={fetchInsights}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 12, fontWeight: 700,
              borderRadius: 8, border: 'none', cursor: 'pointer', color: '#fff', background: '#6b4de6', flexShrink: 0,
            }}
          >
            <Sparkles size={13} /> Find improvements
          </button>
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          <RefreshCw size={13} color="#6b4de6" style={{ animation: 'spin 1s linear infinite' }} />
          <span style={{ fontSize: 13, color: '#64748b' }}>Testing candidate improvements in simulator…</span>
        </div>
      )}

      {error && !loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          <AlertCircle size={14} color="#ef4444" />
          <span style={{ fontSize: 12.5, color: '#b91c1c' }}>{error}</span>
        </div>
      )}

      {insights && insights.length > 0 && !loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          {insights.map((ins, i) => {
            const { Icon, color } = ICONS[ins.type] || ICONS.warn;
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '14px 16px', background: '#fff', border: '1px solid #f1f5f9', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <Icon size={16} color={color} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {ins.tested_evidence && (
                      <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: 6,
                        padding: '2px 8px',
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: '#475569',
                        width: 'fit-content',
                      }}>
                        {ins.tested_evidence}
                      </div>
                    )}
                    {ins.summary && (
                      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45, color: '#334155' }}>
                        <RichText text={ins.summary} />
                      </p>
                    )}
                  </div>
                </div>
                
                {/* Implement Button */}
                <div style={{ marginTop: 12 }}>
                  <button
                    disabled={implementingId !== null}
                    onClick={() => implementSuggestion(ins.variant_definition || ins, i)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      background: implementingId === i ? '#f1f5f9' : '#f5f3ff',
                      color: implementingId === i ? '#94a3b8' : '#6b4de6',
                      border: implementingId === i ? '1px solid #e2e8f0' : '1px solid #ddd6fe',
                      borderRadius: 6,
                      padding: '5px 10px',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: implementingId !== null ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {implementingId === i ? (
                      <>
                        <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} />
                        Implementing...
                      </>
                    ) : (
                      <>
                        <Sparkles size={11} />
                        Implement Suggestion
                      </>
                    )}
                  </button>

                  {implementError && implementError.id === i && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626' }}>
                      <p style={{ margin: '0 0 4px 0', fontWeight: 600 }}>
                        {implementError.message || "Couldn't create this scenario. Please try again."}
                      </p>
                      {implementError.technicalDetails && (
                        <details style={{ marginTop: 2, cursor: 'pointer' }}>
                          <summary style={{ color: '#64748b', fontSize: 11, textDecoration: 'underline' }}>
                            Technical details
                          </summary>
                          <div style={{
                            marginTop: 4,
                            padding: '6px 8px',
                            background: '#fef2f2',
                            border: '1px solid #fee2e2',
                            borderRadius: 6,
                            fontFamily: 'monospace',
                            fontSize: 11,
                            color: '#991b1b',
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-wrap',
                          }}>
                            {implementError.technicalDetails}
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {insights && insights.length === 0 && !loading && (
        <p style={{ margin: 0, fontSize: 13, color: '#64748b', fontStyle: 'italic', padding: '6px 0' }}>
          {noneReason || "No change worth making at this load"}
        </p>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}