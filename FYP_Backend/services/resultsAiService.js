// resultsAiService.js
// Second Gemini-backed feature, separate from aiService.js (BPMN generation).
// Kept as its own file rather than sharing a caller with aiService.js so a
// change here can never affect the (already working) diagram-generation flow.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
// Cache for AI explanations by (resultId, language)
const explanationsCache = new Map();

function getCachedExplanation(resultId, language = 'en') {
  if (!resultId) return null;
  return explanationsCache.get(`${resultId}:${language}`) || null;
}

function setCachedExplanation(resultId, language, value) {
  if (!resultId) return;
  explanationsCache.set(`${resultId}:${language}`, value);
}

function buildLanguagePrompt(language = 'en') {
  const lang = language === 'ur-roman' ? 'Roman Urdu (Latin script)' : (language === 'ur' ? 'Urdu script (Arabic-based script)' : 'English');
  return `\nLanguage requirement:
- Write ALL user-facing text (suggestions, meanings, answers, guidance) strictly in ${lang}.
- Roman Urdu MUST stay in Latin script. Urdu script MUST use Urdu Arabic script.
- Keep user's own step names, activity names, and resource/worker names EXACTLY as they appear in the data (do not translate them).
- Never use technical simulation jargon.`;
}

class ResultsAiError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'ResultsAiError';
    this.detail = detail;
  }
}

const PLAIN_LANGUAGE_RULES = `Plain-language rules (apply to every word you write):
- Write for someone who has never seen a simulation tool. If a 12-year-old could not follow it, rewrite it.
- Never use these words: "cycle time", "throughput", "bottleneck", "utilization", "queue", "capacity", "idle", "WIP", "latency", "p95", "std dev". Use everyday words instead:
  * cycle time / time in system  -> "time from start to finish"
  * bottleneck                   -> "the step that holds everything up"
  * utilization                  -> "how busy someone is"
  * idle                         -> "sitting free"
  * queue / queue wait           -> "waiting in line"
  * throughput                   -> "how many customers get served per hour"
  * capacity                     -> "how many people/machines are working there"
- TIME: the JSON has times in minutes, but many also come with a ready-made "..._plain" text such as "2.6 days". ALWAYS use the "_plain" text when it exists. If you must convert yourself: 60 minutes or more = hours, 1440 minutes or more = days. Never write a number of minutes above 59.
- Percentages: say "busy 18% of the time", never "utilization 18%". Busy and free always add up to 100%.
- Name steps and workers exactly as they appear in the JSON.`;

const INSIGHTS_SYSTEM_PROMPT = `You are a friendly process coach. You are given a small JSON summary of one simulation run of a business process. Write 3-4 suggestions that a non-technical person can understand and act on immediately. Every suggestion must be grounded in the numbers given.

${PLAIN_LANGUAGE_RULES}

Each suggestion has THREE parts:
- "text": WHAT TO DO. One concrete action sentence, under 140 characters, starting with a verb (Add, Reduce, Move, Automate, Simplify). Use **bold** for step names, worker names and key numbers.
- "meaning": WHAT THIS MEANS. One plain sentence, under 140 characters, saying what the numbers show and why it matters to the business. Do not repeat the action.
- "type": one of "alert" (the main problem), "warn" (worker adjustment), "info" (cost or efficiency tip), "success" (something that is working well).

Where to look in the JSON:
1. Main holdup: "primary_bottleneck". If it has an assigned resource (has_assigned_resource is true or assigned_resource is non-null), the first suggestion should address it. If it has NO assigned resource or is customer-paced, DO NOT suggest changing or speeding it up — instead focus on steps in "top_wait_activities" that DO have assigned resources.
2. Overworked: "resource_utilization" entries with status "overloaded" or "very_busy". Say how busy they are and that work is piling up.
3. Mostly free: entries with status "underused", or a high "financial.idle_cost_pct". Suggest moving or reducing them.
4. Slow work itself: steps in "top_wait_activities" where "avg_work_plain" is large compared with the wait.

CRITICAL RULES FOR SUGGESTIONS:
- ONLY suggest changes to steps that have resources assigned (workers, staff, equipment).
- NEVER suggest speeding up, simplifying, or automating a customer-paced step with no resources assigned (e.g. customer browsing items, picking items, choosing or deciding). Customer-paced steps cannot be sped up by the business.
- Never say "costs are wasted" or "100% idle" unless busy time > 0 was recorded in the simulation. If active work or busy time is 0 across all resources, advise the user to assign staff to steps in Task Details rather than claiming costs were wasted.
- Every suggestion must be a real action, not just a fact.
- If nothing stands out for a category, skip it. No filler, no greetings, no headers.

Respond with ONLY raw JSON, no markdown fences:
{ "insights": [ { "type": "alert|warn|info|success", "text": "what to do", "meaning": "what this means" } ] }`;

