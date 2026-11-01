import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Send, Sparkles, X, Maximize2, Minimize2, Plus, AlertCircle, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { applyAiOption, solveProblem } from '../lib/apiService';
import { useExpandablePanel } from '../hooks/useExpandablePanel';
import { useAnalystView, Hint, formatPlainLanguage } from '../lib/labels';

function number(value, digits = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : '—';
}

function changeText(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(1)}%`;
}

function changeColor(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return '#64748b';
  return numeric < 0 ? '#15803d' : '#dc2626';
}

function makeId(prefix = 'msg') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export default function SpotAssistant({ open, onClose, processId, ensureProcessSaved }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  const {
    isExpanded,
    toggleExpand,
    isMobile,
    handleScroll,
    scrollToBottomIfNear,
  } = useExpandablePanel({
    panelId: 'solve-problem',
    inputRef,
    scrollRef,
  });

  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [lastUserPrompt, setLastUserPrompt] = useState('');

  // Storage key based on processId
  const effectiveProcessId = processId || (typeof window !== 'undefined' ? localStorage.getItem('spot:processId') : null) || 'default';
  const threadStorageKey = `spot:solveProblemThread:${effectiveProcessId}`;

  // Messages thread & thread config
  const [messages, setMessages] = useState(() => {
    try {
      const stored = localStorage.getItem(threadStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed.messages)) return parsed.messages;
      }
    } catch {}
    return [];
  });

  const [threadConfig, setThreadConfig] = useState(() => {
    try {
      const stored = localStorage.getItem(threadStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.config && typeof parsed.config === 'object') return parsed.config;
      }
    } catch {}
    return {};
  });

  // Reload or switch thread when effectiveProcessId changes
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`spot:solveProblemThread:${effectiveProcessId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed.messages)) setMessages(parsed.messages);
        if (parsed.config) setThreadConfig(parsed.config);
        return;
      }
    } catch {}
    setMessages([]);
    setThreadConfig({});
  }, [effectiveProcessId]);

  // Persist messages & threadConfig (capped at 50 messages)
  const saveThread = useCallback((newMessages, newConfig = threadConfig) => {
    try {
      const capped = newMessages.slice(-50);
      const payload = {
        messages: capped,
        config: newConfig,
        updatedAt: Date.now(),
      };
      localStorage.setItem(`spot:solveProblemThread:${effectiveProcessId}`, JSON.stringify(payload));
    } catch (e) {
      console.warn('Failed to save solveProblem thread:', e);
    }
  }, [effectiveProcessId, threadConfig]);

  // Scroll to bottom when messages or loading change
  useEffect(() => {
    scrollToBottomIfNear();
  }, [messages, loading, scrollToBottomIfNear]);

  async function currentProcessId() {
    if (processId) return processId;
    const saved = await ensureProcessSaved();
    return typeof saved === 'string' ? saved : localStorage.getItem('spot:processId');
  }

  // Send a problem to the backend
  async function handleSend(text = inputText, explicitConfig) {
    const trimmed = String(text || '').trim();
    if (!trimmed || loading) return;

    // Append user message bubble
    const userMsg = {
      id: makeId('user'),
      type: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    saveThread(nextMessages);
    setInputText('');
    setLastUserPrompt(trimmed);
    setLoading(true);

    try {
      const id = await currentProcessId();
      if (!id) throw new Error('Save your process before testing options.');

      // Prepare config: merge stored simulation config, remembered thread config, and explicit override
      let activeConfig = explicitConfig;
      if (!activeConfig || activeConfig.arrival_rate === undefined) {
        try {
          const stored = JSON.parse(localStorage.getItem('spot:simulationConfig') || '{}');
          const storedGoal = localStorage.getItem('spot:goal') || stored.goal;
          activeConfig = {
            arrival_rate: threadConfig.arrival_rate ?? stored.arrival_rate,
            goal: threadConfig.goal ?? storedGoal,
            ...(threadConfig || {}),
            ...(explicitConfig || {}),
          };
        } catch {
          activeConfig = { ...(threadConfig || {}), ...(explicitConfig || {}) };
        }
      }

      const response = await solveProblem(id, trimmed, activeConfig);

      if (response.type === 'question') {
        const questionMsg = {
          id: makeId('question'),
          type: 'question',
          content: response.question,
          answered: false,
          answerValue: null,
          userPrompt: trimmed,
          timestamp: Date.now(),
        };
        const updated = [...nextMessages, questionMsg];
        setMessages(updated);
        saveThread(updated);
      } else if (response.type === 'evidence') {
        if (!response.baseline || !Array.isArray(response.variants)) {
          throw new Error('The simulator returned an incomplete option comparison.');
        }
        const evidenceMsg = {
          id: makeId('evidence'),
          type: 'evidence',
          evidenceData: response,
          scenarioState: {},
          timestamp: Date.now(),
        };
        const updated = [...nextMessages, evidenceMsg];
        setMessages(updated);
        saveThread(updated);
      } else {
        throw new Error('The assistant returned an unexpected response.');
      }
    } catch (err) {
      const errorMsg = {
        id: makeId('error'),
        type: 'error',
        content: err.message || 'Unable to test options right now.',
        timestamp: Date.now(),
      };
      const updated = [...nextMessages, errorMsg];
      setMessages(updated);
      saveThread(updated);
    } finally {
      setLoading(false);
    }
  }

  // Submit answer to an inline question bubble
  async function handleAnswerQuestion(questionMsgId, minutesVal, originalPrompt) {
    const value = Number(minutesVal);
    if (!Number.isFinite(value) || value <= 0) return;

    // Update the question message to answered
    const updatedMessages = messages.map((m) => {
      if (m.id === questionMsgId) {
        return { ...m, answered: true, answerValue: value };
      }
      return m;
    });

    // Append user answer bubble
    const answerUserBubble = {
      id: makeId('user'),
      type: 'user',
      content: `${value} minutes between arrivals`,
      timestamp: Date.now(),
    };
    const nextList = [...updatedMessages, answerUserBubble];
    setMessages(nextList);

    // Update remembered threadConfig with arrival_rate
    const newConfig = {
      ...threadConfig,
      arrival_rate: 1 / value,
    };
    setThreadConfig(newConfig);
    saveThread(nextList, newConfig);

    // Re-run problem with explicit arrival rate
    setLoading(true);
    try {
      const id = await currentProcessId();
      if (!id) throw new Error('Save your process before testing options.');

      const promptToRun = originalPrompt || lastUserPrompt || 'How can I reduce waiting?';
      const response = await solveProblem(id, promptToRun, newConfig);

      if (response.type === 'evidence') {
        if (!response.baseline || !Array.isArray(response.variants)) {
          throw new Error('The simulator returned an incomplete option comparison.');
        }
        const evidenceMsg = {
          id: makeId('evidence'),
          type: 'evidence',
          evidenceData: response,
          scenarioState: {},
          timestamp: Date.now(),
        };
        const finalList = [...nextList, evidenceMsg];
        setMessages(finalList);
        saveThread(finalList, newConfig);
      } else if (response.type === 'question') {
        const questionMsg = {
          id: makeId('question'),
          type: 'question',
          content: response.question,
          answered: false,
          answerValue: null,
          userPrompt: promptToRun,
          timestamp: Date.now(),
        };
        const finalList = [...nextList, questionMsg];
        setMessages(finalList);
        saveThread(finalList, newConfig);
      } else {
        throw new Error('The assistant returned an unexpected response.');
      }
    } catch (err) {
      const errorMsg = {
        id: makeId('error'),
        type: 'error',
        content: err.message || 'Unable to test options right now.',
        timestamp: Date.now(),
      };
      const finalList = [...nextList, errorMsg];
      setMessages(finalList);
      saveThread(finalList, newConfig);
    } finally {
      setLoading(false);
    }
  }

  // Apply variant on a specific evidence card
  async function handleApplyVariant(evidenceMsgId, variant, evidenceData) {
    const definition = evidenceData?.variant_definitions?.find((item) => item.label === variant.label);
    if (!definition) return;

    // Set loading state on this evidence card
    setMessages((prev) => {
      const next = prev.map((m) => {
        if (m.id === evidenceMsgId) {
          const currentScenarioState = m.scenarioState || {};
          return {
            ...m,
            scenarioState: {
              ...currentScenarioState,
              [variant.label]: { loading: true },
            },
          };
        }
        return m;
      });
      saveThread(next);
      return next;
    });

    try {
      const id = await currentProcessId();
      if (!id) throw new Error('Save your process before creating a scenario.');

      const scenario = await applyAiOption(id, definition);
      const scenarioId = scenario?._id || scenario?.id;

      setMessages((prev) => {
        const next = prev.map((m) => {
          if (m.id === evidenceMsgId) {
            const currentScenarioState = m.scenarioState || {};
            return {
              ...m,
              scenarioState: {
                ...currentScenarioState,
                [variant.label]: { loading: false, created: true, scenarioId },
              },
            };
          }
          return m;
        });
        saveThread(next);
        return next;
      });
    } catch (err) {
      setMessages((prev) => {
        const next = prev.map((m) => {
          if (m.id === evidenceMsgId) {
            const currentScenarioState = m.scenarioState || {};
            return {
              ...m,
              scenarioState: {
                ...currentScenarioState,
                [variant.label]: { loading: false, error: err.message || 'Unable to create scenario.' },
              },
            };
          }
          return m;
        });
        saveThread(next);
        return next;
      });
    }
  }

  function handleOpenScenario(scenarioId) {
    if (scenarioId) localStorage.setItem('spot:activeScenarioId', scenarioId);
    navigate('/scenarios');
  }

  // New Chat handler
  function handleClearChat() {
    setMessages([]);
    setThreadConfig({});
    try {
      localStorage.removeItem(`spot:solveProblemThread:${effectiveProcessId}`);
    } catch {}
    setShowClearConfirm(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  if (!open) return null;

  // Container styling for expanded vs collapsed
  const panelContainerStyle = isExpanded
    ? {
        position: 'fixed',
        top: isMobile ? 0 : 56,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 65,
        width: '100vw',
        maxWidth: '100vw',
        maxHeight: 'none',
        borderRadius: 0,
        border: 'none',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#fff',
        fontFamily: 'Inter, sans-serif',
        fontSize: 15,
        boxShadow: 'none',
      }
    : {
        position: 'fixed',
        right: 24,
        bottom: 24,
        zIndex: 65,
        width: 500,
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 48px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 16,
        boxShadow: '0 16px 48px rgba(15,23,42,0.2)',
        fontFamily: 'Inter, sans-serif',
        fontSize: 13,
      };

  const contentWrapperStyle = isExpanded
    ? {
        maxWidth: 900,
        margin: '0 auto',
        width: '100%',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }
    : {
        width: '100%',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      };

  const panelNode = (
    <div style={panelContainerStyle} role="dialog" aria-label="Solve a process problem">
      {/* Header */}
      <div
        style={{
          padding: isExpanded ? '14px 24px' : '14px 16px',
          background: '#6b4de6',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          color: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={isExpanded ? 18 : 16} />
          <span style={{ fontSize: isExpanded ? 16 : 14, fontWeight: 700 }}>
            Ask AI / Solve a problem
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* New Chat Button */}
          <button
            type="button"
            onClick={() => setShowClearConfirm(true)}
            title="Start a new conversation"
            aria-label="New chat"
            style={{
              border: 0,
              background: 'rgba(255,255,255,0.18)',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '5px 10px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <Plus size={14} />
            <span>New chat</span>
          </button>

          {/* Expand / Collapse Button */}
          <button
            type="button"
            onClick={toggleExpand}
            title={isExpanded ? 'Collapse panel (Esc)' : 'Expand panel (Ctrl+Shift+F)'}
            aria-label={isExpanded ? 'Collapse panel' : 'Expand panel'}
            style={{
              border: 0,
              background: 'rgba(255,255,255,0.18)',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: 5,
              borderRadius: 8,
            }}
          >
            {isExpanded ? <Minimize2 size={isExpanded ? 17 : 15} /> : <Maximize2 size={isExpanded ? 17 : 15} />}
          </button>

          {/* Close Button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close assistant"
            style={{
              border: 0,
              background: 'transparent',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              padding: 5,
            }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Clear conversation confirmation banner */}
      {showClearConfirm && (
        <div
          style={{
            padding: '10px 16px',
            background: '#fef3c7',
            borderBottom: '1px solid #fde68a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 13,
            color: '#92400e',
          }}
        >
          <span>Clear this conversation?</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleClearChat}
              style={{
                background: '#dc2626',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
            <button
              onClick={() => setShowClearConfirm(false)}
              style={{
                background: '#fff',
                color: '#475569',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Inner Centered Content Column */}
      <div style={contentWrapperStyle}>
        {/* Messages List */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            overflowY: 'auto',
            padding: isExpanded ? '20px 24px' : 16,
            background: '#f8fafc',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            minHeight: 260,
          }}
        >
          {messages.length === 0 && !loading && (
            <div
              style={{
                color: '#64748b',
                fontSize: isExpanded ? 14 : 13,
                lineHeight: 1.5,
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: 12,
                padding: 16,
              }}
            >
              Ask a business question (e.g. <em>&quot;How can I reduce waiting?&quot;</em>) and SPOT will test improvement options in your simulator before answering.
            </div>
          )}

          {/* Render Thread Messages */}
          {messages.map((msg) => {
            if (msg.type === 'user') {
              return (
                <div key={msg.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div
                    style={{
                      maxWidth: '82%',
                      background: 'linear-gradient(135deg, #6b4de6, #8b5cf6)',
                      color: '#fff',
                      borderRadius: '14px 14px 4px 14px',
                      padding: '10px 14px',
                      fontSize: isExpanded ? 14 : 13,
                      lineHeight: 1.5,
                      boxShadow: '0 2px 8px rgba(107, 77, 230, 0.2)',
                    }}
                  >
                    {msg.content}
                  </div>
                </div>
              );
            }

            if (msg.type === 'question') {
              return (
                <InlineQuestionCard
                  key={msg.id}
                  questionMsg={msg}
                  isExpanded={isExpanded}
                  disabled={loading}
                  onAnswer={(val) => handleAnswerQuestion(msg.id, val, msg.userPrompt)}
                />
              );
            }

            if (msg.type === 'evidence') {
              return (
                <EvidenceCard
                  key={msg.id}
                  evidenceMsg={msg}
                  isExpanded={isExpanded}
                  onApplyVariant={(variant) => handleApplyVariant(msg.id, variant, msg.evidenceData)}
                  onOpenScenario={handleOpenScenario}
                />
              );
            }

            if (msg.type === 'error') {
              return (
                <div
                  key={msg.id}
                  role="alert"
                  style={{
                    padding: '10px 14px',
                    borderRadius: 10,
                    color: '#b91c1c',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    fontSize: isExpanded ? 13.5 : 13,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <AlertCircle size={16} />
                  <span>{msg.content}</span>
                </div>
              );
            }

            return null;
          })}

          {/* Loading indicator */}
          {loading && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: '#5b21b6',
                fontSize: isExpanded ? 14 : 13,
                padding: '12px 0',
                fontWeight: 600,
              }}
            >
              <Loader2 size={18} className="animate-spin" /> Testing options in the simulator…
            </div>
          )}
        </div>

        {/* Input Form at bottom */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          style={{
            display: 'flex',
            gap: 8,
            padding: isExpanded ? '14px 20px' : 12,
            borderTop: '1px solid #e2e8f0',
            background: '#fff',
            flexShrink: 0,
          }}
        >
          <input
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={loading}
            placeholder="Ask a question (e.g. How can I reduce waiting?)"
            style={{
              flex: 1,
              minWidth: 0,
              border: '1px solid #cbd5e1',
              borderRadius: 8,
              padding: isExpanded ? '10px 14px' : '9px 10px',
              fontSize: isExpanded ? 14 : 13,
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={loading || !inputText.trim()}
            aria-label="Send question"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: isExpanded ? 44 : 38,
              border: 0,
              borderRadius: 8,
              background: loading || !inputText.trim() ? '#cbd5e1' : '#6b4de6',
              color: '#fff',
              cursor: loading || !inputText.trim() ? 'not-allowed' : 'pointer',
              flexShrink: 0,
            }}
          >
            <Send size={isExpanded ? 18 : 16} />
          </button>
        </form>
      </div>
    </div>
  );

  if (typeof window === 'undefined' || globalThis.__SSR__ || window?.__SSR__ || (typeof process !== 'undefined' && process.env?.TEST_SSR)) {
    return panelNode;
  }
  return (typeof document !== 'undefined' && document?.body)
    ? createPortal(panelNode, document.body)
    : panelNode;
}

/**
 * Inline Question Card Component:
 * Answers a pending question right inside the thread without replacing anything.
 */
function InlineQuestionCard({ questionMsg, isExpanded, disabled, onAnswer }) {
  const [minutesInput, setMinutesInput] = useState('');
  const [localError, setLocalError] = useState('');

  const handleInlineSubmit = (e) => {
    e.preventDefault();
    const val = Number(minutesInput);
    if (!Number.isFinite(val) || val <= 0) {
      setLocalError('Enter a number of minutes greater than zero.');
      return;
    }
    setLocalError('');
    onAnswer(val);
  };

  if (questionMsg.answered) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'flex-start', maxWidth: '85%' }}>
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '14px 14px 14px 4px',
            padding: '10px 14px',
            fontSize: isExpanded ? 14 : 13,
            color: '#334155',
            lineHeight: 1.5,
          }}
        >
          {questionMsg.content}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#15803d', fontWeight: 600 }}>
          <CheckCircle size={13} />
          <span>Answered: {questionMsg.answerValue} min arrivals</span>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        alignSelf: 'flex-start',
        maxWidth: '90%',
        background: '#fff',
        border: '1px solid #ddd6fe',
        borderRadius: 14,
        padding: 14,
        boxShadow: '0 2px 8px rgba(107, 77, 230, 0.08)',
      }}
    >
      <div style={{ fontSize: isExpanded ? 14 : 13, color: '#334155', fontWeight: 600, lineHeight: 1.5 }}>
        {questionMsg.content}
      </div>

      <form onSubmit={handleInlineSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          aria-label="Minutes between arrivals"
          type="number"
          min="0.01"
          step="any"
          value={minutesInput}
          onChange={(e) => setMinutesInput(e.target.value)}
          placeholder="Minutes between arrivals"
          disabled={disabled}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid #cbd5e1',
            fontSize: isExpanded ? 13.5 : 13,
          }}
        />
        <button
          type="submit"
          disabled={disabled || !minutesInput}
          style={{
            border: 0,
            borderRadius: 8,
            background: disabled || !minutesInput ? '#cbd5e1' : '#6b4de6',
            color: '#fff',
            padding: '8px 14px',
            fontWeight: 700,
            fontSize: 13,
            cursor: disabled || !minutesInput ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Submit
        </button>
      </form>

      {localError && (
        <div style={{ fontSize: 12, color: '#dc2626' }}>{localError}</div>
      )}
    </div>
  );
}

/**
 * Evidence Card Component:
 * Each card maintains its own table and scenario creation state.
 */
function EvidenceCard({ evidenceMsg, isExpanded, onApplyVariant, onOpenScenario }) {
  const [isAnalystView] = useAnalystView();
  const evidence = evidenceMsg.evidenceData;
  const scenarioState = evidenceMsg.scenarioState || {};
  const target = evidence?.target;
  const hasTarget = target && target.target_pct !== null && target.target_pct !== undefined;
  const isCycleTimeGoal =
    target?.metric === 'cycle_time' ||
    evidence?.target?.metric === 'cycle_time' ||
    (target?.metric !== 'waiting' && target?.metric !== 'throughput' && target?.metric !== 'cost' && (evidenceMsg?.userPrompt && /cycle[- ]?time/i.test(evidenceMsg.userPrompt)));

  const getMetricChange = (variant) => {
    if (!variant || !variant.delta_vs_baseline) return null;
    const metric = target?.metric || (isCycleTimeGoal ? 'cycle_time' : 'waiting');
    if (metric === 'cycle_time') return variant.delta_vs_baseline.cycle_time_pct;
    if (metric === 'throughput') return variant.delta_vs_baseline.throughput_pct ?? variant.delta_vs_baseline.wait_pct;
    if (metric === 'cost') {
      const baseCost = Number(evidence?.baseline?.total_cost);
      const costAbs = Number(variant.delta_vs_baseline.cost_abs);
      if (!baseCost || Number.isNaN(costAbs)) return null;
      return Number(((costAbs / baseCost) * 100).toFixed(1));
    }
    return variant.delta_vs_baseline.wait_pct;
  };

  const rows = evidence
    ? [
        { label: isAnalystView ? 'Baseline' : 'Current setup', metrics: evidence.baseline, change: null, baseline: true },
        ...evidence.variants.map((variant) => ({
          label: variant.label,
          metrics: variant.metrics,
          change: getMetricChange(variant),
          variant,
        })),
      ]
    : [];

  const recommendedLabel = evidence?.best?.label;
  const targetMet = evidence?.target_met;
  const achievedPct = evidence?.achieved_pct;
  const bestCostDelta = evidence?.best?.delta_vs_baseline?.cost_abs;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        background: '#fff',
        border: '1px solid #ddd6fe',
        borderRadius: 14,
        padding: isExpanded ? 16 : 14,
        boxShadow: '0 2px 10px rgba(107, 77, 230, 0.08)',
      }}
    >
      {/* Target Status Banner */}
      {hasTarget && (
        <div
          data-testid="target-status-banner"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            background: targetMet ? '#f0fdf4' : '#fffbeb',
            border: `1px solid ${targetMet ? '#bbf7d0' : '#fde68a'}`,
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: isExpanded ? 13.5 : 12.5,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontWeight: 700, color: targetMet ? '#166534' : '#92400e' }}>
              Target: {target.direction === 'increase' ? '+' : '-'}{target.target_pct}% {formatPlainLanguage(target.metric?.replace('_', ' '), { isAnalystView })}
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontWeight: 700,
                  fontSize: 11,
                  background: targetMet ? '#dcfce7' : '#fef3c7',
                  color: targetMet ? '#15803d' : '#b45309',
                }}
              >
                {targetMet ? 'Target reached' : 'Best achievable'}: {achievedPct != null ? `${achievedPct}%` : '—'}
              </span>
              <span style={{ color: '#475569', fontWeight: 600 }}>
                Cost change: {bestCostDelta > 0 ? `+Rs ${bestCostDelta}` : bestCostDelta < 0 ? `-Rs ${Math.abs(bestCostDelta)}` : 'Rs 0'}
              </span>
            </div>
          </div>
          {evidence.reason && (
            <div style={{ color: '#78350f', fontSize: 12, lineHeight: 1.45 }}>
              {formatPlainLanguage(evidence.reason, { isAnalystView })}
            </div>
          )}
          {evidence.realism && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#b45309', fontSize: 11.5, fontWeight: 600 }}>
              <span>⚠️ Realism note:</span> {formatPlainLanguage(evidence.realism, { isAnalystView })}
            </div>
          )}
        </div>
      )}

      {/* No Meaningful Change Banner */}
      {(evidence?.no_meaningful_change || (evidence?.best && evidence.best.recommended === false)) && (
        <div
          data-testid="no-meaningful-change-banner"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: 10,
            padding: '10px 14px',
            color: '#92400e',
            fontSize: isExpanded ? 13.5 : 12.5,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#b45309', fontWeight: 700 }}>
            <span>⚠️ {isAnalystView ? 'No option changed your cycle time' : 'No option changed your completion time'}</span>
          </div>
          <div style={{ color: '#78350f', fontSize: 12, lineHeight: 1.45 }}>
            {formatPlainLanguage(evidence.reason || evidence.zero_wait_note || 'Nobody waits at this load; completion time is work time.', { isAnalystView })}
          </div>
        </div>
      )}

      {/* Summary Narrative */}
      <div
        style={{
          background: '#f5f3ff',
          border: '1px solid #ede9fe',
          borderRadius: 10,
          padding: '10px 14px',
          color: '#334155',
          fontSize: isExpanded ? 14 : 13,
          lineHeight: 1.55,
          fontWeight: 500,
        }}
      >
        {formatPlainLanguage(evidence?.summary, { isAnalystView })}
      </div>

      {/* Comparison Table */}
      <div
        style={{
          overflowX: 'auto',
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
        }}
      >
        <table
          style={{
            width: '100%',
            minWidth: isExpanded ? 720 : 600,
            borderCollapse: 'collapse',
            fontSize: isExpanded ? 13.5 : 12.5,
          }}
        >
          <thead>
            <tr style={{ background: '#f8fafc', color: '#475569', textAlign: 'left' }}>
              <th style={{ padding: '10px 12px' }}>Option</th>
              {isCycleTimeGoal && <th style={{ padding: '10px 8px' }}>{isAnalystView ? 'Cycle time (min)' : <Hint term="cycle_time">Completion time (min)</Hint>}</th>}
              <th style={{ padding: '10px 8px' }}>{isAnalystView ? 'Avg wait (min)' : <Hint term="bottleneck">Avg wait (min)</Hint>}</th>
              <th style={{ padding: '10px 8px' }}>{isAnalystView ? 'Change vs baseline (%)' : 'Change vs current setup (%)'}</th>
              <th style={{ padding: '10px 8px' }}>{isAnalystView ? 'Throughput' : <Hint term="throughput">Customers served / hr</Hint>}</th>
              <th style={{ padding: '10px 8px' }}>Cost for this run</th>
              <th style={{ padding: '10px 12px' }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isRowRecommended =
                !row.baseline &&
                evidence?.best?.recommended === true &&
                evidence?.no_meaningful_change !== true &&
                row.label === recommendedLabel &&
                Math.abs(row.change || 0) >= 5.0;
              const state = scenarioState[row.label] || {};
              const isCreating = Boolean(state.loading);
              const createdScenarioId = state.scenarioId;
              const hasCreated = Boolean(state.created);

              return (
                <tr
                  key={row.label}
                  style={{
                    background: isRowRecommended ? '#f0fdf4' : '#fff',
                    borderTop: '1px solid #e2e8f0',
                  }}
                >
                  <td
                    style={{
                      padding: '10px 12px',
                      fontWeight: row.baseline || isRowRecommended ? 700 : 600,
                      color: '#334155',
                    }}
                  >
                    {formatPlainLanguage(row.label, { isAnalystView })}
                    {isRowRecommended && (
                      <span
                        style={{
                          marginLeft: 6,
                          color: '#166534',
                          background: '#dcfce7',
                          borderRadius: 999,
                          padding: '2px 8px',
                          fontSize: 10.5,
                          fontWeight: 700,
                        }}
                      >
                        Recommended
                      </span>
                    )}
                  </td>
                  {isCycleTimeGoal && (
                    <td style={{ padding: '10px 8px', color: '#334155' }}>
                      {number(row.metrics?.avg_cycle_time, 1)}
                      {!row.baseline && evidence.baseline?.avg_cycle_time != null && row.metrics?.avg_cycle_time != null && (
                        (() => {
                          const delta = Number((row.metrics.avg_cycle_time - evidence.baseline.avg_cycle_time).toFixed(1));
                          if (delta === 0) return null;
                          return (
                            <span style={{ marginLeft: 4, fontSize: 11, color: delta < 0 ? '#15803d' : '#dc2626' }}>
                              ({delta > 0 ? `+${delta}` : delta})
                            </span>
                          );
                        })()
                      )}
                    </td>
                  )}
                  <td style={{ padding: '10px 8px', color: '#334155' }}>
                    {number(row.metrics?.avg_wait_time, 1)}
                    {!row.baseline && !isCycleTimeGoal && evidence.baseline?.avg_wait_time != null && row.metrics?.avg_wait_time != null && (
                      (() => {
                        const delta = Number((row.metrics.avg_wait_time - evidence.baseline.avg_wait_time).toFixed(1));
                        if (delta === 0) return null;
                        return (
                          <span style={{ marginLeft: 4, fontSize: 11, color: delta < 0 ? '#15803d' : '#dc2626' }}>
                            ({delta > 0 ? `+${delta}` : delta})
                          </span>
                        );
                      })()
                    )}
                  </td>
                  <td style={{ padding: '10px 8px', color: changeColor(row.change), fontWeight: 700 }}>
                    {row.baseline ? '—' : changeText(row.change)}
                  </td>
                  <td style={{ padding: '10px 8px', color: '#334155' }}>
                    {number(row.metrics?.throughput_per_hour, 1)}
                    {!row.baseline && evidence.baseline?.throughput_per_hour != null && row.metrics?.throughput_per_hour != null && (
                      (() => {
                        const delta = Number((row.metrics.throughput_per_hour - evidence.baseline.throughput_per_hour).toFixed(1));
                        if (delta === 0) return null;
                        return (
                          <span style={{ marginLeft: 4, fontSize: 11, color: delta > 0 ? '#15803d' : '#dc2626' }}>
                            ({delta > 0 ? `+${delta}` : delta})
                          </span>
                        );
                      })()
                    )}
                  </td>
                  <td style={{ padding: '10px 8px', color: '#334155' }}>
                    Rs {number(row.metrics?.total_cost, 1)}
                    {!row.baseline && evidence.baseline?.total_cost != null && row.metrics?.total_cost != null && (
                      (() => {
                        const delta = Number((row.metrics.total_cost - evidence.baseline.total_cost).toFixed(1));
                        if (delta === 0) return null;
                        return (
                          <span style={{ marginLeft: 4, fontSize: 11, color: delta > 0 ? '#b45309' : '#15803d' }}>
                            ({delta > 0 ? `+Rs ${delta}` : `-Rs ${Math.abs(delta)}`})
                          </span>
                        );
                      })()
                    )}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    {row.variant && (
                      hasCreated ? (
                        <button
                          type="button"
                          onClick={() => onOpenScenario(createdScenarioId)}
                          style={{
                            whiteSpace: 'nowrap',
                            border: '1px solid #bbf7d0',
                            borderRadius: 7,
                            background: '#f0fdf4',
                            color: '#166534',
                            padding: '6px 10px',
                            fontWeight: 700,
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          Scenario created · Open it
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onApplyVariant(row.variant)}
                          disabled={isCreating}
                          style={{
                            whiteSpace: 'nowrap',
                            border: '1px solid #c4b5fd',
                            borderRadius: 7,
                            background: isCreating ? '#f1f5f9' : '#f5f3ff',
                            color: isCreating ? '#94a3b8' : '#6b4de6',
                            padding: '6px 10px',
                            fontWeight: 700,
                            fontSize: 12,
                            cursor: isCreating ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {isCreating ? 'Creating…' : 'Apply as scenario'}
                        </button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ margin: 0, color: '#64748b', fontSize: 11.5 }}>
          Simulated over 300 customers, 3 runs. Results depend on run length.
        </p>
      </div>

      {/* Row-level errors if any */}
      {Object.entries(scenarioState).some(([, s]) => s?.error) && (
        <div style={{ padding: '8px 12px', borderRadius: 8, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', fontSize: 12.5 }}>
          {Object.entries(scenarioState).find(([, s]) => s?.error)?.[1]?.error}
        </div>
      )}
    </div>
  );
}
