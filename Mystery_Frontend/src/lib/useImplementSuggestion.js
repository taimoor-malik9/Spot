'use client';
import { useState, useCallback, useRef } from 'react';
import { createScenario, getScenarios, shapeFrontendToBackend, shapeBackendToFrontend, getProcess } from './apiService';

const AI_API_BASE = import.meta.env.VITE_AI_API_URL || '';

// A node ends up here — missing a position, or landing on the exact same
// (100, 100) as another node — whenever it was never given a real layout
// position upstream (most commonly: a start/end event from an AI-generated
// diagram that was never manually dragged before saving). This function is
// a repair pass, not a full layout engine: any node that already has a
// valid, unique position is left completely untouched. It only rescues the
// nodes that would otherwise collapse onto each other, which is what was
// making the start event look "missing" — it wasn't gone, it was buried
// under another node sharing its default coordinate.
function repairCollidingPositions(elements) {
  const taken = new Set();
  const hasValidPosition = (el) =>
    el.position && typeof el.position.x === 'number' && typeof el.position.y === 'number';

  // First pass: reserve every coordinate already legitimately in use, so a
  // repaired node can never be placed on top of a node that was fine.
  elements.forEach(el => {
    if (['pool', 'lane'].includes(el.type)) return;
    if (hasValidPosition(el)) taken.add(`${el.position.x},${el.position.y}`);
  });

  let cursorX = 100;
  const ROW_Y = 100;
  const STEP_X = 180;
  const seenThisPass = new Set(); // catches the FIRST node at a shared point too —
  // that one had a "valid" position by the check above, but if a second
  // node also claims that exact point, the first one silently becomes the
  // thing hiding the second, which is just as broken as neither having one.

  return elements.map(el => {
    if (['pool', 'lane'].includes(el.type)) return el;

    const key = hasValidPosition(el) ? `${el.position.x},${el.position.y}` : null;
    const isDuplicate = key && seenThisPass.has(key);
    if (key) seenThisPass.add(key);

    if (hasValidPosition(el) && !isDuplicate) return el;

    while (taken.has(`${cursorX},${ROW_Y}`)) cursorX += STEP_X;
    taken.add(`${cursorX},${ROW_Y}`);
    const fixed = { ...el, position: { x: cursorX, y: ROW_Y } };
    cursorX += STEP_X;
    return fixed;
  });
}

// AI suggestions are intentionally based on the persisted process so that
// resource and task values are authoritative.  Older Process documents,
// however, predate persistence of canvas-only information: pool/lane boxes,
// node positions, and dimensions.  The active baseline remains available in
// localStorage and is the correct recovery source for that presentation data.
// Only fill fields that MongoDB is actually missing; never let a stale browser
// snapshot overwrite a newer saved process.
function restoreMissingPresentationData(elements) {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem('spot:model:nodes') || 'null');
  } catch {
    return elements;
  }

  const localElements = Array.isArray(saved)
    ? saved
    : (Array.isArray(saved?.nodes) ? saved.nodes : []);
  if (!localElements.length) return elements;

  const localById = new Map(localElements.map(el => [el.id, el]));
  const canonicalLayoutIds = new Set(
    elements.filter(el => el.type === 'pool' || el.type === 'lane').map(el => el.id)
  );
  const hasPosition = el =>
    el?.position && Number.isFinite(el.position.x) && Number.isFinite(el.position.y);
  const isFallbackPosition = el =>
    hasPosition(el) && el.position.x === 100 && el.position.y === 100;

  const restoredNodes = elements.map(el => {
    if (el.type === 'pool' || el.type === 'lane') return el;
    const local = localById.get(el.id);
    if (!local) return el;

    const shouldRestorePosition = !hasPosition(el) ||
      (isFallbackPosition(el) && hasPosition(local) && !isFallbackPosition(local));

    return {
      ...el,
      position: shouldRestorePosition ? { ...local.position } : el.position,
      width: el.width ?? local.width,
      height: el.height ?? local.height,
      pool: el.pool ?? local.pool ?? local.poolId ?? null,
      lane: el.lane ?? local.lane ?? null,
    };
  });

  // Containers are not simulation nodes, so they cannot be reconstructed
  // from Process.nodes. Bring over only containers absent from the saved
  // document, retaining their IDs, nesting (poolId), dimensions, and position.
  const missingLayout = localElements.filter(el =>
    (el.type === 'pool' || el.type === 'lane') && !canonicalLayoutIds.has(el.id)
  );

  return [...missingLayout, ...restoredNodes];
}

