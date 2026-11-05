/**
 * i18n.js - Language detection and translations for Guided Intake
 * Supports 'en' (English), 'ur-roman' (Roman Urdu), and 'ur' (Urdu script).
 */
import { LABEL_STRINGS } from './labelsI18n.js';

const ROMAN_URDU_MARKERS = new Set([
  'hai', 'hain', 'ho', 'hoga', 'hogi', 'hoge', 'hote', 'hota', 'hoti', 'hua', 'hue', 'hui',
  'ka', 'ki', 'ke', 'ko', 'se', 'mein', 'me', 'par', 'pe', 'tak',
  'karna', 'karta', 'karti', 'karte', 'kare', 'karein', 'karo', 'kiya', 'kiye', 'karke',
  'aur', 'ya', 'phir', 'pehle', 'baad', 'lekin', 'agar', 'to', 'toh', 'warna',
  'ye', 'yeh', 'wo', 'woh', 'jo', 'kuch', 'koi', 'sab', 'apna', 'apne', 'apni',
  'ata', 'aati', 'aate', 'aana', 'aaya',
  'deta', 'deti', 'dete', 'dena', 'diya',
  'leta', 'leti', 'lete', 'lena', 'liya',
  'jata', 'jati', 'jate', 'jana', 'gaya', 'gayi', 'gaye',
  'bhejta', 'bhejti', 'bhejna', 'bheja',
  'rakhta', 'rakhti', 'rakhte', 'rakhna', 'rakha',
  'banata', 'banati', 'banate', 'banana', 'banaya',
  'khata', 'khati', 'khate', 'khana', 'khaya',
  'hum', 'tum', 'aap', 'unka', 'unke', 'unki', 'iska', 'iske', 'iski', 'unhe', 'use', 'ise',
  'chahiye', 'sakta', 'sakti', 'sakte', 'bhi', 'wala', 'wali', 'wale', 'wahan', 'yahan',
  'batayein', 'batana', 'dekhein', 'dekhna', 'saman', 'raaste', 'milte', 'milta', 'milti',
  'tayyar', 'karobari', 'sawal', 'sawalat', 'shuru', 'khatam', 'tabdeeli', 'theek', 'baqi',
  'kaunsa', 'kitne', 'jaise', 'bhejo', 'kharidna', 'bhejna'
]);

/**
 * Detect language of a process description with confidence.
 * Returns { language: 'en' | 'ur-roman' | 'ur', confidence: number }.
 */
export function detectLanguageWithConfidence(text) {
  if (!text || typeof text !== 'string') return { language: 'en', confidence: 0 };
  const trimmed = text.trim();
  if (!trimmed) return { language: 'en', confidence: 0 };

  // Urdu / Arabic script check
  const urduScriptMatches = trimmed.match(/[\u0600-\u06FF]/g) || [];
  const latinMatches = trimmed.match(/[a-zA-Z]/g) || [];
  const totalChars = urduScriptMatches.length + latinMatches.length;

  if (totalChars > 0 && urduScriptMatches.length / totalChars >= 0.3) {
    const scriptConfidence = Math.min(1.0, (urduScriptMatches.length / totalChars) * 1.5);
    return { language: 'ur', confidence: Math.max(0.85, Number(scriptConfidence.toFixed(2))) };
  }

  // Tokenize Latin words
  const words = trimmed.toLowerCase().match(/[a-z]+/g) || [];
  if (words.length === 0) return { language: 'en', confidence: 0.5 };

  let matchCount = 0;
  for (const w of words) {
    if (ROMAN_URDU_MARKERS.has(w)) {
      matchCount++;
    }
  }

  const ratio = matchCount / words.length;

  if (matchCount >= 2 && ratio >= 0.15) {
    const conf = Math.min(1.0, 0.75 + ratio * 0.4 + (matchCount >= 4 ? 0.1 : 0.05));
    return { language: 'ur-roman', confidence: Math.max(0.85, Number(conf.toFixed(2))) };
  }

  if (words.length <= 5 && matchCount >= 1) {
    return { language: 'ur-roman', confidence: 0.85 };
  }

  // English
  const englishConf = Math.min(1.0, 1.0 - ratio);
  return { language: 'en', confidence: Math.max(0.85, Number(englishConf.toFixed(2))) };
}

/**
 * Detect language of a process description once at intake.
 * Returns 'ur-roman', 'ur', or 'en'.
 */
export function detectLanguage(text) {
  return detectLanguageWithConfidence(text).language;
}

export function getSuggestionBanner(detectedLang, preferredLanguage) {
  const messages = {
    en: {
      'ur-roman': 'You are writing in Roman Urdu. Switch the app to Roman Urdu?',
      ur: 'You are writing in Urdu. Switch the app to Urdu?',
      yes: 'Yes',
      no: 'No',
    },
    'ur-roman': {
      en: 'Aap English mein likh rahe hain. App ko English mein badlein?',
      ur: 'Aap Urdu script mein likh rahe hain. App ko Urdu mein badlein?',
      yes: 'Haan',
      no: 'Nahi',
    },
    ur: {
      en: 'آپ انگریزی میں لکھ رہے ہیں۔ کیا ایپ کو انگریزی میں تبدیل کریں؟',
      'ur-roman': 'آپ رومن اردو میں لکھ رہے ہیں۔ کیا ایپ کو رومن اردو میں تبدیل کریں؟',
      yes: 'ہاں',
      no: 'نہیں',
    },
  };
  const table = messages[preferredLanguage] || messages.en;
  const message = table[detectedLang] || `Switch app to ${detectedLang}?`;
  return {
    message,
    yes: table.yes || 'Yes',
    no: table.no || 'No',
  };
}

