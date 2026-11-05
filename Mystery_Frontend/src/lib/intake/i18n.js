/**
 * i18n.js - Language detection and translations for Guided Intake
 * Supports 'en' (English), 'ur-roman' (Roman Urdu), and 'ur' (Urdu script).
 */

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
 * Detect language of a process description once at intake.
 * Returns 'ur-roman', 'ur', or 'en'.
 */
export function detectLanguage(text) {
  if (!text || typeof text !== 'string') return 'en';
  const trimmed = text.trim();
  if (!trimmed) return 'en';

  // Urdu / Arabic script check
  if (/[\u0600-\u06FF]/.test(trimmed)) {
    return 'ur';
  }

  // Tokenize Latin words
  const words = trimmed.toLowerCase().match(/[a-z]+/g) || [];
  if (words.length === 0) return 'en';

  let matchCount = 0;
  for (const w of words) {
    if (ROMAN_URDU_MARKERS.has(w)) {
      matchCount++;
    }
  }

  if (matchCount >= 2 || (words.length <= 5 && matchCount >= 1)) {
    return 'ur-roman';
  }

  return 'en';
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
  },
};

/**
 * Format plain-language hint for step duration.
 * e.g. "Usually takes between 10 and 15 minutes." / "Takes 10 minutes."
 */
export function formatDurationHint(min, max, unit = 'minutes', lang = 'en') {
  const isUr = lang === 'ur-roman' || lang === 'ur';
  const numMin = Number(min);
  const numMax = Number(max);

  let unitWord = '';
  if (unit === 'seconds') {
    unitWord = isUr ? 'second' : (numMax === 1 ? 'second' : 'seconds');
  } else if (unit === 'hours') {
    unitWord = isUr ? 'ghante' : (numMax === 1 ? 'hour' : 'hours');
  } else {
    unitWord = isUr ? 'minute' : (numMax === 1 ? 'minute' : 'minutes');
  }

  if (numMin === numMax) {
    return isUr
      ? `Taqreeban ${numMin} ${unitWord} lagte hain.`
      : `Usually takes ${numMin} ${unitWord}.`;
  }
  return isUr
    ? `Taqreeban ${numMin} se ${numMax} ${unitWord} lagte hain.`
    : `Usually takes between ${numMin} and ${numMax} ${unitWord}.`;
}

/**
 * Validates a custom duration range.
 * Returns null if valid, or a friendly error message string if invalid.
 */
export function validateCustomRange(min, max, lang = 'en') {
  const isUr = lang === 'ur-roman' || lang === 'ur';
  if (min === '' || min == null) {
    return isUr ? 'Kam se kam waqt 0 se bara hona chahiye.' : 'Minimum time must be greater than 0.';
  }
  const numMin = Number(min);
  if (isNaN(numMin) || numMin <= 0) {
    return isUr ? 'Kam se kam waqt 0 se bara hona chahiye.' : 'Minimum time must be greater than 0.';
  }
  if (max === '' || max == null) {
    return isUr ? 'Zyada se zyada waqt kam se kam waqt se kam nahi ho sakta.' : 'Maximum time cannot be less than minimum.';
  }
  const numMax = Number(max);
  if (isNaN(numMax) || numMax < numMin) {
    return isUr ? 'Zyada se zyada waqt kam se kam waqt se kam nahi ho sakta.' : 'Maximum time cannot be less than minimum.';
  }
  return null;
}

/**
 * Translate a key according to the active language with English fallback.
 */
export function t(key, lang = 'en', ...args) {
  const selectedLang = lang === 'ur-roman' ? 'ur-roman' : (lang === 'ur' ? 'ur-roman' : 'en');
  const table = STRINGS[selectedLang] || STRINGS.en;
  let val = table[key];
  if (val === undefined) {
    val = STRINGS.en[key];
  }
  if (typeof val === 'function') {
    return val(...args);
  }
  return val !== undefined ? val : key;
}
