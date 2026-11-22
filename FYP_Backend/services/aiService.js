const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch (e) {}
const path = require('path');

// Anthropic Claude API configuration (supports direct Anthropic API and LLMsRelay)
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';

// Module I2g: Spec Compiler Feature Flag (set USE_SPEC_COMPILER=true to use high-level spec compiler)
const USE_SPEC_COMPILER = process.env.USE_SPEC_COMPILER === 'true';

let compileBpmnModule = null;
async function getCompiler() {
  if (!compileBpmnModule) {
    const compilerPath = path.resolve(__dirname, '../shared/compileBpmn.js');
    compileBpmnModule = await import(require('url').pathToFileURL(path.resolve(compilerPath)).href);
  }
  return compileBpmnModule;
}

let validateBpmnModule = null;
async function getValidator() {
  if (!validateBpmnModule) {
    const validatorPath = path.resolve(__dirname, '../shared/validateBpmn.js');
    validateBpmnModule = await import(require('url').pathToFileURL(path.resolve(validatorPath)).href);
  }
  return validateBpmnModule;
}

let normalizerModule = null;
async function getNormalizer() {
  if (!normalizerModule) {
    const normalizerPath = path.resolve(__dirname, '../shared/deterministicNormalizer.js');
    normalizerModule = await import(require('url').pathToFileURL(path.resolve(normalizerPath)).href);
  }
  return normalizerModule;
}

let postValidatorModule = null;
async function getPostValidator() {
  if (!postValidatorModule) {
    const postValidatorPath = path.resolve(__dirname, '../shared/postGenerationValidator.js');
    postValidatorModule = await import(require('url').pathToFileURL(path.resolve(postValidatorPath)).href);
  }
  return postValidatorModule;
}

let specSchemaModule = null;
async function getSpecSchema() {
  if (!specSchemaModule) {
    const specSchemaPath = path.resolve(__dirname, '../shared/specSchema.js');
    specSchemaModule = await import(require('url').pathToFileURL(path.resolve(specSchemaPath)).href);
  }
  return specSchemaModule;
}

let specToBpmnModule = null;
async function getSpecToBpmn() {
  if (!specToBpmnModule) {
    const specToBpmnPath = path.resolve(__dirname, '../shared/specToBpmn.js');
    specToBpmnModule = await import(require('url').pathToFileURL(path.resolve(specToBpmnPath)).href);
  }
  return specToBpmnModule;
}

let specSimulationBindingModule = null;
async function getSpecBinding() {
  if (!specSimulationBindingModule) {
    const specBindingPath = path.resolve(__dirname, '../shared/specSimulationBinding.js');
    specSimulationBindingModule = await import(require('url').pathToFileURL(path.resolve(specBindingPath)).href);
  }
  return specSimulationBindingModule;
}

let deterministicBuilderModule = null;
async function getDeterministicBuilder() {
  if (!deterministicBuilderModule) {
    const builderPath = path.resolve(__dirname, '../shared/deterministicBuilder.js');
    deterministicBuilderModule = await import(require('url').pathToFileURL(path.resolve(builderPath)).href);
  }
  return deterministicBuilderModule;
}

const NODE_TYPES = [
  'pool', 'lane', 'start-event', 'end-event', 'intermediate-event', 'task',
  'exclusive-gateway', 'parallel-gateway', 'inclusive-gateway',
  'message-start-event', 'timer-start-event', 'conditional-start-event', 'signal-start-event',
  'message-intermediate-catch', 'message-intermediate-throw', 'timer-intermediate-catch',
  'conditional-intermediate-catch', 'signal-intermediate-catch', 'signal-intermediate-throw',
  'message-end-event', 'signal-end-event', 'error-end-event', 'terminate-end-event'
];
const GATEWAY_TYPES = ['exclusive', 'parallel', 'inclusive'];
const RESOURCE_TYPES = ['staff', 'equipment', 'facility'];

const COST_FIELD_LABELS = {
  hours_per_day: 'Hours worked per day',
  working_days_per_month: 'Working days per month',
  monthly_salary: 'Monthly salary',
  purchase_price: 'Purchase price',
  lifespan_months: 'Expected lifespan (months)',
  monthly_running_cost: 'Monthly running cost',
  monthly_rent: 'Monthly rent'
};