export const STRINGS = {
  en: {
    step1Title: 'Step 1: Your Process',
    step2Title: 'Step 2: Business Questions',
    step3Title: 'Step 3: Ready to Simulate',
    stepOf: (current, total) => `${current} of ${total}`,
    describeProcess: (bType) =>
      bType ? `Describe your ${bType} business process` : 'Describe your business process',
    describeProcessHelp:
      'In plain words, tell us what steps take place from the moment a customer arrives until they leave.',
    placeholder: (bType) =>
      bType
        ? `Describe what happens in your ${bType} business from customer arrival to exit…`
        : 'Describe what happens from the moment a customer arrives until they leave…',
    tryLabel: 'Try:',
    showProcessBtn: 'Show me my process',
    mappingProcess: 'Spot AI is mapping your process…',
    identifyingSteps: 'Identifying activities, events, and flow connections…',
    generationIssue: 'Generation issue',
    tryAgain: 'Try again',
    oneDetailNeeded: 'One quick detail needed',
    typeYourAnswer: 'Type your answer…',
    answerBtn: 'Answer',
    generatedProcessHeader: (count) => `Generated process · ${count} steps`,
    stepsSummary: (stated, inferred) => `You described ${stated} steps. AI added ${inferred}.`,
    processStepsCount: (count) => `Process Steps (${count})`,
    openLargerView: 'Open larger view',
    aiAddedNoTime: 'AI added, no time counted',
    keep: 'Keep',
    kept: 'Kept',
    remove: 'Remove',
    assumptionsHeader: 'Assumptions & Auto-repairs:',
    processNeedsAdjustment: 'One thing is missing before we can run this',
    fixForMe: 'Fix for me',
    isThisRight: 'Is this right?',
    confirm: 'Confirm',
    confirmBlockedErrors: 'Confirm (answer the question above first)',
    whatShouldChange: 'What should change?',
    whatShouldChangePlaceholder:
      'e.g. Add ID check step before payment, or change who handles packaging…',
    update: 'Update',
    continueInChat: 'Continue in Chat →',
    startOver: 'Start over with a new description',
    bothPathsContinue: 'Both paths continue here',
    customer: 'Customer',
    storeStaff: 'Store / Staff',
    estimated: 'estimated',
    branchesQuestion: 'Roughly what % choose each? (e.g. 60% / 40%)',
    unconnectedError: "Some steps aren't connected properly.",
    keepWorking: 'Keep working',
    discard: 'Discard',
    discardModalTitle: 'Discard this draft and start over?',
    discardModalDesc:
      'Your current intake inputs and chat history will be discarded. This will not affect the canvas.',
    howFastIsEachStep: 'How fast is each step?',
    howFastHelp: 'Choose the typical speed taken to perform each activity.',
    quick: 'Quick',
    quickSub: '1–2 min',
    normal: 'Normal',
    normalSub: '3–8 min',
    slow: 'Slow',
    slowSub: '10–25 min',
    custom: 'Custom',
    customSub: 'Custom',
    minLabel: 'Min',
    maxLabel: 'Max',
    unitDropdownSec: 'sec',
    unitDropdownMin: 'min',
    unitDropdownHours: 'hours',
    notSure: 'Not sure',
    continueBtn: 'Continue',
    finishAndApply: 'Finish & Apply',
    errMinGreaterThanZero: 'Minimum time must be greater than 0.',
    errMaxGteMin: 'Maximum time cannot be less than minimum.',
    processReadySummary: (steps, decisions, roles) =>
      `Your process is ready. ${steps} steps, ${decisions} decisions, ${roles} roles.`,
    runSimulation: 'Run simulation',
    editProcess: 'Edit process',
    runSimulationHint: 'See where customers wait and where you can save time.',
    estimatesNote: 'Some numbers are estimates. You can refine them later.',
    totalMustBe100: (sum) => `Total ${sum}%, must be 100`,
    totalIndicator: (sum) => `Total: ${sum}% (must be 100)`,
    autoBalance: 'Auto-balance',
    rushHourPace: 'RUSH HOUR PACE',
    busyness_steady: 'Steady',
    busyness_quiet: 'Slow',
    busyness_packed: 'Busy',
    arrivalsPerHour: (n) => `~${n} arrivals/hr`,
    mainGoal: 'MAIN GOAL',
    goalWaitTimes: 'Wait Times',
    goalReduceCosts: 'Reduce Costs',
    goalThroughput: 'Throughput',
    optimizedForSpot: 'Optimized for SPOT',
    patchedSimulationModel: 'Patched Simulation Model',
    appliedToCanvas: 'Applied to Canvas',
    editAnswers: 'Edit Answers',
    startOverBtn: 'Start Over',
    confirmedBadge: 'Confirmed',
    estimatedBadge: 'Estimated',
    tapEditToAdjust: 'Tap Edit to adjust',
    modelAssumptions: (n) => `Model Assumptions (${n})`,
    reviewHeaderCount: (n) => `${n} thing${n !== 1 ? 's' : ''} to review`,
    stepDurationsMinutes: 'Step Durations (minutes)',
    actionRequiredTitle: 'Action required to resolve process checks:',
    applyAndProceed: 'Apply Auto-repairs & Proceed',
    confirmAndApply: 'Confirm & Apply',
    applyGoDeeper: 'Apply & go deeper →',
    answerQuestionsLink: '← Answer questions to adjust process',
    bothPathsMeetTooltip: 'Both paths continue here',
    autoRepairsApplied: 'Auto-repairs Applied:',

    // Results page keys
    results_perfOverview: 'Performance Overview',
    results_perfOverviewTip: 'A plain-language summary of the simulation: how long one customer needs, how many you can serve per hour and per day, and where the time is lost. Hover any box inside for its own explanation.',
    results_customerNeedsWork: (work) => `A customer needs about ${work} of actual work.`,
    results_customersArriveFaster: (role) => `But customers arrive faster than ${role} can serve them, so a line keeps building up.`,
    results_averageWaitInLine: (wait) => `On average they also wait about ${wait} in line.`,
    results_bestCaseNoWait: 'This is the best case, with no waiting.',
    results_workedOutFromCustomers: (runs) => `Worked out from ${runs} simulated customers.`,
    results_calloutOverloadedWithArrival: (role, arrival, cap, targetArrival) =>
      `Customers are arriving faster than ${role} can serve them. About ${arrival} arrive per hour, but ${role} can handle about ${cap}. The line keeps growing, which is why the waiting time and cycle time look so big. Adding more ${role}${targetArrival ? ` or slowing arrivals to about ${targetArrival} per hour` : ''} should fix it.`,
    results_calloutOverloadedNoArrival: (role, util, cap) =>
      `Customers are arriving faster than ${role} can serve them. ${role} is busy ${util}% of the time and can handle about ${cap} per hour. The line keeps growing, which is why the waiting time and cycle time look so big. Adding more ${role} should fix it.`,
    results_calloutTight: (role, util, cap) =>
      `${role} is almost at its limit (${util}% busy, about ${cap} customers per hour at most). A small rise in customers will start a queue.`,
    results_calloutOk: (role, cap, arrival) =>
      arrival != null
        ? `Capacity looks fine. ${role} can handle about ${cap} customers per hour and ${arrival} arrive.`
        : `Capacity looks fine. ${role} can handle about ${cap} customers per hour.`,
    results_cantKeepUp: "Can't keep up",
    results_closeToLimit: 'Close to the limit',
    results_runningSmoothly: 'Running smoothly',
    results_realTime: 'Real time',
    results_inflatedByLine: 'Inflated by the line',
    results_inflatedByQueue: 'Inflated by a growing queue (see summary above)',
    results_timePerCustomer: 'Time per customer',
    results_timePerCustomerTip: "How long one customer's own tasks take when added together, with no waiting counted. This is the best time your process can ever reach.",
    results_workNoWait: 'of work, no waiting in this mode',
    results_workNotCountingWait: 'of work, not counting the wait',
    results_customersPerHour: 'Customers per hour',
    results_customersPerHourTip: 'How many customers get all the way through your process every hour, measured in this simulation.',
    results_finishedEveryHour: 'finished every hour',
    results_customersPerDay: 'Customers per day',
    results_customersPerDayTip: 'Customers per hour multiplied by the working hours in a day. The hours come from your resource settings, or 8 hours if none are set.',
    results_inADayHours: (h) => `in a ${h}-hour day`,
    results_avgCompletionTime: 'Average completion time',
    results_avgCycleTime: 'Average cycle time',
    results_avgCycleTimeTip: 'The average time from start to finish, waiting in line included. Customers keep arriving without a break, so if staff cannot keep up the line grows and this number climbs. A big gap from Time per customer means customers mostly wait.',
    results_startToFinish: 'start to finish',
    results_pushedUpByGrowingLine: "pushed up by the growing line, not one real customer's time",
    results_fastestSlowest: (min, max) => `fastest ${min}, slowest ${max}`,
    results_howTimeSpent: "How a customer's time is spent",
    results_howTimeSpentHint: 'Purple is real work, teal is time spent waiting in line.',
    results_workingPct: (work, pct) => `${work} working (${pct}%)`,
    results_inLinePct: (wait, pct) => `${wait} in line (${pct}%)`,
    results_arrivalsVsRole: (role) => `Arrivals vs. what ${role} can handle`,
    results_arrivalsVsRoleHint: 'If customers arrive faster than this, a queue builds up.',
    results_customersArriving: 'Customers arriving',
    results_roleCanHandle: (role) => `${role} can handle`,
    results_stepByStep: 'Step by step',
    results_stepByStepHint: (isQuick) => `The longest steps come first.${isQuick ? '' : ' Teal shows how long customers wait before each step.'}`,
    results_stepWorkWait: (work, wait, isQuick) => `${work} work${!isQuick ? ` · ${wait} wait` : ''}`,
    results_cycleTimeFooter: (runs, isAnalyst) => `${isAnalyst ? 'Cycle time' : 'Time from arrival to leaving'} is an average over all ${runs} customers, so a growing queue pushes it up. "Time per customer" shows the work itself.`,

    // Tabs
    results_tabOverview: 'Overview',
    results_tabWhereWait: 'Where Customers Wait',
    results_tabBottlenecks: 'Bottlenecks & Queues',
    results_tabStaffActivity: 'Staff Activity',
    results_tabResources: 'Resources',
    results_tabFinancial: 'Financial',
    results_tabIdeaComparison: 'Idea Comparison',
    results_tabWhatIfComparison: 'What-If Comparison',
    results_tabKeyTakeaways: 'Key Takeaways',

    // Header & Actions
    results_testResults: 'Test Results',
    results_simResults: 'Simulation Results',
    results_quickAnalysisBadge: 'QUICK ANALYSIS',
    results_deepAnalysisBadge: 'DEEP ANALYSIS',
    results_basedOnRuns: (runs) => `Based on ${runs} test runs`,
    results_basedOnIterations: (runs) => `Based on ${runs} iterations`,
    results_testHistory: 'Test History',
    results_runHistory: 'Run History',
    results_loadingRuns: 'Loading runs…',
    results_savedTestRuns: 'Saved Test Runs',
    results_savedSimRuns: 'Saved Simulation Runs',
    results_noSavedRuns: 'No saved test runs yet.',
    results_noSavedSimRuns: 'No saved simulation runs yet.',
    results_savedRunFrom: (date) => `Saved run from ${date}`,
    results_exitSavedView: 'Exit saved view',
    results_rerun: 'Re-run',
    results_rerunning: 'Re-running…',
    results_loadMore: 'Load more',
    results_export: 'Export',
    results_rerunTest: 'Re-run Test',
    results_rerunSim: 'Re-run Simulation',
    results_viewExportIn: 'View/Export in:',
    results_viewExportDefault: (lang) => `Default (${lang})`,

    // Top cards & alerts
    results_bestCaseDuration: 'Best-Case / Theoretical Duration',
    results_productionSpeed: 'Production Speed',
    results_customersServedPerHour: 'Customers served per hour',
    results_worstCaseScenario: 'Worst-Case Scenario',
    results_predictability: 'Predictability',
    results_consistent: 'Consistent',
    results_variable: 'Variable',
    results_criticalBottleneck: 'Critical Bottleneck',
    results_slowestTask: 'Slowest Task',
    results_fixNow: 'Fix Now',
    results_noIssuesDetected: 'No issues detected',
    results_timesVary: (spread, bnLabel) => `Times vary by ${spread}.${bnLabel ? ` Stabilize "${bnLabel}" to reduce variance.` : ''}`,
    results_throughputLimitedBy: (bnLabel) => `Current throughput is limited by ${bnLabel}.`,
    results_processOperatingEfficiently: 'Your process is operating efficiently.',

    // Bottlenecks tab
    results_systemEfficiency: 'System Efficiency',
    results_systemEfficiencyTip: 'Out of all the time customers spend in your steps, how much is real work (purple) and how much is waiting (teal). A low Active % means customers mostly wait instead of being served.',
    results_activeLabel: 'Active',
    results_constraintAnalysis: 'Constraint Analysis',
    results_constraintAnalysisTip: 'The one step that holds the whole process back. It shows how long the step takes to do and how long customers wait for it. Improve this step first.',
    results_constraintDesc: (proc, wait) => `This step takes ${proc} to process and causes ${wait} of waiting time per unit, making it your most resource-intensive constraint.`,
    results_editProperties: 'Edit Properties',
    results_noMajorRoadblocks: 'No major roadblocks identified.',
    results_queueBacklog: 'Queue Backlog',
    results_queueBacklogTip: "The steps where customers wait in line the longest. The bar shows the average wait, and 'units' is the average number of customers standing in that line.",
    results_queueItemDesc: (wait, count) => `${wait} wait | ${count} units`,
    results_noQueueBuildUp: 'No queue build-up detected.',

    // Resources tab
    results_howBusyStaffAre: 'How Busy Staff Are',
    results_resourceUtilization: 'Resource Utilization',
    results_howBusySubtitle: 'How busy each team member was during the test run',
    results_howBusySimSubtitle: 'How busy each resource was during the simulation',
    results_badgeOverloaded: 'Overloaded',
    results_badgeUnderused: 'Underused',
    results_badgeHealthy: 'Healthy',
    results_busyIdleStat: (busy, idle) => `${busy}% busy · ${idle}% idle`,

    // Financial tab
    results_noCostFigures: 'No cost figures to show yet',
    results_noCostFiguresDesc: 'Costs are worked out from the details you enter on each resource in Simulate: monthly salary for staff, purchase price and running cost for equipment, rent for facilities. Fill those in and run a Deep Analysis again to see the total cost, idle waste and cost per resource.',
    results_financialAnalysis: 'Financial Analysis',
    results_costForThisRun: (n, h) => `Cost for this run (${n} customers, ${h} hours)`,
    results_basedOnEstimatedValues: 'Based on estimated values',
    results_activeCost: 'Active Cost',
    results_activeCostHint: 'Cost of active work',
    results_idleCost: 'Idle Cost',
    results_idleCostHint: 'Paid time with no work',
    results_costPerCustomer: 'Cost / Customer',
    results_costDistribution: 'Cost Distribution',
    results_costBreakdownByResource: 'Cost Breakdown by Resource',
    results_costBreakdownByStaff: 'Cost Breakdown by Staff Member',
    results_stackedCostDesc: (isAnalyst) => isAnalyst ? 'Stacked Active + Idle Cost & Utilization' : 'Stacked Active + Idle Cost & Busy %',
    results_colResource: 'Resource',
    results_colType: 'Type',
    results_colQty: 'Qty',
    results_colRate: 'Rate',
    results_colBusyHours: 'Busy Hours',
    results_colTotalCost: 'Total Cost',
    results_colUtilization: 'Utilization',

    // What-If tab
    results_currentSetupVsIdea: 'Current Setup vs Idea Comparison',
    results_baselineVsWhatIf: 'Baseline vs What-If Performance Comparison',
    results_comparingCurrentVsIdea: (name) => `Comparing current setup with idea: "${name}"`,
    results_comparingBaselineVsWhatIf: (name) => `Comparing baseline process with scenario: "${name}"`,
    results_whatIfActive: 'What-If Active',
    results_ideaActive: 'Idea Active',
    results_diffModesTitle: (isAnalyst) => isAnalyst ? 'Baseline and What-If used different simulation modes' : 'Current setup and idea used different test modes',
    results_diffModesDesc: 'These are not comparable — re-run both in the same mode for an accurate comparison.',
    results_goToSimulate: 'Go to Simulate',
    results_noMeaningfulChange: 'No meaningful change',
    results_currentSetup: 'Current setup',
    results_baseline: 'Baseline',
    results_ideaToTry: 'Idea to try',
    results_whatIfScenario: 'What-If Scenario',
    results_waitPointShift: 'Wait Point Shift',
    results_slowestStepShift: 'Slowest Step Shift',
    results_bottleneckShift: 'Bottleneck Shift',
    results_timeComparisonTitle: (isAnalyst) => isAnalyst ? 'Cycle Time: Baseline vs What-If' : 'Time from arrival to leaving: Current setup vs Idea',
    results_throughputComparisonTitle: (isAnalyst) => isAnalyst ? 'Throughput: Baseline vs What-If' : 'Customers served per hour: Current setup vs Idea',

    // Key Takeaways & verdict
    results_keyTakeaways: 'Key Takeaways',
    results_keyTakeawaysSubtitle: (isAnalyst) => isAnalyst ? 'The main points from this simulation' : 'The main points from this test run',
    results_verdictBestCase: (dur) => `Theoretical best-case duration is **${dur}** per unit.`,
    results_verdictOptimalBaseline: (isAnalyst) => isAnalyst ? 'Optimal path baseline established. Run Deep Analysis for accurate constraints and throughput.' : 'Optimal path benchmark established. Run Deep Analysis for accurate constraints and customer capacity.',
    results_verdictOverloaded: (role, avg, work, throughput) => `Customers arrive faster than **${role}** can serve them, so a line keeps building up. That is why the average completion time (**${avg}**) looks so large: one customer's real work takes only about **${work}**, and only about **${throughput} units/hr** get through.`,
    results_verdictNormal: (avg, throughput) => `Average completion time is **${avg}**, delivering **${throughput} units/hr**.`,
    results_verdictReliable: 'Process is **Highly Reliable** under load. Variance is minimal.',
    results_verdictHighRisk: (min, max) => `**High Risk Detected:** Completion times fluctuate drastically between ${min} and ${max}.`,
    results_verdictSlowestStep: (bn) => `**"${bn}"** is the slowest step in your process.`,
    results_verdictPrimaryBottleneck: (bn, isAnalyst) => isAnalyst ? `**"${bn}"** is your primary bottleneck constraint.` : `**"${bn}"** is where customers wait the longest.`,
    results_verdictResourceOverloaded: (name, pct) => `**${name}** is overloaded (${pct}% capacity).`,
    results_verdictTotalCost: (type, cost) => `Total operational cost for this ${type} was **${cost}**.`,
    results_verdictNoStaffTime: 'No staff time was recorded, so all cost shows as idle. Assign staff to steps in Task Details.',
    results_verdictHighWaste: (cost, pct) => `**High Financial Waste:** **${cost}** (${pct}% of total cost) was lost to idle resource wait times.`,
    results_verdictIdleSpent: (cost, pct) => `**${cost}** (${pct}% of total cost) was spent on idle resources.`,

    // Empty State
    results_noResultsTitle: 'No Results to Display',
    results_noResultsDescNoNodes: "You haven't built a process model yet. Create a model and run a test to see your analytics here.",
    results_noResultsDescNeedRun: 'You need to run a test first to view the analytics dashboard.',
    results_buildModel: 'Build a Model',
    results_runTest: 'Run Test',

    // AI Insights
    aiInsights_title: 'AI Insights',
    aiInsights_findImprovements: 'Find improvements',
    aiInsights_refresh: 'Refresh',
    aiInsights_simulatePrompt: 'Simulate tested changes to see measured improvements before applying them.',
    aiInsights_testing: 'Testing candidate improvements in simulator…',
    aiInsights_implement: 'Implement Suggestion',
    aiInsights_implementing: 'Implementing…',
    aiInsights_noChangeWorth: 'No change worth making at this load',
    ...LABEL_STRINGS.en,
  },

  'ur-roman': {
    step1Title: 'Step 1: Aapka Process',
    step2Title: 'Step 2: Karobari Sawalat',
    step3Title: 'Step 3: Simulate karne ke liye tayyar',
    stepOf: (current, total) => `${current} / ${total}`,
    describeProcess: (bType) =>
      bType ? `Apne ${bType} karobar ka process bayan karein` : 'Apna karobari process bayan karein',
    describeProcessHelp:
      'Aasan alfaaz mein batayein ke customer ke aane se jane tak kya kya steps hote hain.',
    placeholder: (bType) =>
      bType
        ? `Batayein ke aapke ${bType} karobar mein customer ke aane se jane tak kya hota hai…`
        : 'Batayein ke customer ke aane se jane tak kya kya hota hai…',
    tryLabel: 'Misaal:',
    showProcessBtn: 'Mera process dikhayein',
    mappingProcess: 'Spot AI aapka process bana raha hai…',
    identifyingSteps: 'Steps aur unka rasta samjha ja raha hai…',
    generationIssue: 'Process banane mein masla aaya',
    tryAgain: 'Dobara koshish karein',
    oneDetailNeeded: 'Ek ahem baat batani baqi hai',
    typeYourAnswer: 'Apna jawab likhein…',
    answerBtn: 'Jawab dein',
    generatedProcessHeader: (count) => `Banaya gaya process · ${count} steps`,
    stepsSummary: (stated, inferred) => `Aap ne ${stated} steps bataye. AI ne ${inferred} mazeed jore.`,
    processStepsCount: (count) => `Process ke Steps (${count})`,
    openLargerView: 'Bara view dekhein',
    aiAddedNoTime: 'AI ne jora, koi waqt shamil nahi',
    keep: 'Rakhain',
    kept: 'Rakh liya',
    remove: 'Hata dein',
    assumptionsHeader: 'Farz ki gayi baatein aur theek kiye gaye steps:',
    processNeedsAdjustment: 'Chalane se pehle ek cheez batani baqi hai',
    fixForMe: 'Mere liye theek karo',
    isThisRight: 'Kya yeh theek hai?',
    confirm: 'Confirm',
    confirmBlockedErrors: 'Confirm (pehle upar wala sawal bharein)',
    whatShouldChange: 'Kya tabdeeli karni hai?',
    whatShouldChangePlaceholder:
      'jaise payment se pehle ID check shamil karein, ya packaging kaun karta hai…',
    update: 'Update karein',
    continueInChat: 'Chat mein jari rakhein →',
    startOver: 'Nayi description ke sath dobara shuru karein',
    bothPathsContinue: 'Dono raaste yahan milte hain',
    customer: 'Customer',
    storeStaff: 'Staff / Dukan',
    estimated: 'estimated',
    branchesQuestion: 'Kitne % log kaunsa lete hain? (jaise 60% / 40%)',
    unconnectedError: 'Kuch steps aapas mein jurre nahi hain.',
    keepWorking: 'Kaam jari rakhain',
    discard: 'Khatam karein',
    discardModalTitle: 'Yeh draft khatam kar ke dobara shuru karein?',
    discardModalDesc:
      'Aapke likhe huway inputs khatam ho jayenge. Canvas par koi asar nahi hoga.',
    howFastIsEachStep: 'Har step mein kitna waqt lagta hai?',
    howFastHelp: 'Har kaam mein aam tor par lagne wala waqt chunain.',
    quick: 'Jaldi',
    quickSub: '1–2 min',
    normal: 'Mamool',
    normalSub: '3–8 min',
    slow: 'Dheema',
    slowSub: '10–25 min',
    custom: 'Apni marzi',
    customSub: 'Apni marzi',
    minLabel: 'Kam az kam',
    maxLabel: 'Zyada se zyada',
    unitDropdownSec: 'sec',
    unitDropdownMin: 'min',
    unitDropdownHours: 'ghante',
    notSure: 'Maloom nahi',
    continueBtn: 'Aagay barhein',
    finishAndApply: 'Khatam karein aur apply karein',
    errMinGreaterThanZero: 'Kam se kam waqt 0 se bara hona chahiye.',
    errMaxGteMin: 'Zyada se zyada waqt kam se kam waqt se kam nahi ho sakta.',
    processReadySummary: (steps, decisions, roles) =>
      `Aapka process tayyar hai. ${steps} steps, ${decisions} faislay, ${roles} log/roles.`,
    runSimulation: 'Simulation chalayein',
    editProcess: 'Process theek karein',
    runSimulationHint: 'Dekhein ke customers kahan intezar karte hain aur kahan waqt bach sakta hai.',
    estimatesNote: 'Kuch numbers andaze hain. Baad mein theek kar sakte hain.',
    totalMustBe100: (sum) => `Total ${sum}%, 100 hona zaroori hai`,
    totalIndicator: (sum) => `Total: ${sum}% (100 hona zaroori hai)`,
    autoBalance: 'Auto-balance',
    rushHourPace: 'RUSH KI RAFTAAR',
    busyness_steady: 'Aam',
    busyness_quiet: 'Kam',
    busyness_packed: 'Zyada',
    arrivalsPerHour: (n) => `~${n} customers/ghanta`,
    mainGoal: 'MAQSAD',
    goalWaitTimes: 'Intezar ka waqt',
    goalReduceCosts: 'Kharcha kam karna',
    goalThroughput: 'Zyada orders',
    optimizedForSpot: 'SPOT ke liye tayyar',
    patchedSimulationModel: 'Aapka process model',
    appliedToCanvas: 'Canvas par laga diya gaya',
    editAnswers: 'Jawab badlein',
    startOverBtn: 'Dobara shuru karein',
    confirmedBadge: 'Tasdeeq shuda',
    estimatedBadge: 'Andaza',
    tapEditToAdjust: 'Badalne ke liye pencil dabayein',
    modelAssumptions: (n) => `Model ke andaze (${n})`,
    reviewHeaderCount: (n) => `${n} cheezein check karni hain`,
    stepDurationsMinutes: 'Har step ka waqt (minutes)',
    actionRequiredTitle: 'Process theek karne ke liye yeh karein:',
    applyAndProceed: 'Theek karein aur aagay barhein',
    confirmAndApply: 'Confirm karein',
    applyGoDeeper: 'Apply karein aur mazeed dekhein →',
    answerQuestionsLink: '← Sawalon ke jawab de kar process theek karein',
    bothPathsMeetTooltip: 'Dono raaste yahan milte hain',
    autoRepairsApplied: 'Theek kiye gaye steps:',

    // Results page keys
    results_perfOverview: 'Performance Overview',
    results_perfOverviewTip: 'Simulation ka aasan khulasa: ek customer ko kitna waqt chahiye, har ghante aur din kitne log serve ho sakte hain, aur kahan waqt zaya hota hai.',
    results_customerNeedsWork: (work) => `Ek customer ko taqreeban ${work} ka haqeeqi kaam darpesh hota hai.`,
    results_customersArriveFaster: (role) => `Lekin log ${role} ki raftaar se zyada tezi se aa rahe hain, is liye line barhti ja rahi hai.`,
    results_averageWaitInLine: (wait) => `Aam taur par log taqreeban ${wait} line mein intezar bhi karte hain.`,
    results_bestCaseNoWait: 'Yeh behtareen soorat-e-haal hai, jismein koi intezar nahi.',
    results_workedOutFromCustomers: (runs) => `${runs} simulated customers ke tajziye se nikala gaya.`,
    results_calloutOverloadedWithArrival: (role, arrival, cap, targetArrival) =>
      `Customers ${role} ki salahiyat se zyada tezi se aa rahe hain. Taqreeban ${arrival} fi ghanta aate hain, jabke ${role} taqreeban ${cap} sambhal sakta hai. Line barhti ja rahi hai, is liye intezar aur kul waqt itna zyada dikh raha hai. Mazeed ${role} shamil karne${targetArrival ? ` ya amad ko taqreeban ${targetArrival} fi ghanta tak kam karne` : ''} se yeh theek ho sakta hai.`,
    results_calloutOverloadedNoArrival: (role, util, cap) =>
      `Customers ${role} ki salahiyat se zyada tezi se aa rahe hain. ${role} ${util}% waqt masroof rehta hai aur taqreeban ${cap} fi ghanta sambhal sakta hai. Line barhti ja rahi hai, is liye intezar aur kul waqt itna zyada dikh raha hai. Mazeed ${role} shamil karne se yeh theek ho sakta hai.`,
    results_calloutTight: (role, util, cap) =>
      `${role} taqreeban apni aakhri hadd par hai (${util}% masroof, zyada se zyada taqreeban ${cap} customers fi ghanta). Customers mein mamooli sa izafa bhi line bana dega.`,
    results_calloutOk: (role, cap, arrival) =>
      arrival != null
        ? `Salahiyat munasib lagti hai. ${role} taqreeban ${cap} customers fi ghanta sambhal sakta hai aur ${arrival} aate hain.`
        : `Salahiyat munasib lagti hai. ${role} taqreeban ${cap} customers fi ghanta sambhal sakta hai.`,
    results_cantKeepUp: "Line sambhal nahi rahi",
    results_closeToLimit: 'Hadd ke qareeb',
    results_runningSmoothly: 'Theek chal raha hai',
    results_realTime: 'Haqeeqi waqt',
    results_inflatedByLine: 'Line ki wajah se barha hua',
    results_inflatedByQueue: 'Barhti hui line ki wajah se zyada (upar summary dekhein)',
    results_timePerCustomer: 'Har customer ka waqt',
    results_timePerCustomerTip: 'Ek customer ke apne kaamon mein lagne wala waqt, baghair kisi intezar ke. Yeh aapke process ka behtareen tareen waqt hai.',
    results_workNoWait: 'kaam ka waqt, is mode mein koi intezar nahi',
    results_workNotCountingWait: 'kaam ka waqt, intezar shamil kiye baghair',
    results_customersPerHour: 'Customers fi ghanta',
    results_customersPerHourTip: 'Is simulation mein har ghante process se guzarne wale mukammal customers ki tadaad.',
    results_finishedEveryHour: 'har ghante mukammal',
    results_customersPerDay: 'Customers fi din',
    results_customersPerDayTip: 'Fi ghanta customers ko rozana ke kaam ke ghanton se zarb de kar nikala gaya.',
    results_inADayHours: (h) => `${h}-ghante ke din mein`,
    results_avgCompletionTime: 'Mukammal hone ka ausat waqt',
    results_avgCycleTime: 'Ausat cycle waqt',
    results_avgCycleTimeTip: 'Shuru se aakhir tak ka ausat waqt, line ka intezar shamil kar ke.',
    results_startToFinish: 'shuru se aakhir tak',
    results_pushedUpByGrowingLine: 'barhti line ki wajah se zyada, ek customer ka haqeeqi waqt nahi',
    results_fastestSlowest: (min, max) => `sab se tezi se ${min}, sab se aahista ${max}`,
    results_howTimeSpent: 'Customer ka waqt kahan guzarta hai',
    results_howTimeSpentHint: 'Jamani rang haqeeqi kaam hai, ferozi rang line mein intezar hai.',
    results_workingPct: (work, pct) => `${work} kaam (${pct}%)`,
    results_inLinePct: (wait, pct) => `${wait} line mein (${pct}%)`,
    results_arrivalsVsRole: (role) => `Amad banam ${role} ki salahiyat`,
    results_arrivalsVsRoleHint: 'Agar customers is se tezi se aayein toh line ban jati hai.',
    results_customersArriving: 'Aane wale customers',
    results_roleCanHandle: (role) => `${role} sambhal sakta hai`,
    results_stepByStep: 'Har step ki tafseel',
    results_stepByStepHint: (isQuick) => `Sab se lambay steps pehle aate hain.${isQuick ? '' : ' Ferozi rang har step se pehle intezar dikhata hai.'}`,
    results_stepWorkWait: (work, wait, isQuick) => `${work} kaam${!isQuick ? ` · ${wait} intezar` : ''}`,
    results_cycleTimeFooter: (runs, isAnalyst) => `${isAnalyst ? 'Cycle waqt' : 'Aane se jane tak ka waqt'} tamam ${runs} customers ka ausat hai, is liye barhti line isay barha deti hai. "Har customer ka waqt" asal kaam dikhata hai.`,

    // Tabs
    results_tabOverview: 'Jaiza',
    results_tabWhereWait: 'Customers kahan intezar karte hain',
    results_tabBottlenecks: 'Rukawatein aur Lines',
    results_tabStaffActivity: 'Staff ki Masroofiyat',
    results_tabResources: 'Resources',
    results_tabFinancial: 'Maliyat',
    results_tabIdeaComparison: 'Tajweez ka Mawazna',
    results_tabWhatIfComparison: 'What-If Mawazna',
    results_tabKeyTakeaways: 'Ahem Nikaat',

    // Header & Actions
    results_testResults: 'Test ke Nataij',
    results_simResults: 'Simulation ke Nataij',
    results_quickAnalysisBadge: 'SARSRI JAIZA',
    results_deepAnalysisBadge: 'TAFSILI JAIZA',
    results_basedOnRuns: (runs) => `${runs} test runs par mabni`,
    results_basedOnIterations: (runs) => `${runs} iterations par mabni`,
    results_testHistory: 'Test History',
    results_runHistory: 'Run History',
    results_loadingRuns: 'Runs load ho rahe hain…',
    results_savedTestRuns: 'Mehfooz Test Runs',
    results_savedSimRuns: 'Mehfooz Simulation Runs',
    results_noSavedRuns: 'Abhi tak koi test runs mehfooz nahi hain.',
    results_noSavedSimRuns: 'Abhi tak koi simulation runs mehfooz nahi hain.',
    results_savedRunFrom: (date) => `${date} ka mehfooz run`,
    results_exitSavedView: 'Mehfooz view se niklein',
    results_rerun: 'Dobara chalayein',
    results_rerunning: 'Dobara chal raha hai…',
    results_loadMore: 'Mazeed load karein',
    results_export: 'Export karein',
    results_rerunTest: 'Test dobara chalayein',
    results_rerunSim: 'Simulation dobara chalayein',
    results_viewExportIn: 'View/Export zubaan:',
    results_viewExportDefault: (lang) => `Default (${lang})`,

    // Top cards & alerts
    results_bestCaseDuration: 'Behtareen Tareen Mumkin Waqt',
    results_productionSpeed: 'Pedawari Raftaar',
    results_customersServedPerHour: 'Customers fi ghanta',
    results_worstCaseScenario: 'Khatarnak Tareen Soorat',
    results_predictability: 'Qabil-e-Andaza',
    results_consistent: 'Yaksan',
    results_variable: 'Mukhtalif',
    results_criticalBottleneck: 'Ahem Tareen Rukawat',
    results_slowestTask: 'Sab se Suste Step',
    results_fixNow: 'Abhi Theek Karein',
    results_noIssuesDetected: 'Koi masla nahi mila',
    results_timesVary: (spread, bnLabel) => `Waqt mein ${spread} ka farq hai.${bnLabel ? ` Farq kam karne ke liye "${bnLabel}" ko behtar banayein.` : ''}`,
    results_throughputLimitedBy: (bnLabel) => `Mojooda raftaar "${bnLabel}" ki wajah se mehdood hai.`,
    results_processOperatingEfficiently: 'Aapka process theek tarah se chal raha hai.',

    // Bottlenecks tab
    results_systemEfficiency: 'System ki Karkardagi',
    results_systemEfficiencyTip: 'Kaam ka waqt aur intezar ka mawazna. Kam karkardagi ka matlab hai log kaam se zyada intezar karte hain.',
    results_activeLabel: 'Kaam',
    results_constraintAnalysis: 'Rukawat ka Tajziya',
    results_constraintAnalysisTip: 'Woh step jo pooray process ko rokta hai. Pehle isay behtar banayein.',
    results_constraintDesc: (proc, wait) => `Yeh step process hone mein ${proc} leta hai aur fi unit ${wait} intezar karwata hai, jo isay sab se bari rukawat banata hai.`,
    results_editProperties: 'Tafseelat Badlein',
    results_noMajorRoadblocks: 'Koi bari rukawat nahi mili.',
    results_queueBacklog: 'Line ka Bojh',
    results_queueBacklogTip: 'Woh steps jahan log sab se lambi line mein kharay hotay hain.',
    results_queueItemDesc: (wait, count) => `${wait} intezar | ${count} log`,
    results_noQueueBuildUp: 'Line ka koi bojh nahi mila.',

    // Resources tab
    results_howBusyStaffAre: 'Staff kitna masroof hai',
    results_resourceUtilization: 'Resource ka Istemal',
    results_howBusySubtitle: 'Test run ke dauran har team member kitna masroof raha',
    results_howBusySimSubtitle: 'Simulation ke dauran har resource kitna masroof raha',
    results_badgeOverloaded: 'Bohat Zyada Bojh',
    results_badgeUnderused: 'Kam Istemal',
    results_badgeHealthy: 'Munasib',
    results_busyIdleStat: (busy, idle) => `${busy}% masroof · ${idle}% free`,

    // Financial tab
    results_noCostFigures: 'Abhi dikhane ke liye kharche ke adad nahi hain',
    results_noCostFiguresDesc: 'Kharche resource settings se nikale jate hain. Simulate mein unhein bharein aur Deep Analysis dobara chalayein.',
    results_financialAnalysis: 'Maliyati Tajziya',
    results_costForThisRun: (n, h) => `Is run ka kharcha (${n} customers, ${h} ghante)`,
    results_basedOnEstimatedValues: 'Andazay par mabni qeematein',
    results_activeCost: 'Kaam ka Kharcha',
    results_activeCostHint: 'Haqeeqi kaam par uthne wala kharcha',
    results_idleCost: 'Fariq Waqt ka Kharcha',
    results_idleCostHint: 'Baghair kaam ke ada kiya gaya kharcha',
    results_costPerCustomer: 'Kharcha / Customer',
    results_costDistribution: 'Kharche ki Taqseem',
    results_costBreakdownByResource: 'Resource ke lehaaz se Kharcha',
    results_costBreakdownByStaff: 'Staff ke lehaaz se Kharcha',
    results_stackedCostDesc: (isAnalyst) => isAnalyst ? 'Active + Idle Kharcha aur Istemal' : 'Active + Idle Kharcha aur Masroofiat %',
    results_colResource: 'Resource',
    results_colType: 'Qisam',
    results_colQty: 'Tadaad',
    results_colRate: 'Rate',
    results_colBusyHours: 'Masroof Ghante',
    results_colTotalCost: 'Kul Kharcha',
    results_colUtilization: 'Istemal',

    // What-If tab
    results_currentSetupVsIdea: 'Mojooda Setup aur Tajweez ka Mawazna',
    results_baselineVsWhatIf: 'Baseline aur What-If Karkardagi ka Mawazna',
    results_comparingCurrentVsIdea: (name) => `Mojooda setup ka mawazna tajweez se: "${name}"`,
    results_comparingBaselineVsWhatIf: (name) => `Baseline process ka mawazna scenario se: "${name}"`,
    results_whatIfActive: 'What-If Chal Raha Hai',
    results_ideaActive: 'Tajweez Chal Rahi Hai',
    results_diffModesTitle: (isAnalyst) => isAnalyst ? 'Baseline aur What-If mein mukhtalif simulation modes istemal huway' : 'Mojooda setup aur tajweez mein mukhtalif test modes istemal huway',
    results_diffModesDesc: 'Yeh mawazna theek nahi hai — sahi mawazne ke liye dono ko ek hi mode mein dobara chalayein.',
    results_goToSimulate: 'Simulate par jayein',
    results_noMeaningfulChange: 'Koi qabil-e-zikr tabdeeli nahi',
    results_currentSetup: 'Mojooda setup',
    results_baseline: 'Baseline',
    results_ideaToTry: 'Tajweez',
    results_whatIfScenario: 'What-If Scenario',
    results_waitPointShift: 'Intezar ki Jagah Badli',
    results_slowestStepShift: 'Suste Step Badla',
    results_bottleneckShift: 'Rukawat Badli',
    results_timeComparisonTitle: (isAnalyst) => isAnalyst ? 'Cycle Waqt: Baseline banam What-If' : 'Waqt: Mojooda setup banam Tajweez',
    results_throughputComparisonTitle: (isAnalyst) => isAnalyst ? 'Raftaar: Baseline banam What-If' : 'Customers fi ghanta: Mojooda setup banam Tajweez',

    // Key Takeaways & verdict
    results_keyTakeaways: 'Ahem Nikaat',
    results_keyTakeawaysSubtitle: (isAnalyst) => isAnalyst ? 'Simulation se samne aane wale ahem nikaat' : 'Test run se samne aane wale ahem nikaat',
    results_verdictBestCase: (dur) => `Fi unit behtareen tareen mumkin waqt **${dur}** hai.`,
    results_verdictOptimalBaseline: (isAnalyst) => isAnalyst ? 'Optimal path baseline tayyar. Sahi throughput ke liye Deep Analysis chalayein.' : 'Optimal benchmark tayyar. Sahi customer capacity ke liye Deep Analysis chalayein.',
    results_verdictOverloaded: (role, avg, work, throughput) => `Customers **${role}** ki salahiyat se tezi se aate hain, is liye line barhti rehti hai. Yahi wajah hai ke ausat waqt (**${avg}**) itna zyada lag raha hai: ek customer ka haqeeqi kaam sirf taqreeban **${work}** leta hai, aur sirf **${throughput} units/hr** guzar paate hain.`,
    results_verdictNormal: (avg, throughput) => `Mukammal hone ka ausat waqt **${avg}** hai, jo **${throughput} units/hr** deliver karta hai.`,
    results_verdictReliable: 'Process bojh ke tehat **Bohat Qabil-e-Aitemad** hai. Farq na hone ke barabar hai.',
    results_verdictHighRisk: (min, max) => `**Khatra Paya Gaya:** Mukammal hone ke waqt mein ${min} aur ${max} ke darmiyan shadeed farq hai.`,
    results_verdictSlowestStep: (bn) => `**"${bn}"** aapke process ka sab se suste step hai.`,
    results_verdictPrimaryBottleneck: (bn, isAnalyst) => isAnalyst ? `**"${bn}"** aapki bunyadi rukawat hai.` : `**"${bn}"** par customers sab se zyada intezar karte hain.`,
    results_verdictResourceOverloaded: (name, pct) => `**${name}** par bojh zyada hai (${pct}% salahiyat).`,
    results_verdictTotalCost: (type, cost) => `Is ${type} ka kul karobari kharcha **${cost}** tha.`,
    results_verdictNoStaffTime: 'Staff ka koi waqt record nahi hua, sara kharcha fariq waqt ka dikh raha hai. Task Details mein staff muqarrar karein.',
    results_verdictHighWaste: (cost, pct) => `**Bari Mali Zayan:** **${cost}** (kul kharche ka ${pct}%) fariq waqt mein zaya ho gaya.`,
    results_verdictIdleSpent: (cost, pct) => `**${cost}** (kul kharche ka ${pct}%) fariq resources par kharch hua.`,

    // Empty State
    results_noResultsTitle: 'Dikhane ke liye koi results nahi',
    results_noResultsDescNoNodes: 'Aap ne abhi tak process model nahi banaya. Analytics dekhne ke liye model banayein aur test chalayein.',
    results_noResultsDescNeedRun: 'Dashboard dekhne ke liye pehle test chalayein.',
    results_buildModel: 'Model Banayein',
    results_runTest: 'Test Chalayein',

    // AI Insights
    aiInsights_title: 'AI Insights',
    aiInsights_findImprovements: 'Behtari talash karein',
    aiInsights_refresh: 'Taaza karein',
    aiInsights_simulatePrompt: 'Laagu karne se pehle tajweez shuda tabdeeliyon ka asar dekhein.',
    aiInsights_testing: 'Simulator mein behtari ki tajweezon ki aazmaish jari hai…',
    aiInsights_implement: 'Tajweez laagu karein',
    aiInsights_implementing: 'Laagu ho raha hai…',
    aiInsights_noChangeWorth: 'Is load par kisi tabdeeli ki zaroorat nahi',
    ...LABEL_STRINGS['ur-roman'],
  },

  ur: {
    step1Title: 'مرحلہ 1: آپ کا پروسیس',
    step2Title: 'مرحلہ 2: کاروباری سوالات',
    step3Title: 'مرحلہ 3: سمولیشن کے لیے تیار',
    stepOf: (current, total) => `${current} از ${total}`,
    describeProcess: (bType) =>
      bType ? `اپنے ${bType} کاروبار کا پروسیس بیان کریں` : 'اپنا کاروباری پروسیس بیان کریں',
    describeProcessHelp:
      'آسان الفاظ میں بتائیں کہ گاہک کے آنے سے جانے تک کیا کیا مراحل ہوتے ہیں۔',
    placeholder: (bType) =>
      bType
        ? `بتائیں کہ آپ کے ${bType} کاروبار میں گاہک کے آنے سے جانے تک کیا ہوتا ہے…`
        : 'بتائیں کہ گاہک کے آنے سے جانے تک کیا کیا ہوتا ہے…',
    tryLabel: 'مثال:',
    showProcessBtn: 'میرا پروسیس دکھائیں',
    mappingProcess: 'اسپاٹ اے آئی آپ کا پروسیس تیار کر رہا ہے…',
    identifyingSteps: 'مراحل اور روابط سمجھے جا رہے ہیں…',
    generationIssue: 'پروسیس بنانے میں مسئلہ پیش آیا',
    tryAgain: 'دوبارہ کوشش کریں',
    oneDetailNeeded: 'ایک اہم وضاحت درکار ہے',
    typeYourAnswer: 'اپنا جواب لکھیں…',
    answerBtn: 'جواب دیں',
    generatedProcessHeader: (count) => `تیار کردہ پروسیس · ${count} مراحل`,
    stepsSummary: (stated, inferred) => `آپ نے ${stated} مراحل بتائے۔ اے آئی نے ${inferred} مزید شامل کیے۔`,
    processStepsCount: (count) => `پروسیس کے مراحل (${count})`,
    openLargerView: 'بڑا منظر دیکھیں',
    aiAddedNoTime: 'اے آئی نے شامل کیا، وقت شمار نہیں ہوگا',
    keep: 'رکھیں',
    kept: 'رکھ لیا',
    remove: 'ہٹا دیں',
    assumptionsHeader: 'فرضی اندازے اور خودکار اصلاحات:',
    processNeedsAdjustment: 'چلانے سے پہلے ایک چیز درست کرنا باقی ہے',
    fixForMe: 'میرے لیے ٹھیک کریں',
    isThisRight: 'کیا یہ درست ہے؟',
    confirm: 'تصدیق کریں',
    confirmBlockedErrors: 'تصدیق کریں (پہلے اوپر والا سوال مکمل کریں)',
    whatShouldChange: 'کیا تبدیلی کرنی ہے؟',
    whatShouldChangePlaceholder:
      'مثلاً ادائیگی سے پہلے شناختی تصدیق شامل کریں، یا پیکنگ کا کام تبدیل کریں…',
    update: 'اپ ڈیٹ کریں',
    continueInChat: 'چیٹ میں جاری رکھیں ←',
    startOver: 'نئی تفصیل کے ساتھ دوبارہ شروع کریں',
    bothPathsContinue: 'دونوں راستے یہاں ملتے ہیں',
    customer: 'گاہک',
    storeStaff: 'عملہ / دکان',
    estimated: 'تخمینہ',
    branchesQuestion: 'کتنے فیصد لوگ کون سا راستہ چنتے ہیں؟ (مثلاً 60% / 40%)',
    unconnectedError: 'کچھ مراحل آپس میں جڑے ہوئے نہیں ہیں۔',
    keepWorking: 'کام جاری رکھیں',
    discard: 'ختم کریں',
    discardModalTitle: 'یہ ڈرافٹ ختم کر کے دوبارہ شروع کریں؟',
    discardModalDesc:
      'آپ کے درج کردہ ان پٹ ختم ہو جائیں گے۔ کینوس پر کوئی اثر نہیں ہوگا۔',
    howFastIsEachStep: 'ہر مرحلے میں کتنا وقت لگتا ہے؟',
    howFastHelp: 'ہر کام میں عام طور پر لگنے والا وقت منتخب کریں۔',
    quick: 'تیز',
    quickSub: '1–2 منٹ',
    normal: 'معمول',
    normalSub: '3–8 منٹ',
    slow: 'سست',
    slowSub: '10–25 منٹ',
    custom: 'اپنی مرضی',
    customSub: 'اپنی مرضی',
    minLabel: 'کم از کم',
    maxLabel: 'زیادہ سے زیادہ',
    unitDropdownSec: 'سیکنڈ',
    unitDropdownMin: 'منٹ',
    unitDropdownHours: 'گھنٹے',
    notSure: 'معلوم نہیں',
    continueBtn: 'آگے بڑھیں',
    finishAndApply: 'مکمل کریں اور لاگو کریں',
    errMinGreaterThanZero: 'کم از کم وقت 0 سے زیادہ ہونا چاہیے۔',
    errMaxGteMin: 'زیادہ سے زیادہ وقت کم از کم وقت سے کم نہیں ہو سکتا۔',
    processReadySummary: (steps, decisions, roles) =>
      `آپ کا پروسیس تیار ہے۔ ${steps} مراحل، ${decisions} فیصلے، ${roles} کردار۔`,
    runSimulation: 'سمولیشن چلائیں',
    editProcess: 'پروسیس میں ترمیم کریں',
    runSimulationHint: 'دیکھیں کہ گاہک کہاں انتظار کرتے ہیں اور کہاں وقت بچایا جا سکتا ہے۔',
    estimatesNote: 'کچھ اعداد و شمار تخمینہ ہیں۔ آپ بعد میں ان کو بہتر کر سکتے ہیں۔',
    totalMustBe100: (sum) => `مجموعہ ${sum}٪، 100 ہونا ضروری ہے`,
    totalIndicator: (sum) => `مجموعہ: ${sum}٪ (100 ہونا ضروری ہے)`,
    autoBalance: 'خودکار توازن',
    rushHourPace: 'رش کے اوقات کی رفتار',
    busyness_steady: 'معمول',
    busyness_quiet: 'کم',
    busyness_packed: 'زیادہ',
    arrivalsPerHour: (n) => `~${n} گاہک/گھنٹہ`,
    mainGoal: 'بنیادی مقصد',
    goalWaitTimes: 'انتظار کا وقت',
    goalReduceCosts: 'اخراجات کم کرنا',
    goalThroughput: 'زیادہ آرڈرز',
    optimizedForSpot: 'اسپاٹ کے لیے بہتر بنایا گیا',
    patchedSimulationModel: 'درست کردہ سمولیشن ماڈل',
    appliedToCanvas: 'کینوس پر لاگو کر دیا گیا',
    editAnswers: 'جوابات تبدیل کریں',
    startOverBtn: 'دوبارہ شروع کریں',
    confirmedBadge: 'تصدیق شدہ',
    estimatedBadge: 'تخمینہ',
    tapEditToAdjust: 'تبدیل کرنے کے لیے پنسل دبائیں',
    modelAssumptions: (n) => `ماڈل کے فرضی اندازے (${n})`,
    reviewHeaderCount: (n) => `${n} چیزوں کا جائزہ درکار ہے`,
    stepDurationsMinutes: 'ہر مرحلے کا وقت (منٹ)',
    actionRequiredTitle: 'پروسیس کی جانچ درست کرنے کے لیے یہ کارروائی درکار ہے:',
    applyAndProceed: 'خودکار اصلاحات لاگو کریں اور آگے بڑھیں',
    confirmAndApply: 'تصدیق اور لاگو کریں',
    applyGoDeeper: 'لاگو کریں اور تفصیلات دیکھیں ←',
    answerQuestionsLink: '← سوالات کے جوابات دے کر پروسیس درست کریں',
    bothPathsMeetTooltip: 'دونوں راستے یہاں ملتے ہیں',
    autoRepairsApplied: 'لاگو شدہ خودکار اصلاحات:',

    // Results page keys
    results_perfOverview: 'کارکردگی کا جائزہ',
    results_perfOverviewTip: 'سمولیشن کا آسان خلاصہ: ایک گاہک کو کتنا وقت درکار ہے، ہر گھنٹے اور دن میں کتنے گاہک نمٹائے جا سکتے ہیں، اور کہاں وقت ضائع ہوتا ہے۔',
    results_customerNeedsWork: (work) => `ایک گاہک کے لیے تقریباً ${work} کا حقیقی کام درکار ہوتا ہے۔`,
    results_customersArriveFaster: (role) => `لیکن گاہک ${role} کی گنجائش سے زیادہ تیزی سے آ رہے ہیں، اس لیے قطار لمبی ہوتی جا رہی ہے۔`,
    results_averageWaitInLine: (wait) => `اوسطاً وہ تقریباً ${wait} قطار میں انتظار بھی کرتے ہیں۔`,
    results_bestCaseNoWait: 'یہ بغیر کسی انتظار کے بہترین صورت حال ہے۔',
    results_workedOutFromCustomers: (runs) => `${runs} گاہکوں کے سمولیشن سے اخذ کیا گیا۔`,
    results_calloutOverloadedWithArrival: (role, arrival, cap, targetArrival) =>
      `گاہک ${role} کی گنجائش سے زیادہ تیزی سے آ رہے ہیں۔ تقریباً ${arrival} فی گھنٹہ آتے ہیں، جبکہ ${role} تقریباً ${cap} نمٹا سکتا ہے۔ قطار بڑھتی جا رہی ہے، اسی لیے انتظار اور کل وقت اتنا زیادہ نظر آ رہا ہے۔ مزید ${role} شامل کرنے${targetArrival ? ` یا آمد کو تقریباً ${targetArrival} فی گھنٹہ تک لانے` : ''} سے یہ مسئلہ حل ہو جائے گا۔`,
    results_calloutOverloadedNoArrival: (role, util, cap) =>
      `گاہک ${role} کی گنجائش سے زیادہ تیزی سے آ رہے ہیں۔ ${role} ${util}٪ وقت مصروف رہتا ہے اور تقریباً ${cap} فی گھنٹہ نمٹا سکتا ہے۔ قطار بڑھتی جا رہی ہے، اس لیے انتظار اور کل وقت اتنا زیادہ نظر آ رہا ہے۔ مزید ${role} شامل کرنے سے یہ ٹھیک ہو سکتا ہے۔`,
    results_calloutTight: (role, util, cap) =>
      `${role} تقریباً اپنی آخری حد پر ہے (${util}٪ مصروف، زیادہ سے زیادہ تقریباً ${cap} گاہک فی گھنٹہ)۔ گاہکوں میں معمولی سا اضافہ بھی قطار بنا دے گا۔`,
    results_calloutOk: (role, cap, arrival) =>
      arrival != null
        ? `گنجائش مناسب لگتی ہے۔ ${role} تقریباً ${cap} گاہک فی گھنٹہ نمٹا سکتا ہے اور ${arrival} آتے ہیں۔`
        : `گنجائش مناسب لگتی ہے۔ ${role} تقریباً ${cap} گاہک فی گھنٹہ نمٹا سکتا ہے۔`,
    results_cantKeepUp: 'قطار سنبھل نہیں رہی',
    results_closeToLimit: 'حد کے قریب',
    results_runningSmoothly: 'روانی سے چل رہا ہے',
    results_realTime: 'حقیقی وقت',
    results_inflatedByLine: 'قطار کی وجہ سے بڑھا ہوا',
    results_inflatedByQueue: 'بڑھتی ہوئی قطار کی وجہ سے زیادہ (اوپر خلاصہ دیکھیں)',
    results_timePerCustomer: 'فی گاہک وقت',
    results_timePerCustomerTip: 'ایک گاہک کے اپنے کاموں میں لگنے والا وقت، بغیر کسی انتظار کے۔ یہ آپ کے عمل کا بہترین ممکنہ وقت ہے۔',
    results_workNoWait: 'کام کا وقت، اس موڈ میں کوئی انتظار نہیں',
    results_workNotCountingWait: 'کام کا وقت، بغیر انتظار شمار کیے',
    results_customersPerHour: 'گاہک فی گھنٹہ',
    results_customersPerHourTip: 'اس سمولیشن میں ہر گھنٹے عمل سے کامیابی سے گزرنے والے گاہکوں کی تعداد۔',
    results_finishedEveryHour: 'ہر گھنٹے مکمل',
    results_customersPerDay: 'گاہک فی دن',
    results_customersPerDayTip: 'فی گھنٹہ گاہکوں کو روزانہ کے کام کے گھنٹوں سے ضرب دے کر اخذ کیا گیا۔',
    results_inADayHours: (h) => `${h} گھنٹے کے دن میں`,
    results_avgCompletionTime: 'مکمل ہونے کا اوسط وقت',
    results_avgCycleTime: 'اوسط سائیکل کا وقت',
    results_avgCycleTimeTip: 'شروع سے آخر تک کا اوسط وقت، قطار میں انتظار سمیت۔ اگر عملہ رفتار برقرار نہ رکھ سکے تو یہ وقت بڑھتا جاتا ہے۔',
    results_startToFinish: 'شروع سے آخر تک',
    results_pushedUpByGrowingLine: 'بڑھتی قطار کی وجہ سے زیادہ، ایک گاہک کا حقیقی وقت نہیں',
    results_fastestSlowest: (min, max) => `تیز ترین ${min}، سست ترین ${max}`,
    results_howTimeSpent: 'گاہک کا وقت کہاں گزرتا ہے',
    results_howTimeSpentHint: 'جامنی رنگ حقیقی کام ہے، فیروزی رنگ قطار میں انتظار ہے۔',
    results_workingPct: (work, pct) => `${work} کام (${pct}٪)`,
    results_inLinePct: (wait, pct) => `${wait} قطار میں (${pct}٪)`,
    results_arrivalsVsRole: (role) => `آمد بنام ${role} کی گنجائش`,
    results_arrivalsVsRoleHint: 'اگر گاہک اس سے زیادہ تیزی سے آئیں تو قطار بن جاتی ہے۔',
    results_customersArriving: 'آنے والے گاہک',
    results_roleCanHandle: (role) => `${role} سنبھال سکتا ہے`,
    results_stepByStep: 'مرحلہ وار تفصیل',
    results_stepByStepHint: (isQuick) => `سب سے طویل مراحل پہلے آتے ہیں۔${isQuick ? '' : ' فیروزی رنگ ہر مرحلے سے پہلے انتظار دکھاتا ہے۔'}`,
    results_stepWorkWait: (work, wait, isQuick) => `${work} کام${!isQuick ? ` · ${wait} انتظار` : ''}`,
    results_cycleTimeFooter: (runs, isAnalyst) => `${isAnalyst ? 'سائیکل کا وقت' : 'آمد سے فراغت تک کا وقت'} تمام ${runs} گاہکوں کا اوسط ہے، اس لیے بڑھتی قطار اسے بڑھا دیتی ہے۔ "فی گاہک وقت" اصل کام کو ظاہر کرتا ہے۔`,

    // Tabs
    results_tabOverview: 'جائزہ',
    results_tabWhereWait: 'گاہک کہاں انتظار کرتے ہیں',
    results_tabBottlenecks: 'رکاوٹیں اور قطاریں',
    results_tabStaffActivity: 'عملے کی سرگرمی',
    results_tabResources: 'وسائل',
    results_tabFinancial: 'مالیات',
    results_tabIdeaComparison: 'تجویز کا موازنہ',
    results_tabWhatIfComparison: 'موازنہ برائے متبادل',
    results_tabKeyTakeaways: 'اہم نکات',

    // Header & Actions
    results_testResults: 'ٹیسٹ کے نتائج',
    results_simResults: 'سمولیشن کے نتائج',
    results_quickAnalysisBadge: 'سررسی جائزہ',
    results_deepAnalysisBadge: 'تفصیلی جائزہ',
    results_basedOnRuns: (runs) => `${runs} ٹیسٹ رنز پر مبنی`,
    results_basedOnIterations: (runs) => `${runs} تکرار پر مبنی`,
    results_testHistory: 'ٹیسٹ ہسٹری',
    results_runHistory: 'رن ہسٹری',
    results_loadingRuns: 'رنز لوڈ ہو رہے ہیں…',
    results_savedTestRuns: 'محفوظ ٹیسٹ رنز',
    results_savedSimRuns: 'محفوظ سمولیشن رنز',
    results_noSavedRuns: 'ابھی تک کوئی ٹیسٹ رنز محفوظ نہیں ہیں۔',
    results_noSavedSimRuns: 'ابھی تک کوئی سمولیشن رنز محفوظ نہیں ہیں۔',
    results_savedRunFrom: (date) => `${date} کا محفوظ رن`,
    results_exitSavedView: 'محفوظ منظر بند کریں',
    results_rerun: 'دوبارہ چلائیں',
    results_rerunning: 'دوبارہ چل رہا ہے…',
    results_loadMore: 'مزید لوڈ کریں',
    results_export: 'ایکسپورٹ کریں',
    results_rerunTest: 'ٹیسٹ دوبارہ چلائیں',
    results_rerunSim: 'سمولیشن دوبارہ چلائیں',
    results_viewExportIn: 'دیکھیں/ایکسپورٹ کریں:',
    results_viewExportDefault: (lang) => `ڈیفالٹ (${lang})`,

    // Top cards & alerts
    results_bestCaseDuration: 'بہترین ممکنہ وقت',
    results_productionSpeed: 'پیداواری رفتار',
    results_customersServedPerHour: 'گاہک فی گھنٹہ',
    results_worstCaseScenario: 'بدترین صورت حال',
    results_predictability: 'پیش گوئی کی صلاحیت',
    results_consistent: 'یکساں',
    results_variable: 'متغیر',
    results_criticalBottleneck: 'اہم ترین رکاوٹ',
    results_slowestTask: 'سست ترین مرحلہ',
    results_fixNow: 'ابھی درست کریں',
    results_noIssuesDetected: 'کوئی مسئلہ نہیں پایا گیا',
    results_timesVary: (spread, bnLabel) => `اوقات میں ${spread} کا فرق ہے۔${bnLabel ? ` فرق کم کرنے کے لیے "${bnLabel}" کو مستحکم کریں۔` : ''}`,
    results_throughputLimitedBy: (bnLabel) => `موجودہ رفتار "${bnLabel}" کی وجہ سے محدود ہے۔`,
    results_processOperatingEfficiently: 'آپ کا پروسیس خوش اسلوبی سے چل رہا ہے۔',

    // Bottlenecks tab
    results_systemEfficiency: 'نظام کی کارکردگی',
    results_systemEfficiencyTip: 'کام کے وقت اور انتظار کا موازنہ۔ کم شرح کا مطلب ہے گاہک کام کے بجائے زیادہ انتظار کرتے ہیں۔',
    results_activeLabel: 'کام',
    results_constraintAnalysis: 'رکاوٹ کا تجزیہ',
    results_constraintAnalysisTip: 'وہ مرحلہ جو پورے عمل کو روکتا ہے۔ پہلے اس کو بہتر بنائیں۔',
    results_constraintDesc: (proc, wait) => `یہ مرحلہ پروسیس ہونے میں ${proc} لیتا ہے اور فی یونٹ ${wait} انتظار کرواتا ہے، جو اسے سب سے بڑی رکاوٹ بناتا ہے۔`,
    results_editProperties: 'خصوصیات میں ترمیم کریں',
    results_noMajorRoadblocks: 'کوئی بڑی رکاوٹ نہیں پائی گئی۔',
    results_queueBacklog: 'قطار کا بوجھ',
    results_queueBacklogTip: 'وہ مراحل جہاں لوگ سب سے لمبی قطار میں کھڑے ہوتے ہیں۔',
    results_queueItemDesc: (wait, count) => `${wait} انتظار | ${count} گاہک`,
    results_noQueueBuildUp: 'قطار کا کوئی بوجھ نہیں پایا گیا۔',

    // Resources tab
    results_howBusyStaffAre: 'عملہ کتنا مصروف ہے',
    results_resourceUtilization: 'وسائل کا استعمال',
    results_howBusySubtitle: 'ٹیسٹ رن کے دوران ہر رکن کتنا مصروف رہا',
    results_howBusySimSubtitle: 'سمولیشن کے دوران ہر وسیلہ کتنا مصروف رہا',
    results_badgeOverloaded: 'بہت زیادہ بوجھ',
    results_badgeUnderused: 'کم استعمال',
    results_badgeHealthy: 'مناسب',
    results_busyIdleStat: (busy, idle) => `${busy}٪ مصروف · ${idle}٪ فارغ`,

    // Financial tab
    results_noCostFigures: 'ابھی دکھانے کے لیے اخراجات کے اعداد و شمار نہیں ہیں',
    results_noCostFiguresDesc: 'اخراجات وسائل کی ترتیبات سے اخذ کیے جاتے ہیں۔ سمولیٹ میں تفصیلات درج کریں اور گہرا تجزیہ دوبارہ چلائیں۔',
    results_financialAnalysis: 'مالیاتی تجزیہ',
    results_costForThisRun: (n, h) => `اس رن کی لاگت (${n} گاہک، ${h} گھنٹے)`,
    results_basedOnEstimatedValues: 'تخمینی اقدار پر مبنی',
    results_activeCost: 'کام کے اخراجات',
    results_activeCostHint: 'حقیقی کام پر آنے والی لاگت',
    results_idleCost: 'فارغ وقت کے اخراجات',
    results_idleCostHint: 'بغیر کام کے ادا کی جانے والی لاگت',
    results_costPerCustomer: 'لاگت / فی گاہک',
    results_costDistribution: 'اخراجات کی تقسیم',
    results_costBreakdownByResource: 'وسائل کے لحاظ سے اخراجات',
    results_costBreakdownByStaff: 'عملے کے لحاظ سے اخراجات',
    results_stackedCostDesc: (isAnalyst) => isAnalyst ? 'مجموعی فعال اور فارغ لاگت اور استعمال' : 'مجموعی فعال اور فارغ لاگت اور مصروفیت ٪',
    results_colResource: 'وسیلہ',
    results_colType: 'قسم',
    results_colQty: 'تعداد',
    results_colRate: 'شرح',
    results_colBusyHours: 'مصروف گھنٹے',
    results_colTotalCost: 'کل لاگت',
    results_colUtilization: 'استعمال',

    // What-If tab
    results_currentSetupVsIdea: 'موجودہ سیٹ اپ اور تجویز کا موازنہ',
    results_baselineVsWhatIf: 'بنیادی ماڈل اور متبادل منظرنامے کی کارکردگی کا موازنہ',
    results_comparingCurrentVsIdea: (name) => `موجودہ سیٹ اپ کا موازنہ تجویز کے ساتھ: "${name}"`,
    results_comparingBaselineVsWhatIf: (name) => `بنیادی پروسیس کا موازنہ منظرنامے کے ساتھ: "${name}"`,
    results_whatIfActive: 'متبادل منظرنامہ فعال ہے',
    results_ideaActive: 'تجویز فعال ہے',
    results_diffModesTitle: (isAnalyst) => isAnalyst ? 'بنیادی اور متبادل ماڈل میں مختلف سمولیشن موڈز استعمال ہوئے' : 'موجودہ سیٹ اپ اور تجویز میں مختلف ٹیسٹ موڈز استعمال ہوئے',
    results_diffModesDesc: 'یہ موازنہ درست نہیں ہے — درست نتائج کے لیے دونوں کو ایک ہی موڈ میں دوبارہ چلائیں۔',
    results_goToSimulate: 'سمولیٹ پر جائیں',
    results_noMeaningfulChange: 'کوئی نمایاں تبدیلی نہیں',
    results_currentSetup: 'موجودہ سیٹ اپ',
    results_baseline: 'بنیادی ماڈل',
    results_ideaToTry: 'تجویز',
    results_whatIfScenario: 'متبادل منظرنامہ',
    results_waitPointShift: 'انتظار کی جگہ تبدیل ہوئی',
    results_slowestStepShift: 'سست ترین مرحلہ تبدیل ہوا',
    results_bottleneckShift: 'رکاوٹ تبدیل ہوئی',
    results_timeComparisonTitle: (isAnalyst) => isAnalyst ? 'سائیکل کا وقت: بنیادی بنام متبادل' : 'آمد سے فراغت تک کا وقت: موجودہ سیٹ اپ بنام تجویز',
    results_throughputComparisonTitle: (isAnalyst) => isAnalyst ? 'پیداواری رفتار: بنیادی بنام متبادل' : 'گاہک فی گھنٹہ: موجودہ سیٹ اپ بنام تجویز',

    // Key Takeaways & verdict
    results_keyTakeaways: 'اہم نکات',
    results_keyTakeawaysSubtitle: (isAnalyst) => isAnalyst ? 'سمولیشن سے حاصل ہونے والے اہم نتائج' : 'ٹیسٹ رن سے حاصل ہونے والے اہم نتائج',
    results_verdictBestCase: (dur) => `فی یونٹ بہترین ممکنہ وقت **${dur}** ہے۔`,
    results_verdictOptimalBaseline: (isAnalyst) => isAnalyst ? 'بہترین بنیادی راستہ طے پا گیا۔ درست گنجائش کے لیے گہرا تجزیہ چلائیں۔' : 'بہترین بنیادی راستہ طے پا گیا۔ درست گاہک صلاحیت کے لیے گہرا تجزیہ چلائیں۔',
    results_verdictOverloaded: (role, avg, work, throughput) => `گاہک **${role}** کی گنجائش سے زیادہ تیزی سے آتے ہیں، اس لیے قطار بڑھتی رہتی ہے۔ اسی لیے اوسط وقت (**${avg}**) اتنا زیادہ ہے: ایک گاہک کا حقیقی کام صرف تقریباً **${work}** لیتا ہے، اور صرف **${throughput} یونٹس/گھنٹہ** مکمل ہوتے ہیں۔`,
    results_verdictNormal: (avg, throughput) => `مکمل ہونے کا اوسط وقت **${avg}** ہے، جو **${throughput} یونٹس/گھنٹہ** فراہم کرتا ہے۔`,
    results_verdictReliable: 'پروسیس بوجھ کے تحت **انتہائی قابل اعتماد** ہے۔ فرق نہ ہونے کے برابر ہے۔',
    results_verdictHighRisk: (min, max) => `**خطرے کی نشاندہی:** مکمل ہونے کے وقت میں ${min} اور ${max} کے درمیان بہت زیادہ اتار چڑھاؤ ہے۔`,
    results_verdictSlowestStep: (bn) => `**"${bn}"** آپ کے پروسیس کا سست ترین مرحلہ ہے۔`,
    results_verdictPrimaryBottleneck: (bn, isAnalyst) => isAnalyst ? `**"${bn}"** آپ کی بنیادی رکاوٹ ہے۔` : `**"${bn}"** وہ جگہ ہے جہاں گاہک سب سے زیادہ انتظار کرتے ہیں۔`,
    results_verdictResourceOverloaded: (name, pct) => `**${name}** پر زیادہ بوجھ ہے (${pct}٪ گنجائش)۔`,
    results_verdictTotalCost: (type, cost) => `اس ${type} کا کل آپریشنل خرچ **${cost}** تھا۔`,
    results_verdictNoStaffTime: 'عملے کا کوئی وقت ریکارڈ نہیں ہوا، تمام لاگت فارغ وقت کی ظاہر ہو رہی ہے۔ ٹاسک کی تفصیلات میں عملہ متعین کریں۔',
    results_verdictHighWaste: (cost, pct) => `**بڑا مالی زیاں:** **${cost}** (کل لاگت کا ${pct}٪) فارغ وقت میں ضائع ہوا۔`,
    results_verdictIdleSpent: (cost, pct) => `**${cost}** (کل لاگت کا ${pct}٪) فارغ وسائل پر خرچ ہوا۔`,

    // Empty State
    results_noResultsTitle: 'دکھانے کے لیے نتائج موجود نہیں',
    results_noResultsDescNoNodes: 'آپ نے ابھی تک پروسیس ماڈل تیار نہیں کیا۔ تجزیات دیکھنے کے لیے ماڈل بنائیں اور ٹیسٹ چلائیں۔',
    results_noResultsDescNeedRun: 'ڈیش بورڈ دیکھنے کے لیے پہلے ٹیسٹ چلائیں۔',
    results_buildModel: 'ماڈل بنائیں',
    results_runTest: 'ٹیسٹ چلائیں',

    // AI Insights
    aiInsights_title: 'اے آئی بصیرت',
    aiInsights_findImprovements: 'بہتری تلاش کریں',
    aiInsights_refresh: 'تازہ کریں',
    aiInsights_simulatePrompt: 'لاگو کرنے سے پہلے تجاویز کا اثر ناپنے کے لیے سمولیشن چلائیں۔',
    aiInsights_testing: 'سمولیٹر میں مجوزہ بہتریوں کی جانچ جاری ہے…',
    aiInsights_implement: 'تجویز لاگو کریں',
    aiInsights_implementing: 'لاگو ہو رہا ہے…',
    aiInsights_noChangeWorth: 'اس بوجھ پر کسی تبدیلی کی ضرورت نہیں',
    ...LABEL_STRINGS.ur,
  },
};

