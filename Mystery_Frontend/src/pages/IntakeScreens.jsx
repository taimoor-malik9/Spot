'use client';
import React, { useState, useMemo, useCallback } from 'react';
import {
  SPEED_MAPPINGS,
  BUSYNESS_MAPPINGS,
  DEFAULT_SPEED,
  DEFAULT_BUSYNESS,
  DEFAULT_GOAL,
  DEFAULT_HAS_LIMITED_SPACE,
  DEFAULT_SPACE_NAME,
  DEFAULT_SPACE_UNITS,
  wrapValue,
  unwrapValue,
} from '../lib/intake/schema';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  HelpCircle,
  Users,
  Clock,
  AlertTriangle,
  AlertCircle,
  Building,
  Flame,
  DollarSign,
  Target,
  Plus,
  Zap,
  Coffee,
  Activity,
  ChevronRight,
  X,
  Sparkles,
  Sliders,
  Minus,
  PenLine,
  Send,
  Loader2,
} from 'lucide-react';
import { parseTypedAnswer } from '../lib/apiService';
import { useAuth } from '@/context/AuthContext';
import { t, formatDurationHint, validateCustomRange } from '../lib/intake/i18n';

/**
 * Filters active task nodes for intake screens.
 * Screens 1 and 2 skip inferred steps that were not Kept.
 */
export function getActiveTaskNodes(rawDiagram) {
  if (!rawDiagram?.nodes || !Array.isArray(rawDiagram.nodes)) return [];
  return rawDiagram.nodes.filter((n) => {
    if (n.type !== 'task' && !n.type?.endsWith('-task')) return false;
    const isInferred = n.origin === 'inferred' || n.data?.origin === 'inferred';
    const isKept = n.kept === true || n.data?.kept === true;
    if (isInferred && !isKept) return false;
    return true;
  });
}

/**
 * Checks if a specific intake screen is already definitively answered by the raw diagram.
 */
export function isScreenAnswered(screenId, rawDiagram, activeNodes = null) {
  const nodes = activeNodes || getActiveTaskNodes(rawDiagram);

  switch (screenId) {
    case 1: {
      // Who handles each step: Answered if all active tasks have stated staff
      if (!nodes.length) return true;
      if (rawDiagram?.staffAnswered === true || rawDiagram?.staffSource === 'stated') return true;
      const staffList = (rawDiagram?.resources || []).filter((r) => r.type === 'staff');
      return nodes.every((n) => {
        const hasRes =
          (n.data?.resources && Object.keys(n.data.resources).length > 0) ||
          Boolean(n.data?.resource);
        if (!hasRes) return false;
        const resName = n.data?.resource || Object.keys(n.data?.resources || {})[0];
        const resObj = staffList.find((r) => r.name === resName || r.id === resName);
        return resObj?.quantitySource === 'stated' || resObj?.source === 'stated';
      });
    }

    case 2: {
      // Speed per step: Answered if every active task has duration_source === 'stated'
      if (!nodes.length) return true;
      if (rawDiagram?.speedAnswered === true || rawDiagram?.speedSource === 'stated') return true;
      return nodes.every(
        (n) => (n.data?.duration_source === 'stated' || n.duration_source === 'stated') && n.data?.duration != null
      );
    }

    case 3: {
      // How busy is rush hour: Answered if busyness is explicitly stated in diagram
      return Boolean(
        rawDiagram?.simulationConfig?.busynessSource === 'stated' ||
        rawDiagram?.busynessSource === 'stated' ||
        rawDiagram?.simulationConfig?.busyness_source === 'stated' ||
        rawDiagram?.busynessAnswered === true
      );
    }

    case 4: {
      // Does it ever go wrong: Answered if exceptions are explicitly stated
      return Boolean(
        rawDiagram?.exceptionsAnswered === true ||
        rawDiagram?.exceptionsSource === 'stated' ||
        rawDiagram?.exceptions_source === 'stated'
      );
    }

    case 5: {
      // Do customers ever wait for a table/seat/room: Answered if facility resource is stated
      if (rawDiagram?.spaceAnswered === true || rawDiagram?.spaceSource === 'stated') return true;
      return Boolean(
        (rawDiagram?.resources || []).some(
          (r) => r.type === 'facility' && (r.quantitySource === 'stated' || r.source === 'stated')
        )
      );
    }

    case 6: {
      // Goal: Answered if optimization goal is stated
      return Boolean(
        rawDiagram?.simulationConfig?.goalSource === 'stated' ||
        rawDiagram?.goalSource === 'stated' ||
        rawDiagram?.simulationConfig?.goal_source === 'stated' ||
        rawDiagram?.goalAnswered === true
      );
    }

    case 7: {
      // Add costs: Answered if all staff resources have costSource === 'stated'
      if (rawDiagram?.costsAnswered === true || rawDiagram?.costsSource === 'stated') return true;
      const staffRes = (rawDiagram?.resources || []).filter((r) => r.type === 'staff');
      const hasTaskStaff = nodes.some(
        (n) => (n.data?.resources && Object.keys(n.data.resources).length > 0) || Boolean(n.data?.resource)
      );
      if (!staffRes.length && !hasTaskStaff) return true;
      if (!staffRes.length) return false;
      return staffRes.every((r) => r.costSource === 'stated' || r.cost_source === 'stated');
    }

    default:
      return false;
  }
}

/**
 * Returns available staff roles from diagram resources with sensible fallbacks.
 */
export function getAvailableStaffRoles(rawDiagram) {
  const staff = (rawDiagram?.resources || [])
    .filter((r) => r.type === 'staff' && r.name)
    .map((r) => r.name);
  return Array.from(new Set(staff));
}

/**
 * Initializes answer state pre-filled from rawDiagram.
 */