const STAGE1_SPEC_EXTRACTION_PROMPT = `You are a domain-agnostic Business Process Spec Extraction Assistant for SPOT (Simulation Platform for Optimization using Digital Twin).
Your goal is to parse a free-text or voice business description into a clean, structured JSON specification.

=== CRITICAL EXTRACTION RULES ===
1. EXTRACT ONLY EXPLICITLY STATED VALUES:
   - NEVER invent or assume numbers, durations, staff counts, arrival rates, salaries, or probabilities.
   - If an activity duration was NOT stated by the user, leave "duration": null!
   - If a staff count was NOT stated, leave "count": null!
   - If an arrival rate was NOT stated, leave "rate": null!
   - If a salary or cost was NOT stated, leave "salary": null!
2. COMPLETE TASK EXTRACTION (ZERO SILENT OMISSIONS):
   - Extract EVERY distinct operational action, task, decision, waiting, or handoff step mentioned in the user's description in exact execution order.
   - Every single operational action described MUST map to an explicit step.
3. PARTICIPANTS & MULTI-ROLE ASSIGNMENT:
   - "actors" / "internal_roles": internal roles, staff, or departments who execute activities within the organization. Include "count" ONLY if explicitly stated.
   - Every internal role listed MUST perform or participate in at least one activity.
   - "external_parties": external organizations, suppliers, clients, or outside entities that interact with the process via messages, deliveries, or requests.
4. TRIGGERS & ARRIVAL FREQUENCIES:
   - Identify each distinct event or condition that triggers flow: "arrival" (intake arrives), "schedule" (periodic/clock trigger), "message" (external notice/order arrived), or "condition" (state reached).
   - When an arrival frequency or volume is explicitly stated:
     * MUST set "rate" (e.g. 400) and "unit" ("minute"|"hour"|"day"|"week"). NEVER drop or omit stated arrival rates!
   - Set "interval" if explicitly stated.
5. ACTIVITIES, DURATIONS & WAITING STEPS:
   - "name": human-readable action name.
   - "actor" / "performer_role": the internal role or participant performing it.
   - "duration": numeric value ONLY if explicitly stated.
   - "duration_unit": "minutes"|"hours"|"days".
   - If waiting on an external response, delivery, or timer is described with a time, extract it with its stated duration!
6. DECISIONS:
   - Real decision points or branches described.
   - "question": phrased as a question.
   - "branches": list each option with "label" and "probability" (ONLY if explicitly stated).
   - ONLY extract decisions if actual branching is described. If sequential, leave "decisions": [].
7. RESOURCES AND COSTS:
   - Stated resource counts, salaries, capital, budgets, and currencies.
8. QUANTITIES & GOALS:
   - Stated operational numbers and objectives/pain points.
9. RECORD ALL GAPS IN "missing_or_ambiguous":
   - For every missing duration, unstated count, unstated rate, or ambiguous condition, add an entry.

=== OUTPUT JSON SCHEMA ===
Respond with ONLY pure valid JSON matching this exact structure:
{
  "processTitle": "Concise Process Title",
  "actors": ["Internal Role 1", "Internal Role 2"],
  "external_parties": ["External Party 1"],
  "steps": [
    {
      "name": "Step Name",
      "actor": "Internal Role 1",
      "type": "task" | "decision" | "wait" | "parallel" | "message send" | "message receive",
      "duration": null,
      "duration_unit": "minutes" | "hours" | "days",
      "interacts_with": null
    }
  ],
  "decisions": [
    {
      "question": "Decision Question?",
      "after_step": "Preceding Step Name",
      "branches": [
        { "label": "Option 1", "target_step": "Target Step Name", "probability": null },
        { "label": "Option 2", "target_step": "Target Step Name", "probability": null }
      ]
    }
  ],
  "parallel_groups": [],
  "loops": [],
  "endings": ["Completed", "Terminated"],
  "participants": {
    "internal_roles": [ { "name": "string", "count": null } ],
    "external_parties": [ { "name": "string" } ]
  },
  "triggers": [
    { "name": "string", "type": "arrival"|"schedule"|"message"|"condition", "rate": null, "unit": "minute"|"hour"|"day"|"week"|null, "interval": null, "independent": false }
  ],
  "activities": [
    { "name": "string", "performer_role": "string", "secondary_roles": ["string"], "duration": null, "duration_unit": "minutes"|"hours"|"days", "cost": null, "depends_on": null }
  ],
  "resources_and_costs": [
    { "role_or_item": "string", "quantity": null, "salary": null, "unit_cost": null, "capital": null, "currency": "USD" }
  ],
  "quantities": [
    { "name": "string", "value": 0, "unit": "string" }
  ],
  "goals_or_issues": [ "string" ],
  "missing_or_ambiguous": [
    { "field": "string", "reason": "string", "suggested_default": "string or number" }
  ]
}

Clarification (only if input is completely incomprehensible or blank):
{ "type": "clarification", "question": "string" }`;

const SPEC_SYSTEM_PROMPT = `You are a BPMN process modeling assistant for SPOT (Simulation Platform for Optimization using Digital Twin).
You convert plain-language business descriptions into a structured process draft or SPECification, which is then compiled deterministically into a valid BPMN 2.0 diagram.
Do NOT output nodes and edges. Output ONLY the high-level process specification.

=== NO FILLER TASKS & EXACT STEP ORDER (CRITICAL) ===
Return steps in the exact order the user described. For every decision list each branch separately, including branches that contain no activity. Mark retries/loops with the step they return to. Do not invent steps.
Only create activities the user actually described or clearly implied. Do NOT add generic tasks such as 'Start process', 'Review', 'Check', 'Notify', 'Verify', 'Process', 'End process', or any task with no real work behind it.
If the user reuses the same condition later in the process, reuse the same decision instead of creating a duplicate question.

=== DOMAIN-INDEPENDENT MODELING RULES ===
1. POOLS & PARTICIPANTS:
   - All internal activities belong to ONE primary pool representing the business or organization running the process.
   - Internal staff/roles are swimlanes within this main business pool.
   - External entities that send or receive messages/orders/deliveries are external pools.
   - Within a pool, sequence flows connect steps.
   - Message flows are ONLY used across DIFFERENT pools.
2. ACTIVITIES & LANES:
   - Each real activity appears EXACTLY ONCE, in the lane of the role that performs it.
3. WORK AS TASKS:
   - Anything that takes time or uses staff or equipment MUST be a "task" ("kind": "task").
   - Events are strictly start, end, timer delays, and external message interactions.
4. EMPTY BRANCHES:
   - A branch where nothing happens has an empty steps array: "steps": []. Direct sequence flow connects split to join.
5. DECISIONS & BRANCHES:
   - Each decision is modeled exactly once, in the lane of the role who decides, placed directly after the step where the outcome is evaluated ("afterStepId").
6. GATEWAY LABELS & PROBABILITIES:
   - Labels belong ONLY on split outputs (the branch options). Join outputs must never be labeled.
   - If probabilities are not explicitly stated, leave "probability": null.
7. RESOURCES:
   - Every staff-handled task MUST specify the performing role in "resource": "Role Name" and "resources": { "Role Name": 1 }.`;