/**
 * Format plain-language hint for step duration.
 * e.g. "Usually takes between 10 and 15 minutes." / "Takes 10 minutes."
 */
export function formatDurationHint(min, max, unit = 'minutes', lang = 'en') {
  const numMin = Number(min);
  const numMax = Number(max);

  if (lang === 'ur') {
    const unitWord = unit === 'seconds' ? 'سیکنڈ' : (unit === 'hours' ? 'گھنٹے' : 'منٹ');
    if (numMin === numMax) {
      return `عام طور پر تقریباً ${numMin} ${unitWord} لگتے ہیں۔`;
    }
    return `عام طور پر ${numMin} سے ${numMax} ${unitWord} لگتے ہیں۔`;
  }

  const isUrRoman = lang === 'ur-roman';
  let unitWord = '';
  if (unit === 'seconds') {
    unitWord = isUrRoman ? 'second' : (numMax === 1 ? 'second' : 'seconds');
  } else if (unit === 'hours') {
    unitWord = isUrRoman ? 'ghante' : (numMax === 1 ? 'hour' : 'hours');
  } else {
    unitWord = isUrRoman ? 'minute' : (numMax === 1 ? 'minute' : 'minutes');
  }

  if (numMin === numMax) {
    return isUrRoman
      ? `Taqreeban ${numMin} ${unitWord} lagte hain.`
      : `Usually takes ${numMin} ${unitWord}.`;
  }
  return isUrRoman
    ? `Taqreeban ${numMin} se ${numMax} ${unitWord} lagte hain.`
    : `Usually takes between ${numMin} and ${numMax} ${unitWord}.`;
}

