import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { generateAIProcess } from '../lib/apiService';
import { layoutAiDiagram } from '../lib/aiDiagramLayout';
import { DiagramPreview } from './AiPanel';
import ProcessStepList from '../components/model/ProcessStepList';
import { validateBpmn } from '../lib/intake/validateBpmn';
import { compileBpmn } from '../lib/intake/compileBpmn';
import IntakeScreens from './IntakeScreens';
import { applyIntakeToRawDiagram } from '../lib/intake/applyIntake';
import ConfirmationCard from './ConfirmationCard';
import {
  Sparkles,
  Wand2,
  CheckCircle,
  AlertCircle,
  Loader2,
  MessageSquare,
  RotateCcw,
  ArrowRight,
  ArrowLeft,
  HelpCircle,
  Check,
  Trash2,
  Play,
  Users,
  Clock,
  Flame,
  Building,
  Target,
  Sliders,
} from 'lucide-react';

const EXAMPLE_DESCRIPTIONS = [
  {
    label: 'Coffee Shop',
    text: 'Customer orders and pays at counter, barista prepares espresso drink, customer picks up drink at collection window.',
  },
  {
    label: 'Clinic Visit',
    text: 'Patient checks in with receptionist, nurse measures vital signs, doctor examines patient, patient collects prescription at front desk.',
  },
  {
    label: 'Order Delivery',
    text: 'Customer places online order, warehouse staff packs the parcel, courier delivers order to customer address.',
  },
];

/**
 * IntakeFlow: Guided mode for non-technical business owners.
 *
 * Step 1:
 *  - Large prompt textarea ("Describe what happens from the moment a customer arrives until they leave")
 *  - "Show me my process" button calling generateAIProcess
 *  - Reuses DiagramPreview
 *  - Clarification response handled in a friendly chat bubble
 *  - "Is this right?" with Confirm and "Fix it" (Fix it switches to Chat mode with diagram context)
 *  - Confirm stores rawDiagram in intake state and advances to next step
 *  - Loading, error, and empty states included
 */