const SYSTEM_PROMPT = `You are an expert BPMN 2.0 process modeling assistant for SPOT (Simulation Platform for Optimization using Digital Twin). You convert plain-language descriptions into structurally valid BPMN diagrams with proper event semantics AND infer the resources needed to run a discrete-event simulation.

=== CRITICAL BPMN STRUCTURAL & SEMANTIC RULES ===
1. FLOW TRIGGERS & INDEPENDENT PROCESS FLOWS:
   - Independent process triggers start with their own appropriate start event.
   - Each separate flow must conclude with its own proper end event(s).
2. CHOOSING THE CORRECT NODE TYPE (Event vs Task vs Gateway):
   - TASK ("task"): Active internal work where an assigned role actively spends time doing something.
   - INTERMEDIATE MESSAGE CATCH ("message-intermediate-catch"): WAITING on an external party, delivery, confirmation, or message.
   - TIMER INTERMEDIATE CATCH ("timer-intermediate-catch"): A pure wait for an elapsed time duration or schedule delay.
   - EXCLUSIVE GATEWAY ("exclusive-gateway"): Used ONLY for real decisions or conditional branch points.
   - PARALLEL GATEWAY ("parallel-gateway"): Used for concurrent branching and synchronization.
3. GATEWAY SPLIT & MATCHING MERGE REQUIREMENTS:
   - Split Gateway: Every split gateway must have >= 2 outgoing sequence flows with condition labels.
   - Matching Merge Gateway: Every split gateway with converging paths must have a corresponding downstream merge/join gateway of the SAME type.
   - Single-path Gateways Forbidden: A gateway with 1 incoming and 1 outgoing sequence flow is strictly forbidden.
4. HUMAN-READABLE NAMES:
   - Descriptive, natural names on EVERY element. Never output internal IDs as names.
5. LANES & ROLE ASSIGNMENTS:
   - Each task must be assigned to the lane of the role that performs it.
6. GRAPH INTEGRITY:
   - Every start event has ZERO incoming flows.
   - Every end event has ZERO outgoing flows.
   - No dead ends or unreachable nodes: every node must be on a valid path from a start event to an end event.

=== DURATIONS & TIME UNITS ===
- Every task and every intermediate-event with a duration MUST explicitly set "duration_unit" to one of: "minutes" | "hours" | "days".
- Set "duration_source" to "stated" (if user explicitly stated time) or "assumed" (if you estimated).
- Waiting for supplier or delivery is in "hours" or "days". Quick desk tasks are in "minutes".

=== RESOURCES ===
- Every staff-handled task MUST specify: data.resource = "Role Name" and data.resources = { "Role Name": 1 }.
- All roles must appear in top-level "resources" array with realistic type, quantity, salary/cost.
- Customers / external clients are NOT internal staff resources.

=== OUTPUT FORMAT ===
Respond with ONLY raw JSON, no markdown code fences, matching:
{
  "type": "diagram",
  "summary": "1-2 sentence summary of the model",
  "nodes": [
    {
      "id": "string",
      "type": "start-event|end-event|task|exclusive-gateway|parallel-gateway|inclusive-gateway|message-start-event|timer-start-event|conditional-start-event|message-intermediate-catch|message-intermediate-throw|timer-intermediate-catch|conditional-intermediate-catch|message-end-event",
      "origin": "stated|inferred",
      "pool": "Pool Name or null",
      "lane": "Lane Name",
      "data": {
        "label": "Human Readable Name",
        "gateway_type": "exclusive|parallel|inclusive or null",
        "duration": number|null,
        "duration_unit": "minutes|hours|days or null",
        "duration_source": "stated|assumed or null",
        "resource": "Role Name",
        "resources": { "Role Name": 1 }
      }
    }
  ],
  "edges": [
    {
      "id": "string",
      "source": "nodeId",
      "target": "nodeId",
      "flowType": "sequence|message",
      "data": {
        "label": "string or null",
        "probability": number|null
      }
    }
  ],
  "resources": [
    {
      "id": "Role Name",
      "name": "Role Name",
      "type": "staff|equipment|facility",
      "quantity": number,
      "hours_per_day": 8,
      "working_days_per_month": 22,
      "monthly_salary": number
    }
  ]
}

Clarification response (only if description is completely ambiguous):
{ "type": "clarification", "question": "string" }

Never mix shapes. No commentary outside the JSON.`;

function normalizeMessagesForClaude(contents, messages) {
  const rawInput = messages || contents || [];
  const list = Array.isArray(rawInput) ? rawInput : [rawInput];
  const result = [];

  for (const item of list) {
    if (!item) continue;
    let role = (item.role === 'assistant' || item.role === 'model') ? 'assistant' : 'user';
    let textContent = '';
    if (typeof item === 'string') {
      textContent = item;
    } else if (typeof item.content === 'string') {
      textContent = item.content;
    } else if (Array.isArray(item.parts)) {
      textContent = item.parts.map(p => (typeof p === 'string' ? p : p?.text || '')).join('');
    } else if (typeof item.text === 'string') {
      textContent = item.text;
    } else if (item.content && Array.isArray(item.content)) {
      textContent = item.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('');
    }

    textContent = textContent.trim();
    if (textContent) {
      if (result.length > 0 && result[result.length - 1].role === role) {
        result[result.length - 1].content += '\n\n' + textContent;
      } else {
        result.push({ role, content: textContent });
      }
    }
  }

  if (result.length === 0) {
    result.push({ role: 'user', content: 'Generate response' });
  } else if (result[0].role !== 'user') {
    result.unshift({ role: 'user', content: 'Begin' });
  }

  return result;
}