/**
 * Validates a custom duration range.
 * Returns null if valid, or a friendly error message string if invalid.
 */
export function validateCustomRange(min, max, lang = 'en') {
  if (min === '' || min == null) {
    if (lang === 'ur') return 'کم از کم وقت 0 سے زیادہ ہونا چاہیے۔';
    if (lang === 'ur-roman') return 'Kam se kam waqt 0 se bara hona chahiye.';
    return 'Minimum time must be greater than 0.';
  }
  const numMin = Number(min);
  if (isNaN(numMin) || numMin <= 0) {
    if (lang === 'ur') return 'کم از کم وقت 0 سے زیادہ ہونا چاہیے۔';
    if (lang === 'ur-roman') return 'Kam se kam waqt 0 se bara hona chahiye.';
    return 'Minimum time must be greater than 0.';
  }
  if (max === '' || max == null) {
    if (lang === 'ur') return 'زیادہ سے زیادہ وقت کم از کم وقت سے کم نہیں ہو سکتا۔';
    if (lang === 'ur-roman') return 'Zyada se zyada waqt kam se kam waqt se kam nahi ho sakta.';
    return 'Maximum time cannot be less than minimum.';
  }
  const numMax = Number(max);
  if (isNaN(numMax) || numMax < numMin) {
    if (lang === 'ur') return 'زیادہ سے زیادہ وقت کم از کم وقت سے کم نہیں ہو سکتا۔';
    if (lang === 'ur-roman') return 'Zyada se zyada waqt kam se kam waqt se kam nahi ho sakta.';
    return 'Maximum time cannot be less than minimum.';
  }
  return null;
}