const CHAT_SYSTEM_PROMPT = `You are a friendly helper inside SPOT, a tool that simulates business processes. The user is looking at the results of one simulation run, given to you as a small JSON summary. Many users are not technical, so explain everything the way you would to a shop owner.

${PLAIN_LANGUAGE_RULES}

How to answer:
1. Start with the direct answer in one or two sentences.
2. Then give a short "What this means:" line saying why it matters.
3. Then a short "What to do:" line with 1-3 concrete actions, e.g. "Add one more worker to **Scan Items**".
- If asked "how do I improve / speed up / cut costs", first point at the step that holds everything up (primary_bottleneck). Adding workers to a step that is already fast will not help.
- If longest_wait_step differs from primary_bottleneck, explain in one sentence why (people wait longest at one step, but the holdup starts at the other).
- If the user asks about something that is not in the JSON, say so plainly instead of guessing.
- Never claim costs are wasted or 100% idle unless busy work was recorded; when active work is zero, guide the user to assign staff to steps in Task Details.
- Plain conversational text, 60-150 words, short paragraphs. Bold (**like this**) key numbers, step names and worker names. No formulas.`;

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

async function callClaude({
  systemPrompt,
  contents,
  messages,
  expectJson,
  maxModels,
  maxAttempts = 2,
  timeoutMs = 15000,
  maxTokens = 4096,
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new ResultsAiError('AI service is not configured on this server: ANTHROPIC_API_KEY is not set in .env', null);
  }

  const formattedMessages = normalizeMessagesForClaude(contents, messages);

  let finalSystem = systemPrompt || '';
  if (expectJson && !finalSystem.includes('JSON')) {
    finalSystem += '\n\nIMPORTANT: Respond with pure JSON only, with no commentary and no markdown fences.';
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

  const modelLimit = typeof maxModels === 'number' ? maxModels : candidateModels.length;

  let response;
  let lastErrBody = '';

  for (const baseUrl of baseUrls) {
    const url = `${baseUrl}/v1/messages`;

    for (const modelName of candidateModels.slice(0, modelLimit)) {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
              max_tokens: Math.min(maxTokens, 8192),
              ...(finalSystem ? { system: finalSystem } : {}),
              messages: formattedMessages,
            }),
            signal: controller.signal,
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
          lastErrBody = err.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : err.message;
        } finally {
          clearTimeout(timeout);
        }
      }
      if (response && response.ok) break;
    }
    if (response && response.ok) break;
  }

  if (!response || !response.ok) {
    throw new ResultsAiError(`Claude API error: ${lastErrBody}`, null);
  }

  const data = await response.json();
  const raw = (data.content || [])
    .filter(c => c.type === 'text')
    .map(c => c.text || '')
    .join('')
    .trim();

  if (!raw) {
    throw new ResultsAiError('Claude returned an empty response', data);
  }

  return raw;
}

const callGemini = callClaude;

async function generateInsights(summary, language = 'en', resultId = null) {
  if (!summary) {
    throw new ResultsAiError('summary is required', null);
  }

  // Check cache by (resultId, language)
  if (resultId) {
    const cached = getCachedExplanation(resultId, language);
    if (cached) return cached;
  }

  const promptWithLang = `${INSIGHTS_SYSTEM_PROMPT}\n${buildLanguagePrompt(language)}`;

  const raw = await callGemini({
    systemPrompt: promptWithLang,
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(summary) }] }],
    expectJson: true,
    maxModels: 1,
    maxAttempts: 1,
    timeoutMs: 10000,
  });

  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (err) {
    throw new ResultsAiError('AI returned non-JSON output', raw.slice(0, 500));
  }

  if (!parsed || !Array.isArray(parsed.insights)) {
    throw new ResultsAiError('Malformed insights response', parsed);
  }

  const formatted = parsed.insights.slice(0, 4).map(ins => ({
    type: ['alert', 'warn', 'info', 'success'].includes(ins?.type) ? ins.type : 'info',
    text: String(ins?.text || '').trim(),
    meaning: String(ins?.meaning || '').trim(),
  })).filter(ins => ins.text);

  if (resultId) {
    setCachedExplanation(resultId, language, formatted);
  }

  return formatted;
}

async function chatAboutResults(summary, message, history = [], language = 'en') {
  if (!summary) {
    throw new ResultsAiError('summary is required', null);
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    throw new ResultsAiError('message is required', null);
  }

  // Ground the model in the current numbers on every turn (not just the first),
  // since the user can switch which scenario/results are being viewed mid-chat.
  const contextTurn = {
    role: 'user',
    parts: [{ text: `Current simulation results summary (JSON):\n${JSON.stringify(summary)}` }],
  };
  const ack = { role: 'model', parts: [{ text: 'Got it — I have the current results in context.' }] };

  const historyTurns = (history || []).slice(-8).map(h => ({
    role: h.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: h.content }],
  }));

  const contents = [
    contextTurn,
    ack,
    ...historyTurns,
    { role: 'user', parts: [{ text: message }] },
  ];

  const promptWithLang = `${CHAT_SYSTEM_PROMPT}\n${buildLanguagePrompt(language)}`;

  const raw = await callGemini({
    systemPrompt: promptWithLang,
    contents,
    expectJson: false,
    maxModels: 1,
    maxAttempts: 1,
    timeoutMs: 10000,
  });

  return raw;
}