export function sanitizeTechnicalDetails(details) {
  if (!details) return '';
  let str = String(details);
  // Strip Mongo ObjectIDs
  str = str.replace(/\b[0-9a-fA-F]{24}\b/g, '');
  // Strip node and element IDs like msg_throw_order, task_123, Activity_abc, flow_123, etc.
  str = str.replace(/\b(msg|task|node|edge|flow|Activity|Gateway|Event|activity|gateway|event)_[a-zA-Z0-9_-]+/gi, 'step');
  // Strip raw element IDs that look like ID hashes or uuid tokens
  str = str.replace(/\b[a-zA-Z0-9]+_[0-9a-zA-Z_-]{4,}\b/g, 'step');
  return str.replace(/\s+/g, ' ').trim();
}

/**
 * Shared "implement this suggestion as a new scenario" flow.
 * Originally lived only inside AIInsightsPanel.jsx — pulled out here so
 * AIChatWidget can trigger the exact same behavior (same bugs fixed once,
 * same behavior everywhere) instead of re-implementing it.
 *
 * @param {Function} navigate - react-router navigate function
 * @returns {{ implementSuggestion: (text: string, id: string|number) => Promise<void>, implementingId: string|number|null, implementError: object|null, clearImplementError: () => void }}
 */
export function useImplementSuggestion(navigate) {
  const [implementingId, setImplementingId] = useState(null);
  const [implementError, setImplementError] = useState(null);
  const inFlightRef = useRef(false);
  const lastCallRef = useRef({ text: null, baseProcessId: null, timestamp: 0 });

  const clearImplementError = useCallback(() => {
    setImplementError(null);
  }, []);

  const implementSuggestion = useCallback(async (suggestionOrVariant, id) => {
    // In-flight guard: prevent concurrent runs
    if (inFlightRef.current) {
      console.warn('[useImplementSuggestion] Ignored: implementation already in flight');
      return;
    }

    const baseProcessId = typeof window !== 'undefined' ? localStorage.getItem('spot:processId') : null;
    const now = Date.now();
    const callKey = typeof suggestionOrVariant === 'object'
      ? (suggestionOrVariant.label || JSON.stringify(suggestionOrVariant))
      : String(suggestionOrVariant);

    // Ignore repeat within 10 seconds
    if (
      lastCallRef.current.text === callKey &&
      lastCallRef.current.baseProcessId === baseProcessId &&
      now - lastCallRef.current.timestamp < 10000
    ) {
      console.warn('[useImplementSuggestion] Ignored: duplicate suggestion within 10s');
      return;
    }

    inFlightRef.current = true;
    lastCallRef.current = { text: callKey, baseProcessId, timestamp: now };
    setImplementingId(id);
    setImplementError(null);

    try {
      if (!baseProcessId) {
        setImplementError({
          id,
          message: "Couldn't create this scenario. Please try again.",
          technicalDetails: "No baseline process found. Please build a process first.",
        });
        return;
      }

      let variantDefinition = null;
      if (suggestionOrVariant && typeof suggestionOrVariant === 'object') {
        variantDefinition = suggestionOrVariant.variant_definition ||
          suggestionOrVariant.variantDefinition ||
          suggestionOrVariant;
      } else if (typeof suggestionOrVariant === 'string') {
        variantDefinition = {
          label: suggestionOrVariant,
          resourceChanges: [],
          nodeChanges: [],
        };
      }

      if (!variantDefinition) {
        throw new Error('No valid variant definition provided for implementation');
      }

      const token = localStorage.getItem('spot_token') || sessionStorage.getItem('spot_token');
      const response = await fetch(`${AI_API_BASE}/api/ai/apply-option`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          processId: baseProcessId,
          variantDefinition,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.detail || 'Failed to create scenario via apply-option');
      }

      const newScenario = await response.json();
      if (!newScenario || !newScenario._id) {
        throw new Error('Failed to create scenario on the backend');
      }

      localStorage.setItem('spot:activeScenarioId', newScenario._id);
      navigate('/scenarios');
    } catch (err) {
      console.error('Implement suggestion error:', err);
      const rawMsg = err.message || 'Failed to implement suggestion';
      const cleanDetails = sanitizeTechnicalDetails(rawMsg);
      setImplementError({
        id,
        message: "Couldn't create this scenario. Please try again.",
        technicalDetails: cleanDetails,
      });
    } finally {
      inFlightRef.current = false;
      setImplementingId(null);
    }
  }, [navigate]);

  return { implementSuggestion, implementingId, implementError, clearImplementError };
}
