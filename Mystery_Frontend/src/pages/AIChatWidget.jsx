'use client';
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, X, Send, Sparkles, RefreshCw } from 'lucide-react';
import { buildResultsSummary } from './aiSummary';
import { useImplementSuggestion } from '../lib/useImplementSuggestion';

const AI_API_BASE = import.meta.env.VITE_AI_API_URL || '';

function RichText({ text }) {
  const parts = String(text || '').split(/\*\*(.*?)\*\*/g);
  return <span>{parts.map((p, i) => i % 2 === 1 ? <strong key={i} style={{ fontWeight: 700 }}>{p}</strong> : <span key={i}>{p}</span>)}</span>;
}

const SUGGESTED_PROMPTS = [
  'How can customers get served faster?',
  'Who should I add more of?',
  'Where is money being wasted?',
];

// Heuristic only — there's no structured "this reply is actionable" flag
// coming back from /api/ai/chat today, so this looks for the kind of
// language an optimization suggestion actually uses (add/reduce capacity,
// staffing, cycle time, bottlenecks, etc.) before showing the Implement
// button under an assistant message. Errs toward showing it — a suggestion
// text that turns out not to be actionable just means the AI implement
// endpoint makes no changes, not a crash.
const ACTIONABLE_PATTERN = /\b(add|increase|reduce|decrease|remove|cut|speed up|optimi[sz]e|capacity|staff|resource|bottleneck|cycle time|wait time|throughput|utili[sz]ation|cost|duration|parallel|automat)/i;

function looksActionable(text) {
  return ACTIONABLE_PATTERN.test(String(text || ''));
}

export default function AIChatWidget({ results, idToLabel, simMode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // {role: 'user'|'assistant', content}
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);
  const { implementSuggestion, implementingId, implementError } = useImplementSuggestion(navigate);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading, open]);

  if (!results) return null;

  async function send(text) {
    const trimmed = (text ?? input).trim();
    if (!trimmed || loading) return;

    const nextMessages = [...messages, { role: 'user', content: trimmed }];
    setMessages(nextMessages);
    setInput('');
    setError(null);
    setLoading(true);

    try {
      const summary = buildResultsSummary(results, idToLabel, simMode);
      const token = localStorage.getItem('spot_token') || sessionStorage.getItem('spot_token');
      const res = await fetch(`${AI_API_BASE}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          summary,
          message: trimmed,
          history: nextMessages.slice(0, -1), // everything before this turn
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to get a response');
      setMessages(m => [...m, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function resetChat() {
    setMessages([]);
    setError(null);
  }

  return (
    <>
      {/* Floating trigger button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 50,
            width: 56, height: 56, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: '#6b4de6', boxShadow: '0 8px 24px rgba(107, 77, 230, 0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          aria-label="Ask AI about these results"
        >
          <MessageCircle size={24} color="#fff" />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 50,
          width: 360, maxWidth: 'calc(100vw - 32px)', height: 500, maxHeight: 'calc(100vh - 48px)',
          background: '#fff', borderRadius: 16, boxShadow: '0 12px 40px rgba(15,23,42,0.18)',
          border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          fontFamily: "'Inter', sans-serif",
        }}>
          {/* Header */}
          <div style={{ background: '#6b4de6', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={16} color="#fff" />
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>Ask about these results</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {messages.length > 0 && (
                <button onClick={resetChat} title="Reset chat" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, display: 'flex' }}>
                  <RefreshCw size={14} color="rgba(255,255,255,0.85)" />
                </button>
              )}
              <button onClick={() => setOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, display: 'flex' }}>
                <X size={16} color="#fff" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12, background: '#f8fafc' }}>
            {messages.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ fontSize: 12.5, color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                  Ask anything about this simulation run — e.g. "My cycle time is 100 hours, how do I get it to 50?"
                </p>
                {SUGGESTED_PROMPTS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => send(p)}
                    style={{
                      textAlign: 'left', padding: '8px 12px', borderRadius: 10, border: '1px solid #e2e8f0',
                      background: '#fff', color: '#334155', fontSize: 12.5, cursor: 'pointer',
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', gap: 4 }}>
                <div style={{
                  maxWidth: '85%', padding: '9px 12px', borderRadius: 12, fontSize: 13, lineHeight: 1.5,
                  background: m.role === 'user' ? '#6b4de6' : '#fff',
                  color: m.role === 'user' ? '#fff' : '#334155',
                  border: m.role === 'user' ? 'none' : '1px solid #e2e8f0',
                  borderBottomRightRadius: m.role === 'user' ? 4 : 12,
                  borderBottomLeftRadius: m.role === 'user' ? 12 : 4,
                  whiteSpace: 'pre-wrap',
                }}>
                  <RichText text={m.content} />
                </div>

                {m.role === 'assistant' && looksActionable(m.content) && (
                  <div style={{ marginTop: 6 }}>
                    <button
                      disabled={implementingId !== null}
                      onClick={() => implementSuggestion(m.content, i)}
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
                          Implementing…
                        </>
                      ) : (
                        <>
                          <Sparkles size={11} />
                          Implement Suggestion
                        </>
                      )}
                    </button>

                    {implementError && implementError.id === i && (
                      <div style={{ marginTop: 6, fontSize: 11.5, color: '#dc2626' }}>
                        <p style={{ margin: '0 0 3px 0', fontWeight: 600 }}>
                          {implementError.message || "Couldn't create this scenario. Please try again."}
                        </p>
                        {implementError.technicalDetails && (
                          <details style={{ marginTop: 2, cursor: 'pointer' }}>
                            <summary style={{ color: '#64748b', fontSize: 10.5, textDecoration: 'underline' }}>
                              Technical details
                            </summary>
                            <div style={{
                              marginTop: 3,
                              padding: '5px 7px',
                              background: '#fef2f2',
                              border: '1px solid #fee2e2',
                              borderRadius: 5,
                              fontFamily: 'monospace',
                              fontSize: 10.5,
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
                )}
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ padding: '9px 12px', borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0', fontSize: 12.5, color: '#94a3b8' }}>
                  Thinking…
                </div>
              </div>
            )}

            {error && (
              <div style={{ fontSize: 12, color: '#b91c1c', padding: '6px 2px' }}>{error}</div>
            )}
          </div>

          {/* Input */}
          <div style={{ padding: 12, borderTop: '1px solid #e2e8f0', display: 'flex', gap: 8, flexShrink: 0, background: '#fff' }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask a question…"
              style={{
                flex: 1, border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', fontSize: 13,
                outline: 'none', fontFamily: 'inherit',
              }}
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              style={{
                width: 38, height: 38, borderRadius: 10, border: 'none', flexShrink: 0,
                background: (loading || !input.trim()) ? '#e2e8f0' : '#6b4de6',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: (loading || !input.trim()) ? 'default' : 'pointer',
              }}
            >
              <Send size={15} color={(loading || !input.trim()) ? '#94a3b8' : '#fff'} />
            </button>
          </div>
        </div>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </>
  );
}