const MIN_PER_HOUR = 60;
const MIN_PER_DAY = 1440;

function trimNumber(n, d = 1) {
  const f = Math.pow(10, d);
  const v = Math.round(n * f) / f;
  return Number.isInteger(v) ? String(v) : v.toFixed(d);
}

/**
 * Localized duration formatter.
 * e.g. formatDuration(27, 'ur') -> "27 منٹ"
 *      formatDuration(27, 'ur-roman') -> "27 min"
 *      formatDuration(27, 'en') -> "27 minutes"
 */
export function formatDuration(minutes, lang = 'en') {
  const m = Number(minutes);
  if (!isFinite(m) || m <= 0) {
    if (lang === 'ur') return '0 منٹ';
    if (lang === 'ur-roman') return '0 min';
    return '0 minutes';
  }
  if (m >= MIN_PER_DAY) {
    const d = m / MIN_PER_DAY;
    const val = trimNumber(d);
    if (lang === 'ur') return `${val} دن`;
    if (lang === 'ur-roman') return `${val} din`;
    return `${val} ${Math.round(d * 10) / 10 === 1 ? 'day' : 'days'}`;
  }
  if (m >= MIN_PER_HOUR) {
    const h = m / MIN_PER_HOUR;
    const val = trimNumber(h);
    if (lang === 'ur') return `${val} گھنٹے`;
    if (lang === 'ur-roman') return `${val} ghante`;
    return `${val} ${Math.round(h * 10) / 10 === 1 ? 'hour' : 'hours'}`;
  }
  const val = trimNumber(m, m < 10 ? 1 : 0);
  if (lang === 'ur') return `${val} منٹ`;
  if (lang === 'ur-roman') return `${val} min`;
  return `${val} ${Number(val) === 1 ? 'minute' : 'minutes'}`;
}