export function initializeIntakeAnswers(rawDiagram, activeNodes) {
  const nodes = activeNodes || getActiveTaskNodes(rawDiagram);
  const steps = {};

  (rawDiagram?.nodes || []).forEach((n) => {
    if (n.type !== 'task' && !n.type?.endsWith('-task')) return;
    const isInferred = n.origin === 'inferred' || n.data?.origin === 'inferred';
    const isKept = n.kept === true || n.data?.kept === true;

    if (isInferred && !isKept) {
      steps[n.id] = {
        speed: wrapValue(DEFAULT_SPEED, 'default', true),
        staffRoles: wrapValue([], 'default', true),
        kept: false,
      };
      return;
    }

    // Pre-fill speed from duration
    const d = Number(n.data?.duration) || 5;
    let initialSpeed = 'normal';
    if (d <= 2) initialSpeed = 'quick';
    else if (d >= 10) initialSpeed = 'slow';

    const isStatedDuration = n.data?.duration_source === 'stated';

    // Pre-fill staff roles
    const existingRoles = [];
    if (n.data?.resources && typeof n.data.resources === 'object') {
      existingRoles.push(...Object.keys(n.data.resources));
    } else if (n.data?.resource) {
      existingRoles.push(n.data.resource);
    }

    const defaultMin = n.data?.duration_min != null ? Number(n.data.duration_min) : SPEED_MAPPINGS[initialSpeed].duration_min;
    const defaultMax = n.data?.duration_max != null ? Number(n.data.duration_max) : SPEED_MAPPINGS[initialSpeed].duration_max;
    const defaultUnit = n.data?.duration_unit || SPEED_MAPPINGS[initialSpeed].duration_unit || 'minutes';

    steps[n.id] = {
      speed: wrapValue(initialSpeed, isStatedDuration ? 'tap' : 'default', !isStatedDuration),
      duration_min: defaultMin,
      duration_max: defaultMax,
      duration: defaultMin === defaultMax ? defaultMin : Math.round((defaultMin + defaultMax) / 2),
      duration_unit: defaultUnit,
      source: isStatedDuration ? 'bucket' : 'estimated',
      staffRoles: wrapValue(existingRoles, 'default', existingRoles.length === 0),
      kept: isKept || !isInferred,
    };
  });

  // Pre-fill busyness
  const initialBusyness =
    rawDiagram?.simulationConfig?.busyness || rawDiagram?.busyness || DEFAULT_BUSYNESS;

  // Pre-fill exceptions from diagram edge labels if available
  const detectedExceptions = [];
  (rawDiagram?.edges || []).forEach((e) => {
    const lbl = String(e.data?.label || e.label || '').toLowerCase();
    if (lbl.includes('stock') || lbl.includes('unavailable')) detectedExceptions.push('Out of stock');
    if (lbl.includes('refund') || lbl.includes('return')) detectedExceptions.push('Refund');
    if (lbl.includes('leave') || lbl.includes('cancel') || lbl.includes('walkout')) detectedExceptions.push('Customer leaves');
  });

  // Pre-fill space
  const fac = (rawDiagram?.resources || []).find((r) => r.type === 'facility');
  const hasSpace = Boolean(fac);
  const spaceName = fac?.name || DEFAULT_SPACE_NAME;
  const spaceUnits = Number(fac?.quantity) || DEFAULT_SPACE_UNITS;

  // Pre-fill costs
  const costs = {};
  (rawDiagram?.resources || []).forEach((r) => {
    if (r.type === 'staff') {
      costs[r.name] = Number(r.monthly_salary) || 50000;
    }
  });

  return {
    steps,
    busyness: wrapValue(initialBusyness, 'default', true),
    exceptions: wrapValue(
      detectedExceptions.length ? Array.from(new Set(detectedExceptions)) : [],
      'default',
      detectedExceptions.length === 0
    ),
    hasLimitedSpace: wrapValue(hasSpace, 'default', !hasSpace),
    spaceName: wrapValue(spaceName, 'default', !hasSpace),
    spaceUnits: wrapValue(spaceUnits, 'default', !hasSpace),
    spaceStepId: wrapValue(nodes[0]?.id || null, 'default', true),
    goal: wrapValue(DEFAULT_GOAL, 'default', true),
    costs: wrapValue(costs, 'default', true),
  };
}

/**
 * Builds the final answers payload conforming to the I1 schema.
 */
export function buildFinalAnswers(rawDiagram, answersState, activeNodes) {
  const allNodes = rawDiagram?.nodes || [];
  const finalSteps = {};

  allNodes.forEach((n) => {
    if (n.type !== 'task' && !n.type?.endsWith('-task')) return;
    const isInferred = n.origin === 'inferred' || n.data?.origin === 'inferred';
    const isKept = n.kept === true || n.data?.kept === true;

    if (isInferred && !isKept) {
      finalSteps[n.id] = {
        speed: wrapValue(DEFAULT_SPEED, 'default', true),
        staffRoles: wrapValue([], 'default', true),
        kept: false,
      };
      return;
    }

    const currentStep = answersState.steps?.[n.id];
    const speedVal = currentStep?.speed?.value || DEFAULT_SPEED;
    const isEstimated = Boolean(currentStep?.speed?.estimated || currentStep?.source === 'estimated');
    const isCustom = speedVal === 'custom' || currentStep?.source === 'custom';

    let min = currentStep?.duration_min;
    let max = currentStep?.duration_max;
    let unit = currentStep?.duration_unit || 'minutes';

    if (min == null || max == null) {
      const bucket = SPEED_MAPPINGS[speedVal] || SPEED_MAPPINGS[DEFAULT_SPEED];
      min = bucket.duration_min;
      max = bucket.duration_max;
      unit = bucket.duration_unit;
    }

    const numMin = Number(min);
    const numMax = Number(max);
    let duration;
    if (isCustom) {
      duration = numMin === numMax ? numMin : (currentStep?.duration != null ? Number(currentStep.duration) : Math.round((numMin + numMax) / 2));
    } else {
      const bucket = SPEED_MAPPINGS[speedVal] || SPEED_MAPPINGS[DEFAULT_SPEED];
      duration = bucket.duration;
    }
    const source = isEstimated ? 'estimated' : (isCustom ? 'custom' : 'bucket');

    finalSteps[n.id] = {
      speed: currentStep?.speed || wrapValue(DEFAULT_SPEED, 'default', true),
      duration_min: numMin,
      duration_max: numMax,
      duration,
      duration_unit: unit,
      source,
      staffRoles: currentStep?.staffRoles || wrapValue([], 'default', true),
      kept: true,
    };
  });

  return {
    steps: finalSteps,
    busyness: answersState.busyness !== undefined ? answersState.busyness : wrapValue(DEFAULT_BUSYNESS, 'default', true),
    exceptions: answersState.exceptions !== undefined ? answersState.exceptions : wrapValue([], 'default', true),
    hasLimitedSpace: answersState.hasLimitedSpace !== undefined ? answersState.hasLimitedSpace : wrapValue(DEFAULT_HAS_LIMITED_SPACE, 'default', true),
    spaceName: answersState.spaceName !== undefined ? answersState.spaceName : wrapValue(DEFAULT_SPACE_NAME, 'default', true),
    spaceUnits: answersState.spaceUnits !== undefined ? answersState.spaceUnits : wrapValue(DEFAULT_SPACE_UNITS, 'default', true),
    spaceStepId: answersState.spaceStepId !== undefined ? answersState.spaceStepId : wrapValue(activeNodes?.[0]?.id || null, 'default', true),
    goal: answersState.goal !== undefined ? answersState.goal : wrapValue(DEFAULT_GOAL, 'default', true),
    costs: answersState.costs !== undefined ? answersState.costs : wrapValue({}, 'default', true),
  };
}

const COMMON_FALLBACK_ROLES = ['Staff', 'Cashier', 'Barista', 'Manager', 'Technician'];
const COMMON_SPACE_PRESETS = ['Table', 'Room', 'Seat', 'Desk', 'Booth', 'Bay'];

