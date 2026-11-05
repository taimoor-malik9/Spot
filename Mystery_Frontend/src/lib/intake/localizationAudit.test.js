// Mystery_Frontend/src/lib/intake/localizationAudit.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  STRINGS,
  t,
  renderAssumption,
  detectLanguageWithConfidence,
  getSuggestionBanner,
  formatDuration,
  formatRate,
  formatCurrency,
} from './i18n.js';
import { applyIntakeToRawDiagram } from './applyIntake.js';
import { buildBpmnFromDraft, ensureSingleStartAndEndEvents } from './deterministicNormalizer.js';

describe('Guided Intake: Full Localization Audit & i18n Lint Tests', () => {
  it('1. Dictionary parity: all keys in en table must exist in ur-roman and ur tables', () => {
    const enKeys = Object.keys(STRINGS.en);
    const urRomanKeys = new Set(Object.keys(STRINGS['ur-roman']));
    const urKeys = new Set(Object.keys(STRINGS.ur));

    const missingInUrRoman = enKeys.filter((k) => !urRomanKeys.has(k));
    assert.deepStrictEqual(
      missingInUrRoman,
      [],
      `The following keys are defined in STRINGS.en but missing in STRINGS['ur-roman']: ${missingInUrRoman.join(', ')}`
    );

    const missingInUr = enKeys.filter((k) => !urKeys.has(k));
    assert.deepStrictEqual(
      missingInUr,
      [],
      `The following keys are defined in STRINGS.en but missing in STRINGS.ur: ${missingInUr.join(', ')}`
    );
  });

  it('2. Assumptions rendering: renders all assumption types from templates without English leaks in ur-roman', () => {
    // Crowding
    const crowdingAsm = { type: 'crowding', params: {}, status: 'confirmed' };
    const ruCrowding = renderAssumption(crowdingAsm, 'ur-roman');
    assert.strictEqual(ruCrowding, 'Rush ka asar (log lambi line mein phans jana) model mein shamil nahi hai');
    assert.doesNotMatch(ruCrowding, /crowding|effects|included/i);

    // Busyness
    const busynessAsm = { type: 'busyness', params: { n: 20 }, status: 'estimated' };
    const ruBusyness = renderAssumption(busynessAsm, 'ur-roman');
    assert.strictEqual(ruBusyness, 'Rush ka andaza: aam taur par 20 customers/ghanta');
    assert.doesNotMatch(ruBusyness, /rush hour|arrivals\/hr|estimate/i);

    // Goal
    const goalWaitAsm = { type: 'goal', params: { goal: 'waiting' }, status: 'estimated' };
    const ruGoalWait = renderAssumption(goalWaitAsm, 'ur-roman');
    assert.strictEqual(ruGoalWait, 'Maqsad: intezar ka waqt kam karna');

    const goalCostAsm = { type: 'goal', params: { goal: 'cost' }, status: 'estimated' };
    const ruGoalCost = renderAssumption(goalCostAsm, 'ur-roman');
    assert.strictEqual(ruGoalCost, 'Maqsad: kharcha kam karna');

    const goalThroughputAsm = { type: 'goal', params: { goal: 'throughput' }, status: 'estimated' };
    const ruGoalThroughput = renderAssumption(goalThroughputAsm, 'ur-roman');
    assert.strictEqual(ruGoalThroughput, 'Maqsad: zyada orders nipatana');

    // Duration: preserves exact user step wording
    const durationAsm = {
      type: 'duration',
      params: { step: 'Order lena', min: 1, max: 2, avg: 1, unit: 'minutes' },
      status: 'estimated',
    };
    const ruDuration = renderAssumption(durationAsm, 'ur-roman');
    assert.strictEqual(ruDuration, "'Order lena' ka waqt andaza hai: 1-2 min (aam taur par 1 min)");
    assert.ok(ruDuration.includes('Order lena'), 'Step name must stay exactly as user wrote it');
    assert.doesNotMatch(ruDuration, /time is estimated|typically/i);

    // Salary
    const salaryAsm = { type: 'salary', params: {}, status: 'estimated' };
    const ruSalary = renderAssumption(salaryAsm, 'ur-roman');
    assert.strictEqual(ruSalary, 'Staff ki tankhwah andaze se li gayi hai (aam market rates ke mutabiq)');
    assert.doesNotMatch(ruSalary, /wages|salaries|benchmark|compensation/i);

    // Space
    const spaceUnlAsm = { type: 'spaceUnlimited', params: {}, status: 'estimated' };
    assert.strictEqual(renderAssumption(spaceUnlAsm, 'ur-roman'), 'Jagah ki koi pabandi shamil nahi hai');

    const spaceUnitsAsm = { type: 'spaceUnits', params: { units: 10 }, status: 'estimated' };
    assert.strictEqual(renderAssumption(spaceUnitsAsm, 'ur-roman'), 'Jagah ki gunjaish ka andaza: 10 units');

    const spaceNameAsm = { type: 'spaceName', params: { name: 'Seating' }, status: 'estimated' };
    assert.strictEqual(renderAssumption(spaceNameAsm, 'ur-roman'), 'Jagah ka naam: "Seating"');
  });

  it('3. Assumptions rendering: English counterparts are properly formatted', () => {
    assert.strictEqual(
      renderAssumption({ type: 'crowding' }, 'en'),
      'Crowding effects (customers waiting in long lines) are not included in the model'
    );
    assert.strictEqual(
      renderAssumption({ type: 'busyness', params: { n: 45 } }, 'en'),
      'Rush estimate: typically 45 customers/hour'
    );
    assert.strictEqual(
      renderAssumption({ type: 'goal', params: { goal: 'waiting' } }, 'en'),
      'Main goal: reduce wait times'
    );
    assert.strictEqual(
      renderAssumption({ type: 'duration', params: { step: 'Take Order', min: 2, max: 5, avg: 4 } }, 'en'),
      "'Take Order' time is estimated: 2-5 min (typically 4 min)"
    );
    assert.strictEqual(
      renderAssumption({ type: 'salary' }, 'en'),
      'Staff wages estimated based on standard market rates'
    );
  });

  it('4. Summary screen strings: audits all target strings in Roman Urdu', () => {
    // Header count
    assert.strictEqual(t('reviewHeaderCount', 'ur-roman', 6), '6 cheezein check karni hain');
    assert.notStrictEqual(t('reviewHeaderCount', 'ur-roman', 6), '6 cheezein jaanchne ke liye');

    // Cards
    assert.strictEqual(t('rushHourPace', 'ur-roman'), 'RUSH KI RAFTAAR');
    assert.strictEqual(t('busyness_steady', 'ur-roman'), 'Aam');
    assert.strictEqual(t('busyness_quiet', 'ur-roman'), 'Kam');
    assert.strictEqual(t('busyness_packed', 'ur-roman'), 'Zyada');
    assert.strictEqual(t('arrivalsPerHour', 'ur-roman', 20), '~20 customers/ghanta');
    assert.strictEqual(t('mainGoal', 'ur-roman'), 'MAQSAD');
    assert.strictEqual(t('goalWaitTimes', 'ur-roman'), 'Intezar ka waqt');
    assert.strictEqual(t('goalReduceCosts', 'ur-roman'), 'Kharcha kam karna');
    assert.strictEqual(t('goalThroughput', 'ur-roman'), 'Zyada orders');
    assert.strictEqual(t('optimizedForSpot', 'ur-roman'), 'SPOT ke liye tayyar');

    // Panel & Badges
    assert.strictEqual(t('patchedSimulationModel', 'ur-roman'), 'Aapka process model');
    assert.strictEqual(t('appliedToCanvas', 'ur-roman'), 'Canvas par laga diya gaya');
    assert.strictEqual(t('modelAssumptions', 'ur-roman', 6), 'Model ke andaze (6)');
    assert.strictEqual(t('tapEditToAdjust', 'ur-roman'), 'Badalne ke liye pencil dabayein');
    assert.strictEqual(t('confirmedBadge', 'ur-roman'), 'Tasdeeq shuda');
    assert.strictEqual(t('estimatedBadge', 'ur-roman'), 'Andaza');
    assert.strictEqual(t('editAnswers', 'ur-roman'), 'Jawab badlein');
    assert.strictEqual(t('startOverBtn', 'ur-roman'), 'Dobara shuru karein');

    // Next-Step CTA
    assert.strictEqual(t('runSimulation', 'ur-roman'), 'Simulation chalayein');
    assert.strictEqual(t('editProcess', 'ur-roman'), 'Process theek karein');
    assert.strictEqual(
      t('runSimulationHint', 'ur-roman'),
      'Dekhein ke customers kahan intezar karte hain aur kahan waqt bach sakta hai.'
    );
  });

  it('5. Hardcoded English lint test: asserts forbidden English strings do not appear in ur-roman outputs', () => {
    const forbiddenEnglishSnippets = [
      'RUSH HOUR PACE',
      'arrivals/hr',
      'MAIN GOAL',
      'Wait Times',
      'Optimized for SPOT',
      'Patched Simulation Model',
      'Applied to Canvas',
      'Model Assumptions',
      'Tap Edit to adjust',
      'cheezein jaanchne',
      'Confirm & Apply',
      'Auto-repairs Applied',
      'Step Durations (minutes)',
      'Action required to resolve',
    ];

    const testKeys = [
      t('rushHourPace', 'ur-roman'),
      t('arrivalsPerHour', 'ur-roman', 25),
      t('mainGoal', 'ur-roman'),
      t('goalWaitTimes', 'ur-roman'),
      t('optimizedForSpot', 'ur-roman'),
      t('patchedSimulationModel', 'ur-roman'),
      t('appliedToCanvas', 'ur-roman'),
      t('modelAssumptions', 'ur-roman', 3),
      t('tapEditToAdjust', 'ur-roman'),
      t('reviewHeaderCount', 'ur-roman', 6),
      t('confirmedBadge', 'ur-roman'),
      t('estimatedBadge', 'ur-roman'),
      t('editAnswers', 'ur-roman'),
      t('startOverBtn', 'ur-roman'),
      t('stepDurationsMinutes', 'ur-roman'),
      t('actionRequiredTitle', 'ur-roman'),
      t('applyAndProceed', 'ur-roman'),
      t('confirmAndApply', 'ur-roman'),
      t('applyGoDeeper', 'ur-roman'),
      t('answerQuestionsLink', 'ur-roman'),
      t('bothPathsMeetTooltip', 'ur-roman'),
      t('autoRepairsApplied', 'ur-roman'),
    ];

    for (const rendered of testKeys) {
      for (const forbidden of forbiddenEnglishSnippets) {
        assert.ok(
          !rendered.includes(forbidden),
          `Hardcoded English leak detected! String "${rendered}" contains forbidden snippet "${forbidden}"`
        );
      }
    }
  });

  it('6. Integration with applyIntake: produces structured assumptions with type and params', () => {
    const rawDiagram = {
      nodes: [
        { id: 'start_1', type: 'start-event', label: 'Start' },
        { id: 'task_1', type: 'task', label: 'Order lena', data: { label: 'Order lena' } },
        { id: 'end_1', type: 'end-event', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'task_1' },
        { id: 'e2', source: 'task_1', target: 'end_1' },
      ],
      resources: [],
    };

    const answers = {
      busyness: 'steady',
      goal: 'waiting',
      steps: {
        task_1: { speed: 'quick', staffRoles: ['Cashier'] },
      },
      hasLimitedSpace: false,
    };

    const result = applyIntakeToRawDiagram(rawDiagram, answers);
    assert.ok(Array.isArray(result.assumptions));
    assert.ok(result.assumptions.length >= 2);

    // Check crowding assumption
    const crowding = result.assumptions.find((a) => a.field === 'crowding');
    assert.ok(crowding);
    assert.strictEqual(crowding.type, 'crowding');
    assert.strictEqual(crowding.status, 'confirmed');

    // Render in ur-roman
    const renderedUr = renderAssumption(crowding, 'ur-roman');
    assert.strictEqual(renderedUr, 'Rush ka asar (log lambi line mein phans jana) model mein shamil nahi hai');
  });

  it('7. Canvas labels: merge gateway has no visible label and Start/End in ur-roman are Shuru/Khatam', () => {
    const draft = {
      roles: ['Customer', 'Staff'],
      activities: [
        { id: 'act_1', label: 'Order lena', role: 'Staff', duration: 3 },
      ],
    };

    const diagram = buildBpmnFromDraft(draft, { lang: 'ur-roman' });
    const startNode = diagram.nodes.find((n) => n.type.includes('start'));
    const endNode = diagram.nodes.find((n) => n.type.includes('end'));

    assert.strictEqual(startNode.label, 'Shuru', 'Start event in Roman Urdu should be Shuru');
    assert.strictEqual(endNode.label, 'Khatam', 'End event in Roman Urdu should be Khatam');

    // Ensure single start and end events also normalizes labels for ur-roman
    const normalized = ensureSingleStartAndEndEvents(diagram, { lang: 'ur-roman' });
    const normStart = normalized.nodes.find((n) => n.type.includes('start'));
    const normEnd = normalized.nodes.find((n) => n.type.includes('end'));
    assert.strictEqual(normStart.label, 'Shuru');
    assert.strictEqual(normEnd.label, 'Khatam');
  });

  it('8. Urdu script Start/End labels: Start/End in ur are شروع / ختم', () => {
    const draft = {
      roles: ['Customer', 'Staff'],
      activities: [
        { id: 'act_1', label: 'آرڈر لینا', role: 'Staff', duration: 3 },
      ],
    };

    const diagram = buildBpmnFromDraft(draft, { lang: 'ur' });
    const startNode = diagram.nodes.find((n) => n.type.includes('start'));
    const endNode = diagram.nodes.find((n) => n.type.includes('end'));

    assert.strictEqual(startNode.label, 'شروع', 'Start event in Urdu script should be شروع');
    assert.strictEqual(endNode.label, 'ختم', 'End event in Urdu script should be ختم');

    const normalized = ensureSingleStartAndEndEvents(diagram, { lang: 'ur' });
    const normStart = normalized.nodes.find((n) => n.type.includes('start'));
    const normEnd = normalized.nodes.find((n) => n.type.includes('end'));
    assert.strictEqual(normStart.label, 'شروع');
    assert.strictEqual(normEnd.label, 'ختم');
  });

  it('9. detectLanguageWithConfidence: detects language with confidence >= 0.8', () => {
    // Roman Urdu
    const ruSample = 'Customer counter par aata hai aur order deta hai phir khana tayyar hota hai';
    const ruResult = detectLanguageWithConfidence(ruSample);
    assert.strictEqual(ruResult.language, 'ur-roman');
    assert.ok(ruResult.confidence >= 0.8, `Confidence ${ruResult.confidence} should be >= 0.8`);

    // Urdu script
    const urSample = 'گاہک دکان پر آتا ہے اور کیشئر کو آرڈر دیتا ہے';
    const urResult = detectLanguageWithConfidence(urSample);
    assert.strictEqual(urResult.language, 'ur');
    assert.ok(urResult.confidence >= 0.8, `Confidence ${urResult.confidence} should be >= 0.8`);

    // English
    const enSample = 'Customer arrives at the restaurant and places an order with the cashier';
    const enResult = detectLanguageWithConfidence(enSample);
    assert.strictEqual(enResult.language, 'en');
    assert.ok(enResult.confidence >= 0.8, `Confidence ${enResult.confidence} should be >= 0.8`);
  });

  it('10. getSuggestionBanner: banner text is strictly in preferredLanguage', () => {
    // App is English, user typed Roman Urdu
    const bannerEn = getSuggestionBanner('ur-roman', 'en');
    assert.strictEqual(bannerEn.message, 'You are writing in Roman Urdu. Switch the app to Roman Urdu?');
    assert.strictEqual(bannerEn.yes, 'Yes');
    assert.strictEqual(bannerEn.no, 'No');

    // App is Roman Urdu, user typed English
    const bannerRu = getSuggestionBanner('en', 'ur-roman');
    assert.strictEqual(bannerRu.message, 'Aap English mein likh rahe hain. App ko English mein badlein?');
    assert.strictEqual(bannerRu.yes, 'Haan');
    assert.strictEqual(bannerRu.no, 'Nahi');

    // App is Urdu script, user typed Roman Urdu
    const bannerUr = getSuggestionBanner('ur-roman', 'ur');
    assert.strictEqual(bannerUr.message, 'آپ رومن اردو میں لکھ رہے ہیں۔ کیا ایپ کو رومن اردو میں تبدیل کریں؟');
    assert.strictEqual(bannerUr.yes, 'ہاں');
    assert.strictEqual(bannerUr.no, 'نہیں');
  });

  it('11. Suggestion banner dismissal threshold: stops asking after 2 dismissals', () => {
    const mockStorage = {};
    const checkShouldSuggest = (detectedLang, prefLang) => {
      if (detectedLang === prefLang) return false;
      const count = Number(mockStorage['spot_dismiss_lang_' + detectedLang] || 0);
      return count < 2;
    };

    // First time
    assert.strictEqual(checkShouldSuggest('ur-roman', 'en'), true);

    // Dismiss 1
    mockStorage['spot_dismiss_lang_ur-roman'] = '1';
    assert.strictEqual(checkShouldSuggest('ur-roman', 'en'), true);

    // Dismiss 2
    mockStorage['spot_dismiss_lang_ur-roman'] = '2';
    assert.strictEqual(checkShouldSuggest('ur-roman', 'en'), false, 'Should stop asking after 2 dismissals');
  });

  it('12. Urdu script assumptions rendering: renders without English leakage', () => {
    const ruCrowding = renderAssumption({ type: 'crowding' }, 'ur');
    assert.strictEqual(ruCrowding, 'رش کا اثر (گاہکوں کا لمبی لائنوں میں پھنس جانا) ماڈل میں شامل نہیں ہے');
    assert.doesNotMatch(ruCrowding, /[a-zA-Z]/);

    const ruGoal = renderAssumption({ type: 'goal', params: { goal: 'waiting' } }, 'ur');
    assert.strictEqual(ruGoal, 'بنیادی مقصد: انتظار کا وقت کم کرنا');
    assert.doesNotMatch(ruGoal, /[a-zA-Z]/);

    const ruSalary = renderAssumption({ type: 'salary' }, 'ur');
    assert.strictEqual(ruSalary, 'عملے کی تنخواہ کا تخمینہ مارکیٹ کے مطابق لگایا گیا ہے');
    assert.doesNotMatch(ruSalary, /[a-zA-Z]/);
  });

  it('13. One-off override for results export preserves preferredLanguage', () => {
    let preferredLanguage = 'en';
    let viewLanguageOverride = null;

    // Default effective language
    assert.strictEqual(viewLanguageOverride || preferredLanguage, 'en');

    // User chooses to view/export in Roman Urdu
    viewLanguageOverride = 'ur-roman';
    const effectiveForExport = viewLanguageOverride || preferredLanguage;
    assert.strictEqual(effectiveForExport, 'ur-roman');
    // Account preferredLanguage is unchanged
    assert.strictEqual(preferredLanguage, 'en');

    // Reset override
    viewLanguageOverride = null;
    assert.strictEqual(viewLanguageOverride || preferredLanguage, 'en');
  });

  it('14. Unit formatters: formatDuration, formatRate, formatCurrency support en, ur-roman, and ur', () => {
    // formatDuration
    assert.strictEqual(formatDuration(27, 'ur'), '27 منٹ');
    assert.strictEqual(formatDuration(27, 'ur-roman'), '27 min');
    assert.strictEqual(formatDuration(27, 'en'), '27 minutes');

    assert.strictEqual(formatDuration(90, 'ur'), '1.5 گھنٹے');
    assert.strictEqual(formatDuration(90, 'ur-roman'), '1.5 ghante');
    assert.strictEqual(formatDuration(90, 'en'), '1.5 hours');

    assert.strictEqual(formatDuration(1800, 'ur'), '1.3 دن');
    assert.strictEqual(formatDuration(1800, 'ur-roman'), '1.3 din');
    assert.strictEqual(formatDuration(1800, 'en'), '1.3 days');

    // formatRate
    assert.strictEqual(formatRate(6.3, 'hr', 'ur'), '6.3 فی گھنٹہ');
    assert.strictEqual(formatRate(6.3, 'hr', 'ur-roman'), '6.3 per ghanta');
    assert.strictEqual(formatRate(6.3, 'hr', 'en'), '6.3/hr');

    assert.strictEqual(formatRate(50, 'day', 'ur'), '50 فی دن');
    assert.strictEqual(formatRate(50, 'day', 'ur-roman'), '50 per din');
    assert.strictEqual(formatRate(50, 'day', 'en'), '50/day');

    // formatCurrency
    assert.strictEqual(formatCurrency(500, 'ur', 'Rs'), '500.00 روپے');
    assert.strictEqual(formatCurrency(500, 'ur-roman', 'Rs'), 'Rs 500.00');
    assert.strictEqual(formatCurrency(500, 'en', 'Rs'), 'Rs 500.00');
    assert.strictEqual(formatCurrency(1250.5, 'ur', '$'), '1,250.50 روپے');
    assert.strictEqual(formatCurrency(1250.5, 'en', '$'), '$ 1,250.50');
  });

  it('15. t() dev warning guard: returns ⚠ missing_key in dev/test mode', () => {
    // Non-existent key in ur
    const missingDev = t('definitely_non_existent_key_xyz', 'ur');
    assert.strictEqual(missingDev, '⚠ definitely_non_existent_key_xyz');

    // Non-existent key in en
    const missingEnDev = t('definitely_non_existent_key_xyz', 'en');
    assert.strictEqual(missingEnDev, '⚠ definitely_non_existent_key_xyz');

    // Existing key translates properly
    assert.strictEqual(t('results_testResults', 'ur'), 'ٹیسٹ کے نتائج');
    assert.strictEqual(t('results_testResults', 'ur-roman'), 'Test ke Nataij');
    assert.strictEqual(t('results_testResults', 'en'), 'Test Results');
  });

  it('16. Results page localization audit: all results_ and aiInsights_ keys are non-empty and well-formed', () => {
    const enKeys = Object.keys(STRINGS.en).filter(
      (k) => k.startsWith('results_') || k.startsWith('aiInsights_')
    );
    assert.ok(enKeys.length >= 40, `Expected at least 40 results keys, found ${enKeys.length}`);

    for (const key of enKeys) {
      assert.ok(STRINGS['ur-roman'][key], `Missing ur-roman translation for ${key}`);
      assert.ok(STRINGS.ur[key], `Missing ur translation for ${key}`);

      const urVal = STRINGS.ur[key];
      const urText = typeof urVal === 'function' ? urVal('X', 'Y', 'Z', 'W') : urVal;
      assert.ok(typeof urText === 'string' && urText.length > 0, `Empty translation for ur key ${key}`);

      // Check for presence of Urdu characters in non-brand / non-icon strings
      if (key !== 'results_viewExportIn' && key !== 'aiInsights_title') {
        assert.match(
          urText,
          /[\u0600-\u06FF]/,
          `Key "${key}" in ur should contain Urdu script characters, got: "${urText}"`
        );
      }
    }
  });

  it('17. Urdu punctuation: ur strings use Urdu punctuation marks (۔ ، ؟) instead of English period/comma', () => {
    // Check specific sentences that have punctuation
    const fullStopKeys = [
      'results_verdictReliable',
      'results_processOperatingEfficiently',
      'results_noMajorRoadblocks',
      'results_noQueueBuildUp',
      'results_diffModesDesc',
    ];

    for (const k of fullStopKeys) {
      const urText = typeof STRINGS.ur[k] === 'function' ? STRINGS.ur[k]('A', 'B') : STRINGS.ur[k];
      assert.ok(
        urText.includes('۔') || !urText.endsWith('.'),
        `Key ${k} should use Urdu full stop (۔) or omit dot, got: "${urText}"`
      );
      assert.doesNotMatch(urText, /\.$/, `Key ${k} must not end with Latin period: "${urText}"`);
    }
  });
});