/**
 * Localized rate formatter.
 * e.g. formatRate(6.3, 'hr', 'ur') -> "6.3 فی گھنٹہ"
 *      formatRate(6.3, 'hr', 'ur-roman') -> "6.3 per ghanta"
 *      formatRate(6.3, 'hr', 'en') -> "6.3/hr"
 */
export function formatRate(n, unit = 'hr', lang = 'en') {
  const num = Number(n);
  const val = isFinite(num) ? (num % 1 === 0 ? String(num) : num.toFixed(1)) : '0';
  if (lang === 'ur') {
    if (unit === 'hr' || unit === 'hour') return `${val} فی گھنٹہ`;
    if (unit === 'day') return `${val} فی دن`;
    return `${val} فی ${unit}`;
  }
  if (lang === 'ur-roman') {
    if (unit === 'hr' || unit === 'hour') return `${val} per ghanta`;
    if (unit === 'day') return `${val} per din`;
    return `${val} per ${unit}`;
  }
  return `${val}/${unit}`;
}

/**
 * Localized currency formatter.
 * e.g. formatCurrency(500, 'ur') -> "500.00 روپے"
 *      formatCurrency(500, 'ur-roman') -> "Rs 500.00"
 *      formatCurrency(500, 'en') -> "Rs 500.00"
 */
