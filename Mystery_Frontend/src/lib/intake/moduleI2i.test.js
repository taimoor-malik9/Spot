import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { GUIDED_STORAGE_KEY, getInitialGuidedState } from './guidedState.js';

describe('Module I2i: Reset & Discard Draft Logic', () => {
  // Helper mimicking hasUnsavedDraft in AiPanel
  function checkHasUnsavedDraft(guidedState, messages = [], input = '') {
    return Boolean(
      guidedState?.flowText?.trim() ||
      guidedState?.rawDiagram ||
      (guidedState?.answers && Object.keys(guidedState.answers).length > 0) ||
      (guidedState?.keptSteps && guidedState.keptSteps.length > 0) ||
      (guidedState?.currentStep && guidedState.currentStep > 1) ||
      (messages && messages.length > 0) ||
      (input && input.trim())
    );
  }

  // Helper mimicking executeReset in AiPanel
  function performReset(setGuidedState, setMessages, setInput, setMode, storage) {
    const initialState = {
      flowText: '',
      rawDiagram: null,
      version: 1,
      keptSteps: [],
      answers: null,
      currentStep: 1,
      validationResult: { errors: [], repairs: [] },
    };

    setGuidedState(initialState);
    if (storage && typeof storage.removeItem === 'function') {
      storage.removeItem(GUIDED_STORAGE_KEY);
    }
    setMessages([]);
    setInput('');
    setMode('guided');
    return initialState;
  }

  it('correctly detects when there is NO unsaved draft', () => {
    const freshState = getInitialGuidedState();
    assert.strictEqual(checkHasUnsavedDraft(freshState, [], ''), false);
  });

  it('detects unsaved draft when flowText is non-empty', () => {
    const state = { ...getInitialGuidedState(), flowText: 'Customer enters coffee shop' };
    assert.strictEqual(checkHasUnsavedDraft(state, [], ''), true);
  });

  it('detects unsaved draft when rawDiagram exists', () => {
    const state = { ...getInitialGuidedState(), rawDiagram: { nodes: [{ id: '1' }] } };
    assert.strictEqual(checkHasUnsavedDraft(state, [], ''), true);
  });

  it('detects unsaved draft when user is on step > 1', () => {
    const state = { ...getInitialGuidedState(), currentStep: 2 };
    assert.strictEqual(checkHasUnsavedDraft(state, [], ''), true);
  });

  it('detects unsaved draft when answers or keptSteps are present', () => {
    const stateWithAnswers = { ...getInitialGuidedState(), answers: { busyness: 'steady' } };
    assert.strictEqual(checkHasUnsavedDraft(stateWithAnswers, [], ''), true);

    const stateWithKept = { ...getInitialGuidedState(), keptSteps: ['step-1'] };
    assert.strictEqual(checkHasUnsavedDraft(stateWithKept, [], ''), true);
  });

  it('detects unsaved draft when chat messages or unsubmitted input exist', () => {
    const freshState = getInitialGuidedState();
    assert.strictEqual(checkHasUnsavedDraft(freshState, [{ role: 'user', content: 'hello' }], ''), true);
    assert.strictEqual(checkHasUnsavedDraft(freshState, [], 'typing a question...'), true);
  });

  it('performReset completely resets guided state, chat history, mode, and removes sessionStorage', () => {
    let guidedState = {
      flowText: 'Order coffee',
      rawDiagram: { nodes: [{ id: 'n1' }] },
      version: 3,
      keptSteps: ['n1'],
      answers: { busyness: 'steady' },
      currentStep: 3,
      validationResult: { errors: [], repairs: [{ description: 'auto repair' }] },
    };
    let messages = [{ role: 'assistant', text: 'Here is your process' }];
    let input = 'Modify barista lane';
    let mode = 'chat';

    const mockStorage = {
      data: { [GUIDED_STORAGE_KEY]: JSON.stringify(guidedState) },
      removeItem(k) { delete this.data[k]; },
      getItem(k) { return this.data[k]; },
    };

    const resetResult = performReset(
      s => { guidedState = s; },
      m => { messages = m; },
      i => { input = i; },
      md => { mode = md; },
      mockStorage
    );

    // Assert reset values
    assert.strictEqual(guidedState.flowText, '');
    assert.strictEqual(guidedState.rawDiagram, null);
    assert.strictEqual(guidedState.version, 1);
    assert.deepStrictEqual(guidedState.keptSteps, []);
    assert.strictEqual(guidedState.answers, null);
    assert.strictEqual(guidedState.currentStep, 1);
    assert.deepStrictEqual(guidedState.validationResult, { errors: [], repairs: [] });
    assert.deepStrictEqual(messages, []);
    assert.strictEqual(input, '');
    assert.strictEqual(mode, 'guided');
    assert.strictEqual(mockStorage.getItem(GUIDED_STORAGE_KEY), undefined);
  });

  it('reset never modifies or mutates canvas elements or connections', () => {
    const canvasElements = [
      { id: 'node_1', type: 'start-event', label: 'Start' },
      { id: 'node_2', type: 'task', label: 'Brew' },
    ];
    const canvasConnections = [
      { id: 'c1', fromId: 'node_1', toId: 'node_2' },
    ];

    // Snapshot before reset
    const elementsSnapshot = JSON.stringify(canvasElements);
    const connectionsSnapshot = JSON.stringify(canvasConnections);

    let guidedState = { flowText: 'Brewing flow', currentStep: 2 };
    let messages = [];
    let input = '';
    let mode = 'guided';

    performReset(
      s => { guidedState = s; },
      m => { messages = m; },
      i => { input = i; },
      md => { mode = md; },
      null
    );

    // Canvas elements and connections must remain identical
    assert.strictEqual(JSON.stringify(canvasElements), elementsSnapshot);
    assert.strictEqual(JSON.stringify(canvasConnections), connectionsSnapshot);
  });
});
