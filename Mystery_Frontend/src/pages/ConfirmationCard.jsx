import React, { useState, useMemo } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  X,
  Plus,
  Settings2,
  AlertCircle,
  Check,
  Edit2,
  HelpCircle,
  Clock,
  Flame,
  Users,
  Building,
} from 'lucide-react';
import { validateBpmn } from '../lib/intake/validateBpmn';
import { SPEED_MAPPINGS, BUSYNESS_MAPPINGS } from '../lib/intake/schema';

const COST_FIELD_LABELS = {
  hours_per_day: 'Hours/day',
  working_days_per_month: 'Working days/mo',
  monthly_salary: 'Monthly salary',
  purchase_price: 'Purchase price',
  lifespan_months: 'Lifespan (months)',
  monthly_running_cost: 'Monthly running cost',
  monthly_rent: 'Monthly rent',
};

const COST_FIELDS_BY_TYPE = {
  staff: ['hours_per_day', 'working_days_per_month', 'monthly_salary'],
  equipment: ['purchase_price', 'lifespan_months', 'monthly_running_cost'],
  facility: ['monthly_rent', 'purchase_price', 'lifespan_months'],
};

/**
 * ConfirmationCard (Module I5 extended)
 *
 * Sits inside AiPanel / IntakeFlow to review guessed values, assumptions,
 * and repairs before applying to the canvas.
 *
 * Props:
 *   diagram                 - raw diagram object (patched or from AI)
 *   confirmations           - optional: { resources: [...], durations: [...] }
 *   assumptions             - optional: Array of Assumption objects from applyIntake
 *   repairs                 - optional: Array of auto-repairs from validateBpmn
 *   initialValidationErrors - optional: Array of BPMN errors to display/block
 *   simulationConfig        - optional: { arrival_rate, busyness, goal, ... }
 *   onConfirm(patched, repairs, meta) - called to layout & apply to canvas
 *   onOpenResourcePanel     - optional: open full resource editor
 */