export default function IntakeScreens({
  rawDiagram,
  onComplete,
  onBack,
  initialAnswers = null,
  lang = 'en',
}) {
  const auth = useAuth();
  const currencySymbol = auth?.user?.currency || 'Rs';
  const activeNodes = useMemo(() => getActiveTaskNodes(rawDiagram), [rawDiagram]);

  // Determine active screens that the diagram does not already answer
  const activeScreens = useMemo(() => {
    const allScreens = [1, 2, 3, 4, 5, 6, 7];
    return allScreens.filter((id) => !isScreenAnswered(id, rawDiagram, activeNodes));
  }, [rawDiagram, activeNodes]);

  const [currentIndex, setCurrentIndex] = useState(0);

  // Intake answers state
  const [answers, setAnswers] = useState(() => {
    if (initialAnswers) return initialAnswers;
    return initializeIntakeAnswers(rawDiagram, activeNodes);
  });

  // Track which cards have custom duration editor opened
  const [openCustomCards, setOpenCustomCards] = useState(() => new Set());

  // Local helper state for role/space creation
  const [customRoleInput, setCustomRoleInput] = useState('');
  const [customRolesList, setCustomRolesList] = useState([]);

  const availableStaffRoles = useMemo(() => {
    const fromDiag = getAvailableStaffRoles(rawDiagram);
    const combined = [...fromDiag, ...customRolesList];
    return combined.length > 0 ? Array.from(new Set(combined)) : COMMON_FALLBACK_ROLES;
  }, [rawDiagram, customRolesList]);

  // Module I4: "Type instead" and proposal state
  const [isTyping, setIsTyping] = useState(false);
  const [typedText, setTypedText] = useState('');
  const [parsingLoading, setParsingLoading] = useState(false);
  const [proposal, setProposal] = useState(null); // { text, proposedValue }
  const [fallbackTip, setFallbackTip] = useState(null);

  // Current screen identifier (1..7)
  const currentScreenId = activeScreens[currentIndex] ?? null;
  const isLastScreen = currentIndex >= activeScreens.length - 1;

  // Validation: Check if any card has invalid custom duration on Screen 2
  const hasInvalidCustomDuration = useMemo(() => {
    if (currentScreenId !== 2) return false;
    return activeNodes.some((node) => {
      const stepData = answers.steps?.[node.id];
      const speedVal = stepData?.speed?.value;
      const isOpen = speedVal === 'custom' || openCustomCards.has(node.id);
      if (speedVal === 'custom' || isOpen) {
        const err = validateCustomRange(stepData?.duration_min, stepData?.duration_max, lang);
        return Boolean(err);
      }
      return false;
    });
  }, [currentScreenId, activeNodes, answers.steps, openCustomCards, lang]);

  // Reset typing state when switching screens
  React.useEffect(() => {
    setIsTyping(false);
    setTypedText('');
    setProposal(null);
    setFallbackTip(null);
  }, [currentIndex]);

  const applyParsedValue = useCallback(
    (val, source = 'typed') => {
      setAnswers((prev) => {
        const next = { ...prev };

        switch (currentScreenId) {
          case 1: {
            if (val.steps) {
              const nextSteps = { ...next.steps };
              const newRoles = [];
              Object.entries(val.steps).forEach(([nodeId, sVal]) => {
                if (Array.isArray(sVal.staffRoles)) {
                  nextSteps[nodeId] = {
                    ...(nextSteps[nodeId] || {}),
                    staffRoles: wrapValue(sVal.staffRoles, source, false),
                  };
                  newRoles.push(...sVal.staffRoles);
                }
              });
              next.steps = nextSteps;
              if (newRoles.length > 0) {
                setCustomRolesList((rList) => Array.from(new Set([...rList, ...newRoles])));
              }
            }
            break;
          }

          case 2: {
            if (val.steps) {
              const nextSteps = { ...next.steps };
              Object.entries(val.steps).forEach(([nodeId, sVal]) => {
                if (sVal.speed) {
                  nextSteps[nodeId] = {
                    ...(nextSteps[nodeId] || {}),
                    speed: wrapValue(sVal.speed, source, false),
                  };
                }
              });
              next.steps = nextSteps;
            }
            break;
          }

          case 3: {
            if (val.busyness) {
              next.busyness = wrapValue(val.busyness, source, false);
            }
            break;
          }

          case 4: {
            if (Array.isArray(val.exceptions)) {
              next.exceptions = wrapValue(val.exceptions, source, false);
            }
            break;
          }

          case 5: {
            if (val.hasLimitedSpace !== undefined) {
              next.hasLimitedSpace = wrapValue(Boolean(val.hasLimitedSpace), source, false);
            }
            if (val.spaceName) {
              next.spaceName = wrapValue(val.spaceName, source, false);
            }
            if (val.spaceUnits !== undefined) {
              next.spaceUnits = wrapValue(Number(val.spaceUnits) || DEFAULT_SPACE_UNITS, source, false);
            }
            break;
          }

          case 6: {
            if (val.goal) {
              next.goal = wrapValue(val.goal, source, false);
            }
            break;
          }

          case 7: {
            if (val.costs && typeof val.costs === 'object') {
              const currentCosts = { ...(prev.costs?.value || {}) };
              Object.entries(val.costs).forEach(([k, v]) => {
                currentCosts[k] = Number(v) || 0;
              });
              next.costs = wrapValue(currentCosts, source, false);
            }
            break;
          }

          default:
            break;
        }

        return next;
      });
    },
    [currentScreenId]
  );

  const handleParseSubmit = async () => {
    if (!typedText.trim() || parsingLoading) return;
    setParsingLoading(true);
    setProposal(null);
    setFallbackTip(null);

    try {
      const res = await parseTypedAnswer(currentScreenId, typedText.trim(), answers, rawDiagram);

      if (res.fallback) {
        setFallbackTip(
          "Couldn't interpret automatically. Please tap one of the choices above or try rephrasing."
        );
        return;
      }

      if (res.proposal && res.proposedValue) {
        setProposal({
          text: res.proposal,
          proposedValue: res.proposedValue,
        });
        return;
      }

      if (res.value) {
        applyParsedValue(res.value, 'typed');
        setIsTyping(false);
        setTypedText('');
      }
    } catch (err) {
      console.warn('parseTypedAnswer error:', err);
      setFallbackTip(
        "Couldn't connect to AI parser. Please tap one of the choices above."
      );
    } finally {
      setParsingLoading(false);
    }
  };

  const handleAcceptProposal = () => {
    if (!proposal?.proposedValue) return;
    applyParsedValue(proposal.proposedValue, 'tap');
    setProposal(null);
    setIsTyping(false);
    setTypedText('');
  };

  // Handle immediate completion if all screens were already answered
  React.useEffect(() => {
    if (activeScreens.length === 0 && onComplete) {
      const finalPayload = buildFinalAnswers(rawDiagram, answers, activeNodes);
      onComplete(finalPayload);
    }
  }, [activeScreens, onComplete, rawDiagram, answers, activeNodes]);

  // Navigation handlers
  const handleNext = useCallback(
    (overrideAnswers = null) => {
      const effectiveAnswers = overrideAnswers || answers;
      if (isLastScreen) {
        if (onComplete) {
          const finalPayload = buildFinalAnswers(rawDiagram, effectiveAnswers, activeNodes);
          onComplete(finalPayload);
        }
      } else {
        setCurrentIndex((i) => Math.min(activeScreens.length - 1, i + 1));
      }
    },
    [answers, isLastScreen, onComplete, rawDiagram, activeNodes, activeScreens.length]
  );

  const handleBackNav = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
    } else if (onBack) {
      onBack();
    }
  }, [currentIndex, onBack]);

  const handleSkip = useCallback(() => {
    handleNext();
  }, [handleNext]);

  // "Not sure" on every screen: maps to default flagged estimated: true
  const handleNotSure = useCallback(() => {
    setAnswers((prev) => {
      const next = { ...prev };

      switch (currentScreenId) {
        case 1: {
          // Set all active tasks to empty staff roles marked estimated
          const updatedSteps = { ...next.steps };
          activeNodes.forEach((n) => {
            updatedSteps[n.id] = {
              ...(updatedSteps[n.id] || {}),
              staffRoles: wrapValue([], 'tap', true),
            };
          });
          next.steps = updatedSteps;
          break;
        }

        case 2: {
          // Set all active tasks to normal speed marked estimated
          const updatedSteps = { ...next.steps };
          const bucket = SPEED_MAPPINGS[DEFAULT_SPEED];
          activeNodes.forEach((n) => {
            updatedSteps[n.id] = {
              ...(updatedSteps[n.id] || {}),
              speed: wrapValue(DEFAULT_SPEED, 'tap', true),
              duration_min: bucket.duration_min,
              duration_max: bucket.duration_max,
              duration: bucket.duration,
              duration_unit: bucket.duration_unit,
              source: 'estimated',
            };
          });
          next.steps = updatedSteps;
          break;
        }

        case 3: {
          next.busyness = wrapValue(DEFAULT_BUSYNESS, 'tap', true);
          break;
        }

        case 4: {
          next.exceptions = wrapValue([], 'tap', true);
          break;
        }

        case 5: {
          next.hasLimitedSpace = wrapValue(false, 'tap', true);
          break;
        }

        case 6: {
          next.goal = wrapValue(DEFAULT_GOAL, 'tap', true);
          break;
        }

        case 7: {
          next.costs = wrapValue(prev.costs?.value || {}, 'tap', true);
          break;
        }

        default:
          break;
      }

      setTimeout(() => handleNext(next), 0);
      return next;
    });
  }, [currentScreenId, activeNodes, handleNext]);

  if (activeScreens.length === 0) {
    return null;
  }

  // --- Handlers for Screen 1: Who handles each step ---
  const handleToggleStaffRole = (nodeId, role) => {
    setAnswers((prev) => {
      const currentRoles = prev.steps?.[nodeId]?.staffRoles?.value || [];
      const isSelected = currentRoles.includes(role);
      const newRoles = isSelected
        ? currentRoles.filter((r) => r !== role)
        : [...currentRoles, role];

      return {
        ...prev,
        steps: {
          ...prev.steps,
          [nodeId]: {
            ...(prev.steps?.[nodeId] || {}),
            staffRoles: wrapValue(newRoles, 'tap', false),
          },
        },
      };
    });
  };

  const handleAddCustomRole = () => {
    const trimmed = customRoleInput.trim();
    if (!trimmed) return;
    setCustomRolesList((prev) => Array.from(new Set([...prev, trimmed])));
    setCustomRoleInput('');
  };

  // --- Handlers for Screen 2: Speed per step & Custom Duration ---
  const handleSetSpeed = (nodeId, speed) => {
    const bucket = SPEED_MAPPINGS[speed] || SPEED_MAPPINGS.normal;
    setAnswers((prev) => {
      const current = prev.steps?.[nodeId] || {};
      return {
        ...prev,
        steps: {
          ...prev.steps,
          [nodeId]: {
            ...current,
            speed: wrapValue(speed, 'tap', false),
            duration_min: bucket.duration_min,
            duration_max: bucket.duration_max,
            duration: bucket.duration,
            duration_unit: bucket.duration_unit || current.duration_unit || 'minutes',
            source: 'bucket',
          },
        },
      };
    });
  };

  const handleSelectCustom = (nodeId) => {
    setAnswers((prev) => {
      const current = prev.steps?.[nodeId] || {};
      const currentSpeed = current.speed?.value;
      const bucket = SPEED_MAPPINGS[currentSpeed] || SPEED_MAPPINGS.normal;
      const min = current.duration_min != null ? current.duration_min : bucket.duration_min;
      const max = current.duration_max != null ? current.duration_max : bucket.duration_max;
      const unit = current.duration_unit || bucket.duration_unit || 'minutes';
      const numMin = Number(min);
      const numMax = Number(max);

      return {
        ...prev,
        steps: {
          ...prev.steps,
          [nodeId]: {
            ...current,
            speed: wrapValue('custom', 'typed', false),
            duration_min: min,
            duration_max: max,
            duration: numMin === numMax ? numMin : Math.round((numMin + numMax) / 2),
            duration_unit: unit,
            source: 'custom',
          },
        },
      };
    });
    setOpenCustomCards((prev) => new Set([...prev, nodeId]));
  };

  const handleCustomNumberChange = (nodeId, field, rawValue) => {
    setAnswers((prev) => {
      const current = prev.steps?.[nodeId] || {};
      const currentMin = current.duration_min != null ? current.duration_min : 3;
      const currentMax = current.duration_max != null ? current.duration_max : 8;
      const newMin = field === 'min' ? rawValue : currentMin;
      const newMax = field === 'max' ? rawValue : currentMax;
      const unit = current.duration_unit || 'minutes';

      const numMin = Number(newMin);
      const numMax = Number(newMax);
      const isFixed = !isNaN(numMin) && !isNaN(numMax) && numMin === numMax;
      const durationVal = isFixed ? numMin : (!isNaN(numMin) && !isNaN(numMax) ? Math.round((numMin + numMax) / 2) : 0);

      return {
        ...prev,
        steps: {
          ...prev.steps,
          [nodeId]: {
            ...current,
            speed: wrapValue('custom', 'typed', false),
            duration_min: newMin === '' ? '' : (isNaN(numMin) ? newMin : numMin),
            duration_max: newMax === '' ? '' : (isNaN(numMax) ? newMax : numMax),
            duration: durationVal,
            duration_unit: unit,
            source: 'custom',
          },
        },
      };
    });
    setOpenCustomCards((prev) => new Set([...prev, nodeId]));
  };

  const handleCustomUnitChange = (nodeId, newUnit) => {
    setAnswers((prev) => {
      const current = prev.steps?.[nodeId] || {};
      return {
        ...prev,
        steps: {
          ...prev.steps,
          [nodeId]: {
            ...current,
            speed: wrapValue('custom', 'typed', false),
            duration_unit: newUnit,
            source: 'custom',
          },
        },
      };
    });
    setOpenCustomCards((prev) => new Set([...prev, nodeId]));
  };

  // --- Handlers for Screen 3: Busyness ---
  const handleSetBusyness = (level) => {
    setAnswers((prev) => ({
      ...prev,
      busyness: wrapValue(level, 'tap', false),
    }));
  };

  // --- Handlers for Screen 4: Exceptions ---
  const handleToggleException = (item) => {
    setAnswers((prev) => {
      const current = prev.exceptions?.value || [];
      if (item === 'Nothing') {
        const isSelected = current.includes('Nothing');
        return {
          ...prev,
          exceptions: wrapValue(isSelected ? [] : ['Nothing'], 'tap', false),
        };
      }

      const filtered = current.filter((x) => x !== 'Nothing');
      const isSelected = filtered.includes(item);
      const nextList = isSelected
        ? filtered.filter((x) => x !== item)
        : [...filtered, item];

      return {
        ...prev,
        exceptions: wrapValue(nextList, 'tap', false),
      };
    });
  };

  // --- Handlers for Screen 5: Space ---
  const handleSetSpaceEnabled = (enabled) => {
    setAnswers((prev) => ({
      ...prev,
      hasLimitedSpace: wrapValue(enabled, 'tap', false),
    }));
  };

  const handleSetSpaceName = (name) => {
    setAnswers((prev) => ({
      ...prev,
      spaceName: wrapValue(name, 'typed', false),
    }));
  };

  const handleSetSpaceUnits = (deltaOrVal) => {
    setAnswers((prev) => {
      const current = Number(prev.spaceUnits?.value) || DEFAULT_SPACE_UNITS;
      const nextUnits =
        typeof deltaOrVal === 'function'
          ? deltaOrVal(current)
          : Math.max(1, current + deltaOrVal);
      return {
        ...prev,
        spaceUnits: wrapValue(Math.max(1, nextUnits), 'typed', false),
      };
    });
  };

  // --- Handlers for Screen 6: Goal ---
  const handleSetGoal = (goal) => {
    setAnswers((prev) => ({
      ...prev,
      goal: wrapValue(goal, 'tap', false),
    }));
  };

  // --- Handlers for Screen 7: Add costs ---
  const handleSetSalary = (role, salary) => {
    setAnswers((prev) => {
      const currentCosts = { ...(prev.costs?.value || {}) };
      currentCosts[role] = Math.max(0, Number(salary) || 0);
      return {
        ...prev,
        costs: wrapValue(currentCosts, 'typed', false),
      };
    });
  };

  // Get distinct staff roles used across tasks or defined
  const assignedStaffRoles = useMemo(() => {
    const rolesFromSteps = new Set();
    Object.values(answers.steps || {}).forEach((s) => {
      const list = s?.staffRoles?.value || [];
      list.forEach((r) => rolesFromSteps.add(r));
    });
    (rawDiagram?.resources || []).forEach((r) => {
      if (r.type === 'staff' && r.name) rolesFromSteps.add(r.name);
    });
    return Array.from(rolesFromSteps);
  }, [answers.steps, rawDiagram]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        background: '#fff',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {/* Top Navigation & Progress Bar */}
      <div
        style={{
          padding: '12px 14px 10px',
          background: '#fff',
          borderBottom: '1px solid #f3f4f6',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <button
            onClick={handleBackNav}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'none',
              border: 'none',
              color: '#6d28d9',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <ArrowLeft size={14} /> Back
          </button>

          <span
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              color: '#4f46e5',
              letterSpacing: 0.3,
            }}
          >
            Step {currentIndex + 1} of {activeScreens.length}
          </span>

          <button
            onClick={handleSkip}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              background: 'none',
              border: 'none',
              color: '#6b7280',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            Skip <ArrowRight size={13} />
          </button>
        </div>

        {/* Progress Track */}
        <div
          style={{
            height: 5,
            background: '#ede9fe',
            borderRadius: 999,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${((currentIndex + 1) / activeScreens.length) * 100}%`,
              background: 'linear-gradient(90deg, #4f46e5, #7c3aed)',
              borderRadius: 999,
              transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />
        </div>
      </div>

      {/* Screen Body Content (Scrollable) */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {/* ========================================================================= */}
        {/* SCREEN 1: WHO HANDLES EACH STEP */}
        {/* ========================================================================= */}
        {currentScreenId === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <Users size={16} color="#7c3aed" />
                <h3 style={{ fontSize: 13.5, fontWeight: 700, color: '#111827', margin: 0 }}>
                  Who handles each step?
                </h3>
              </div>
              <p style={{ fontSize: 11.5, color: '#6b7280', margin: 0, lineHeight: 1.4 }}>
                Tap the staff role responsible for each activity in your process.
              </p>
            </div>

            {/* Quick Add Custom Role */}
            <div
              style={{
                display: 'flex',
                gap: 6,
                padding: '6px 8px',
                background: '#faf5ff',
                borderRadius: 8,
                border: '1px dashed #ddd6fe',
              }}
            >
              <input
                type="text"
                placeholder="+ Add another role (e.g. Host, Specialist)"
                value={customRoleInput}
                onChange={(e) => setCustomRoleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddCustomRole();
                }}
                style={{
                  flex: 1,
                  fontSize: 11.5,
                  padding: '4px 6px',
                  borderRadius: 6,
                  border: '1px solid #e9d5ff',
                  outline: 'none',
                  background: '#fff',
                }}
              />
              <button
                onClick={handleAddCustomRole}
                style={{
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#7c3aed',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Add
              </button>
            </div>

            {/* Active Task Steps */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {activeNodes.map((node, idx) => {
                const nodeLabel = node.data?.label || node.label || node.id;
                const selectedRoles = answers.steps?.[node.id]?.staffRoles?.value || [];

                return (
                  <div
                    key={node.id}
                    style={{
                      background: '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: 10,
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          background: '#ede9fe',
                          color: '#6d28d9',
                          fontSize: 10,
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {idx + 1}
                      </span>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1f2937' }}>
                        {nodeLabel}
                      </span>
                    </div>

                    {/* Role Chips */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {availableStaffRoles.map((role) => {
                        const isSelected = selectedRoles.includes(role);
                        return (
                          <button
                            key={role}
                            type="button"
                            onClick={() => handleToggleStaffRole(node.id, role)}
                            style={{
                              padding: '6px 11px',
                              borderRadius: 20,
                              border: isSelected
                                ? '1.5px solid #7c3aed'
                                : '1px solid #e5e7eb',
                              background: isSelected ? '#faf5ff' : '#f9fafb',
                              color: isSelected ? '#6d28d9' : '#4b5563',
                              fontSize: 11.5,
                              fontWeight: isSelected ? 600 : 500,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              minHeight: 32,
                            }}
                          >
                            {isSelected && <Check size={12} color="#7c3aed" />}
                            {role}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SCREEN 2: SPEED PER STEP & CUSTOM DURATION */}
        {/* ========================================================================= */}
        {currentScreenId === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <Clock size={16} color="#7c3aed" />
                <h3 style={{ fontSize: 13.5, fontWeight: 700, color: '#111827', margin: 0 }}>
                  {t('howFastIsEachStep', lang)}
                </h3>
              </div>
              <p style={{ fontSize: 11.5, color: '#6b7280', margin: 0, lineHeight: 1.4 }}>
                {t('howFastHelp', lang)}
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {activeNodes.map((node, idx) => {
                const nodeLabel = node.data?.label || node.label || node.id;
                const stepData = answers.steps?.[node.id];
                const currentSpeed = stepData?.speed?.value || DEFAULT_SPEED;
                const isEstimated = Boolean(stepData?.speed?.estimated || stepData?.source === 'estimated');
                const isCustom = currentSpeed === 'custom';
                const isEditorOpen = isCustom || openCustomCards.has(node.id);

                const minVal = stepData?.duration_min !== undefined ? stepData.duration_min : (SPEED_MAPPINGS[currentSpeed]?.duration_min ?? 3);
                const maxVal = stepData?.duration_max !== undefined ? stepData.duration_max : (SPEED_MAPPINGS[currentSpeed]?.duration_max ?? 8);
                const unitVal = stepData?.duration_unit || SPEED_MAPPINGS[currentSpeed]?.duration_unit || 'minutes';

                const customError = isEditorOpen ? validateCustomRange(minVal, maxVal, lang) : null;
                const unitDisplay = unitVal === 'seconds' ? t('unitDropdownSec', lang) : (unitVal === 'hours' ? t('unitDropdownHours', lang) : t('unitDropdownMin', lang));

                const customSub = isCustom && minVal && maxVal && !customError
                  ? (Number(minVal) === Number(maxVal) ? `${minVal} ${unitDisplay}` : `${minVal}–${maxVal} ${unitDisplay}`)
                  : t('customSub', lang);

                return (
                  <div
                    key={node.id}
                    style={{
                      background: '#fff',
                      border: customError ? '1.5px solid #fecaca' : '1px solid #e5e7eb',
                      borderRadius: 10,
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    {/* Header: Number, Step Label, and Estimated Tag if applicable */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <span
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            background: '#ede9fe',
                            color: '#6d28d9',
                            fontSize: 10,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {idx + 1}
                        </span>
                        <span
                          style={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: '#1f2937',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={nodeLabel}
                        >
                          {nodeLabel}
                        </span>
                      </div>

                      {isEstimated && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: '#6b7280',
                            background: '#f3f4f6',
                            border: '1px solid #e5e7eb',
                            padding: '1px 6px',
                            borderRadius: 4,
                            flexShrink: 0,
                          }}
                        >
                          {t('estimated', lang)}
                        </span>
                      )}
                    </div>

                    {/* Speed 4-Tap Buttons */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                      {[
                        { key: 'quick', label: t('quick', lang), sub: t('quickSub', lang) },
                        { key: 'normal', label: t('normal', lang), sub: t('normalSub', lang) },
                        { key: 'slow', label: t('slow', lang), sub: t('slowSub', lang) },
                        { key: 'custom', label: t('custom', lang), sub: customSub },
                      ].map((opt) => {
                        const isSelected = currentSpeed === opt.key;
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => {
                              if (opt.key === 'custom') {
                                handleSelectCustom(node.id);
                              } else {
                                handleSetSpeed(node.id, opt.key);
                              }
                            }}
                            style={{
                              minHeight: 48,
                              padding: '4px 2px',
                              borderRadius: 8,
                              border: isSelected
                                ? '1.5px solid #7c3aed'
                                : '1px solid #e5e7eb',
                              background: isSelected ? '#7c3aed' : '#fafafa',
                              color: isSelected ? '#fff' : '#374151',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 2,
                              boxShadow: isSelected
                                ? '0 2px 6px rgba(124,58,237,0.2)'
                                : 'none',
                            }}
                          >
                            <span style={{ fontSize: 12, fontWeight: 700 }}>
                              {opt.label}
                            </span>
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                if (opt.key === 'custom') {
                                  handleSelectCustom(node.id);
                                } else {
                                  handleSetSpeed(node.id, opt.key);
                                  setOpenCustomCards((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(node.id) && currentSpeed === opt.key) {
                                      next.delete(node.id);
                                    } else {
                                      next.add(node.id);
                                    }
                                    return next;
                                  });
                                }
                              }}
                              title={opt.key !== 'custom' ? (lang === 'ur-roman' ? 'Waqt customize karein' : 'Click to customize range') : ''}
                              style={{
                                fontSize: 9.5,
                                color: isSelected ? 'rgba(255,255,255,0.85)' : '#6b7280',
                                textDecoration: opt.key !== 'custom' ? 'underline dotted' : 'none',
                              }}
                            >
                              {opt.sub}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Inline Custom Duration Editor (Requirement 2 & 3) */}
                    {isEditorOpen && (
                      <div
                        style={{
                          marginTop: 4,
                          padding: '8px 10px',
                          background: '#faf5ff',
                          border: customError ? '1.5px solid #fecaca' : '1px solid #ddd6fe',
                          borderRadius: 8,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          {/* Min */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#5b21b6' }}>
                              {t('minLabel', lang)}:
                            </span>
                            <input
                              type="number"
                              min="1"
                              value={minVal !== undefined && minVal !== null ? minVal : ''}
                              onChange={(e) => handleCustomNumberChange(node.id, 'min', e.target.value)}
                              style={{
                                width: 54,
                                padding: '3px 6px',
                                fontSize: 12,
                                fontWeight: 600,
                                borderRadius: 6,
                                border: '1px solid #c4b5fd',
                                background: '#fff',
                                textAlign: 'center',
                                outline: 'none',
                              }}
                            />
                          </div>

                          {/* Max */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#5b21b6' }}>
                              {t('maxLabel', lang)}:
                            </span>
                            <input
                              type="number"
                              min="1"
                              value={maxVal !== undefined && maxVal !== null ? maxVal : ''}
                              onChange={(e) => handleCustomNumberChange(node.id, 'max', e.target.value)}
                              style={{
                                width: 54,
                                padding: '3px 6px',
                                fontSize: 12,
                                fontWeight: 600,
                                borderRadius: 6,
                                border: '1px solid #c4b5fd',
                                background: '#fff',
                                textAlign: 'center',
                                outline: 'none',
                              }}
                            />
                          </div>

                          {/* Unit Dropdown */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <select
                              value={unitVal || 'minutes'}
                              onChange={(e) => handleCustomUnitChange(node.id, e.target.value)}
                              style={{
                                padding: '3px 8px',
                                fontSize: 11.5,
                                fontWeight: 600,
                                borderRadius: 6,
                                border: '1px solid #c4b5fd',
                                background: '#fff',
                                color: '#4c1d95',
                                outline: 'none',
                                cursor: 'pointer',
                              }}
                            >
                              <option value="seconds">{t('unitDropdownSec', lang)}</option>
                              <option value="minutes">{t('unitDropdownMin', lang)}</option>
                              <option value="hours">{t('unitDropdownHours', lang)}</option>
                            </select>
                          </div>
                        </div>

                        {/* Validation message or friendly hint */}
                        {customError ? (
                          <div style={{ color: '#b91c1c', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <AlertCircle size={12} /> {customError}
                          </div>
                        ) : (
                          <div style={{ color: '#6d28d9', fontSize: 11, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Clock size={12} /> {formatDurationHint(minVal, maxVal, unitVal, lang)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SCREEN 3: HOW BUSY IS RUSH HOUR */}
        {/* ========================================================================= */}
        {currentScreenId === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <Flame size={16} color="#7c3aed" />
                <h3 style={{ fontSize: 13.5, fontWeight: 700, color: '#111827', margin: 0 }}>
                  How busy is rush hour?
                </h3>
              </div>
              <p style={{ fontSize: 11.5, color: '#6b7280', margin: 0, lineHeight: 1.4 }}>
                This controls customer arrival rate and traffic density during peak periods.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                {
                  id: 'quiet',
                  title: 'Quiet',
                  rate: '~5 customers / hour',
                  desc: 'A calm pace with 10–15 min breaks between customer arrivals.',
                  badge: 'Relaxed',
                  color: '#0284c7',
                  bg: '#f0f9ff',
                },
                {
                  id: 'steady',
                  title: 'Steady',
                  rate: '~20 customers / hour',
                  desc: 'A consistent flow arriving every 3 minutes. Standard traffic.',
                  badge: 'Regular',
                  color: '#16a34a',
                  bg: '#f0fdf4',
                },
                {
                  id: 'packed',
                  title: 'Packed',
                  rate: '~45 customers / hour',
                  desc: 'Non-stop rush hour with arrivals every 1–2 minutes.',
                  badge: 'Peak Rush',
                  color: '#d97706',
                  bg: '#fffbeb',
                },
              ].map((opt) => {
                const isSelected = (answers.busyness?.value || DEFAULT_BUSYNESS) === opt.id;
                return (
                  <div
                    key={opt.id}
                    onClick={() => handleSetBusyness(opt.id)}
                    style={{
                      minHeight: 64,
                      padding: '12px 14px',
                      borderRadius: 10,
                      border: isSelected
                        ? '2px solid #7c3aed'
                        : '1px solid #e5e7eb',
                      background: isSelected ? '#faf5ff' : '#fff',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      boxShadow: isSelected
                        ? '0 2px 8px rgba(124,58,237,0.15)'
                        : '0 1px 2px rgba(0,0,0,0.02)',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>
                          {opt.title}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: opt.bg,
                            color: opt.color,
                          }}
                        >
                          {opt.rate}
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.35 }}>
                        {opt.desc}
                      </span>
                    </div>

                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        border: isSelected ? '2px solid #7c3aed' : '2px solid #d1d5db',
                        background: isSelected ? '#7c3aed' : '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {isSelected && <Check size={12} color="#fff" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SCREEN 4: DOES IT EVER GO WRONG */}
        {/* ========================================================================= */}
        {currentScreenId === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <AlertTriangle size={16} color="#7c3aed" />
                <h3 style={{ fontSize: 13.5, fontWeight: 700, color: '#111827', margin: 0 }}>
                  Does it ever go wrong?
                </h3>
              </div>
              <p style={{ fontSize: 11.5, color: '#6b7280', margin: 0, lineHeight: 1.4 }}>
                Select common interruptions or exceptions that occur in your operation.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                {
                  id: 'Out of stock',
                  title: 'Out of stock',
                  desc: 'Item or ingredient runs out mid-process',
                  icon: '📦',
                },
                {
                  id: 'Refund',
                  title: 'Refund requested',
                  desc: 'Customer asks for return or reimbursement',
                  icon: '💳',
                },
                {
                  id: 'Customer leaves',
                  title: 'Customer leaves early',
                  desc: 'Customer abandons line due to long wait',
                  icon: '🚪',
                },
                {
                  id: 'Nothing',
                  title: 'Nothing — runs smoothly',
                  desc: 'No frequent exceptions or disruptions',
                  icon: '✨',
                },
              ].map((opt) => {
                const currentList = answers.exceptions?.value || [];
                const isSelected = currentList.includes(opt.id);

                return (
                  <div
                    key={opt.id}
                    onClick={() => handleToggleException(opt.id)}
                    style={{
                      minHeight: 56,
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: isSelected
                        ? '2px solid #7c3aed'
                        : '1px solid #e5e7eb',
                      background: isSelected ? '#faf5ff' : '#fff',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 18 }}>{opt.icon}</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1f2937' }}>
                          {opt.title}
                        </span>
                        <span style={{ fontSize: 10.5, color: '#6b7280' }}>
                          {opt.desc}
                        </span>
                      </div>
                    </div>

                    <div
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 4,
                        border: isSelected ? '1.5px solid #7c3aed' : '1.5px solid #d1d5db',
                        background: isSelected ? '#7c3aed' : '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {isSelected && <Check size={12} color="#fff" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SCREEN 5: DO CUSTOMERS WAIT FOR A TABLE/SEAT/ROOM */}
        {/* ========================================================================= */}
        {currentScreenId === 5 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <Building size={16} color="#7c3aed" />
                <h3 style={{ fontSize: 13.5, fontWeight: 700, color: '#111827', margin: 0 }}>
                  Do customers ever wait for space?
                </h3>
              </div>
              <p style={{ fontSize: 11.5, color: '#6b7280', margin: 0, lineHeight: 1.4 }}>
                Tell us if physical space (tables, seats, rooms, booths) is limited.
              </p>
            </div>

            {/* Yes / No Large Tap Cards */}
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { val: false, label: 'No', sub: 'Plenty of room' },
                { val: true, label: 'Yes', sub: 'Space is limited' },
              ].map((opt) => {
                const isSelected = (answers.hasLimitedSpace?.value ?? false) === opt.val;
                return (
                  <button
                    key={String(opt.val)}
                    type="button"
                    onClick={() => handleSetSpaceEnabled(opt.val)}
                    style={{
                      flex: 1,
                      minHeight: 58,
                      borderRadius: 10,
                      border: isSelected
                        ? '2px solid #7c3aed'
                        : '1px solid #e5e7eb',
                      background: isSelected ? '#faf5ff' : '#fff',
                      color: isSelected ? '#6d28d9' : '#374151',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 2,
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{opt.label}</span>
                    <span style={{ fontSize: 10.5, color: '#6b7280' }}>{opt.sub}</span>
                  </button>
                );
              })}
            </div>

            {/* If Yes: Ask Name + Count */}
            {answers.hasLimitedSpace?.value === true && (
              <div
                style={{
                  background: '#fcfaff',
                  border: '1.5px solid #ddd6fe',
                  borderRadius: 10,
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                    What kind of space?
                  </label>
                  <input
                    type="text"
                    value={answers.spaceName?.value || DEFAULT_SPACE_NAME}
                    onChange={(e) => handleSetSpaceName(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: 6,
                      border: '1px solid #d8b4fe',
                      fontSize: 12,
                      outline: 'none',
                    }}
                  />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                    {COMMON_SPACE_PRESETS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => handleSetSpaceName(p)}
                        style={{
                          padding: '3px 8px',
                          borderRadius: 12,
                          border: '1px solid #e9d5ff',
                          background: '#fff',
                          color: '#6d28d9',
                          fontSize: 10.5,
                          cursor: 'pointer',
                        }}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                    How many units available?
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => handleSetSpaceUnits(-1)}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        border: '1px solid #d8b4fe',
                        background: '#fff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Minus size={14} color="#6d28d9" />
                    </button>
                    <input
                      type="number"
                      min="1"
                      max="500"
                      value={answers.spaceUnits?.value || DEFAULT_SPACE_UNITS}
                      onChange={(e) => handleSetSpaceUnits(Number(e.target.value) || 1)}
                      style={{
                        width: 60,
                        textAlign: 'center',
                        padding: '6px',
                        borderRadius: 6,
                        border: '1px solid #d8b4fe',
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleSetSpaceUnits(1)}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        border: '1px solid #d8b4fe',
                        background: '#fff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Plus size={14} color="#6d28d9" />
                    </button>
                    <span style={{ fontSize: 11.5, color: '#6b7280' }}>
                      total {answers.spaceName?.value || 'units'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* SCREEN 6: GOAL (3 CARDS) */}
        {/* ========================================================================= */}
        {currentScreenId === 6 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <Target size={16} color="#7c3aed" />
                <h3 style={{ fontSize: 13.5, fontWeight: 700, color: '#111827', margin: 0 }}>
                  What is your main goal?
                </h3>
              </div>
              <p style={{ fontSize: 11.5, color: '#6b7280', margin: 0, lineHeight: 1.4 }}>
                Choose the single biggest priority for SPOT to optimize.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                {
                  id: 'waiting',
                  title: 'Customers wait too long',
                  desc: 'Eliminate bottlenecks, cut queue times, and speed up turnaround.',
                  icon: '⏳',
                },
                {
                  id: 'cost',
                  title: 'Costs too high',
                  desc: 'Streamline staff schedules and reduce resource overhead.',
                  icon: '💰',
                },
                {
                  id: 'throughput',
                  title: "Can't serve enough",
                  desc: 'Maximize capacity and increase total completed cases per hour.',
                  icon: '🚀',
                },
              ].map((opt) => {
                const isSelected = (answers.goal?.value || DEFAULT_GOAL) === opt.id;
                return (
                  <div
                    key={opt.id}
                    onClick={() => handleSetGoal(opt.id)}
                    style={{
                      minHeight: 64,
                      padding: '12px 14px',
                      borderRadius: 10,
                      border: isSelected
                        ? '2px solid #7c3aed'
                        : '1px solid #e5e7eb',
                      background: isSelected ? '#faf5ff' : '#fff',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      boxShadow: isSelected
                        ? '0 2px 8px rgba(124,58,237,0.15)'
                        : '0 1px 2px rgba(0,0,0,0.02)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 20 }}>{opt.icon}</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>
                          {opt.title}
                        </span>
                        <span style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.35 }}>
                          {opt.desc}
                        </span>
                      </div>
                    </div>

                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        border: isSelected ? '2px solid #7c3aed' : '2px solid #d1d5db',
                        background: isSelected ? '#7c3aed' : '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {isSelected && <Check size={12} color="#fff" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SCREEN 7: OPTIONAL "ADD COSTS" */}
        {/* ========================================================================= */}
        {currentScreenId === 7 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <Sliders size={16} color="#7c3aed" />
                <h3 style={{ fontSize: 13.5, fontWeight: 700, color: '#111827', margin: 0 }}>
                  Staff costs (optional)
                </h3>
              </div>
              <p style={{ fontSize: 11.5, color: '#6b7280', margin: 0, lineHeight: 1.4 }}>
                Adjust estimated monthly salaries to calculate real financial return.
              </p>
            </div>

            {assignedStaffRoles.length === 0 ? (
              <div
                style={{
                  padding: '16px',
                  background: '#f9fafb',
                  borderRadius: 10,
                  textAlign: 'center',
                  fontSize: 12,
                  color: '#6b7280',
                }}
              >
                No staff roles assigned yet. You can skip this screen.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {assignedStaffRoles.map((role) => {
                  const salaryVal =
                    answers.costs?.value?.[role] != null
                      ? Number(answers.costs.value[role])
                      : 50000;

                  return (
                    <div
                      key={role}
                      style={{
                        background: '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: 10,
                        padding: '12px 14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#111827' }}>
                          {role}
                        </span>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: '#7c3aed',
                            background: '#faf5ff',
                            padding: '2px 8px',
                            borderRadius: 6,
                          }}
                        >
                          {currencySymbol} {salaryVal.toLocaleString()} / mo
                        </span>
                      </div>

                      {/* Range Slider */}
                      <input
                        type="range"
                        min="500"
                        max="150000"
                        step="500"
                        value={salaryVal}
                        onChange={(e) => handleSetSalary(role, e.target.value)}
                        style={{
                          width: '100%',
                          accentColor: '#7c3aed',
                          cursor: 'pointer',
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* MODULE I4: "TYPE INSTEAD" SECTION (Available on all screens except Screen 2) */}
        {/* ========================================================================= */}
        {currentScreenId !== 2 && (
          <div style={{ marginTop: 6, borderTop: '1px dashed #ede9fe', paddingTop: 8 }}>
          {!isTyping ? (
            <button
              type="button"
              onClick={() => {
                setIsTyping(true);
                setProposal(null);
                setFallbackTip(null);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#7c3aed',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 2px',
              }}
            >
              <PenLine size={13} /> Type instead
            </button>
          ) : (
            <div
              style={{
                background: '#faf5ff',
                border: '1.5px solid #ddd6fe',
                borderRadius: 10,
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#6d28d9', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Sparkles size={13} /> Answer in your own words
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setIsTyping(false);
                    setProposal(null);
                    setFallbackTip(null);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#9ca3af',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                >
                  Close
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  value={typedText}
                  placeholder="Type your answer here..."
                  onChange={(e) => setTypedText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleParseSubmit();
                  }}
                  disabled={parsingLoading}
                  style={{
                    flex: 1,
                    padding: '7px 10px',
                    borderRadius: 6,
                    border: '1px solid #d8b4fe',
                    fontSize: 12,
                    outline: 'none',
                    background: '#fff',
                  }}
                />
                <button
                  type="button"
                  onClick={handleParseSubmit}
                  disabled={parsingLoading || !typedText.trim()}
                  style={{
                    padding: '7px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                    color: '#fff',
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: parsingLoading || !typedText.trim() ? 'not-allowed' : 'pointer',
                    opacity: parsingLoading || !typedText.trim() ? 0.6 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {parsingLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={13} />}
                  Parse
                </button>
              </div>

              {/* Fallback tip */}
              {fallbackTip && (
                <div
                  style={{
                    fontSize: 11,
                    color: '#7e22ce',
                    background: '#f3e8ff',
                    padding: '6px 8px',
                    borderRadius: 6,
                    lineHeight: 1.35,
                  }}
                >
                  {fallbackTip}
                </div>
              )}

              {/* Proposal as tap choice */}
              {proposal && (
                <div
                  style={{
                    background: '#fff',
                    border: '1.5px solid #a855f7',
                    borderRadius: 8,
                    padding: '8px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    boxShadow: '0 2px 6px rgba(168,85,247,0.15)',
                  }}
                >
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: '#1f2937' }}>
                    {proposal.text}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={handleAcceptProposal}
                      style={{
                        flex: 1,
                        padding: '6px 10px',
                        borderRadius: 6,
                        border: 'none',
                        background: '#7c3aed',
                        color: '#fff',
                        fontSize: 11.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Confirm this choice
                    </button>
                    <button
                      type="button"
                      onClick={() => setProposal(null)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 6,
                        border: '1px solid #e5e7eb',
                        background: '#fff',
                        color: '#6b7280',
                        fontSize: 11.5,
                        cursor: 'pointer',
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        )}
      </div>

      {/* Bottom Sticky Action Bar */}
      <div
        style={{
          padding: '12px 14px',
          background: '#fff',
          borderTop: '1px solid #f3f4f6',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Not Sure Button */}
          <button
            type="button"
            onClick={handleNotSure}
            style={{
              flex: 1,
              minHeight: 46,
              borderRadius: 8,
              border: '1px solid #ddd6fe',
              background: '#f5f3ff',
              color: '#6d28d9',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <HelpCircle size={14} /> {t('notSure', lang)}
          </button>

          {/* Continue / Finish Button */}
          <button
            type="button"
            disabled={hasInvalidCustomDuration}
            onClick={() => {
              if (!hasInvalidCustomDuration) handleNext();
            }}
            style={{
              flex: 1.3,
              minHeight: 46,
              borderRadius: 8,
              border: 'none',
              background: hasInvalidCustomDuration
                ? '#e5e7eb'
                : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
              color: hasInvalidCustomDuration ? '#9ca3af' : '#fff',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: hasInvalidCustomDuration ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              boxShadow: hasInvalidCustomDuration ? 'none' : '0 2px 6px rgba(79,70,229,0.25)',
              opacity: hasInvalidCustomDuration ? 0.7 : 1,
            }}
            title={hasInvalidCustomDuration ? (lang === 'ur-roman' ? 'Pehle ghalati theek karein' : 'Please fix the errors above before continuing') : ''}
          >
            {isLastScreen ? (
              <>
                <CheckCircle size={14} /> {t('finishAndApply', lang)}
              </>
            ) : (
              <>
                {t('continueBtn', lang)} <ArrowRight size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