export function formatCurrency(n, lang = 'en', currency = 'Rs') {
  const num = Number(n);
  const val = isFinite(num)
    ? num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00';
  if (lang === 'ur') {
    return `${val} روپے`;
  }
  if (lang === 'ur-roman') {
    return `Rs ${val}`;
  }
  return `${currency} ${val}`;
}

function getParamNames(fn) {
  try {
    const fnStr = fn.toString();
    const match = fnStr.match(/^(?:async\s*)?(?:function\s*)?(?:\w+\s*)?\(([^)]*)\)/) || fnStr.match(/^(?:async\s*)?([^\s=>(]+)\s*=>/);
    if (match && match[1]) {
      return match[1].split(',').map(p => p.trim().split('=')[0].trim()).filter(Boolean);
    }
  } catch {}
  return [];
}

function safeStringify(val, key, paramName, isDev) {
  if (typeof val === 'string') {
    return val === '[object Object]' ? '' : val;
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || Number.isNaN(val)) {
      if (isDev) {
        console.warn(`[i18n] Fallback used for key "${key}" param "${paramName}": received ${val}`);
      }
      return '';
    }
    return val;
  }
  if (typeof val === 'boolean') return val;

  if (val === null || val === undefined) {
    if (isDev) {
      console.warn(`[i18n] Fallback used for key "${key}" param "${paramName}": received ${val}`);
    }
    return '';
  }

  if (Array.isArray(val)) {
    return val.map(item => safeStringify(item, key, paramName, isDev)).filter(Boolean).join(', ');
  }

  if (typeof val === 'object') {
    if (isDev) {
      console.warn(`[i18n] Fallback used for key "${key}" param "${paramName}": received object`, val);
    }
    let str = val.name ?? val.label ?? val.title ?? val.task_name ?? val.role ?? val.text;
    if (str === undefined && val.props) {
      const ch = val.props.children;
      if (typeof ch === 'string') {
        str = ch;
      } else if (ch && typeof ch === 'object') {
        str = ch.name ?? ch.label ?? ch.title ?? (typeof ch.props?.children === 'string' ? ch.props.children : '');
      }
    }
    if (str === undefined) {
      if (val.current != null && Number.isFinite(Number(val.current))) str = String(val.current);
      else if (val.value != null && Number.isFinite(Number(val.value))) str = String(val.value);
      else if (val.pct != null && Number.isFinite(Number(val.pct))) str = String(val.pct);
      else if (val.utilization_pct != null && Number.isFinite(Number(val.utilization_pct))) str = String(val.utilization_pct);
    }
    if (typeof str === 'object' && str !== null) {
      str = str.name ?? str.label ?? str.title ?? '';
    }
    const res = str != null ? String(str) : '';
    return res === '[object Object]' ? '' : res;
  }

  const res = String(val);
  return res === '[object Object]' ? '' : res;
}

