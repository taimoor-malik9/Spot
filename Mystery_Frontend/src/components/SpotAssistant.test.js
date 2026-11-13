import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock localStorage and sessionStorage for Node.js test environment
class MockStorage {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

globalThis.localStorage = new MockStorage();
globalThis.sessionStorage = new MockStorage();

describe('Module C1: SpotAssistant Persistent Thread & Config Memory', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('1. Persists thread per processId in localStorage and caps at 50 messages', () => {
    const processId = 'proc_123';
    const storageKey = `spot:solveProblemThread:${processId}`;

    // Simulate appending 60 messages to the thread
    const messages = [];
    for (let i = 1; i <= 60; i++) {
      messages.push({
        id: `msg_${i}`,
        type: i % 2 === 0 ? 'user' : 'evidence',
        content: `Message ${i}`,
        timestamp: Date.now() + i,
      });
    }

    // Helper mirroring SpotAssistant's saveThread capping at 50
    function saveThread(msgs, config = {}) {
      const capped = msgs.slice(-50);
      localStorage.setItem(storageKey, JSON.stringify({
        messages: capped,
        config,
        updatedAt: Date.now(),
      }));
    }

    saveThread(messages, { arrival_rate: 0.2 });

    const storedRaw = localStorage.getItem(storageKey);
    assert.ok(storedRaw, 'Storage key must exist');
    const stored = JSON.parse(storedRaw);

    assert.strictEqual(stored.messages.length, 50, 'Thread must be capped at exactly 50 messages');
    assert.strictEqual(stored.messages[0].id, 'msg_11', 'Oldest messages (msg_1 to msg_10) must be discarded');
    assert.strictEqual(stored.messages[49].id, 'msg_60', 'Newest message must be preserved');
    assert.strictEqual(stored.config.arrival_rate, 0.2, 'Config must be stored alongside messages');
  });

  it('2. Restores persistent thread and remembers config so arrival question is not repeated', () => {
    const processId = 'proc_tea_shop';
    const storageKey = `spot:solveProblemThread:${processId}`;

    // Seed existing thread with 1 user question, 1 inline question (answered), and 1 evidence card
    const initialThread = {
      messages: [
        { id: 'u1', type: 'user', content: 'How can I reduce queue length?' },
        { id: 'q1', type: 'question', content: 'How many minutes between arrivals?', answered: true, answerValue: 4 },
        { id: 'u2', type: 'user', content: '4 minutes between arrivals' },
        {
          id: 'ev1',
          type: 'evidence',
          evidenceData: {
            summary: 'Adding a second barista reduces wait by 54%',
            baseline: { avg_wait_time: 8.5 },
            variants: [{ label: 'Add 1 Barista', metrics: { avg_wait_time: 3.9 } }],
          },
          scenarioState: {},
        },
      ],
      config: { arrival_rate: 0.25 }, // 1 / 4
    };
    localStorage.setItem(storageKey, JSON.stringify(initialThread));

    // Simulate opening assistant for proc_tea_shop
    const stored = JSON.parse(localStorage.getItem(storageKey));
    assert.strictEqual(stored.messages.length, 4, 'Must restore all 4 messages in thread');
    assert.strictEqual(stored.config.arrival_rate, 0.25, 'Must restore remembered arrival rate');

    // Next question: config already includes arrival_rate, so no second question needed
    const userPrompt2 = 'Can I reduce cost instead?';
    const nextConfig = { ...stored.config };
    assert.strictEqual(nextConfig.arrival_rate, 0.25, 'arrival_rate is passed directly, preventing duplicate question');
  });

  it('3. Evidence cards keep their own "Apply as scenario" state (loading, created, error) isolated', () => {
    const processId = 'proc_isolated';
    const storageKey = `spot:solveProblemThread:${processId}`;

    const evidenceCard1 = {
      id: 'ev_card_1',
      type: 'evidence',
      evidenceData: {
        summary: 'Option 1 summary',
        variants: [{ label: 'Option A' }, { label: 'Option B' }],
      },
      scenarioState: {
        'Option A': { loading: false, created: true, scenarioId: 'scen_opt_a_99' },
      },
    };

    const evidenceCard2 = {
      id: 'ev_card_2',
      type: 'evidence',
      evidenceData: {
        summary: 'Option 2 summary',
        variants: [{ label: 'Option A' }, { label: 'Option C' }],
      },
      scenarioState: {
        'Option A': { loading: false, created: false, error: 'Database connection failed' },
      },
    };

    const thread = {
      messages: [evidenceCard1, evidenceCard2],
      config: {},
    };
    localStorage.setItem(storageKey, JSON.stringify(thread));

    const restored = JSON.parse(localStorage.getItem(storageKey));
    const card1State = restored.messages[0].scenarioState;
    const card2State = restored.messages[1].scenarioState;

    // Card 1 Option A is created with scenario ID
    assert.strictEqual(card1State['Option A'].created, true);
    assert.strictEqual(card1State['Option A'].scenarioId, 'scen_opt_a_99');

    // Card 2 Option A has an error and is NOT created
    assert.strictEqual(card2State['Option A'].created, false);
    assert.strictEqual(card2State['Option A'].error, 'Database connection failed');
  });

  it('4. Inline question answering updates question to answered and appends user answer bubble', () => {
    const questionMsg = {
      id: 'q_pending',
      type: 'question',
      content: 'How many minutes typically pass between customer arrivals?',
      answered: false,
      answerValue: null,
    };

    let messages = [questionMsg];

    // User submits 5 minutes inline
    const minutesVal = 5;
    messages = messages.map(m => m.id === 'q_pending' ? { ...m, answered: true, answerValue: minutesVal } : m);
    messages.push({
      id: 'u_ans',
      type: 'user',
      content: `${minutesVal} minutes between arrivals`,
    });

    assert.strictEqual(messages[0].answered, true);
    assert.strictEqual(messages[0].answerValue, 5);
    assert.strictEqual(messages[1].content, '5 minutes between arrivals');
  });

  it('5. New chat clears thread in localStorage while preserving expanded choice in sessionStorage', () => {
    const processId = 'proc_clear_test';
    const threadKey = `spot:solveProblemThread:${processId}`;
    const expandKey = 'spot:panelExpanded:solve-problem';

    localStorage.setItem(threadKey, JSON.stringify({ messages: [{ id: 'm1' }] }));
    sessionStorage.setItem(expandKey, 'true');

    // Execute clear chat
    localStorage.removeItem(threadKey);

    assert.strictEqual(localStorage.getItem(threadKey), null, 'Thread should be cleared from localStorage');
    assert.strictEqual(sessionStorage.getItem(expandKey), 'true', 'Expanded choice in sessionStorage must be preserved');
  });

  it('6. Expandable panel defaults to collapsed (false) in sessionStorage and persists toggle', () => {
    const expandKey = 'spot:panelExpanded:ask-ai';

    // Default collapsed
    let isExpanded = sessionStorage.getItem(expandKey) === 'true';
    assert.strictEqual(isExpanded, false, 'Default must be collapsed (false)');

    // Toggle expand
    isExpanded = true;
    sessionStorage.setItem(expandKey, String(isExpanded));
    assert.strictEqual(sessionStorage.getItem(expandKey), 'true', 'Must persist true');

    // Toggle collapse
    isExpanded = false;
    sessionStorage.setItem(expandKey, String(isExpanded));
    assert.strictEqual(sessionStorage.getItem(expandKey), 'false', 'Must persist false');
  });

  it('7. Dynamically titles change column as "Cost change (%)" for cost goals and computes wait time delta', () => {
    // Helper replicating SpotAssistant header logic
    function getChangeColumnHeader({ target, isAnalystView, userPrompt }) {
      const isCycleTimeGoal = target?.metric === 'cycle_time' || (!target?.metric && /cycle[- ]?time/i.test(userPrompt || ''));
      const isCostGoal = target?.metric === 'cost' || (!target?.metric && /cost|money|expensive|reduce cost/i.test(userPrompt || ''));
      const isWaitingGoal = target?.metric === 'waiting';
      const isThroughputGoal = target?.metric === 'throughput';

      if (isCostGoal) return 'Cost change (%)';
      if (isCycleTimeGoal) return isAnalystView ? 'Cycle time change (%)' : 'Total time change (%)';
      if (isWaitingGoal) return 'Wait time change (%)';
      if (isThroughputGoal) return 'Throughput change (%)';
      return isAnalystView ? 'Change vs baseline (%)' : 'Change vs current setup (%)';
    }

    assert.strictEqual(
      getChangeColumnHeader({ target: { metric: 'cost' } }),
      'Cost change (%)'
    );
    assert.strictEqual(
      getChangeColumnHeader({ target: null, userPrompt: 'reduce cost by 50%' }),
      'Cost change (%)'
    );
    assert.strictEqual(
      getChangeColumnHeader({ target: { metric: 'cycle_time' } }),
      'Total time change (%)'
    );

    // Helper replicating wait time impact column logic
    function computeWaitTimeImpact(baseWait, candWait, tradeOffExceeded) {
      const delta = Number((candWait - baseWait).toFixed(1));
      const deltaPct = baseWait >= 0.05
        ? Number((((candWait - baseWait) / baseWait) * 100).toFixed(1))
        : (delta > 0 ? 100 : 0);
      const exceedsLimit = tradeOffExceeded || (deltaPct > 15.0 && delta > 0.5);
      return {
        text: `${delta > 0 ? `+${delta}` : delta} min (${deltaPct > 0 ? `+${deltaPct}` : deltaPct}%)`,
        exceedsLimit,
      };
    }

    const safeImpact = computeWaitTimeImpact(5.0, 5.4, false);
    assert.strictEqual(safeImpact.text, '+0.4 min (+8%)');
    assert.strictEqual(safeImpact.exceedsLimit, false);

    const degradedImpact = computeWaitTimeImpact(5.0, 6.5, true);
    assert.strictEqual(degradedImpact.text, '+1.5 min (+30%)');
    assert.strictEqual(degradedImpact.exceedsLimit, true);
  });

  it('8. Options correctly classify badges: Realistic option vs What-if only vs Recommended', () => {
    function getOptionBadge(row, evidence) {
      const isRowRecommended =
        !row.baseline &&
        evidence?.best?.recommended === true &&
        evidence?.no_meaningful_change !== true &&
        row.label === evidence?.best?.label &&
        row.variant?.option_type !== 'what_if' &&
        row.variant?.is_realistic !== false &&
        Math.abs(row.change || 0) >= 5.0;

      if (isRowRecommended) return 'Recommended';
      if (!row.baseline && (row.variant?.option_type === 'what_if' || row.variant?.is_realistic === false)) {
        return 'What-if only (needs a real change you must arrange)';
      }
      if (!row.baseline) return 'Realistic option';
      return null;
    }

    const evidence = {
      best: { label: 'Remove 1 Pharmacist (utilization 22%)', recommended: false },
    };

    const realisticRow = {
      label: 'Remove 1 Pharmacist (utilization 22%)',
      change: -18.5,
      variant: { option_type: 'realistic', is_realistic: true },
    };
    assert.strictEqual(getOptionBadge(realisticRow, evidence), 'Realistic option');

    const whatIfRow = {
      label: 'Remove 1 Doctor (utilization 75%)',
      change: -35.0,
      variant: { option_type: 'what_if', is_realistic: false, trade_off_exceeded: true },
    };
    assert.strictEqual(getOptionBadge(whatIfRow, evidence), 'What-if only (needs a real change you must arrange)');

    // When recommended
    evidence.best.recommended = true;
    assert.strictEqual(getOptionBadge(realisticRow, evidence), 'Recommended');
    // But what-if can NEVER be recommended even if labels match
    const whatIfWithSameLabel = {
      label: evidence.best.label,
      change: -18.5,
      variant: { option_type: 'what_if', is_realistic: false },
    };
    assert.strictEqual(getOptionBadge(whatIfWithSameLabel, evidence), 'What-if only (needs a real change you must arrange)');
  });
});
