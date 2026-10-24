import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  User,
  Store,
  GitBranch,
  Sparkles,
  Maximize2,
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Check,
  Trash2,
} from 'lucide-react';
import { layoutAiDiagram } from '../../lib/aiDiagramLayout';
import DiagramPreview from './DiagramPreview';
import { extractOrderedSteps } from '../../lib/intake/stepListHelper';

export { extractOrderedSteps };

/**
 * Readable Step List component (Module I2e)
 *
 * Displays numbered process steps grouped by actor (Customer / Store),
 * showing branch paths ("If <question> -> <step>"), tagging inferred steps
 * ("AI added, no time counted"), and providing an "Open larger view" modal.
 */
export default function ProcessStepList({
  rawDiagram,
  version = 1,
  onKeepInferred,
  onRemoveInferred,
}) {
  const [showModal, setShowModal] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);

  // Close modal on Escape key
  useEffect(() => {
    if (!showModal) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setShowModal(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal]);

  const steps = useMemo(() => extractOrderedSteps(rawDiagram), [rawDiagram, version]);

  const layout = useMemo(
    () => (rawDiagram ? layoutAiDiagram(rawDiagram) : null),
    [rawDiagram, version]
  );

  // Group steps by actor
  const groupedSteps = useMemo(() => {
    const customer = [];
    const store = [];
    steps.forEach((s, idx) => {
      const stepWithIndex = { ...s, stepNumber: idx + 1 };
      if (s.group === 'Customer') {
        customer.push(stepWithIndex);
      } else {
        store.push(stepWithIndex);
      }
    });
    return { customer, store };
  }, [steps]);

  if (!rawDiagram || steps.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: '#fff',
        borderRadius: 10,
        border: '1px solid #e0e7ff',
        padding: '10px 12px',
      }}
    >
      {/* Header with Step Count & "Open larger view" button */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #f3f4f6',
          paddingBottom: 8,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: '#4f46e5' }}>
          Process Steps ({steps.length})
        </span>

        <button
          type="button"
          onClick={() => {
            setZoomScale(1);
            setShowModal(true);
          }}
          style={{
            background: '#f5f3ff',
            border: '1px solid #ddd6fe',
            color: '#6d28d9',
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Maximize2 size={12} /> Open larger view
        </button>
      </div>

      {/* Customer Steps Group */}
      {groupedSteps.customer.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#0369a1',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            <User size={12} /> Customer
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {groupedSteps.customer.map((step) => renderStepItem(step, onKeepInferred, onRemoveInferred))}
          </div>
        </div>
      )}

      {/* Store / Staff Steps Group */}
      {groupedSteps.store.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#059669',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            <Store size={12} /> Store / Staff
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {groupedSteps.store.map((step) => renderStepItem(step, onKeepInferred, onRemoveInferred))}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* LARGER VIEW MODAL (Zoomable & Readable size) */}
      {/* ========================================================================= */}
      {showModal && layout && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowModal(false);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 14,
              width: '95vw',
              maxWidth: 1040,
              height: '88vh',
              maxHeight: 760,
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
              overflow: 'hidden',
            }}
          >
            {/* Modal Header with Title & Zoom Controls */}
            <div
              style={{
                padding: '12px 18px',
                borderBottom: '1px solid #e5e7eb',
                background: '#fafafa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', margin: 0 }}>
                  Process Diagram · Full View
                </h3>
                <span style={{ fontSize: 11, color: '#6b7280' }}>
                  {steps.length} process steps · AI generated layout (v{version})
                </span>
              </div>

              {/* Controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: '#fff',
                    border: '1px solid #d1d5db',
                    borderRadius: 6,
                    padding: '2px 4px',
                    gap: 4,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setZoomScale((z) => Math.max(0.4, Number((z - 0.15).toFixed(2))))}
                    style={modalCtrlBtn}
                    title="Zoom Out"
                  >
                    <ZoomOut size={13} />
                  </button>
                  <span style={{ fontSize: 11, fontWeight: 600, minWidth: 38, textAlign: 'center' }}>
                    {Math.round(zoomScale * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setZoomScale((z) => Math.min(2.5, Number((z + 0.15).toFixed(2))))}
                    style={modalCtrlBtn}
                    title="Zoom In"
                  >
                    <ZoomIn size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoomScale(1)}
                    style={modalCtrlBtn}
                    title="Reset Zoom"
                  >
                    <RotateCcw size={12} />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{
                    background: '#f3f4f6',
                    border: 'none',
                    borderRadius: 6,
                    padding: '5px 8px',
                    cursor: 'pointer',
                    color: '#4b5563',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  title="Close modal"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Modal Body Canvas Container */}
            <div
              style={{
                flex: 1,
                overflow: 'auto',
                background: '#f8fafc',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'flex-start',
                padding: 32,
              }}
            >
              <div
                style={{
                  transform: `scale(${zoomScale})`,
                  transformOrigin: 'top left',
                  transition: 'transform 0.12s ease-out',
                }}
              >
                <DiagramPreview
                  key={`preview_modal_v${version}`}
                  nodes={layout.elements}
                  connections={layout.connections}
                  isFullView={true}
                  version={version}
                />
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function renderStepItem(step, onKeepInferred, onRemoveInferred) {
  return (
    <div
      key={step.id}
      style={{
        background: '#fafafa',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '7px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {/* Branch indicator if this step branches from a gateway */}
      {step.branchCondition && (
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: '#7c3aed',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: '#f5f3ff',
            padding: '2px 6px',
            borderRadius: 4,
            alignSelf: 'flex-start',
          }}
        >
          <GitBranch size={11} /> If {step.branchCondition} {'->'} {step.label}
        </div>
      )}

      {/* Main step line */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0 }}>
          <span
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: '#e0e7ff',
              color: '#4338ca',
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {step.stepNumber}
          </span>

          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#111827',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={step.label}
          >
            {step.label}
          </span>
        </div>

        {/* Inferred Tag: "AI added, no time counted" */}
        {step.isInferred && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 600,
                color: '#6d28d9',
                background: '#f5f3ff',
                border: '1px solid #ddd6fe',
                borderRadius: 4,
                padding: '2px 5px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              <Sparkles size={9} /> AI added, no time counted
            </span>

            {onKeepInferred && !step.isKept && (
              <button
                type="button"
                onClick={() => onKeepInferred(step.id)}
                style={{
                  background: '#ecfdf5',
                  border: '1px solid #a7f3d0',
                  color: '#065f46',
                  borderRadius: 4,
                  padding: '2px 5px',
                  fontSize: 9.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                }}
                title="Count time for this step"
              >
                <Check size={9} /> Keep
              </button>
            )}

            {onRemoveInferred && (
              <button
                type="button"
                onClick={() => onRemoveInferred(step.id)}
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#b91c1c',
                  borderRadius: 4,
                  padding: '2px 5px',
                  fontSize: 9.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                }}
                title="Remove this step"
              >
                <Trash2 size={9} /> Remove
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const modalCtrlBtn = {
  background: 'none',
  border: 'none',
  color: '#374151',
  cursor: 'pointer',
  padding: '2px 4px',
  borderRadius: 4,
  display: 'flex',
  alignItems: 'center',
};