async function callClaude({ systemPrompt, contents, messages, generationConfig, expectJson = true }) {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new AiValidationError('AI service is not configured on this server: ANTHROPIC_API_KEY is not set in .env', null);
  }

  const formattedMessages = normalizeMessagesForClaude(contents, messages);

  let finalSystem = systemPrompt || '';
  if (expectJson && !finalSystem.includes('JSON')) {
    finalSystem += '\n\nIMPORTANT: Respond with pure JSON only, without any markdown formatting, code blocks, or preamble.';
  }

  const isRelay = apiKey.startsWith('sk-air-') || apiKey.startsWith('sk-cs4-') || Boolean(process.env.ANTHROPIC_BASE_URL && (process.env.ANTHROPIC_BASE_URL.includes('llmsrelay') || process.env.ANTHROPIC_BASE_URL.includes('airforce')));
  const primaryBaseUrl = process.env.ANTHROPIC_BASE_URL || (isRelay ? 'https://api.llmsrelay.com' : 'https://api.anthropic.com');
  const baseUrls = [
    primaryBaseUrl.replace(/\/+$/, ''),
    ...(isRelay && !primaryBaseUrl.includes('airforce') ? ['https://api.airforce.com'] : []),
  ];

  const defaultModels = isRelay
    ? ['claude-3-5-sonnet-20241022', 'claude-sonnet-4.6', 'claude-sonnet-5', 'claude-3-7-sonnet-20250219', 'claude-3-5-haiku-20241022', 'claude-opus-4.6']
    : ['claude-3-5-sonnet-20241022', 'claude-3-7-sonnet-20250219', 'claude-3-5-haiku-20241022'];

  const candidateModels = [...new Set([
    process.env.ANTHROPIC_MODEL,
    ...defaultModels
  ])].filter(Boolean);

  const maxTokens = Math.min(generationConfig?.maxOutputTokens || 8192, 8192);

  let response;
  let lastErrBody = '';

  for (const baseUrl of baseUrls) {
    const url = `${baseUrl}/v1/messages`;

    for (const modelName of candidateModels) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'Authorization': `Bearer ${apiKey}`,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: modelName,
              max_tokens: maxTokens,
              ...(finalSystem ? { system: finalSystem } : {}),
              messages: formattedMessages,
            }),
          });

          if (response.ok) break;

          lastErrBody = await response.text();
          if (response.status === 404 || response.status === 429 || response.status === 529 || response.status === 503) {
            console.warn(`⚠️ Claude model ${modelName} at ${baseUrl} returned status ${response.status}. Trying next fallback...`);
            break;
          } else {
            break;
          }
        } catch (err) {
          lastErrBody = err.message;
        }
      }

      if (response && response.ok) break;
    }

    if (response && response.ok) break;
  }

  if (!response || !response.ok) {
    throw new AiValidationError(`Claude API error: ${lastErrBody}`, null);
  }

  const data = await response.json();
  const raw = (data.content || [])
    .filter(c => c.type === 'text')
    .map(c => c.text || '')
    .join('')
    .trim();

  if (!raw) {
    throw new AiValidationError('Claude returned an empty response', data);
  }

  return raw;
}

const callGemini = callClaude;

async function extractSpec(description, history = [], preferredLanguage = 'en') {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new AiValidationError('AI service is not configured on this server: ANTHROPIC_API_KEY is not set in .env', null);
  }

  const prefLang = preferredLanguage === 'ur-roman' ? 'ur-roman' : (preferredLanguage === 'ur' ? 'ur' : 'en');
  const languageInstruction = `
=== LANGUAGE & TERMINOLOGY REQUIREMENT (CRITICAL) ===
User's preferred output language is: ${prefLang === 'ur-roman' ? 'Roman Urdu (ur-roman)' : (prefLang === 'ur' ? 'Urdu script (ur)' : 'English (en)')}.
Write user-facing questions, field descriptions, and reasons in the user's preferred language.
Keep the user's own activity names, role names, and triggers EXACTLY as the user wrote them.
`;

  const contents = [
    ...history.map(h => ({
      role: h.role === 'assistant' ? 'assistant' : 'user',
      content: h.content
    })),
    { role: 'user', content: description }
  ];

  const promptToUse = `${languageInstruction}\n\n${STAGE1_SPEC_EXTRACTION_PROMPT}`;
  const raw = await callClaude({
    systemPrompt: promptToUse,
    contents,
    generationConfig: { maxOutputTokens: 8192 },
    expectJson: true
  });

  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (err) {
    throw new AiValidationError('AI returned non-JSON output during spec extraction', raw.slice(0, 500));
  }

  if (parsed.type === 'clarification') {
    if (!parsed.question || typeof parsed.question !== 'string') {
      throw new AiValidationError('Malformed clarification response', parsed);
    }
    return parsed;
  }

  const { validateSpecJson, validateProcessDescriptionSchema, cleanAndNormalizeSpec } = await getSpecSchema();
  let validation = validateProcessDescriptionSchema
    ? validateProcessDescriptionSchema(parsed)
    : validateSpecJson(parsed);

  let schemaRetries = 0;
  while (!validation.valid && schemaRetries < 3) {
    schemaRetries++;
    const schemaErrorText = validation.errors.join('\n');
    const retryContents = [
      ...contents,
      { role: 'assistant', content: raw },
      { role: 'user', content: `The extracted JSON did not conform to the schema:\n${schemaErrorText}\nPlease return pure valid JSON matching the schema.` }
    ];
    try {
      const retryRaw = await callClaude({
        systemPrompt: promptToUse,
        contents: retryContents,
        generationConfig: { maxOutputTokens: 8192 },
        expectJson: true
      });
      parsed = JSON.parse(retryRaw.replace(/```json|```/g, '').trim());
      validation = validateProcessDescriptionSchema
        ? validateProcessDescriptionSchema(parsed)
        : validateSpecJson(parsed);
    } catch {
      break;
    }
  }

  if (!validation.valid) {
    console.warn('Stage 1 Spec extraction schema notices:', validation.errors);
  }

  return cleanAndNormalizeSpec(parsed);
}