const IMPLEMENTATION_SYSTEM_PROMPT = `You are a process model optimization assistant. You are given a list of nodes and a list of resources from a BPMN process model, along with a specific optimization suggestion.

Your task is to identify the specific changes to resource quantities and/or task durations needed to implement the suggestion.

Every node includes its current "duration_unit" ("minutes" | "hours" | "days" | "weeks" | "months"). This is NOT something you may change. Any duration/duration_min/duration_max number you return for a node MUST be expressed in that SAME unit — e.g. if a node's duration_unit is "days" and you want to shorten a 10-day step by half a day, return "duration": 9.5, never a value re-scaled into minutes or hours. If you are unsure what unit a number in the suggestion text refers to, convert it into the node's existing duration_unit before writing the number — never leave the node's unit ambiguous or silently switch scale.

Output ONLY a JSON object with:
1. "scenarioTitle": A short, descriptive scenario title (max 25 characters, e.g., "Add Cashier", "Optimize Prep", "Fewer Drivers").
2. "resourceChanges": An array of objects for any resource being modified, e.g. [ { "id": "resource_id", "quantity": number } ]. Match by resource id or name.
3. "nodeChanges": An array of objects for any task node being modified (e.g. duration decreased), e.g. [ { "id": "node_id", "duration": number, "duration_min": number, "duration_max": number } ]. Match by node id or label. Numbers must be in that node's existing duration_unit — never include a "duration_unit" key yourself, it is fixed and non-negotiable.

Only include elements that are actually changing. Keep all other values out of the response.

Format:
{
  "scenarioTitle": "string",
  "resourceChanges": [ { "id": "string", "quantity": 3 } ],
  "nodeChanges": [ { "id": "string", "duration": 10, "duration_min": 5, "duration_max": 15 } ]
}`;

async function implementSuggestion(nodes, resources, suggestion) {
  if (!nodes || !resources || !suggestion) {
    throw new ResultsAiError('nodes, resources, and suggestion are required', null);
  }

  // Simplify inputs to save tokens and prevent context limit issues.
  // duration_unit is included (read-only, from the model's perspective) so
  // the AI expresses any new duration in the SAME scale as the existing
  // value instead of guessing — this is what previously let an AI-driven
  // edit silently reinterpret a day-scale task as minutes.
  const simplifiedNodes = nodes.map(n => ({
    id: n.id,
    label: n.data?.label || n.id,
    duration: n.data?.duration,
    duration_min: n.data?.duration_min,
    duration_max: n.data?.duration_max,
    duration_unit: n.data?.duration_unit || 'minutes',
  }));

  const simplifiedResources = resources.map(r => ({
    id: r.id,
    name: r.name,
    quantity: r.quantity
  }));

  const payload = {
    nodes: simplifiedNodes,
    resources: simplifiedResources,
    suggestion
  };

  const raw = await callGemini({
    systemPrompt: IMPLEMENTATION_SYSTEM_PROMPT,
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(payload) }] }],
    expectJson: true,
  });

  let delta;
  try {
    delta = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (err) {
    console.error('Gemini Raw Output:', raw);
    throw new ResultsAiError('AI returned non-JSON output', raw.slice(0, 500));
  }

  // Deep clone the original nodes and resources to apply mutations safely
  const updatedNodes = JSON.parse(JSON.stringify(nodes));
  const updatedResources = JSON.parse(JSON.stringify(resources));

  // Apply resource changes
  if (Array.isArray(delta.resourceChanges)) {
    for (const change of delta.resourceChanges) {
      if (!change.id) continue;
      const target = updatedResources.find(r => 
        String(r.id).toLowerCase() === String(change.id).toLowerCase() ||
        String(r.name || '').toLowerCase() === String(change.id).toLowerCase()
      );
      if (target && typeof change.quantity === 'number') {
        target.quantity = change.quantity;
      }
    }
  }

  // Apply node changes
  if (Array.isArray(delta.nodeChanges)) {
    for (const change of delta.nodeChanges) {
      if (!change.id) continue;
      const target = updatedNodes.find(n => 
        String(n.id).toLowerCase() === String(change.id).toLowerCase() ||
        String(n.data?.label || '').toLowerCase() === String(change.id).toLowerCase()
      );
      if (target && target.data) {
        // duration_unit is deliberately never taken from `change` — it stays
        // whatever the node already had, regardless of what the model returns.
        // This is the safety net behind the prompt instruction above: even if
        // the model ignores the instruction, applied numbers keep meaning
        // what they meant before the edit.
        if (typeof change.duration === 'number') target.data.duration = change.duration;
        if (typeof change.duration_min === 'number') target.data.duration_min = change.duration_min;
        if (typeof change.duration_max === 'number') target.data.duration_max = change.duration_max;
      }
    }
  }

  return {
    scenarioTitle: delta.scenarioTitle || 'AI Scenario',
    nodes: updatedNodes,
    resources: updatedResources
  };
}

module.exports = {
  generateInsights,
  chatAboutResults,
  implementSuggestion,
  ResultsAiError,
  PLAIN_LANGUAGE_RULES,
  callClaude,
  callGemini,
  getCachedExplanation,
  setCachedExplanation,
  explanationsCache,
};