/**
 * Translate a key according to the active language with English fallback.
 */
export function t(key, lang = 'en', ...args) {
  let selectedLang = 'en';
  let passedArgs = args;

  if (['en', 'ur-roman', 'ur'].includes(lang)) {
    selectedLang = lang;
  } else if (lang !== undefined && lang !== null) {
    passedArgs = [lang, ...args];
  }

  const table = STRINGS[selectedLang] || STRINGS.en;
  let val = table ? table[key] : undefined;

  const isDev =
    (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') ||
    (typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV));

  if (val === undefined) {
    if (selectedLang !== 'en' && STRINGS.en?.[key] !== undefined) {
      if (isDev) {
        console.warn(`[i18n] Missing translation for key "${key}" in language "${selectedLang}".`);
        return `⚠ ${key}`;
      } else {
        console.warn(`[i18n] Fallback to English for missing key "${key}" in "${selectedLang}".`);
        val = STRINGS.en[key];
      }
    } else {
      if (isDev) {
        console.error(`[i18n] Unknown key "${key}" requested for language "${selectedLang}".`);
        return `⚠ ${key}`;
      } else {
        console.error(`[i18n] Unknown key "${key}".`);
        return key;
      }
    }
  }

  let result;
  if (typeof val === 'function') {
    const paramNames = getParamNames(val);
    if (
      passedArgs.length === 1 &&
      typeof passedArgs[0] === 'object' &&
      passedArgs[0] !== null &&
      !Array.isArray(passedArgs[0]) &&
      !passedArgs[0].$$typeof &&
      paramNames.length > 0 &&
      paramNames.some(p => p in passedArgs[0])
    ) {
      const namedObj = passedArgs[0];
      const safeArgs = paramNames.map(pName =>
        safeStringify(namedObj[pName], key, pName, isDev)
      );
      result = val(...safeArgs);
    } else {
      const safeArgs = passedArgs.map((arg, idx) => {
        const pName = paramNames[idx] || `param_${idx}`;
        return safeStringify(arg, key, pName, isDev);
      });
      result = val(...safeArgs);
    }
  } else if (typeof val === 'string' && /\{[a-zA-Z0-9_]+\}/.test(val)) {
    const params = (passedArgs.length === 1 && typeof passedArgs[0] === 'object' && passedArgs[0] !== null && !passedArgs[0].$$typeof)
      ? passedArgs[0]
      : null;
    result = val.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, pName) => {
      let raw = params ? params[pName] : undefined;
      if (raw === undefined && !isNaN(Number(pName))) {
        raw = passedArgs[Number(pName)];
      }
      return safeStringify(raw, key, pName, isDev);
    });
  } else {
    result = val !== undefined ? val : key;
  }

  if (typeof result === 'string' && result.includes('[object Object]')) {
    result = result.replaceAll('[object Object]', '');
  }
  return result;
}

/**
 * Render structured assumption using language templates.
 * Never outputs free-text English when lang is 'ur-roman' or 'ur'.
 *
 * @param {object|string} asm - Assumption object or string
 * @param {'en'|'ur-roman'|'ur'} lang - target language
 * @returns {string} localized template string
 */
export function renderAssumption(asm, lang = 'en') {
  if (!asm) return '';

  if (typeof asm === 'string') {
    if (/crowding/i.test(asm)) {
      if (lang === 'ur') return 'رش کا اثر (گاہکوں کا لمبی لائنوں میں پھنس جانا) ماڈل میں شامل نہیں ہے';
      if (lang === 'ur-roman') return 'Rush ka asar (log lambi line mein phans jana) model mein shamil nahi hai';
      return 'Crowding effects (customers waiting in long lines) are not included in the model';
    }
    if (/salaries|wages|salary/i.test(asm)) {
      if (lang === 'ur') return 'عملے کی تنخواہ کا تخمینہ مارکیٹ کے مطابق لگایا گیا ہے';
      if (lang === 'ur-roman') return 'Staff ki tankhwah andaze se li gayi hai (aam market rates ke mutabiq)';
      return 'Staff wages estimated based on standard market rates';
    }
    return asm;
  }

  const type = asm.type || (
    asm.field === 'crowding' ? 'crowding' :
    asm.field === 'busyness' ? 'busyness' :
    asm.field === 'goal' ? 'goal' :
    (asm.field?.includes('speed') || asm.nodeId) ? 'duration' :
    asm.field === 'costs' ? 'salary' :
    asm.field === 'hasLimitedSpace' ? 'spaceUnlimited' :
    asm.field === 'spaceUnits' ? 'spaceUnits' :
    asm.field === 'spaceName' ? 'spaceName' :
    null
  );

  const params = asm.params || {};

  switch (type) {
    case 'crowding':
      if (lang === 'ur') return 'رش کا اثر (گاہکوں کا لمبی لائنوں میں پھنس جانا) ماڈل میں شامل نہیں ہے';
      if (lang === 'ur-roman') return 'Rush ka asar (log lambi line mein phans jana) model mein shamil nahi hai';
      return 'Crowding effects (customers waiting in long lines) are not included in the model';

    case 'busyness': {
      const n = params.n != null ? params.n : 20;
      if (lang === 'ur') return `رش کا تخمینہ: عام طور پر ${n} گاہک/گھنٹہ`;
      if (lang === 'ur-roman') return `Rush ka andaza: aam taur par ${n} customers/ghanta`;
      return `Rush estimate: typically ${n} customers/hour`;
    }

    case 'goal': {
      const g = params.goal || 'waiting';
      if (lang === 'ur') {
        if (g === 'cost') return 'بنیادی مقصد: اخراجات کم کرنا';
        if (g === 'throughput') return 'بنیادی مقصد: زیادہ آرڈرز نمٹانا';
        return 'بنیادی مقصد: انتظار کا وقت کم کرنا';
      }
      if (lang === 'ur-roman') {
        if (g === 'cost') return 'Maqsad: kharcha kam karna';
        if (g === 'throughput') return 'Maqsad: zyada orders nipatana';
        return 'Maqsad: intezar ka waqt kam karna';
      }
      if (g === 'cost') return 'Main goal: reduce costs';
      if (g === 'throughput') return 'Main goal: increase throughput';
      return 'Main goal: reduce wait times';
    }

    case 'duration': {
      const step = params.step || asm.stepLabel || 'Step';
      const min = params.min != null ? params.min : 3;
      const max = params.max != null ? params.max : 8;
      const avg = params.avg != null ? params.avg : Math.round((Number(min) + Number(max)) / 2);
      if (lang === 'ur') return `'${step}' کا وقت تخمینہ ہے: ${min}-${max} منٹ (عام طور پر ${avg} منٹ)`;
      if (lang === 'ur-roman') return `'${step}' ka waqt andaza hai: ${min}-${max} min (aam taur par ${avg} min)`;
      return `'${step}' time is estimated: ${min}-${max} min (typically ${avg} min)`;
    }

    case 'salary':
      if (lang === 'ur') return 'عملے کی تنخواہ کا تخمینہ مارکیٹ کے مطابق لگایا گیا ہے';
      if (lang === 'ur-roman') return 'Staff ki tankhwah andaze se li gayi hai (aam market rates ke mutabiq)';
      return 'Staff wages estimated based on standard market rates';

    case 'spaceUnlimited':
      if (lang === 'ur') return 'جگہ کی کوئی پابندی شامل نہیں ہے';
      if (lang === 'ur-roman') return 'Jagah ki koi pabandi shamil nahi hai';
      return 'Physical space limit was not specified, assumed unlimited capacity';

    case 'spaceUnits': {
      const u = params.units || 1;
      if (lang === 'ur') return `جگہ کی گنجائش کا تخمینہ: ${u} یونٹس`;
      if (lang === 'ur-roman') return `Jagah ki gunjaish ka andaza: ${u} units`;
      return `Limited space capacity estimated as ${u} unit${u > 1 ? 's' : ''}`;
    }

    case 'spaceName': {
      const nm = params.name || 'Space';
      if (lang === 'ur') return `جگہ کا نام: "${nm}"`;
      if (lang === 'ur-roman') return `Jagah ka naam: "${nm}"`;
      return `Limited space name estimated as "${nm}"`;
    }

    default:
      return asm.text || asm.message || '';
  }
}

