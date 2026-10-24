'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { generateAIProcess } from '../lib/apiService';
import { layoutAiDiagram } from '../lib/aiDiagramLayout';
import ConfirmationCard from './ConfirmationCard';
import IntakeFlow from './IntakeFlow';
import { validateBpmn } from '../lib/intake/validateBpmn';
import { compileBpmn } from '../lib/intake/compileBpmn';
import {
  Sparkles, X, ExternalLink, Send, RotateCcw, ChevronDown,
  ChevronUp, CheckCircle, AlertCircle, Loader2, Copy, Check,
  Wand2, Zap, RefreshCw, MessageSquare, Plus,
} from 'lucide-react';

function makeId(type) {
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

const QUICK_PROMPTS = [
  { label: 'Loan Approval',     text: 'Create a loan approval process with credit check, manual review, and final decision.' },
  { label: 'Employee Onboarding', text: 'Model an employee onboarding process covering HR setup, IT access, and orientation.' },
  { label: 'Order Fulfillment', text: 'Design an order fulfillment flow from order placement to delivery confirmation.' },
  { label: 'Bug Triage',        text: 'Build a bug report triage workflow with severity assessment and escalation paths.' },
  { label: 'Invoice Approval',  text: 'Create an invoice approval process with three-way match and exception handling.' },
  { label: 'Refund Request',    text: 'Model a customer refund request process with fraud check and finance approval.' },
];

export function describeDiagram(elements, connections) {
  if (!elements.length) return 'The canvas is currently empty.';
  const nodes = elements.map(e => `  - ${e.type} "${e.label || e.id}"`).join('\n');
  const edges = connections.map(c => {
    const from = elements.find(e => e.id === c.fromId);
    const to   = elements.find(e => e.id === c.toId);
    return `  - ${from?.label || c.fromId} → ${to?.label || c.toId}${c.label ? ` [${c.label}]` : ''}`;
  }).join('\n');
  return `Current diagram:\nNodes:\n${nodes}\nConnections:\n${edges}`;
}

function MessageBubble({ msg, onApply, onConfirmApply, onCopy, copied }) {
  const [open, setOpen] = useState(true);
  const isUser = msg.role === 'user';

  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <div style={{
          maxWidth: '82%',
          background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
          color: '#fff',
          borderRadius: '16px 16px 4px 16px',
          padding: '10px 14px',
          fontSize: 13,
          lineHeight: 1.5,
        }}>
          {msg.content}
        </div>
      </div>
    );
  }

  const hasDiagram = !!msg.diagram;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0, marginTop: 2,
        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Sparkles size={13} color="#fff" />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {msg.text && (
          <div style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '4px 16px 16px 16px',
            padding: '10px 14px',
            fontSize: 13,
            lineHeight: 1.6,
            color: '#111827',
            marginBottom: hasDiagram ? 8 : 0,
          }}>
            {msg.text}
          </div>
        )}

        {msg.loading && (
          <div style={{
            background: '#f9fafb', border: '1px solid #e5e7eb',
            borderRadius: '4px 16px 16px 16px', padding: '12px 16px',
            display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#6b7280',
          }}>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
            <span>{msg.loadingText || 'Thinking…'}</span>
          </div>
        )}

        {hasDiagram && (
          <div style={{
            border: '1px solid #e0e7ff',
            borderRadius: 12,
            background: '#f5f3ff',
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 12px', background: '#ede9fe', borderBottom: '1px solid #ddd6fe',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Wand2 size={13} color="#6d28d9" />
                <span style={{ fontSize: 12, fontWeight: 600, color: '#5b21b6' }}>
                  Generated diagram — {msg.diagram.nodes?.length || 0} nodes
                </span>
              </div>
              <button
                onClick={() => setOpen(o => !o)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#7c3aed' }}>
                {open ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
              </button>
            </div>

            {open && (
              <>
                <DiagramPreview nodes={msg.diagram.nodes} connections={msg.diagram.connections} />

                {msg.validationErrors && msg.validationErrors.length > 0 && (
                  <div style={{
                    margin: '8px 10px', padding: '8px 10px',
                    background: '#fef2f2', border: '1px solid #fecaca',
                    borderRadius: 8, fontSize: 11.5, color: '#b91c1c',
                  }}>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                      <AlertCircle size={13} /> Cannot apply to canvas:
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {msg.validationErrors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {msg.repairs && msg.repairs.length > 0 && (
                  <div style={{
                    margin: '8px 10px', padding: '8px 10px',
                    background: '#eff6ff', border: '1px solid #bfdbfe',
                    borderRadius: 8, fontSize: 11.5, color: '#1e40af',
                  }}>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                      <CheckCircle size={13} /> Assumptions & Auto-repairs:
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {msg.repairs.map((r, i) => (
                        <li key={i}>{r.description || r}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {msg.confirmations ? (
                  <div style={{ padding: '8px 10px 10px', borderTop: '1px solid #ddd6fe', background: '#f5f3ff' }}>
                    <ConfirmationCard
                      diagram={msg.rawDiagram}
                      confirmations={msg.confirmations}
                      onConfirm={onConfirmApply}
                    />
                  </div>
                ) : (
                  <div style={{
                    display: 'flex', gap: 6, padding: '8px 10px',
                    borderTop: '1px solid #ddd6fe', background: '#f5f3ff',
                  }}>
                    <button
                      onClick={() => onApply(msg.diagram, msg.rawDiagram)}
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: 6, padding: '7px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                        background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                        color: '#fff', fontSize: 12, fontWeight: 600,
                      }}>
                      <CheckCircle size={13}/> Apply to canvas
                    </button>
                    <button
                      onClick={() => onCopy(JSON.stringify(msg.diagram, null, 2))}
                      title="Copy JSON"
                      style={{
                        padding: '7px 10px', borderRadius: 8, border: '1px solid #ddd6fe',
                        background: '#fff', cursor: 'pointer', color: '#6d28d9', fontSize: 12,
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                      {copied ? <Check size={13}/> : <Copy size={13}/>}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {msg.error && (
          <div style={{
            display: 'flex', gap: 8, alignItems: 'flex-start',
            background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: 10, padding: '8px 12px', fontSize: 12, color: '#b91c1c',
          }}>
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{msg.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

import DiagramPreview from '../components/model/DiagramPreview';
export { DiagramPreview };

import { GUIDED_STORAGE_KEY, getInitialGuidedState } from '../lib/intake/guidedState';
export { GUIDED_STORAGE_KEY, getInitialGuidedState };

export default function AiPanel({ open, onClose, elements = [], connections = [], onApplyDiagram }) {
  const [mode,        setMode]       = useState('guided'); // 'guided' | 'chat'
  const [messages,   setMessages]   = useState([]);
  const [input,      setInput]      = useState('');
  const [loading,    setLoading]    = useState(false);
  const [copiedId,   setCopiedId]   = useState(null);
  const [showQuick,  setShowQuick]  = useState(true);
  const [contextOn,  setContextOn]  = useState(true);
  const [lastDiagram, setLastDiagram] = useState(null); // most recent generated diagram, applied or not
  const bottomRef    = useRef(null);
  const textareaRef  = useRef(null);

  // Lifted guided state (MODULE I2e Single Source of Truth)
  const [guidedState, setGuidedState] = useState(getInitialGuidedState);

  // Sync guided state to sessionStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const isDefault =
          guidedState.currentStep === 1 &&
          (!guidedState.flowText || !guidedState.flowText.trim()) &&
          !guidedState.rawDiagram &&
          (!guidedState.keptSteps || guidedState.keptSteps.length === 0) &&
          !guidedState.answers;
        if (isDefault) {
          sessionStorage.removeItem(GUIDED_STORAGE_KEY);
        } else {
          sessionStorage.setItem(GUIDED_STORAGE_KEY, JSON.stringify(guidedState));
        }
      } catch (e) {
        console.warn('Could not persist guided state to sessionStorage:', e);
      }
    }
  }, [guidedState]);

  const updateGuidedState = useCallback((patchOrFn) => {
    setGuidedState((prev) => {
      const patch = typeof patchOrFn === 'function' ? patchOrFn(prev) : patchOrFn;
      return { ...prev, ...patch };
    });
  }, []);

  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Unsaved draft check across Guided and Chat modes
  const hasUnsavedDraft = Boolean(
    guidedState.flowText?.trim() ||
    guidedState.rawDiagram ||
    (guidedState.answers && Object.keys(guidedState.answers).length > 0) ||
    (guidedState.keptSteps && guidedState.keptSteps.length > 0) ||
    guidedState.currentStep > 1 ||
    messages.length > 0 ||
    input?.trim()
  );

  const executeReset = useCallback(() => {
    // Reset flowText, rawDiagram, kept steps, answers, step index, validation state
    setGuidedState({
      flowText: '',
      rawDiagram: null,
      version: 1,
      keptSteps: [],
      answers: null,
      currentStep: 1,
      validationResult: { errors: [], repairs: [] },
    });

    // Clear the sessionStorage copy
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem(GUIDED_STORAGE_KEY);
      } catch (e) {
        console.warn('Could not clear guided state from sessionStorage:', e);
      }
    }

    // Reset chat history and input
    setMessages([]);
    setInput('');
    setLastDiagram(null);

    // Return to the first guided screen
    setMode('guided');
    setShowDiscardConfirm(false);
  }, []);

  const handleRequestReset = useCallback(() => {
    if (hasUnsavedDraft) {
      setShowDiscardConfirm(true);
    } else {
      executeReset();
    }
  }, [hasUnsavedDraft, executeReset]);

  const handleSwitchToChat = useCallback(({ rawDiagram, layout, text, summary } = {}) => {
    const targetRaw = rawDiagram || guidedState.rawDiagram;
    const targetLayout = layout || (targetRaw ? layoutAiDiagram(targetRaw) : null);
    if (targetLayout) {
      setLastDiagram({ elements: targetLayout.elements, connections: targetLayout.connections });
    }
    setContextOn(true);
    if (targetRaw || targetLayout) {
      setMessages(prev => [
        ...prev,
        {
          id: Date.now(),
          role: 'assistant',
          text: summary || targetRaw?.summary || 'Here is the process generated from your intake description. What would you like to adjust or fix?',
          diagram: {
            nodes: targetLayout?.elements || [],
            connections: targetLayout?.connections || [],
            resources: targetLayout?.resources || targetRaw?.resources || [],
          },
          rawDiagram: targetRaw,
        },
      ]);
    }
    setMode('chat');
  }, [guidedState.rawDiagram]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleCopy = useCallback((text) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(text.slice(0, 20));
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleApply = useCallback((diagram, rawDiagram = null, passedRepairs = []) => {
    const raw = rawDiagram || diagram;
    const validation = validateBpmn(raw);

    if (validation.errors && validation.errors.length > 0) {
      setMessages(prev => prev.map(m =>
        (m.diagram === diagram || m.rawDiagram === raw)
          ? { ...m, validationErrors: validation.errors }
          : m
      ));
      return;
    }

    const finalRepairs = (validation.repairs && validation.repairs.length > 0) ? validation.repairs : passedRepairs;
    const finalDiagram = (validation.repairs && validation.repairs.length > 0)
      ? layoutAiDiagram(validation.repaired)
      : diagram;

    setMessages(prev => prev.map(m =>
      (m.diagram === diagram || m.rawDiagram === raw)
        ? { ...m, validationErrors: null, repairs: finalRepairs }
        : m
    ));

    if (!onApplyDiagram) return;
    const nodes = finalDiagram.elements || finalDiagram.nodes;
    const conns = finalDiagram.connections;
    const res = finalDiagram.resources;
    if (nodes) {
      onApplyDiagram(nodes, conns, res);
    }
  }, [onApplyDiagram]);

  // Called from ConfirmationCard once the person confirms/edits assumed
  // fields — patchedRawDiagram already has their values baked in, so we
  // just lay it out fresh and apply it, same as a normal Apply.
  const handleConfirmApply = useCallback((patchedRawDiagram, passedRepairs = []) => {
    const validation = validateBpmn(patchedRawDiagram);
    if (validation.errors && validation.errors.length > 0) {
      setMessages(prev => prev.map(m =>
        m.rawDiagram === patchedRawDiagram
          ? { ...m, validationErrors: validation.errors }
          : m
      ));
      return;
    }

    const finalDiagram = validation.repaired || patchedRawDiagram;
    const finalRepairs = (validation.repairs && validation.repairs.length > 0) ? validation.repairs : passedRepairs;
    const layout = layoutAiDiagram(finalDiagram);

    setMessages(prev => prev.map(m =>
      m.rawDiagram === patchedRawDiagram
        ? { ...m, validationErrors: null, repairs: finalRepairs }
        : m
    ));

    if (onApplyDiagram) {
      onApplyDiagram(layout.elements, layout.connections, layout.resources);
    }
  }, [onApplyDiagram]);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loading) return;
    setInput('');
    setShowQuick(false);

    const userMsg = { id: Date.now(), role: 'user', content: text };
    const loadingMsg = {
      id: Date.now() + 1, role: 'assistant', loading: true,
      loadingText: 'Generating diagram…',
    };

    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setLoading(true);

    // Keep history lightweight — full diagram context is re-attached fresh on
    // every turn via `description` below, so history doesn't need to repeat it
    // (repeating it each turn was ballooning the payload and breaking after a
    // few messages).
    const history = messages
      .filter(m => !m.loading)
      .slice(-12) // bound payload size on long conversations
      .map(m => ({
        role: m.role,
        content: m.role === 'user' ? m.content : (m.text || 'Diagram generated — see current canvas.'),
      }));

    // Prefer the live canvas (post-Apply) if it has content; otherwise fall
    // back to the last diagram this chat generated but the user hasn't
    // applied yet — so follow-up refinements work either way.
    const activeElements = elements.length > 0 ? elements : (lastDiagram?.elements || []);
    const activeConnections = elements.length > 0 ? connections : (lastDiagram?.connections || []);

    const description = contextOn && activeElements.length > 0
      ? `${text}\n\n---\nCurrent diagram (modify this unless the user is clearly asking to start over):\n${describeDiagram(activeElements, activeConnections)}`
      : text;

    try {
      const result = await generateAIProcess(description, history);

      if (result.type === 'clarification') {
        setMessages(prev => prev.map(m =>
          m.id === loadingMsg.id
            ? { ...m, loading: false, text: result.question, diagram: null }
            : m
        ));
        return;
      }

      if (result.type === 'needs_confirmation') {
        let diag = result.diagram;
        if (diag && (diag.type === 'spec' || (!diag.nodes && diag.pools))) {
          diag = compileBpmn(diag);
          result.diagram = diag;
        }
        const previewLayout = layoutAiDiagram(diag);
        setLastDiagram({ elements: previewLayout.elements, connections: previewLayout.connections });
        const val = validateBpmn(diag);
        updateGuidedState(prev => ({
          rawDiagram: val.repaired || diag,
          version: (prev.version || 1) + 1,
          validationResult: val,
        }));
        setMessages(prev => prev.map(m =>
          m.id === loadingMsg.id
            ? {
                ...m,
                loading: false,
                text: diag.summary || null,
                diagram: { nodes: previewLayout.elements, connections: previewLayout.connections, resources: previewLayout.resources },
                rawDiagram: diag,
                confirmations: result.confirmations,
              }
            : m
        ));
        return;
      }

      let diagResult = result;
      if (diagResult && (diagResult.type === 'spec' || (!diagResult.nodes && diagResult.pools))) {
        diagResult = compileBpmn(diagResult);
      }
      const layout = layoutAiDiagram(diagResult);
      setLastDiagram({ elements: layout.elements, connections: layout.connections });
      const val = validateBpmn(diagResult);
      updateGuidedState(prev => ({
        rawDiagram: val.repaired || diagResult,
        version: (prev.version || 1) + 1,
        validationResult: val,
      }));
      setMessages(prev => prev.map(m =>
        m.id === loadingMsg.id
          ? {
              ...m,
              loading: false,
              text: diagResult.summary || null,
              diagram: { nodes: layout.elements, connections: layout.connections, resources: layout.resources },
              rawDiagram: diagResult,
            }
          : m
      ));
    } catch (err) {
      setMessages(prev => prev.map(m =>
        m.id === loadingMsg.id
          ? { ...m, loading: false, error: `Request failed: ${err.message}` }
          : m
      ));
    } finally {
      setLoading(false);
    }
  }, [loading, messages, elements, connections, contextOn, lastDiagram]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setShowQuick(true);
  };

  if (!open) return null;

  return (
    <aside style={{
      width: 380, flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      borderRadius: 16, overflow: 'hidden',
      border: '1px solid #e5e7eb',
      background: '#fff',
      boxShadow: '0 4px 24px rgba(99,102,241,0.1)',
      position: 'relative',
    }}>

      <div style={{
        flexShrink: 0,
        background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
        borderBottom: '1px solid rgba(255,255,255,0.12)',
      }}>
        {/* Title bar */}
        <div style={{
          padding: '10px 14px 6px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: 'rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Sparkles size={15} color="#fff"/>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>AI Assistant</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', marginTop: 1 }}>
                {mode === 'guided' ? 'Guided intake · step-by-step' : (loading ? 'Generating…' : 'SPOT AI · BPMN + resources')}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {mode === 'chat' && (
              <>
                <button
                  onClick={() => setContextOn(o => !o)}
                  title={contextOn ? 'Diagram context ON — click to disable' : 'Diagram context OFF — click to enable'}
                  style={{
                    padding: '3px 7px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: contextOn ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)',
                    color: contextOn ? '#fff' : 'rgba(255,255,255,0.5)',
                    fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3,
                  }}>
                  <Zap size={10}/> {contextOn ? 'Context' : 'No ctx'}
                </button>
                {messages.length > 0 && (
                  <button onClick={clearChat} title="Clear chat"
                    style={{
                      padding: 5, borderRadius: 6, border: 'none', cursor: 'pointer',
                      background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)',
                      display: 'flex', alignItems: 'center',
                    }}>
                    <RotateCcw size={13}/>
                  </button>
                )}
              </>
            )}
            <button onClick={onClose} title="Close"
              style={{
                padding: 5, borderRadius: 6, border: 'none', cursor: 'pointer',
                background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)',
                display: 'flex', alignItems: 'center',
              }}>
              <X size={14}/>
            </button>
          </div>
        </div>

        {/* Guided | Chat Toggle Row + Persistent New Button */}
        <div style={{ padding: '2px 14px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            display: 'flex',
            flex: 1,
            background: 'rgba(0,0,0,0.18)',
            borderRadius: 8,
            padding: 2,
            gap: 2,
          }}>
            <button
              type="button"
              onClick={() => setMode('guided')}
              style={{
                flex: 1,
                padding: '4px 0',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                fontSize: 11.5,
                fontWeight: 600,
                background: mode === 'guided' ? '#fff' : 'transparent',
                color: mode === 'guided' ? '#4f46e5' : 'rgba(255,255,255,0.85)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                transition: 'all 0.15s ease',
              }}
            >
              <Sparkles size={12} color={mode === 'guided' ? '#4f46e5' : 'rgba(255,255,255,0.85)'} />
              Guided
            </button>
            <button
              type="button"
              onClick={() => setMode('chat')}
              style={{
                flex: 1,
                padding: '4px 0',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                fontSize: 11.5,
                fontWeight: 600,
                background: mode === 'chat' ? '#fff' : 'transparent',
                color: mode === 'chat' ? '#4f46e5' : 'rgba(255,255,255,0.85)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                transition: 'all 0.15s ease',
              }}
            >
              <MessageSquare size={12} color={mode === 'chat' ? '#4f46e5' : 'rgba(255,255,255,0.85)'} />
              Chat
            </button>
          </div>

          {/* Persistent "New" / "New chat" button */}
          <button
            type="button"
            onClick={handleRequestReset}
            title={mode === 'chat' ? 'New chat' : 'Start new guided draft'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '5px 10px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.25)',
              background: 'rgba(255,255,255,0.18)',
              color: '#fff',
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.28)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.18)'}
          >
            <Plus size={13} strokeWidth={2.5} />
            <span>{mode === 'chat' ? 'New chat' : 'New'}</span>
          </button>
        </div>
      </div>

      {/* Guided mode container - always mounted */}
      <div
        style={{
          display: mode === 'guided' ? 'flex' : 'none',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <IntakeFlow
          state={guidedState}
          updateState={updateGuidedState}
          onStartOver={handleRequestReset}
          onSwitchToChat={handleSwitchToChat}
          onApplyDiagram={onApplyDiagram}
          onConfirmApply={handleConfirmApply}
        />
      </div>

      {/* Chat mode container - always mounted */}
      <div
        style={{
          display: mode === 'chat' ? 'flex' : 'none',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
          <div style={{
        flex: 1, overflowY: 'auto', padding: '16px 14px',
        display: 'flex', flexDirection: 'column', gap: 14,
        background: 'linear-gradient(180deg, #fafafa 0%, #fff 100%)',
      }}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2,
            }}>
              <Sparkles size={13} color="#fff"/>
            </div>
            <div style={{
              background: '#fff', border: '1px solid #e5e7eb',
              borderRadius: '4px 16px 16px 16px',
              padding: '12px 14px', flex: 1,
            }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 4 }}>
                Hi! I'm your SPOT AI assistant.
              </p>
              <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.55, marginBottom: 12 }}>
                Describe a business process and I'll generate a BPMN diagram instantly.
                I can also modify your current diagram — just ask.
              </p>
              {elements.length > 0 && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 10px', borderRadius: 8,
                  background: '#f0fdf4', border: '1px solid #bbf7d0',
                  fontSize: 11, color: '#15803d', marginBottom: 10,
                }}>
                  <CheckCircle size={12}/>
                  <span>Reading your current diagram ({elements.length} nodes)</span>
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {QUICK_PROMPTS.map(q => (
                  <button key={q.label}
                    onClick={() => sendMessage(q.text)}
                    style={{
                      padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
                      fontSize: 11, fontWeight: 500,
                      background: '#f5f3ff', color: '#6d28d9',
                      border: '1px solid #ddd6fe',
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#ede9fe'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#f5f3ff'; }}>
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            onApply={handleApply}
            onConfirmApply={handleConfirmApply}
            onCopy={handleCopy}
            copied={copiedId !== null}
          />
        ))}

        {messages.length > 0 && !loading && !showQuick && (
          <button
            onClick={() => setShowQuick(true)}
            style={{
              alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 12px', borderRadius: 20, border: '1px solid #e0e7ff',
              background: '#f5f3ff', color: '#6d28d9', fontSize: 11, cursor: 'pointer',
            }}>
            <MessageSquare size={11}/> Quick prompts
          </button>
        )}

        {showQuick && messages.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingLeft: 38 }}>
            {QUICK_PROMPTS.map(q => (
              <button key={q.label}
                onClick={() => { setShowQuick(false); sendMessage(q.text); }}
                style={{
                  padding: '3px 9px', borderRadius: 20, cursor: 'pointer',
                  fontSize: 11, fontWeight: 500,
                  background: '#f5f3ff', color: '#6d28d9',
                  border: '1px solid #ddd6fe',
                }}>
                {q.label}
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef}/>
      </div>

      <div style={{
        flexShrink: 0, padding: '10px 12px 12px',
        borderTop: '1px solid #f3f4f6', background: '#fff',
      }}>
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 8,
          border: '1.5px solid #e0e7ff',
          borderRadius: 12, padding: '8px 10px',
          background: '#fafafa',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
          onFocusCapture={e => {
            e.currentTarget.style.borderColor = '#818cf8';
            e.currentTarget.style.boxShadow = '0 0 0 3px rgba(129,140,248,0.15)';
            e.currentTarget.style.background = '#fff';
          }}
          onBlurCapture={e => {
            e.currentTarget.style.borderColor = '#e0e7ff';
            e.currentTarget.style.boxShadow = 'none';
            e.currentTarget.style.background = '#fafafa';
          }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe a process or ask to modify the diagram…"
            rows={1}
            disabled={loading}
            style={{
              flex: 1, fontSize: 13, lineHeight: 1.5, background: 'transparent',
              border: 'none', outline: 'none', resize: 'none',
              maxHeight: 100, overflowY: 'auto', color: '#111827',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            style={{
              width: 32, height: 32, borderRadius: 8, border: 'none',
              background: !input.trim() || loading
                ? '#e0e7ff'
                : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
              cursor: !input.trim() || loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, transition: 'all 0.15s',
            }}>
            {loading
              ? <Loader2 size={14} color="#818cf8" style={{ animation: 'spin 1s linear infinite' }}/>
              : <Send size={14} color={!input.trim() ? '#a5b4fc' : '#fff'}/>
            }
          </button>
        </div>
        <p style={{ fontSize: 10, color: '#9ca3af', textAlign: 'center', marginTop: 6 }}>
          ↵ send · Shift+↵ newline · AI may make mistakes — review carefully
        </p>
      </div>
      </div>

      {/* Discard Draft Confirmation Dialog */}
      {showDiscardConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="discard-draft-title"
          data-testid="discard-confirm-modal"
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            zIndex: 100,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 14,
              padding: '22px 20px',
              width: '100%',
              maxWidth: 310,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
              border: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              textAlign: 'center',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: '50%',
                  background: '#fef2f2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#dc2626',
                }}
              >
                <AlertCircle size={22} strokeWidth={2.2} />
              </div>
              <div
                id="discard-draft-title"
                style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', lineHeight: 1.35 }}
              >
                Discard this draft and start over?
              </div>
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.45 }}>
                Your current intake inputs and chat history will be discarded. This will not affect the canvas.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button
                type="button"
                data-testid="modal-keep-working-btn"
                onClick={() => setShowDiscardConfirm(false)}
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                  color: '#334155',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'background 0.15s, border-color 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#f8fafc';
                  e.currentTarget.style.borderColor = '#94a3b8';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#fff';
                  e.currentTarget.style.borderColor = '#cbd5e1';
                }}
              >
                Keep working
              </button>
              <button
                type="button"
                data-testid="modal-discard-btn"
                onClick={executeReset}
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#dc2626',
                  color: '#fff',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#b91c1c'}
                onMouseLeave={e => e.currentTarget.style.background = '#dc2626'}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </aside>
  );
}