export default function ConfirmationCard({
  diagram = {},
  confirmations = null,
  assumptions = [],
  repairs = [],
  initialValidationErrors = [],
  simulationConfig = null,
  onConfirm,
  onOpenResourcePanel,
  onWhatShouldChange = null,
  onBackToQuestions = null,
}) {
  const [open, setOpen] = useState(true);
  const [removedResources, setRemovedResources] = useState(() => new Set());
  const [expandedResources, setExpandedResources] = useState(() => new Set());
  const [addingResource, setAddingResource] = useState(false);
  const [newResource, setNewResource] = useState({ name: '', type: 'staff', quantity: 1 });
  const [extraResources, setExtraResources] = useState([]);
  const [validationErrors, setValidationErrors] = useState(() => initialValidationErrors || []);
  const [activeRepairs, setActiveRepairs] = useState(() => repairs || []);
  const [cardCorrection, setCardCorrection] = useState('');
  const [cardUpdating, setCardUpdating] = useState(false);

  const safeConfirmations = useMemo(
    () => confirmations || { resources: [], durations: [] },
    [confirmations]
  );

  // Resource values for AI confirmations
  const [resourceValues, setResourceValues] = useState(() => {
    const init = {};
    (safeConfirmations.resources || []).forEach((r) => {
      (r.fields || []).forEach((f) => {
        init[`${r.resourceName}::${f.key}`] = f.guessedValue;
      });
    });
    return init;
  });

  // Duration values for AI confirmations
  const [durationValues, setDurationValues] = useState(() => {
    const init = {};
    (safeConfirmations.durations || []).forEach((d) => {
      init[d.nodeId] = d.guessedValue;
    });
    return init;
  });

  // Assumptions list (Module I5): marked as estimated and editable
  const [assumptionList, setAssumptionList] = useState(() => {
    if (!Array.isArray(assumptions)) return [];
    return assumptions.map((a, i) => {
      const text = typeof a === 'string' ? a : a.text || a.message || '';
      const field = a.field || '';
      const estimated = a.estimated !== undefined ? Boolean(a.estimated) : true;
      const val = a.value !== undefined ? a.value : '';
      return {
        id: `asm_${i}_${Date.now()}`,
        originalText: text,
        text,
        field,
        estimated,
        value: val,
        nodeId: a.nodeId || null,
        isEditing: false,
        tempValue: val,
      };
    });
  });

  const activeResources = (safeConfirmations.resources || []).filter(
    (r) => !removedResources.has(r.resourceName)
  );

  const totalFields =
    activeResources.reduce((sum, r) => sum + (r.fields?.length || 0), 0) +
    (safeConfirmations.durations?.length || 0) +
    extraResources.length +
    assumptionList.length;

  const findOriginal = (resourceName) =>
    (diagram.resources || []).find((r) => r.name === resourceName);

  const toggleExpanded = (resourceName) => {
    setExpandedResources((prev) => {
      const next = new Set(prev);
      if (next.has(resourceName)) {
        next.delete(resourceName);
      } else {
        next.add(resourceName);
        const original = findOriginal(resourceName);
        if (original) {
          setResourceValues((rv) => {
            const patch = {};
            (COST_FIELDS_BY_TYPE[original.type] || []).forEach((key) => {
              const k = `${resourceName}::${key}`;
              if (rv[k] === undefined) patch[k] = original[key] ?? '';
            });
            const qKey = `${resourceName}::quantity`;
            if (rv[qKey] === undefined) patch[qKey] = original.quantity ?? '';
            return { ...rv, ...patch };
          });
        }
      }
      return next;
    });
  };

  // Assumption editing handlers
  const handleToggleEditAssumption = (id) => {
    setAssumptionList((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, isEditing: !item.isEditing, tempValue: item.value } : item
      )
    );
  };

  const handleUpdateAssumptionValue = (id, newVal, newText = null) => {
    setAssumptionList((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updatedText = newText || item.text;
        return {
          ...item,
          value: newVal,
          text: updatedText,
          estimated: false, // Once edited, no longer estimated!
          isEditing: false,
        };
      })
    );
  };

  const buildPatchedDiagram = () => {
    const patched = JSON.parse(JSON.stringify(diagram || {}));
    patched.resources = patched.resources || [];
    patched.nodes = patched.nodes || [];

    // Filter removed resources
    patched.resources = patched.resources.filter((r) => !removedResources.has(r.name));
    if (removedResources.size > 0) {
      patched.nodes = patched.nodes.map((n) => {
        if (!n.data) return n;
        const data = { ...n.data };
        if (data.resource && removedResources.has(data.resource)) data.resource = null;
        if (data.resources) {
          const cleaned = {};
          Object.entries(data.resources).forEach(([k, v]) => {
            if (!removedResources.has(k)) cleaned[k] = v;
          });
          data.resources = cleaned;
        }
        return { ...n, data };
      });
    }

    // Apply resource values from confirmations
    patched.resources = patched.resources.map((r) => {
      const updated = { ...r };
      const fieldKeys = ['quantity', ...(COST_FIELDS_BY_TYPE[r.type] || [])];
      fieldKeys.forEach((key) => {
        const rvKey = `${r.name}::${key}`;
        if (resourceValues[rvKey] === undefined) return;
        const val = resourceValues[rvKey];
        const num = Number(val);
        updated[key] = Number.isNaN(num) || val === '' ? val : num;
      });

      const entry = (safeConfirmations.resources || []).find((c) => c.resourceName === r.name);
      const reviewedKeys = new Set((entry?.fields || []).map((f) => f.key));
      const guessFor = (key) => entry?.fields?.find((f) => f.key === key)?.guessedValue;

      if (reviewedKeys.has('quantity')) {
        const changed = String(resourceValues[`${r.name}::quantity`]) !== String(guessFor('quantity'));
        updated.quantitySource = changed ? 'stated' : 'assumed';
      } else {
        updated.quantitySource = r.quantitySource || 'stated';
      }

      const costKeys = (COST_FIELDS_BY_TYPE[r.type] || []).filter((k) => reviewedKeys.has(k));
      if (costKeys.length > 0) {
        const anyChanged = costKeys.some(
          (k) => String(resourceValues[`${r.name}::${k}`]) !== String(guessFor(k))
        );
        updated.costSource = anyChanged ? 'stated' : 'assumed';
      } else {
        updated.costSource = r.costSource || 'stated';
      }

      return updated;
    });

    extraResources.forEach((r) => {
      patched.resources.push({
        id: r.name,
        name: r.name,
        displayName: r.name,
        type: r.type,
        quantity: Number(r.quantity) || 1,
        quantitySource: 'stated',
        costSource: 'stated',
      });
    });

    // Apply durations from confirmations
    patched.nodes = patched.nodes.map((n) => {
      if (durationValues[n.id] === undefined) return n;
      const num = Number(durationValues[n.id]);
      const durationEntry = (safeConfirmations.durations || []).find((d) => d.nodeId === n.id);
      const changed = durationEntry && String(durationValues[n.id]) !== String(durationEntry.guessedValue);
      return {
        ...n,
        data: {
          ...n.data,
          duration: Number.isNaN(num) ? durationValues[n.id] : num,
          duration_source: changed ? 'stated' : 'assumed',
        },
      };
    });

    // Apply edited assumptions to nodes/resources
    assumptionList.forEach((asm) => {
      if (asm.estimated === false && asm.value !== null && asm.value !== undefined) {
        // Step speed
        if (asm.field?.includes('speed') && asm.nodeId) {
          const targetNode = patched.nodes.find((n) => n.id === asm.nodeId);
          if (targetNode) {
            targetNode.data = targetNode.data || {};
            const speedVal = String(asm.value).toLowerCase();
            const map = SPEED_MAPPINGS[speedVal] || SPEED_MAPPINGS.normal;
            targetNode.data.duration_min = map.duration_min;
            targetNode.data.duration = map.duration;
            targetNode.data.duration_max = map.duration_max;
            targetNode.data.duration_source = 'stated';
          }
        }

        // Limited space units
        if (asm.field === 'spaceUnits') {
          const count = parseInt(asm.value, 10);
          if (!isNaN(count) && count > 0) {
            const fac = patched.resources.find((r) => r.type === 'facility');
            if (fac) {
              fac.quantity = count;
              fac.quantitySource = 'stated';
            }
          }
        }

        // Staff salary
        if (asm.field === 'costs' || asm.field?.includes('salary')) {
          if (typeof asm.value === 'object' && asm.value !== null) {
            Object.entries(asm.value).forEach(([role, sal]) => {
              const res = patched.resources.find((r) => r.name === role && r.type === 'staff');
              if (res) {
                res.monthly_salary = Number(sal) || res.monthly_salary;
                res.costSource = 'stated';
              }
            });
          } else if (asm.value != null && !isNaN(Number(asm.value))) {
            const staffRes = patched.resources.find((r) => r.type === 'staff');
            if (staffRes) {
              staffRes.monthly_salary = Number(asm.value);
              staffRes.costSource = 'stated';
            }
          }
        }
      }
    });

    return patched;
  };

  const handleConfirm = () => {
    const patched = buildPatchedDiagram();
    const validation = validateBpmn(patched);

    // BLOCK APPLY IF VALIDATE BPMN RETURNS ERRORS
    if (validation.errors && validation.errors.length > 0) {
      setValidationErrors(validation.errors);
      return;
    }

    setValidationErrors([]);
    const finalRepairs = (validation.repairs && validation.repairs.length > 0)
      ? validation.repairs
      : activeRepairs;
    setActiveRepairs(finalRepairs);

    // Check if any salary is still estimated
    const anySalaryEstimated =
      assumptionList.some(
        (a) =>
          a.estimated &&
          (a.field === 'costs' || a.field?.includes('salary') || a.text.toLowerCase().includes('salary'))
      ) ||
      (patched.resources || []).some(
        (r) => r.type === 'staff' && (r.costSource === 'assumed' || r.salaryEstimated)
      );

    if (typeof window !== 'undefined') {
      localStorage.setItem('spot:anySalaryEstimated', anySalaryEstimated ? 'true' : 'false');
    }

    if (onConfirm) {
      onConfirm(validation.repaired || patched, finalRepairs, {
        assumptions: assumptionList,
        simulationConfig,
        anySalaryEstimated,
      });
    }
  };

  const handleOpenPanel = () =>
    onOpenResourcePanel && onOpenResourcePanel(buildPatchedDiagram());

  const handleAddResource = () => {
    if (!newResource.name.trim()) return;
    setExtraResources((prev) => [...prev, { ...newResource }]);
    setNewResource({ name: '', type: 'staff', quantity: 1 });
    setAddingResource(false);
  };

  const hasErrors = validationErrors && validationErrors.length > 0;

  const inputStyle = {
    fontSize: 12,
    padding: '5px 7px',
    borderRadius: 6,
    border: '1px solid #fde68a',
    outline: 'none',
    width: '100%',
    fontFamily: 'inherit',
    color: '#111827',
    background: '#fff',
  };

  const iconBtnStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    borderRadius: 5,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: '#9ca3af',
  };

  return (
    <div
      style={{
        border: hasErrors ? '1.5px solid #fca5a5' : '1px solid #fde68a',
        borderRadius: 10,
        background: hasErrors ? '#fef2f2' : '#fffbeb',
        overflow: 'hidden',
        marginBottom: 8,
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <AlertTriangle
          size={13}
          color={hasErrors ? '#dc2626' : '#d97706'}
          style={{ flexShrink: 0 }}
        />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: hasErrors ? '#b91c1c' : '#92400e',
            flex: 1,
          }}
        >
          {hasErrors
            ? `${validationErrors.length} BPMN issue${validationErrors.length !== 1 ? 's' : ''} to resolve`
            : `${totalFields} thing${totalFields !== 1 ? 's' : ''} to review`}
        </span>
        {open ? (
          <ChevronUp size={13} color={hasErrors ? '#dc2626' : '#d97706'} />
        ) : (
          <ChevronDown size={13} color={hasErrors ? '#dc2626' : '#d97706'} />
        )}
      </button>

      {open && (
        <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Active Resources from Confirmations */}
          {activeResources.map((r) => {
            const original = findOriginal(r.resourceName);
            const expanded = expandedResources.has(r.resourceName);
            const extraFieldKeys = expanded
              ? (COST_FIELDS_BY_TYPE[r.resourceType] || []).filter(
                  (key) => !r.fields.some((f) => f.key === key)
                )
              : [];

            return (
              <div
                key={r.resourceName}
                style={{
                  background: '#fff',
                  border: '1px solid #fef3c7',
                  borderRadius: 8,
                  padding: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>
                    {r.resourceName}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 500,
                      color: '#6b7280',
                      textTransform: 'capitalize',
                    }}
                  >
                    ({r.resourceType})
                  </span>
                  <div style={{ flex: 1 }} />
                  <button
                    onClick={() => toggleExpanded(r.resourceName)}
                    style={iconBtnStyle}
                    title={expanded ? 'Hide all fields' : 'Edit all fields'}
                  >
                    <Settings2 size={12} color={expanded ? '#6d28d9' : '#9ca3af'} />
                  </button>
                  <button
                    onClick={() =>
                      setRemovedResources((prev) => new Set([...prev, r.resourceName]))
                    }
                    style={iconBtnStyle}
                    title="Remove resource"
                  >
                    <X size={12} />
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {r.fields.map((f) => (
                    <div
                      key={f.key}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '110px 1fr',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <label style={{ fontSize: 11, color: '#6b7280' }}>
                        {COST_FIELD_LABELS[f.key] || f.key}
                      </label>
                      <input
                        type="number"
                        value={resourceValues[`${r.resourceName}::${f.key}`] ?? f.guessedValue}
                        onChange={(e) => {
                          const val = e.target.value;
                          setResourceValues((rv) => ({
                            ...rv,
                            [`${r.resourceName}::${f.key}`]: val,
                          }));
                        }}
                        style={inputStyle}
                      />
                    </div>
                  ))}

                  {extraFieldKeys.map((key) => (
                    <div
                      key={key}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '110px 1fr',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <label style={{ fontSize: 11, color: '#9ca3af' }}>
                        {COST_FIELD_LABELS[key] || key}
                      </label>
                      <input
                        type="number"
                        value={resourceValues[`${r.resourceName}::${key}`] ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setResourceValues((rv) => ({
                            ...rv,
                            [`${r.resourceName}::${key}`]: val,
                          }));
                        }}
                        style={{ ...inputStyle, borderColor: '#e5e7eb' }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Durations from Confirmations */}
          {(safeConfirmations.durations || []).length > 0 && (
            <div
              style={{
                background: '#fff',
                border: '1px solid #fef3c7',
                borderRadius: 8,
                padding: 8,
              }}
            >
              <div style={{ fontSize: 11.5, fontWeight: 600, color: '#92400e', marginBottom: 6 }}>
                Step Durations (minutes)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {safeConfirmations.durations.map((d) => (
                  <div
                    key={d.nodeId}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 70px',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        color: '#374151',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={d.label}
                    >
                      {d.label}
                    </span>
                    <input
                      type="number"
                      value={durationValues[d.nodeId] ?? d.guessedValue}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDurationValues((dv) => ({
                          ...dv,
                          [d.nodeId]: val,
                        }));
                      }}
                      style={inputStyle}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* MODULE I5: ASSUMPTIONS LIST WITH ESTIMATED ITEMS MARKED & EDITABLE */}
          {/* ========================================================================= */}
          {assumptionList.length > 0 && (
            <div
              style={{
                background: '#fff',
                border: '1px solid #fef3c7',
                borderRadius: 8,
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 2,
                }}
              >
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: '#92400e',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <HelpCircle size={13} color="#d97706" /> Model Assumptions ({assumptionList.length})
                </span>
                <span style={{ fontSize: 10, color: '#9ca3af' }}>Tap Edit to adjust</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {assumptionList.map((asm) => (
                  <div
                    key={asm.id}
                    style={{
                      background: asm.estimated ? '#fffdf7' : '#f0fdf4',
                      border: `1px solid ${asm.estimated ? '#fed7aa' : '#bbf7d0'}`,
                      borderRadius: 6,
                      padding: '7px 8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
                      <span
                        style={{
                          fontSize: 11,
                          color: '#1f2937',
                          lineHeight: 1.35,
                          flex: 1,
                        }}
                      >
                        {asm.text}
                      </span>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        {asm.estimated ? (
                          <span
                            style={{
                              background: '#fef3c7',
                              color: '#92400e',
                              fontSize: 9.5,
                              padding: '2px 5px',
                              borderRadius: 4,
                              fontWeight: 700,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                            }}
                          >
                            <AlertTriangle size={9} /> Estimated
                          </span>
                        ) : (
                          <span
                            style={{
                              background: '#dcfce7',
                              color: '#15803d',
                              fontSize: 9.5,
                              padding: '2px 5px',
                              borderRadius: 4,
                              fontWeight: 700,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                            }}
                          >
                            <Check size={9} /> Confirmed
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => handleToggleEditAssumption(asm.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#6d28d9',
                            cursor: 'pointer',
                            padding: '1px 3px',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                          title={asm.isEditing ? 'Close' : 'Edit assumption'}
                        >
                          <Edit2 size={11} />
                        </button>
                      </div>
                    </div>

                    {/* Inline Editor for Assumption */}
                    {asm.isEditing && (
                      <div
                        style={{
                          background: '#faf5ff',
                          border: '1px dashed #d8b4fe',
                          borderRadius: 6,
                          padding: '6px 8px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          marginTop: 3,
                        }}
                      >
                        {/* Speed assumption editing */}
                        {asm.field?.includes('speed') ? (
                          <div>
                            <div style={{ fontSize: 10.5, fontWeight: 600, color: '#6d28d9', marginBottom: 4 }}>
                              Select step speed:
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {['quick', 'normal', 'slow'].map((spd) => (
                                <button
                                  key={spd}
                                  type="button"
                                  onClick={() => {
                                    const minMax =
                                      spd === 'quick' ? '1-2m' : spd === 'normal' ? '3-8m' : '10-25m';
                                    handleUpdateAssumptionValue(
                                      asm.id,
                                      spd,
                                      `Duration for step set to ${spd} (${minMax})`
                                    );
                                  }}
                                  style={{
                                    flex: 1,
                                    padding: '4px 6px',
                                    borderRadius: 4,
                                    border: asm.value === spd ? '1.5px solid #7c3aed' : '1px solid #ddd6fe',
                                    background: asm.value === spd ? '#7c3aed' : '#fff',
                                    color: asm.value === spd ? '#fff' : '#4b5563',
                                    fontSize: 10.5,
                                    fontWeight: 600,
                                    textTransform: 'capitalize',
                                    cursor: 'pointer',
                                  }}
                                >
                                  {spd}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : asm.field === 'spaceUnits' ? (
                          /* Space Units editing */
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 10.5, color: '#4b5563', flex: 1 }}>
                              Available units / tables:
                            </span>
                            <input
                              type="number"
                              min="1"
                              defaultValue={asm.value || 10}
                              id={`input_${asm.id}`}
                              style={{
                                width: 60,
                                padding: '3px 6px',
                                borderRadius: 4,
                                border: '1px solid #d8b4fe',
                                fontSize: 11,
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const el = document.getElementById(`input_${asm.id}`);
                                const val = parseInt(el?.value, 10) || 1;
                                handleUpdateAssumptionValue(
                                  asm.id,
                                  val,
                                  `Limited space capacity set to ${val} units`
                                );
                              }}
                              style={{
                                padding: '3px 8px',
                                borderRadius: 4,
                                border: 'none',
                                background: '#7c3aed',
                                color: '#fff',
                                fontSize: 10.5,
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              Save
                            </button>
                          </div>
                        ) : (
                          /* Generic assumption edit */
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input
                              type="text"
                              defaultValue={typeof asm.value === 'object' ? JSON.stringify(asm.value) : asm.value || ''}
                              id={`input_gen_${asm.id}`}
                              placeholder="Enter stated value..."
                              style={{
                                flex: 1,
                                padding: '4px 6px',
                                borderRadius: 4,
                                border: '1px solid #d8b4fe',
                                fontSize: 11,
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const el = document.getElementById(`input_gen_${asm.id}`);
                                const val = el?.value || '';
                                handleUpdateAssumptionValue(
                                  asm.id,
                                  val,
                                  `Assumption updated: ${val}`
                                );
                              }}
                              style={{
                                padding: '3px 8px',
                                borderRadius: 4,
                                border: 'none',
                                background: '#7c3aed',
                                color: '#fff',
                                fontSize: 10.5,
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              Save
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Validation Errors banner (BLOCKS APPLY) */}
          {hasErrors && (
            <div
              style={{
                background: '#fef2f2',
                border: '1.5px solid #f87171',
                borderRadius: 8,
                padding: '8px 10px',
                color: '#b91c1c',
                fontSize: 11.5,
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  marginBottom: 4,
                }}
              >
                <AlertCircle size={14} color="#dc2626" /> Apply Blocked — BPMN Validation Errors:
              </div>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {validationErrors.map((err, i) => (
                  <li key={i} style={{ marginBottom: 2 }}>
                    {err}
                  </li>
                ))}
              </ul>
              <div style={{ fontSize: 10.5, color: '#991b1b', marginTop: 4 }}>
                Please review or fix the errors above before applying to canvas.
              </div>
            </div>
          )}

          {/* Auto-Repairs List */}
          {activeRepairs.length > 0 && (
            <div
              style={{
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: 8,
                padding: '8px 10px',
                color: '#1e40af',
                fontSize: 11.5,
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  marginBottom: 4,
                }}
              >
                <CheckCircle size={13} /> Auto-repairs Applied:
              </div>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {activeRepairs.map((r, i) => (
                  <li key={i}>{r.description || r}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Actionable Resolution when validation errors exist - Never leave a dead end */}
          {hasErrors && (
            <div
              style={{
                marginBottom: 8,
                padding: '10px 12px',
                background: '#fff',
                border: '1.5px solid #fecaca',
                borderRadius: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#b91c1c', display: 'flex', alignItems: 'center', gap: 5 }}>
                <AlertCircle size={13} />
                Action required to resolve BPMN validation:
              </div>

              {/* Action 1: Auto-repair button if repairable */}
              {activeRepairs && activeRepairs.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const patched = buildPatchedDiagram();
                    const validation = validateBpmn(patched);
                    if (validation.repaired) {
                      setValidationErrors([]);
                      onConfirm && onConfirm(validation.repaired, validation.repairs, {
                        assumptions: assumptionList,
                        simulationConfig,
                        anySalaryEstimated: false,
                      });
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: '1px solid #bfdbfe',
                    background: '#eff6ff',
                    color: '#1e40af',
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <CheckCircle size={12} /> Apply Auto-repairs & Proceed
                </button>
              )}

              {/* Action 2: "What should change?" inline box */}
              {onWhatShouldChange && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>
                    What should change?
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      value={cardCorrection}
                      onChange={(e) => setCardCorrection(e.target.value)}
                      placeholder="e.g. Add end event after packaging..."
                      style={{
                        flex: 1,
                        padding: '5px 8px',
                        fontSize: 11.5,
                        borderRadius: 6,
                        border: '1px solid #d1d5db',
                        outline: 'none',
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && cardCorrection.trim() && !cardUpdating) {
                          setCardUpdating(true);
                          Promise.resolve(onWhatShouldChange(cardCorrection.trim())).finally(() => {
                            setCardUpdating(false);
                            setCardCorrection('');
                          });
                        }
                      }}
                    />
                    <button
                      type="button"
                      disabled={!cardCorrection.trim() || cardUpdating}
                      onClick={() => {
                        setCardUpdating(true);
                        Promise.resolve(onWhatShouldChange(cardCorrection.trim())).finally(() => {
                          setCardUpdating(false);
                          setCardCorrection('');
                        });
                      }}
                      style={{
                        padding: '5px 10px',
                        borderRadius: 6,
                        border: 'none',
                        background: !cardCorrection.trim() || cardUpdating ? '#e5e7eb' : '#4f46e5',
                        color: !cardCorrection.trim() || cardUpdating ? '#9ca3af' : '#fff',
                        fontSize: 11.5,
                        fontWeight: 600,
                        cursor: !cardCorrection.trim() || cardUpdating ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {cardUpdating ? 'Updating…' : 'Update'}
                    </button>
                  </div>
                </div>
              )}

              {/* Action 3: Answer questions link */}
              {onBackToQuestions && (
                <button
                  type="button"
                  onClick={onBackToQuestions}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#4f46e5',
                    fontSize: 11,
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    textAlign: 'left',
                    padding: 0,
                  }}
                >
                  ← Answer questions to adjust process
                </button>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleConfirm}
              disabled={hasErrors}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '8px 0',
                borderRadius: 8,
                border: 'none',
                cursor: hasErrors ? 'not-allowed' : 'pointer',
                opacity: hasErrors ? 0.5 : 1,
                background: hasErrors
                  ? '#9ca3af'
                  : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                color: '#fff',
                fontSize: 12,
                fontWeight: 600,
                boxShadow: hasErrors ? 'none' : '0 2px 6px rgba(79,70,229,0.25)',
              }}
              title={hasErrors ? 'BPMN validation errors must be resolved to apply' : 'Apply to canvas'}
            >
              <CheckCircle size={13} />
              {hasErrors ? `Apply Blocked (${validationErrors.length} Errors)` : 'Confirm & Apply'}
            </button>

            {onOpenResourcePanel && (
              <button
                onClick={handleOpenPanel}
                title="Apply and open the full resource editor"
                style={{
                  padding: '7px 10px',
                  borderRadius: 8,
                  border: '1px solid #ddd6fe',
                  background: '#fff',
                  cursor: 'pointer',
                  color: '#6d28d9',
                  fontSize: 11.5,
                  fontWeight: 500,
                }}
              >
                Apply & go deeper →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}