export default function IntakeFlow({
  state,
  updateState,
  onStartOver,
  onSwitchToChat,
  onApplyDiagram,
  onConfirmApply,
}) {
  const [localStep, setLocalStep] = useState(1);
  const [localDescription, setLocalDescription] = useState('');
  const [localRawDiagram, setLocalRawDiagram] = useState(null);
  const [localVersion, setLocalVersion] = useState(1);
  const [localKeptSteps, setLocalKeptSteps] = useState([]);
  const [localAnswers, setLocalAnswers] = useState(null);
  const [localValidation, setLocalValidation] = useState({ errors: [], repairs: [] });

  const step = state?.currentStep !== undefined ? state.currentStep : localStep;
  const description = state?.flowText !== undefined ? state.flowText : localDescription;
  const rawDiagram = state?.rawDiagram !== undefined ? state.rawDiagram : localRawDiagram;
  const version = state?.version !== undefined ? state.version : localVersion;
  const keptSteps = state?.keptSteps !== undefined ? state.keptSteps : localKeptSteps;
  const intakeAnswers = state?.answers !== undefined ? state.answers : localAnswers;
  const validationErrors = state?.validationResult?.errors || localValidation?.errors || [];
  const assumptions = state?.validationResult?.repairs || localValidation?.repairs || [];

  const updateGuided = useCallback((patchOrFn) => {
    if (updateState) {
      updateState(patchOrFn);
    } else {
      if (typeof patchOrFn === 'function') {
        const patch = patchOrFn({
          currentStep: localStep,
          flowText: localDescription,
          rawDiagram: localRawDiagram,
          version: localVersion,
          keptSteps: localKeptSteps,
          answers: localAnswers,
          validationResult: localValidation,
        });
        if (patch.currentStep !== undefined) setLocalStep(patch.currentStep);
        if (patch.flowText !== undefined) setLocalDescription(patch.flowText);
        if (patch.rawDiagram !== undefined) setLocalRawDiagram(patch.rawDiagram);
        if (patch.version !== undefined) setLocalVersion(patch.version);
        if (patch.keptSteps !== undefined) setLocalKeptSteps(patch.keptSteps);
        if (patch.answers !== undefined) setLocalAnswers(patch.answers);
        if (patch.validationResult !== undefined) setLocalValidation(patch.validationResult);
      } else {
        if (patchOrFn.currentStep !== undefined) setLocalStep(patchOrFn.currentStep);
        if (patchOrFn.flowText !== undefined) setLocalDescription(patchOrFn.flowText);
        if (patchOrFn.rawDiagram !== undefined) setLocalRawDiagram(patchOrFn.rawDiagram);
        if (patchOrFn.version !== undefined) setLocalVersion(patchOrFn.version);
        if (patchOrFn.keptSteps !== undefined) setLocalKeptSteps(patchOrFn.keptSteps);
        if (patchOrFn.answers !== undefined) setLocalAnswers(patchOrFn.answers);
        if (patchOrFn.validationResult !== undefined) setLocalValidation(patchOrFn.validationResult);
      }
    }
  }, [updateState, localStep, localDescription, localRawDiagram, localVersion, localKeptSteps, localAnswers, localValidation]);

  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('Analyzing your process…');
  const [error, setError] = useState(null);

  // Synchronously compute layout whenever rawDiagram or version changes
  const layout = useMemo(() => {
    if (!rawDiagram) return null;
    return layoutAiDiagram(rawDiagram);
  }, [rawDiagram, version]);

  // Clarification state
  const [clarification, setClarification] = useState(null);
  const [clarificationHistory, setClarificationHistory] = useState([]);
  const [clarificationAnswer, setClarificationAnswer] = useState('');

  // Confirmed state (saved on Confirm)
  const [confirmedData, setConfirmedData] = useState(null);
  const [simulationReadyData, setSimulationReadyData] = useState(null);
  const [inlineCorrection, setInlineCorrection] = useState('');

  // Reset local flow state when guided state is reset to clean step 1
  useEffect(() => {
    if (step === 1 && (!description || !description.trim()) && !rawDiagram) {
      setClarification(null);
      setClarificationHistory([]);
      setClarificationAnswer('');
      setError(null);
      setConfirmedData(null);
      setSimulationReadyData(null);
      setInlineCorrection('');
    }
  }, [step, description, rawDiagram]);

  const handleGenerate = useCallback(
    async (textToSubmit, history = []) => {
      const prompt = textToSubmit || description;
      if (!prompt.trim() || loading) return;

      setLoading(true);
      setError(null);
      setClarification(null);
      setLoadingText('Spot AI is mapping your process…');

      try {
        const result = await generateAIProcess(prompt.trim(), history);

        if (result.type === 'clarification') {
          setClarification(result.question);
          setClarificationHistory([
            ...history,
            { role: 'user', content: prompt.trim() },
            { role: 'assistant', content: result.question },
          ]);
          return;
        }

        // Needs confirmation or standard diagram
        let raw = result.type === 'needs_confirmation' ? result.diagram : result;
        if (raw && (raw.type === 'spec' || (!raw.nodes && raw.pools))) {
          raw = compileBpmn(raw);
        }
        const validation = validateBpmn(raw);
        const finalRaw = validation.repaired || raw;

        updateGuided((prev) => ({
          rawDiagram: finalRaw,
          version: (prev.version || 1) + 1,
          validationResult: validation,
          currentStep: 1,
        }));
        setClarification(null);
      } catch (err) {
        console.error('Intake generation error:', err);
        setError(err.message || 'Unable to generate process. Please check your network or try again.');
      } finally {
        setLoading(false);
      }
    },
    [description, loading, updateGuided]
  );

  const handleClarificationSubmit = useCallback(async () => {
    if (!clarificationAnswer.trim() || loading) return;

    const answer = clarificationAnswer.trim();
    setClarificationAnswer('');
    const updatedHistory = [
      ...clarificationHistory,
      { role: 'user', content: answer },
    ];
    setClarificationHistory(updatedHistory);

    const combinedPrompt = `${description}\nAdditional details: ${answer}`;
    await handleGenerate(combinedPrompt, updatedHistory);
  }, [clarificationAnswer, clarificationHistory, description, handleGenerate, loading]);

  const handleInlineCorrectionSubmit = useCallback(async (customText) => {
    const correction = (typeof customText === 'string' ? customText : inlineCorrection).trim();
    if (!correction || loading || !rawDiagram) return;

    setLoading(true);
    setError(null);
    setClarification(null);
    setLoadingText('Updating your process with your changes…');

    try {
      const correctionPrompt = `Current process diagram:\n${JSON.stringify(rawDiagram, null, 2)}\n\nWhat should change:\n${correction}`;
      const result = await generateAIProcess(correctionPrompt, clarificationHistory);

      if (result.type === 'clarification') {
        setClarification(result.question);
        setClarificationHistory((prev) => [
          ...prev,
          { role: 'user', content: correction },
          { role: 'assistant', content: result.question },
        ]);
        return;
      }

      let raw = result.type === 'needs_confirmation' ? result.diagram : result;
      if (raw && (raw.type === 'spec' || (!raw.nodes && raw.pools))) {
        raw = compileBpmn(raw);
      }
      const validation = validateBpmn(raw);
      const finalRaw = validation.repaired || raw;

      updateGuided((prev) => ({
        rawDiagram: finalRaw,
        version: (prev.version || 1) + 1,
        validationResult: validation,
      }));

      setInlineCorrection('');
    } catch (err) {
      console.error('Correction update error:', err);
      setError(err.message || 'Unable to update process diagram.');
    } finally {
      setLoading(false);
    }
  }, [inlineCorrection, loading, rawDiagram, clarificationHistory, updateGuided]);

  const handleSwitchToChatClick = useCallback(() => {
    if (!onSwitchToChat) return;
    onSwitchToChat({
      rawDiagram,
      layout,
      text: description,
      summary: rawDiagram?.summary,
    });
  }, [onSwitchToChat, rawDiagram, layout, description]);

  const handleRemoveInferred = useCallback((nodeId) => {
    if (!rawDiagram) return;
    const deep = JSON.parse(JSON.stringify(rawDiagram));
    const edges = Array.isArray(deep.edges) ? deep.edges : (Array.isArray(deep.connections) ? deep.connections : []);

    const inEdges = edges.filter(e => (e.target || e.toId) === nodeId);
    const outEdges = edges.filter(e => (e.source || e.fromId) === nodeId);

    const newEdges = edges.filter(e => (e.source || e.fromId) !== nodeId && (e.target || e.toId) !== nodeId);

    inEdges.forEach((inE, inIdx) => {
      outEdges.forEach((outE, outIdx) => {
        const src = inE.source || inE.fromId;
        const tgt = outE.target || outE.toId;
        if (src && tgt && src !== tgt) {
          newEdges.push({
            id: `edge_reconnect_${src}_${tgt}_${Date.now()}_${inIdx}_${outIdx}`,
            source: src,
            target: tgt,
            flowType: inE.flowType || outE.flowType || 'sequence',
            data: { ...(inE.data || {}), ...(outE.data || {}) },
          });
        }
      });
    });

    deep.nodes = (deep.nodes || []).filter(n => n.id !== nodeId);
    deep.edges = newEdges;

    const validation = validateBpmn(deep);
    const finalRaw = validation.repaired || deep;

    updateGuided(prev => ({
      rawDiagram: finalRaw,
      version: (prev.version || 1) + 1,
      validationResult: validation,
      keptSteps: (prev.keptSteps || []).filter(id => id !== nodeId),
    }));
  }, [rawDiagram, updateGuided]);

  const handleKeepInferred = useCallback((nodeId) => {
    if (!rawDiagram) return;
    const deep = JSON.parse(JSON.stringify(rawDiagram));
    deep.nodes = (deep.nodes || []).map(n => {
      if (n.id === nodeId) {
        return {
          ...n,
          kept: true,
          data: {
            ...n.data,
            kept: true,
            duration: 0,
            duration_min: null,
            duration_max: null,
            resources: {},
            resource: null,
          },
        };
      }
      return n;
    });

    const validation = validateBpmn(deep);
    const finalRaw = validation.repaired || deep;

    updateGuided(prev => ({
      rawDiagram: finalRaw,
      version: (prev.version || 1) + 1,
      validationResult: validation,
      keptSteps: [...new Set([...(prev.keptSteps || []), nodeId])],
    }));
  }, [rawDiagram, updateGuided]);

  const handleConfirm = useCallback(() => {
    if (!rawDiagram) return;

    // Validate BPMN before applying
    const validation = validateBpmn(rawDiagram);
    if (validation.errors && validation.errors.length > 0) {
      updateGuided({ validationResult: validation });
      return;
    }

    const finalRaw = validation.repaired || rawDiagram;
    const finalLayout = layoutAiDiagram(finalRaw);

    const confirmedPayload = {
      rawDiagram: finalRaw,
      layout: finalLayout,
      description,
      repairs: validation.repairs || [],
      confirmedAt: new Date().toISOString(),
    };
    setConfirmedData(confirmedPayload);

    if (onApplyDiagram && finalLayout) {
      onApplyDiagram(finalLayout.elements, finalLayout.connections, finalLayout.resources);
    }

    updateGuided({
      rawDiagram: finalRaw,
      validationResult: validation,
      currentStep: 2,
    });
  }, [rawDiagram, description, onApplyDiagram, updateGuided]);

  const handleApplyAutoRepair = useCallback(() => {
    if (!rawDiagram) return;
    const validation = validateBpmn(rawDiagram);
    if (validation.repaired) {
      const repairedLayout = layoutAiDiagram(validation.repaired);
      const confirmedPayload = {
        rawDiagram: validation.repaired,
        layout: repairedLayout,
        description,
        repairs: validation.repairs || [],
        confirmedAt: new Date().toISOString(),
      };
      setConfirmedData(confirmedPayload);

      if (onApplyDiagram && repairedLayout) {
        onApplyDiagram(repairedLayout.elements, repairedLayout.connections, repairedLayout.resources);
      }

      updateGuided(prev => ({
        rawDiagram: validation.repaired,
        version: (prev.version || 1) + 1,
        validationResult: { errors: [], repairs: validation.repairs },
        currentStep: 2,
      }));
    }
  }, [rawDiagram, description, onApplyDiagram, updateGuided]);

  const handleIntakeComplete = useCallback(
    (answers) => {
      const targetDiagram = confirmedData?.rawDiagram || rawDiagram;
      if (!targetDiagram) return;

      const { patched, simulationConfig, assumptions: intakeAssumptions } = applyIntakeToRawDiagram(
        targetDiagram,
        answers
      );

      const validation = validateBpmn(patched);
      const finalDiagram = validation.repaired || patched;
      const finalRepairs = validation.repairs || [];

      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('spot:simulationConfig', JSON.stringify(simulationConfig));
          localStorage.setItem('spot:goal', simulationConfig?.goal || 'waiting');
          if (simulationConfig?.arrival_rate) {
            localStorage.setItem('spot:arrivalRate', String(simulationConfig.arrival_rate));
          }
          if (simulationConfig?.arrival_gap_minutes) {
            localStorage.setItem('spot:arrivalValue', String(simulationConfig.arrival_gap_minutes));
          }
          const anySalaryEst =
            intakeAssumptions.some(
              (a) =>
                a.estimated &&
                (a.field === 'costs' || a.field?.includes('salary') || a.text?.toLowerCase().includes('salary'))
            ) ||
            (finalDiagram.resources || []).some(
              (r) => r.type === 'staff' && (r.costSource === 'assumed' || r.salaryEstimated)
            );
          localStorage.setItem('spot:anySalaryEstimated', anySalaryEst ? 'true' : 'false');
        } catch (e) {
          console.warn('Could not persist simulation config to localStorage:', e);
        }
      }

      const newLayout = layoutAiDiagram(finalDiagram);
      setSimulationReadyData({
        patched: finalDiagram,
        simulationConfig,
        assumptions: intakeAssumptions,
        repairs: finalRepairs,
        validationErrors: validation.errors || [],
        layout: newLayout,
        answers,
      });

      updateGuided({
        answers,
        rawDiagram: finalDiagram,
        validationResult: validation,
        currentStep: 3,
      });
    },
    [confirmedData, rawDiagram, updateGuided]
  );

  const handleReset = useCallback(() => {
    if (onStartOver) {
      onStartOver();
      return;
    }
    updateGuided({
      flowText: '',
      rawDiagram: null,
      version: 1,
      keptSteps: [],
      answers: null,
      currentStep: 1,
      validationResult: { errors: [], repairs: [] },
    });
    setClarification(null);
    setClarificationHistory([]);
    setClarificationAnswer('');
    setError(null);
    setConfirmedData(null);
    setSimulationReadyData(null);
    setInlineCorrection('');
  }, [onStartOver, updateGuided]);

  return (
    <div
      style={{
        flex: 1,
        overflowY: step === 2 ? 'hidden' : 'auto',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(180deg, #fafafa 0%, #fff 100%)',
      }}
    >
      {/* Step Indicator Header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid #f3f4f6',
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: step > 1 ? '#10b981' : '#4f46e5',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {step === 3 ? <Check size={12} /> : step}
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>
            {step === 1
              ? 'Step 1: Your Process'
              : step === 2
              ? 'Step 2: Business Questions'
              : 'Step 3: Ready to Simulate'}
          </span>
        </div>
        <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 500 }}>
          {step === 1 ? '1 of 3' : step === 2 ? '2 of 3' : '3 of 3'}
        </span>
      </div>

      {step === 2 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <IntakeScreens
            rawDiagram={confirmedData?.rawDiagram || rawDiagram}
            onComplete={handleIntakeComplete}
            onBack={() => updateGuided({ currentStep: 1 })}
          />
        </div>
      ) : (
        <div style={{ padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {step === 1 ? (
          <>
            {/* Step 1 Introduction */}
            <div>
              <h3 style={{ fontSize: 13.5, fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>
                Describe your business process
              </h3>
              <p style={{ fontSize: 12, color: '#6b7280', margin: 0, lineHeight: 1.5 }}>
                In plain words, tell us what steps take place from the moment a customer arrives until they leave.
              </p>
            </div>

            {/* Main Textarea */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div
                style={{
                  border: '1.5px solid #e0e7ff',
                  borderRadius: 12,
                  background: '#fff',
                  padding: '10px 12px',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
                onFocusCapture={(e) => {
                  e.currentTarget.style.borderColor = '#818cf8';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(129,140,248,0.15)';
                }}
                onBlurCapture={(e) => {
                  e.currentTarget.style.borderColor = '#e0e7ff';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <textarea
                  value={description}
                  onChange={(e) => updateGuided({ flowText: e.target.value })}
                  placeholder="Describe what happens from the moment a customer arrives until they leave…"
                  rows={4}
                  disabled={loading}
                  style={{
                    width: '100%',
                    fontSize: 13,
                    lineHeight: 1.55,
                    border: 'none',
                    outline: 'none',
                    resize: 'vertical',
                    minHeight: 90,
                    maxHeight: 200,
                    color: '#111827',
                    fontFamily: 'Inter, system-ui, sans-serif',
                    background: 'transparent',
                  }}
                />
              </div>

              {/* Starter example chips */}
              {!rawDiagram && !loading && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 2 }}>
                  <span style={{ fontSize: 10.5, color: '#9ca3af', alignSelf: 'center', marginRight: 2 }}>
                    Try:
                  </span>
                  {EXAMPLE_DESCRIPTIONS.map((ex) => (
                    <button
                      key={ex.label}
                      onClick={() => updateGuided({ flowText: ex.text })}
                      style={{
                        padding: '3px 8px',
                        borderRadius: 14,
                        border: '1px solid #e0e7ff',
                        background: '#f5f3ff',
                        color: '#6d28d9',
                        fontSize: 10.5,
                        cursor: 'pointer',
                        fontWeight: 500,
                      }}
                    >
                      {ex.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Action Button */}
            {!rawDiagram && !loading && (
              <button
                onClick={() => handleGenerate(description)}
                disabled={!description.trim() || loading}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '10px 0',
                  borderRadius: 10,
                  border: 'none',
                  cursor: !description.trim() ? 'not-allowed' : 'pointer',
                  background: !description.trim()
                    ? '#e0e7ff'
                    : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                  color: !description.trim() ? '#a5b4fc' : '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  boxShadow: !description.trim() ? 'none' : '0 2px 8px rgba(99,102,241,0.25)',
                  transition: 'all 0.15s ease',
                }}
              >
                <Wand2 size={15} /> Show me my process
              </button>
            )}

            {/* Loading State */}
            {loading && (
              <div
                style={{
                  background: '#f5f3ff',
                  border: '1px solid #ddd6fe',
                  borderRadius: 12,
                  padding: '20px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  textAlign: 'center',
                }}
              >
                <Loader2
                  size={26}
                  color="#7c3aed"
                  style={{ animation: 'spin 1s linear infinite' }}
                />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#5b21b6' }}>
                    {loadingText}
                  </div>
                  <div style={{ fontSize: 11, color: '#7c3aed', marginTop: 3 }}>
                    Identifying activities, events, and flow connections…
                  </div>
                </div>
              </div>
            )}

            {/* Error State */}
            {error && (
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 10,
                  padding: '10px 12px',
                  fontSize: 12,
                  color: '#b91c1c',
                }}
              >
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>Generation issue</div>
                  <div style={{ lineHeight: 1.4 }}>{error}</div>
                  <button
                    onClick={() => handleGenerate(description)}
                    style={{
                      marginTop: 8,
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: '1px solid #fca5a5',
                      background: '#fff',
                      color: '#b91c1c',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Try again
                  </button>
                </div>
              </div>
            )}

            {/* Clarification State */}
            {clarification && !loading && (
              <div
                style={{
                  background: '#fff',
                  border: '1.5px solid #ddd6fe',
                  borderRadius: 12,
                  overflow: 'hidden',
                  boxShadow: '0 2px 10px rgba(124,58,237,0.08)',
                }}
              >
                <div
                  style={{
                    padding: '8px 12px',
                    background: '#ede9fe',
                    borderBottom: '1px solid #ddd6fe',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Sparkles size={13} color="#6d28d9" />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#5b21b6' }}>
                    One quick detail needed
                  </span>
                </div>

                <div style={{ padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div
                    style={{
                      background: '#f5f3ff',
                      borderRadius: '4px 12px 12px 12px',
                      padding: '10px 12px',
                      fontSize: 12.5,
                      lineHeight: 1.5,
                      color: '#374151',
                    }}
                  >
                    {clarification}
                  </div>

                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      value={clarificationAnswer}
                      onChange={(e) => setClarificationAnswer(e.target.value)}
                      placeholder="Type your answer…"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleClarificationSubmit();
                      }}
                      style={{
                        flex: 1,
                        padding: '7px 10px',
                        borderRadius: 8,
                        border: '1px solid #ddd6fe',
                        fontSize: 12.5,
                        outline: 'none',
                        color: '#111827',
                      }}
                    />
                    <button
                      onClick={handleClarificationSubmit}
                      disabled={!clarificationAnswer.trim() || loading}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 8,
                        border: 'none',
                        cursor: !clarificationAnswer.trim() ? 'not-allowed' : 'pointer',
                        background: !clarificationAnswer.trim()
                          ? '#e0e7ff'
                          : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                        color: '#fff',
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      Answer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Generated Diagram Preview & Decision Card */}
            {rawDiagram && layout && !loading && (() => {
              const statedTasks = (rawDiagram.nodes || []).filter(
                (n) => n.type === 'task' && n.origin !== 'inferred' && n.data?.origin !== 'inferred'
              );
              const inferredTasks = (rawDiagram.nodes || []).filter(
                (n) => n.type === 'task' && (n.origin === 'inferred' || n.data?.origin === 'inferred')
              );
              const statedCount = statedTasks.length;
              const inferredCount = inferredTasks.length;

              return (
                <div
                  style={{
                    border: '1px solid #e0e7ff',
                    borderRadius: 12,
                    background: '#f5f3ff',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {/* Header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: '#ede9fe',
                      borderBottom: '1px solid #ddd6fe',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Wand2 size={13} color="#6d28d9" />
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#5b21b6' }}>
                        Generated process · {layout.elements?.filter((n) => n.type === 'task').length || 0} steps
                      </span>
                    </div>
                    <button
                      onClick={() => handleGenerate(description)}
                      title="Regenerate diagram"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 2,
                        color: '#7c3aed',
                      }}
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>

                  {/* Above preview: You described N steps. AI added M. */}
                  <div
                    style={{
                      padding: '7px 12px',
                      background: '#faf5ff',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#6d28d9',
                      borderBottom: '1px solid #ede9fe',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>You described {statedCount} steps. AI added {inferredCount}.</span>
                  </div>

                  {/* Readable Process Steps List (Module I2e) */}
                  <ProcessStepList
                    rawDiagram={rawDiagram}
                    version={version}
                    onKeepInferred={handleKeepInferred}
                    onRemoveInferred={handleRemoveInferred}
                  />

                  {/* AI Summary note if present */}
                  {rawDiagram.summary && (
                    <div
                      style={{
                        padding: '8px 12px',
                        background: '#fff',
                        fontSize: 11.5,
                        color: '#4b5563',
                        lineHeight: 1.45,
                        borderTop: '1px solid #ede9fe',
                      }}
                    >
                      {rawDiagram.summary}
                    </div>
                  )}

                  {/* Inferred Tasks Keep / Remove Controls */}
                  {inferredTasks.length > 0 && (
                    <div
                      style={{
                        padding: '10px 12px',
                        background: '#faf5ff',
                        borderTop: '1px solid #ede9fe',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#6d28d9', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Sparkles size={13} />
                        AI added steps (no time counted):
                      </div>
                      {inferredTasks.map((task) => {
                        const isKept = task.kept || task.data?.kept;
                        const taskLabel = task.data?.label || task.label || task.id;
                        return (
                          <div
                            key={task.id}
                            style={{
                              background: '#fff',
                              border: isKept ? '1.5px solid #a78bfa' : '1px solid #e9d5ff',
                              borderRadius: 8,
                              padding: '7px 10px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 8,
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {taskLabel}
                              </div>
                              <div style={{ fontSize: 10.5, color: '#7c3aed', marginTop: 1 }}>
                                {isKept ? 'Kept · 0 min until configured' : 'AI added, no time counted'}
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                              <button
                                onClick={() => handleKeepInferred(task.id)}
                                title="Keep step in process (leaves zero time until configured)"
                                style={{
                                  padding: '4px 8px',
                                  borderRadius: 6,
                                  border: isKept ? '1px solid #7c3aed' : '1px solid #ddd6fe',
                                  background: isKept ? '#7c3aed' : '#fff',
                                  color: isKept ? '#fff' : '#6d28d9',
                                  fontSize: 11,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 3,
                                }}
                              >
                                <Check size={11} /> {isKept ? 'Kept' : 'Keep'}
                              </button>

                              <button
                                onClick={() => handleRemoveInferred(task.id)}
                                title="Remove step and reconnect process flow"
                                style={{
                                  padding: '4px 8px',
                                  borderRadius: 6,
                                  border: '1px solid #fecaca',
                                  background: '#fff',
                                  color: '#dc2626',
                                  fontSize: 11,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 3,
                                }}
                              >
                                <Trash2 size={11} /> Remove
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Assumptions & Auto-Repairs List */}
                  {assumptions.length > 0 && (
                    <div
                      style={{
                        padding: '8px 12px',
                        background: '#eff6ff',
                        borderTop: '1px solid #bfdbfe',
                        fontSize: 11.5,
                        color: '#1e40af',
                      }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <CheckCircle size={13} /> Assumptions & Auto-repairs:
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {assumptions.map((r, i) => (
                          <li key={i} style={{ marginBottom: 2 }}>{r.description || r}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Validation Errors Block */}
                  {validationErrors.length > 0 && (
                    <div
                      style={{
                        padding: '10px 12px',
                        background: '#fef2f2',
                        borderTop: '1px solid #fecaca',
                        fontSize: 11.5,
                        color: '#b91c1c',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <AlertCircle size={13} /> Process needs adjustment before proceeding:
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {validationErrors.map((err, i) => (
                          <li key={i} style={{ marginBottom: 2 }}>{err}</li>
                        ))}
                      </ul>
                      {(assumptions.length > 0 || (state?.validationResult?.repairs && state.validationResult.repairs.length > 0)) && (
                        <button
                          type="button"
                          onClick={handleApplyAutoRepair}
                          style={{
                            alignSelf: 'flex-start',
                            marginTop: 4,
                            padding: '5px 10px',
                            borderRadius: 6,
                            border: '1px solid #bfdbfe',
                            background: '#eff6ff',
                            color: '#1e40af',
                            fontSize: 11.5,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <CheckCircle size={12} /> Apply Auto-repairs & Proceed
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setInlineCorrection(
                            'Assign all tasks to either Customer or Store swimlanes, and ensure every task and intermediate event has valid incoming and outgoing sequence flows within its lane.'
                          );
                          const inputEl = document.getElementById('inline-change-input');
                          if (inputEl) inputEl.focus();
                        }}
                        style={{
                          alignSelf: 'flex-start',
                          marginTop: 2,
                          padding: '5px 10px',
                          borderRadius: 6,
                          border: '1px solid #ddd6fe',
                          background: '#f5f3ff',
                          color: '#6d28d9',
                          fontSize: 11.5,
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <Wand2 size={12} /> Autofill fix into "What should change?"
                      </button>
                    </div>
                  )}

                  {/* Decision Block: "Is this right?" */}
                  <div
                    style={{
                      padding: '12px 12px',
                      borderTop: '1px solid #ddd6fe',
                      background: '#fff',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#111827', textAlign: 'center' }}>
                      Is this right?
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {/* Confirm Button */}
                      <button
                        onClick={handleConfirm}
                        disabled={validationErrors.length > 0}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          padding: '9px 0',
                          borderRadius: 8,
                          border: validationErrors.length > 0 ? '1px solid #d1d5db' : 'none',
                          cursor: validationErrors.length > 0 ? 'not-allowed' : 'pointer',
                          background: validationErrors.length > 0
                            ? '#f3f4f6'
                            : 'linear-gradient(135deg, #10b981, #059669)',
                          color: validationErrors.length > 0 ? '#9ca3af' : '#fff',
                          fontSize: 12.5,
                          fontWeight: 600,
                          boxShadow: validationErrors.length > 0 ? 'none' : '0 1px 4px rgba(16,185,129,0.25)',
                        }}
                        title={
                          validationErrors.length > 0
                            ? "Confirm is blocked because of process validation errors above. Resolve them below."
                            : "Confirm process diagram and proceed to questions"
                        }
                      >
                        <CheckCircle size={14} />
                        {validationErrors.length > 0 ? 'Confirm (Blocked by errors)' : 'Confirm'}
                      </button>

                      {validationErrors.length > 0 && (
                        <div
                          style={{
                            fontSize: 11,
                            color: '#b91c1c',
                            background: '#fef2f2',
                            border: '1px solid #fecaca',
                            borderRadius: 6,
                            padding: '6px 8px',
                            lineHeight: 1.35,
                          }}
                        >
                          <strong>Why is Confirm blocked?</strong> The diagram has {validationErrors.length} BPMN structural errors (missing lanes or sequence flows) that would crash simulation. Use <em>"What should change?"</em> below to adjust it with AI.
                        </div>
                      )}
                    </div>

                    {/* Inline Box: "What should change?" (Module I2e) */}
                    <div
                      style={{
                        background: '#faf5ff',
                        border: '1.5px solid #ddd6fe',
                        borderRadius: 10,
                        padding: '10px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        marginTop: 2,
                      }}
                    >
                      <label
                        htmlFor="inline-change-input"
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: '#5b21b6',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                        }}
                      >
                        <Wand2 size={13} color="#7c3aed" /> What should change?
                      </label>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          id="inline-change-input"
                          type="text"
                          value={inlineCorrection}
                          onChange={(e) => setInlineCorrection(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && inlineCorrection.trim() && !loading) {
                              e.preventDefault();
                              handleInlineCorrectionSubmit();
                            }
                          }}
                          placeholder="e.g. Add ID check step before payment, or change who handles packaging…"
                          disabled={loading}
                          style={{
                            flex: 1,
                            padding: '7px 10px',
                            fontSize: 12,
                            borderRadius: 8,
                            border: '1px solid #c4b5fd',
                            background: '#fff',
                            outline: 'none',
                            color: '#111827',
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => handleInlineCorrectionSubmit()}
                          disabled={!inlineCorrection.trim() || loading}
                          style={{
                            padding: '7px 14px',
                            borderRadius: 8,
                            border: 'none',
                            cursor: !inlineCorrection.trim() || loading ? 'not-allowed' : 'pointer',
                            background: !inlineCorrection.trim() || loading
                              ? '#e0e7ff'
                              : 'linear-gradient(135deg, #6366f1, #7c3aed)',
                            color: !inlineCorrection.trim() || loading ? '#a5b4fc' : '#fff',
                            fontSize: 12,
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {loading ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={12} />}
                          Update
                        </button>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -2 }}>
                        <button
                          type="button"
                          onClick={handleSwitchToChatClick}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            color: '#7c3aed',
                            fontSize: 11,
                            fontWeight: 500,
                            textDecoration: 'underline',
                            cursor: 'pointer',
                          }}
                        >
                          Continue in Chat →
                        </button>
                      </div>
                    </div>

                    <button
                      onClick={handleReset}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#9ca3af',
                        fontSize: 11,
                        cursor: 'pointer',
                        textAlign: 'center',
                        padding: '4px 0',
                      }}
                    >
                      Start over with a new description
                    </button>
                  </div>
                </div>
              );
            })()}
          </>
        ) : (
          /* Step 3: Ready to Simulate */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              style={{
                background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)',
                border: '1px solid #bbf7d0',
                borderRadius: 12,
                padding: '14px 16px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                boxShadow: '0 2px 8px rgba(16,185,129,0.08)',
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: '#10b981',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <CheckCircle size={18} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#065f46' }}>
                  Process Ready to Simulate!
                </div>
                <div style={{ fontSize: 11.5, color: '#047857', marginTop: 2, lineHeight: 1.4 }}>
                  All step speeds, staff responsibilities, arrival rates, and space constraints have been applied to your digital twin.
                </div>
              </div>
            </div>

            {/* Simulation Config Summary Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {/* Busyness card */}
              <div
                style={{
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 10,
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                }}
              >
                <span style={{ fontSize: 10.5, color: '#6b7280', textTransform: 'uppercase', fontWeight: 600 }}>
                  Rush Hour Pace
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#111827', textTransform: 'capitalize' }}>
                  {simulationReadyData?.simulationConfig?.busyness || 'Steady'}
                </span>
                <span style={{ fontSize: 10.5, color: '#7c3aed' }}>
                  ~{simulationReadyData?.simulationConfig?.customers_per_hour || 20} arrivals/hr
                </span>
              </div>

              {/* Goal card */}
              <div
                style={{
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 10,
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                }}
              >
                <span style={{ fontSize: 10.5, color: '#6b7280', textTransform: 'uppercase', fontWeight: 600 }}>
                  Main Goal
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#111827', textTransform: 'capitalize' }}>
                  {simulationReadyData?.simulationConfig?.goal === 'waiting'
                    ? 'Wait Times'
                    : simulationReadyData?.simulationConfig?.goal === 'cost'
                    ? 'Reduce Costs'
                    : 'Throughput'}
                </span>
                <span style={{ fontSize: 10.5, color: '#059669' }}>
                  Optimized for SPOT
                </span>
              </div>
            </div>

            {/* Diagram thumbnail */}
            {(simulationReadyData?.layout || confirmedData?.layout) && (
              <div
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: 10,
                  overflow: 'hidden',
                  background: '#fff',
                }}
              >
                <div
                  style={{
                    padding: '6px 10px',
                    background: '#f9fafb',
                    borderBottom: '1px solid #f3f4f6',
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#6b7280',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>Patched Simulation Model</span>
                  <span style={{ color: '#10b981', fontWeight: 700 }}>● Applied to Canvas</span>
                </div>
                <DiagramPreview
                  key={`preview_step3_v${version}`}
                  nodes={(simulationReadyData?.layout || confirmedData?.layout)?.elements}
                  connections={(simulationReadyData?.layout || confirmedData?.layout)?.connections}
                  version={version}
                />
              </div>
            )}

            {/* ConfirmationCard (Module I5): lists assumptions (estimated items marked & editable), repairs, and blocks on validation errors */}
            <ConfirmationCard
              diagram={simulationReadyData?.patched || confirmedData?.rawDiagram || rawDiagram}
              assumptions={simulationReadyData?.assumptions || assumptions || []}
              repairs={simulationReadyData?.repairs || []}
              initialValidationErrors={simulationReadyData?.validationErrors || validationErrors || []}
              simulationConfig={simulationReadyData?.simulationConfig}
              onWhatShouldChange={handleInlineCorrectionSubmit}
              onBackToQuestions={() => updateGuided({ currentStep: 2 })}
              onConfirm={(finalDiagram, finalRepairs) => {
                if (onConfirmApply) {
                  onConfirmApply(finalDiagram, finalRepairs);
                } else if (onApplyDiagram) {
                  const layout = layoutAiDiagram(finalDiagram);
                  onApplyDiagram(layout.elements, layout.connections, layout.resources);
                }
              }}
            />

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                onClick={() => updateGuided({ currentStep: 2 })}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '8px 0',
                  borderRadius: 8,
                  border: '1px solid #ddd6fe',
                  background: '#fff',
                  color: '#6d28d9',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <ArrowLeft size={13} /> Edit Answers
              </button>

              <button
                onClick={handleReset}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '8px 0',
                  borderRadius: 8,
                  border: '1px solid #e5e7eb',
                  background: '#fafafa',
                  color: '#4b5563',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <RotateCcw size={13} /> Start Over
              </button>
            </div>
          </div>
        )}
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
