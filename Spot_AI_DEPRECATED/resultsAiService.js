// resultsAiService.js
// Second Gemini-backed feature, separate from aiService.js (BPMN generation).
// Kept as its own file rather than sharing a caller with aiService.js so a
// change here can never affect the (already working) diagram-generation flow.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CANDIDATE_MODELS = [
  process.env.GEMINI_MODEL || 'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash',
];

class ResultsAiError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'ResultsAiError';
    this.detail = detail;
  }
}

const INSIGHTS_SYSTEM_PROMPT = `You are a process-improvement analyst embedded in SPOT (Simulation Platform for Optimization using Digital Twin). You are given a compact JSON summary of one discrete-event simulation run (cycle time, throughput, bottleneck, resource utilization, queue hotspots, financials). All numeric times are in minutes.

Produce 3-4 short, concrete insights a process owner can act on immediately. Ground every claim in the numbers given — never invent data that isn't in the summary.

Rules:
- Each insight: one sentence, under 160 characters.
- Lead with the single highest-impact issue (worst bottleneck, most overloaded/underloaded resource, or biggest cost leak) first.
- Use **bold** markdown around the key number or entity in each line.
- "type" must be one of: "alert" (something bad/constraining), "warn" (risk worth watching), "info" (neutral observation), "success" (something healthy/working well).
- If nothing stands out for a category, omit it — don't pad with filler.
- No greetings, no closing remarks, no markdown headers.

Respond with ONLY raw JSON, no markdown fences:
{ "insights": [ { "type": "alert|warn|info|success", "text": "string with **bold** highlights" } ] }`;

const CHAT_SYSTEM_PROMPT = `You are an embedded process-simulation advisor in SPOT. You're chatting with someone looking at one specific simulation run's results, shown to you as a compact JSON summary (cycle time, throughput, bottleneck, resource utilization, queue hotspots, financials — all times in minutes).

Ground every answer in the numbers you're given. If the user asks something the summary can't answer (e.g. detail that isn't in it), say so plainly instead of guessing.

When asked "how do I get from X to Y" (e.g. reduce cycle time, raise throughput, cut cost):
- Reason like a queueing/operations analyst: Little's Law (WIP = throughput × cycle time), the fact that adding capacity at a non-bottleneck step won't help, that cutting a bottleneck's processing or wait time is what moves the whole system.
- Give 2-4 concrete levers (e.g. "add 1 more unit of X capacity", "cut processing time at Y by Z%", "reduce batch/wait at Y"), each tied to the actual bottleneck/resource in the data.
- Where you can reasonably estimate the effect from the numbers given, state it as an approximation, clearly flagged as an estimate — don't fabricate false precision.

Style: plain conversational text (not JSON), 80-180 words, short paragraphs or a tight bullet list. No headers, no markdown tables. Bold (**like this**) the key numbers.`;

async function callGemini({ systemPrompt, contents, expectJson }) {
  if (!GEMINI_API_KEY) {
    throw new ResultsAiError('GEMINI_API_KEY is not set in .env', null);
  }

  const requestBody = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      maxOutputTokens: 1200,
      ...(expectJson ? { responseMimeType: 'application/json' } : {}),
      thinkingConfig: { thinkingBudget: 512 },
    },
  };

  let response;
  let lastErrBody = '';

  for (const modelName of CANDIDATE_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
        if (response.ok) break;
        lastErrBody = await response.text();
        if (response.status === 429 || response.status === 503) break; // try next model
      } catch (err) {
        lastErrBody = err.message;
      }
    }
    if (response && response.ok) break;
  }

  if (!response || !response.ok) {
    throw new ResultsAiError(`Gemini API error: ${lastErrBody}`, null);
  }

  const data = await response.json();
  const raw = (data.candidates?.[0]?.content?.parts || [])
    .map(p => p.text || '')
    .join('')
    .trim();

  if (!raw) {
    throw new ResultsAiError('Gemini returned an empty response', data);
  }

  return raw;
}

async function generateInsights(summary) {
  if (!summary) {
    throw new ResultsAiError('summary is required', null);
  }

  const raw = await callGemini({
    systemPrompt: INSIGHTS_SYSTEM_PROMPT,
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(summary) }] }],
    expectJson: true,
  });

  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (err) {
    throw new ResultsAiError('AI returned non-JSON output', raw.slice(0, 500));
  }

  if (!Array.isArray(parsed.insights)) {
    throw new ResultsAiError('Malformed insights response', parsed);
  }

  return parsed.insights.slice(0, 4);
}

async function chatAboutResults(summary, message, history = []) {
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

  const raw = await callGemini({
    systemPrompt: CHAT_SYSTEM_PROMPT,
    contents,
    expectJson: false,
  });

  return raw;
}

module.exports = { generateInsights, chatAboutResults, ResultsAiError };