async function generateProcess(input, history = [], preferredLanguage = 'en') {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new AiValidationError('AI service is not configured on this server: ANTHROPIC_API_KEY is not set in .env', null);
  }

  const isObj = input && typeof input === 'object';
  const description = isObj ? (input.description || input.text || '') : String(input || '');
  const providedSpec = isObj ? (input.spec || (input.participants ? input : null)) : null;

  const prefLang = preferredLanguage === 'ur-roman' ? 'ur-roman' : (preferredLanguage === 'ur' ? 'ur' : 'en');

  // Dynamic module loaders
  const { validateSpecJson, cleanAndNormalizeSpec } = await getSpecSchema();
  const { specToBpmn, deriveCleanPoolTitle } = await getSpecToBpmn();
  const { bindSpecToSimulation } = await getSpecBinding();
  const { validatePostGeneration } = await getPostValidator();
  const { validateBpmn } = await getValidator();
  const { normalizeAndRepairBpmn } = await getNormalizer();

  // ──────────────────────────────────────────────────────────────────────────
  // STAGE 1: SPEC EXTRACTION
  // ──────────────────────────────────────────────────────────────────────────
  let spec;
  if (providedSpec) {
    spec = cleanAndNormalizeSpec(providedSpec);
  } else {
    const extractedSpec = await extractSpec(description, history, prefLang);
    if (extractedSpec.type === 'clarification') {
      return extractedSpec;
    }
    spec = cleanAndNormalizeSpec(extractedSpec);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STAGE 2: DETERMINISTIC BPMN GENERATION FROM SPEC
  // ──────────────────────────────────────────────────────────────────────────
  const businessTitle = deriveCleanPoolTitle ? deriveCleanPoolTitle(description, spec) : (description.split(/[.\n]/)[0]?.slice(0, 45).trim() || 'Business Organization');
  const { buildBpmnFromProcessJson } = await getDeterministicBuilder();

  // Convert spec to processJson for deterministic builder
  const processJson = {
    processTitle: spec.process_name || spec.processTitle || businessTitle,
    actors: spec.actors || (spec.participants?.internal_roles ? spec.participants.internal_roles.map(r => r.name) : ['Staff']),
    external_parties: spec.external_parties || (spec.participants?.external_parties ? spec.participants.external_parties.map(p => p.name) : []),
    steps: (spec.steps && spec.steps.length > 0)
      ? spec.steps
      : (spec.activities || []).map((a, idx) => ({
          id: `step_${idx + 1}`,
          name: a.name,
          actor: a.performer_role || a.actor || 'Staff',
          type: a.type || (/wait|delay/i.test(a.name) ? 'wait' : (/send/i.test(a.name) ? 'message send' : (/receive/i.test(a.name) ? 'message receive' : 'task'))),
          duration: a.duration,
          duration_unit: a.duration_unit || 'minutes',
          interacts_with: a.interacts_with || a.interactsWith || null,
        })),
    decisions: (spec.decisions || []).map(d => ({
      question: d.question,
      after_step: d.after_step || d.afterStep || (d.branches?.[0]?.after_activity) || null,
      branches: (d.branches || d.options || []).map(b => ({
        label: b.label || b.condition,
        target_step: b.target_step || b.targetStepId || b.target || null,
        probability: b.probability != null ? Number(b.probability) : null,
      })),
    })),
    parallel_groups: spec.parallel_groups || spec.parallelGroups || [],
    loops: spec.loops || spec.rework || [],
    endings: spec.endings || [],
  };

  let rawDiagram;
  try {
    rawDiagram = buildBpmnFromProcessJson(processJson);
  } catch (buildErr) {
    console.warn('Deterministic builder warning, falling back to specToBpmn:', buildErr.message);
    rawDiagram = specToBpmn(spec, { businessName: businessTitle, userDescription: description });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STAGE 3: VALIDATION + REPAIR LOOP
  // ──────────────────────────────────────────────────────────────────────────
  rawDiagram = normalizeAndRepairBpmn(rawDiagram, { userDescription: description });
  let postVal = validatePostGeneration(rawDiagram);
  rawDiagram = postVal.repaired || rawDiagram;
  let validation = validateBpmn(rawDiagram, { allowUnresolved: true });

  let allViolations = [
    ...(postVal.errors || []),
    ...(validation.errors || [])
  ];

  // Repair loop with Claude (up to 3 retries) if violations exist and LLM is enabled
  let retryCount = 0;
  while (allViolations.length > 0 && retryCount < 3 && !providedSpec) {
    retryCount++;
    try {
      const violationsText = allViolations.map((err, i) => `${i + 1}. ${err}`).join('\n');
      const repairPrompt = `The extracted business spec had technical BPMN validation issues when generated:
${violationsText}

Please return a corrected Stage 1 JSON spec ("processTitle", "actors", "external_parties", "steps", "decisions", "parallel_groups", "loops", "endings") fixing these issues:
- Intermediate message catch events for waiting on external messages/deliveries/orders.
- Timer events for delays/waits.
- Every split gateway must have >= 2 outgoing branches with condition labels (e.g. "Yes", "No") and a matching downstream merge gateway of the same type.
- Ensure all nodes are reachable from start to end with no dead ends.
- Return pure valid JSON matching the schema.`;

      const contents = [
        ...history.map(h => ({
          role: h.role === 'assistant' ? 'assistant' : 'user',
          content: h.content
        })),
        { role: 'user', content: description },
        { role: 'assistant', content: JSON.stringify(spec) },
        { role: 'user', content: repairPrompt }
      ];

      const retryRaw = await callClaude({
        systemPrompt: STAGE1_SPEC_EXTRACTION_PROMPT,
        contents,
        generationConfig: { maxOutputTokens: 8192 },
        expectJson: true,
      });

      const retryParsed = JSON.parse(retryRaw.replace(/```json|```/g, '').trim());
      if (retryParsed.type === 'clarification') {
        return retryParsed;
      }

      const retrySpec = cleanAndNormalizeSpec(retryParsed);
      let retryDiagram;
      try {
        retryDiagram = buildBpmnFromProcessJson(retrySpec);
      } catch {
        retryDiagram = specToBpmn(retrySpec, { businessName: businessTitle, userDescription: description });
      }
      retryDiagram = normalizeAndRepairBpmn(retryDiagram, { userDescription: description });

      const retryPostVal = validatePostGeneration(retryDiagram);
      const retryRepaired = retryPostVal.repaired || retryDiagram;
      const retryVal = validateBpmn(retryRepaired, { allowUnresolved: true });
      const retryViolations = [...(retryPostVal.errors || []), ...(retryVal.errors || [])];

      rawDiagram = retryRepaired;
      postVal = retryPostVal;
      validation = retryVal;
      allViolations = retryViolations;

      if (allViolations.length === 0) {
        break;
      }
    } catch (retryErr) {
      console.warn(`Repair retry ${retryCount} error:`, retryErr.message);
    }
  }

  // Final check
  postVal = validatePostGeneration(rawDiagram);
  rawDiagram = postVal.repaired || rawDiagram;
  validation = validateBpmn(rawDiagram, { allowUnresolved: true });
  allViolations = [...(validation.errors || [])];

  // ──────────────────────────────────────────────────────────────────────────
  // STAGE 4: SPEC -> SIMULATION CONFIG BINDING
  // ──────────────────────────────────────────────────────────────────────────
  const is24h = /24\/7|24\s+hours|continuous|round[\s-]the[\s-]clock/i.test(description);
  const bindingResult = bindSpecToSimulation(spec, rawDiagram, { is24Hour: is24h });

  const finalDiagram = bindingResult.diagram;
  const simulationConfig = bindingResult.simulationConfig;
  const scenarioSettings = bindingResult.scenarioSettings;

  finalDiagram.simulationConfig = simulationConfig;
  finalDiagram.scenarioSettings = scenarioSettings;
  finalDiagram.unresolvedGateways = validation.unresolvedGateways || [];
  finalDiagram.duplicateWarnings = validation.duplicateWarnings || [];
  finalDiagram.validationRepairs = [
    ...(validation.repairs || []),
    ...(postVal.warnings || []).map(w => (typeof w === 'string' ? w : w.message))
  ];

  // ──────────────────────────────────────────────────────────────────────────
  // STAGE 5: QUESTIONNAIRE INTEGRATION & CONFIRMATION
  // ──────────────────────────────────────────────────────────────────────────
  const combinedWarnings = [
    ...(validation.warnings || []),
    ...(postVal.warnings || []).map(w => (typeof w === 'string' ? w : w.message))
  ];
  if (allViolations.length > 0) {
    combinedWarnings.push(...allViolations);
  }
  finalDiagram.validationWarnings = combinedWarnings;
  finalDiagram.validationErrors = allViolations.length > 0 ? allViolations : [];

  // Build confirmation payload for review card on first pass
  const isFirstPass = !history || history.length === 0;
  if (isFirstPass) {
    const confirmations = buildConfirmationPayload(finalDiagram);
    return {
      type: 'needs_confirmation',
      diagram: finalDiagram,
      confirmations,
      spec,
      simulationConfig,
      scenarioSettings,
      unresolvedGateways: finalDiagram.unresolvedGateways,
      duplicateWarnings: finalDiagram.duplicateWarnings,
      validationWarnings: finalDiagram.validationWarnings,
      validationErrors: finalDiagram.validationErrors,
    };
  }

  return {
    ...finalDiagram,
    spec,
    simulationConfig,
    scenarioSettings,
    unresolvedGateways: finalDiagram.unresolvedGateways,
    duplicateWarnings: finalDiagram.duplicateWarnings,
    validationWarnings: finalDiagram.validationWarnings,
    validationErrors: finalDiagram.validationErrors,
  };
}

// Builds a batch of "the AI guessed this, please confirm" fields, grouped so
// the frontend can render ONE card per resource (quantity + cost fields
// together) plus a compact list of task durations — a single review screen,
// not scattered rows. Every entry carries enough info to patch the diagram
// in-place on confirm; no second call to the AI is needed.
function buildConfirmationPayload(diagram) {
  const COST_FIELDS_BY_TYPE = {
    staff: ['hours_per_day', 'working_days_per_month', 'monthly_salary'],
    equipment: ['purchase_price', 'lifespan_months', 'monthly_running_cost'],
    facility: ['monthly_rent', 'purchase_price', 'lifespan_months']
  };

  const resources = (diagram.resources || [])
    .filter(r => r.quantitySource !== 'stated' || r.costSource !== 'stated')
    .map(r => {
      const fields = [];
      if (r.quantitySource !== 'stated') {
        fields.push({ key: 'quantity', label: `How many ${r.name}?`, guessedValue: r.quantity });
      }
      if (r.costSource !== 'stated') {
        (COST_FIELDS_BY_TYPE[r.type] || []).forEach(fieldKey => {
          if (r[fieldKey] != null) {
            fields.push({ key: fieldKey, label: COST_FIELD_LABELS[fieldKey], guessedValue: r[fieldKey] });
          }
        });
      }
      return {
        kind: 'resource',
        resourceName: r.name,
        resourceType: r.type,
        fields
      };
    });

  const durations = (diagram.nodes || [])
    .filter(n => (n.type === 'task' || n.type === 'intermediate-event') && n.data?.duration_source !== 'stated')
    .map(n => ({
      kind: 'task_duration',
      nodeId: n.id,
      taskLabel: n.data?.label || n.label || 'Step',
      guessedValue: n.data?.duration,
      unit: n.data?.duration_unit || 'minutes',
      label: `How long does "${n.data?.label || n.label}" usually take?`
    }));

  return { resources, durations };
}

function normalizeDiagram(diagram) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return;

  // 1. Ensure resources array exists with sensible defaults & clean human-readable names
  if (!Array.isArray(diagram.resources) || diagram.resources.length === 0) {
    diagram.resources = [
      {
        id: 'Staff / Employee',
        name: 'Staff / Employee',
        displayName: 'Staff / Employee',
        type: 'staff',
        quantity: 2,
        hours_per_day: 8,
        working_days_per_month: 22,
        monthly_salary: 50000,
        purchase_price: null,
        lifespan_months: null,
        monthly_running_cost: null,
        monthly_rent: null
      }
    ];
  }

  // Ensure all resources have clean human-readable names
  diagram.resources.forEach((r, idx) => {
    let cleanName = r.name || r.displayName || r.id;
    if (!cleanName || cleanName.startsWith('res_') || cleanName.trim() === '') {
      if (r.type === 'staff') cleanName = 'Staff / Specialist';
      else if (r.type === 'equipment') cleanName = 'Equipment / Machine';
      else if (r.type === 'facility') cleanName = 'Room / Facility';
      else cleanName = `Resource ${idx + 1}`;
    }
    r.name = cleanName;
    r.displayName = cleanName;
    r.id = cleanName;
    r.payloadKey = cleanName;
    if (!r.type || !RESOURCE_TYPES.includes(r.type)) r.type = 'staff';
    r.quantity = Number(r.quantity) || 1;
    r.hours_per_day = r.type === 'staff' ? (r.hours_per_day != null ? Number(r.hours_per_day) : 8) : null;
    r.working_days_per_month = r.type === 'staff' ? (r.working_days_per_month != null ? Number(r.working_days_per_month) : 22) : null;
    r.monthly_salary = r.type === 'staff' ? (r.monthly_salary != null ? Number(r.monthly_salary) : 50000) : null;
    r.purchase_price = r.type !== 'staff' ? (r.purchase_price != null ? Number(r.purchase_price) : 100000) : null;
    r.lifespan_months = r.type !== 'staff' ? (r.lifespan_months != null ? Number(r.lifespan_months) : 36) : null;
    r.monthly_running_cost = r.type !== 'staff' ? (r.monthly_running_cost != null ? Number(r.monthly_running_cost) : 5000) : null;
    r.monthly_rent = null;
    r.quantitySource = r.quantitySource === 'stated' ? 'stated' : 'assumed';
    r.costSource = r.costSource === 'stated' ? 'stated' : 'assumed';
  });

  const modelNodes = diagram.nodes.filter(n => n.type !== 'pool' && n.type !== 'lane');
  const firstResName = diagram.resources[0].name;

  // 2. Ensure EVERY task activity has valid data and assigned resource names
  modelNodes.forEach(n => {
    n.data = n.data || {};
    if (n.type.endsWith('-gateway')) {
      if (!n.data.gateway_type) {
        if (n.type.includes('exclusive')) n.data.gateway_type = 'exclusive';
        else if (n.type.includes('parallel')) n.data.gateway_type = 'parallel';
        else if (n.type.includes('inclusive')) n.data.gateway_type = 'inclusive';
        else n.data.gateway_type = 'exclusive';
      }
    }
    if (n.type === 'task' || n.type === 'intermediate-event') {
      const validUnits = ['minutes', 'hours', 'days'];
      if (!validUnits.includes(n.data.duration_unit)) {
        n.data.duration_unit = 'minutes';
      }
      // If the model omitted the tag, treat it as assumed rather than silently
      // trusting an untagged number — same "when in doubt, assumed" rule as
      // resource quantitySource.
      n.data.duration_source = n.data.duration_source === 'stated' ? 'stated' : 'assumed';
    }

    if (n.type === 'task') {
      if (!n.data.label) n.data.label = n.label || 'Process Step';

      let taskResMap = {};
      if (n.data.resources && typeof n.data.resources === 'object') {
        Object.entries(n.data.resources).forEach(([key, qty]) => {
          let match = diagram.resources.find(r => r.id === key || r.name === key || r.displayName === key);
          if (!match && key && !key.startsWith('res_') && key.trim() !== '') {
            // Gemini referenced a resource on a task but forgot to define it
            // at the top level — auto-create it rather than silently dropping
            // the requirement (this used to just vanish from the model).
            match = {
              id: key, name: key, displayName: key, type: 'staff', quantity: 1,
              hours_per_day: 8, working_days_per_month: 22, monthly_salary: 50000,
              purchase_price: null, lifespan_months: null, monthly_running_cost: null, monthly_rent: null,
              quantitySource: 'assumed', costSource: 'assumed' // fully auto-created — nothing here was ever stated
            };
            diagram.resources.push(match);
          }
          const nameKey = match ? match.name : null;
          if (nameKey) {
            taskResMap[nameKey] = Number(qty) || 1;
          }
        });
      }

      if (Object.keys(taskResMap).length === 0) {
        const matchingRes = diagram.resources.find(r => 
          n.data.label.toLowerCase().includes(r.name.toLowerCase()) || 
          (n.pool && n.pool.toLowerCase().includes(r.name.toLowerCase()))
        ) || diagram.resources[0];

        const assignedName = matchingRes.name;
        taskResMap = { [assignedName]: 1 };
        n.data.resource = assignedName;
      } else {
        n.data.resource = Object.keys(taskResMap)[0];
      }

      n.data.resources = taskResMap;

      // Ensure lane is ALWAYS assigned on every task (Rule 8)
      const assignedLane = n.lane || n.data?.lane || n.pool || n.data?.pool || 'Staff';
      n.lane = assignedLane;
      n.data.lane = assignedLane;
    }

    // Module D1b: Do not rely on LLM for "structural"; code sets it.
    const isStructural = n.type.includes('event') || n.type.includes('gateway');
    let nodeOrigin = n.origin || n.data?.origin;
    if (isStructural) {
      nodeOrigin = 'structural';
    } else if (!nodeOrigin || nodeOrigin === 'structural') {
      nodeOrigin = 'stated';
    }
    n.origin = nodeOrigin;
    if (!n.data) n.data = {};
    n.data.origin = nodeOrigin;

    if (n.type === 'task' && nodeOrigin === 'inferred') {
      n.data.duration = 0;
      n.data.duration_min = null;
      n.data.duration_max = null;
      n.data.resources = {};
      n.data.resource = null;
    }
  });

  // 3. Normalize start-events without deleting independent multi-trigger flows
  const allStarts = modelNodes.filter(n => n.type === 'start-event' || (typeof n.type === 'string' && n.type.endsWith('-start-event')));
  if (allStarts.length === 0 && modelNodes.length > 0) {
    modelNodes[0].type = 'start-event';
  } else if (allStarts.length > 1) {
    const targetMap = new Map();
    allStarts.forEach(s => {
      const targets = diagram.edges.filter(e => e.source === s.id && e.flowType !== 'message').map(e => e.target).sort().join(',') || '__none__';
      if (!targetMap.has(targets)) targetMap.set(targets, []);
      targetMap.get(targets).push(s);
    });
    targetMap.forEach((dupes) => {
      if (dupes.length > 1) {
        const keep = dupes[0];
        const extraIds = new Set(dupes.slice(1).map(s => s.id));
        diagram.nodes = diagram.nodes.filter(n => !extraIds.has(n.id));
        diagram.edges.forEach(e => {
          if (extraIds.has(e.source)) e.source = keep.id;
        });
      }
    });
  }

  // 4. Normalize end-events (at least 1 per pool)
  const updatedModelNodes = diagram.nodes.filter(n => n.type !== 'pool' && n.type !== 'lane');
  const pools = [...new Set(updatedModelNodes.map(n => n.pool || 'default'))];
  pools.forEach(pool => {
    const poolNodes = updatedModelNodes.filter(n => (n.pool || 'default') === pool);
    const ends = poolNodes.filter(n => n.type === 'end-event');
    if (ends.length === 0 && poolNodes.length > 0) {
      const endId = `end_auto_${String(pool).replace(/[^a-zA-Z0-9_]/g, '')}_${Date.now()}`;
      const newEnd = {
        id: endId,
        type: 'end-event',
        pool: pool === 'default' ? null : pool,
        lane: null,
        origin: 'structural',
        data: { label: 'Process Ended', origin: 'structural' }
      };
      diagram.nodes.push(newEnd);

      const outgoingMap = new Set(diagram.edges.map(e => e.source));
      const terminalNodes = poolNodes.filter(n => !outgoingMap.has(n.id) && n.type !== 'end-event');
      if (terminalNodes.length > 0) {
        terminalNodes.forEach((tn, idx) => {
          diagram.edges.push({
            id: `edge_auto_end_${tn.id}_${idx}`,
            source: tn.id,
            target: endId,
            flowType: 'sequence',
            data: {}
          });
        });
      } else {
        const lastNode = poolNodes[poolNodes.length - 1];
        diagram.edges.push({
          id: `edge_auto_end_${lastNode.id}`,
          source: lastNode.id,
          target: endId,
          flowType: 'sequence',
          data: {}
        });
      }
    }
  });

  // 5. Enforce sequence vs message flow types correctly
  const nodePoolMap = {};
  diagram.nodes.forEach(n => { nodePoolMap[n.id] = n.pool || 'default'; });
  diagram.edges.forEach(e => {
    const sp = nodePoolMap[e.source] || 'default';
    const tp = nodePoolMap[e.target] || 'default';
    if (sp === tp) {
      e.flowType = 'sequence';
    } else {
      e.flowType = 'message';
    }
  });

  // 6. Direct event <-> gateway and gateway <-> gateway connections are valid BPMN (do not insert fake tasks)

  // 7. Auto-normalize gateway probabilities
  const finalModelNodes = diagram.nodes.filter(n => n.type !== 'pool' && n.type !== 'lane');
  const gateways = finalModelNodes.filter(n => n.type === 'exclusive-gateway' || n.type === 'inclusive-gateway');
  for (const gw of gateways) {
    const outEdges = diagram.edges.filter(e => e.source === gw.id);
    if (outEdges.length > 1) {
      const equalProb = Math.round((1.0 / outEdges.length) * 100) / 100;
      outEdges.forEach((e, idx) => {
        e.data = e.data || {};
        if (e.data.probability == null || isNaN(e.data.probability)) {
          e.data.probability = idx === outEdges.length - 1 ? Number((1.0 - equalProb * (outEdges.length - 1)).toFixed(2)) : equalProb;
        }
      });
      const currentSum = outEdges.reduce((s, e) => s + (Number(e.data?.probability) || 0), 0);
      if (Math.abs(currentSum - 1.0) > 0.01 && currentSum > 0) {
        outEdges.forEach(e => {
          e.data.probability = Number(((e.data.probability || 0) / currentSum).toFixed(2));
        });
      }
    }
  }

  // 8. Deduplicate edges
  const seenEdgeKeys = new Set();
  diagram.edges = diagram.edges.filter(e => {
    const key = `${e.source}->${e.target}`;
    if (seenEdgeKeys.has(key)) return false;
    seenEdgeKeys.add(key);
    return true;
  });

}

function isEventNode(type) {
  return type === 'start-event' || type === 'end-event' || type === 'intermediate-event' || (type && (type.endsWith('-event') || type.includes('event')));
}

function isGatewayNode(type) {
  return type === 'gateway' || (type && type.endsWith('-gateway'));
}

function validateDiagram(diagram) {
  if (!diagram) return;
  // Pre-heal any potential schema issues so validation never fails
  normalizeDiagram(diagram);
}

function bfsReachable(startId, edges) {
  const visited = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift();
    for (const e of edges.filter(e => e.source === current)) {
      if (!visited.has(e.target)) { visited.add(e.target); queue.push(e.target); }
    }
  }
  return visited;
}

class AiValidationError extends Error {
  constructor(message, offendingData) {
    super(message);
    this.name = 'AiValidationError';
    this.offendingData = offendingData;
  }
}

module.exports = {
  generateProcess,
  extractSpec,
  AiValidationError,
  callClaude,
  callGemini,
  getSpecSchema,
  getSpecToBpmn,
  getSpecBinding,
  getPostValidator,
};