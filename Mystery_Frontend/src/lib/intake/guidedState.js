/**
 * Single source of truth state helpers for the Guided Intake / Chat system.
 * Persists guided intake draft to sessionStorage and restores on mount.
 */

export const GUIDED_STORAGE_KEY = 'spot:guidedState';

export function getInitialGuidedState() {
  if (typeof window !== 'undefined') {
    try {
      const saved = sessionStorage.getItem(GUIDED_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return {
            flowText: typeof parsed.flowText === 'string' ? parsed.flowText : '',
            rawDiagram: parsed.rawDiagram || null,
            version: typeof parsed.version === 'number' ? parsed.version : 1,
            keptSteps: Array.isArray(parsed.keptSteps) ? parsed.keptSteps : [],
            answers: parsed.answers || null,
            currentStep: typeof parsed.currentStep === 'number' ? parsed.currentStep : 1,
            validationResult: parsed.validationResult || { errors: [], repairs: [] },
          };
        }
      }
    } catch (e) {
      console.warn('Could not restore guided state from sessionStorage:', e);
    }
  }
  return {
    flowText: '',
    rawDiagram: null,
    version: 1,
    keptSteps: [],
    answers: null,
    currentStep: 1,
    validationResult: { errors: [], repairs: [] },
  };
}
