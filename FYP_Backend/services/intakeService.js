// FYP_Backend/services/intakeService.js
/**
 * Module I4: Intelligent Intake Parser
 *
 * Maps a business owner's plain-English typed text to I1 schema fields
 * for a specific intake screen (1 to 7).
 *
 * Rules:
 *  - JSON only.
 *  - Never invent numbers.
 *  - If ambiguous, return { proposal, proposedValue } instead of guessing.
 *  - On Gemini failure (429, 503, timeout, etc.), return { fallback: true, text }.
 *  - Reuses the Gemini helper (callGemini) from aiService.js.
 */

const aiService = require('./aiService');

/**
 * Builds the focused system prompt for each screenId.
 */
function buildScreenPrompt(screenId, rawDiagram, currentAnswers) {
  const nodes = Array.isArray(rawDiagram?.nodes) ? rawDiagram.nodes : [];
  const activeTasks = nodes
    .filter(
      (n) =>
        (n.type === 'task' || n.type?.endsWith('-task')) &&
        !(n.origin === 'inferred' && !n.kept && !n.data?.kept)
    )
    .map((n) => ({
      id: n.id,
      label: n.data?.label || n.label || n.id,
    }));

  const existingStaff = (rawDiagram?.resources || [])
    .filter((r) => r.type === 'staff' && r.name)
    .map((r) => r.name);

  let screenContext = '';

  switch (screenId) {
    case 1: {
      screenContext = `
SCREEN 1: Who handles each step.
Active process steps: ${JSON.stringify(activeTasks)}
Known staff roles: ${JSON.stringify(existingStaff)}

TASK: Assign staff role(s) to step(s) mentioned by the user.
RULES:
- Map by step id: { "steps": { "<nodeId>": { "staffRoles": ["RoleName"] } } }
- If the user names a new role (e.g. "Host", "Specialist"), you may include it.
- Never assign roles to steps the user did NOT mention.
- If ambiguous or general (e.g. "everyone helps", "staff takes care of it"):
  Return:
  {
    "proposal": "Suggest assigning <RoleName> to <Step Label>?",
    "proposedValue": {
      "steps": { "<nodeId>": { "staffRoles": ["<RoleName>"] } }
    }
  }
- If clear, return:
  {
    "value": {
      "steps": { "<nodeId>": { "staffRoles": ["<RoleName>"] } }
    }
  }
`;
      break;
    }

    case 2: {
      screenContext = `
SCREEN 2: Speed per step.
Active process steps: ${JSON.stringify(activeTasks)}
Allowed speeds:
- "quick": 1-2 minutes
- "normal": 3-8 minutes
- "slow": 10-25 minutes

RULES:
- NEVER invent numbers.
- If explicit time given: <=2 min is "quick", 3-8 min is "normal", >=10 min is "slow".
- If speed words used: "fast", "speedy", "quick" -> "quick"; "takes a while", "slow", "lengthy" -> "slow"; "moderate", "normal", "average" -> "normal".
- If ambiguous (e.g. "it takes a little bit of time" or "it depends"):
  Return:
  {
    "proposal": "Do you mean Normal speed (3-8 min) for <Step Label>?",
    "proposedValue": {
      "steps": { "<nodeId>": { "speed": "normal" } }
    }
  }
- If clear, return:
  {
    "value": {
      "steps": { "<nodeId>": { "speed": "quick|normal|slow" } }
    }
  }
`;
      break;
    }

    case 3: {
      screenContext = `
SCREEN 3: How busy is rush hour.
Allowed busyness:
- "quiet": ~5 customers / hour (calm, long breaks between arrivals, low traffic)
- "steady": ~20 customers / hour (consistent flow arriving every 3 mins, regular rush)
- "packed": ~45 customers / hour (slammed, nonstop queues, high rush, intense rush)

RULES:
- NEVER invent numbers.
- ~5/hr, slow, calm, dead, relaxed -> "quiet".
- ~20/hr, steady, typical, medium, normal flow -> "steady".
- ~45/hr or more, packed, slammed, crazy busy, hectic, full house -> "packed".
- If ambiguous (e.g. "it depends", "sometimes busy"):
  Return:
  {
    "proposal": "Did you mean Steady rush (~20 customers/hour)?",
    "proposedValue": { "busyness": "steady" }
  }
- If clear, return:
  {
    "value": { "busyness": "quiet|steady|packed" }
  }
`;
      break;
    }

    case 4: {
      screenContext = `
SCREEN 4: Does it ever go wrong.
Allowed disruption options (array of strings):
- "Out of stock" (ran out of item, ingredients, or supplies)
- "Refund" (customer returns, refund requested, dispute)
- "Customer leaves" (customer walks out or abandons queue due to wait)
- "Nothing" (runs smoothly, no frequent problems)

RULES:
- User can have multiple disruptions, e.g. ["Out of stock", "Customer leaves"].
- If user says no problems or runs smoothly -> ["Nothing"].
- If ambiguous (e.g. "customers get frustrated" or "we have issues"):
  Return:
  {
    "proposal": "Do customers leave when they get frustrated?",
    "proposedValue": { "exceptions": ["Customer leaves"] }
  }
- If clear, return:
  {
    "value": { "exceptions": ["..."] }
  }
`;
      break;
    }

    case 5: {
      screenContext = `
SCREEN 5: Do customers ever wait for a table/seat/room.
Fields to map:
- hasLimitedSpace: boolean (true or false)
- spaceName: string (optional, e.g. "Table", "Room", "Seat", "Desk", "Booth")
- spaceUnits: integer (optional count of available units)

CRITICAL RULES:
- NEVER invent numbers.
- If user says seating/space is limited, but DOES NOT give a count:
  DO NOT invent spaceUnits! Instead return:
  {
    "proposal": "You have limited space. Do you have around 10 <spaceName>s?",
    "proposedValue": { "hasLimitedSpace": true, "spaceName": "Table", "spaceUnits": 10 }
  }
- If user states a number (e.g. "we have 14 tables and people wait"):
  {
    "value": { "hasLimitedSpace": true, "spaceName": "Table", "spaceUnits": 14 }
  }
- If user says no (e.g. "no, takeaway only", "we have plenty of room"):
  {
    "value": { "hasLimitedSpace": false }
  }
`;
      break;
    }

    case 6: {
      screenContext = `
SCREEN 6: Main Goal.
Allowed goals:
- "waiting": Customers wait too long (cut queue bottlenecks, speed up turnaround)
- "cost": Costs too high (streamline staff schedules, reduce overhead and payroll)
- "throughput": Can't serve enough (maximize capacity, serve more customers per hour)

RULES:
- Wait times, long lines, delays -> "waiting".
- High payroll, labor cost, expenses -> "cost".
- Serve more people, capacity, volume -> "throughput".
- If ambiguous:
  Return:
  {
    "proposal": "Should SPOT focus on cutting customer wait times?",
    "proposedValue": { "goal": "waiting" }
  }
- If clear, return:
  {
    "value": { "goal": "waiting|cost|throughput" }
  }
`;
      break;
    }

    case 7: {
      screenContext = `
SCREEN 7: Optional staff costs.
Known staff roles: ${JSON.stringify(existingStaff)}
Fields to map:
- costs: { [roleName]: monthlySalaryNumber }

CRITICAL RULES:
- NEVER invent numbers.
- If user states monthly salaries (e.g. "Barista makes 40000, Manager makes 75000"):
  {
    "value": { "costs": { "Barista": 40000, "Manager": 75000 } }
  }
- If user gives an hourly wage (e.g. "$25/hour"):
  Return:
  {
    "proposal": "Is $25/hr roughly $4,000/month?",
    "proposedValue": { "costs": { "Staff": 4000 } }
  }
- If ambiguous or no number:
  Return:
  {
    "proposal": "Estimate $50,000/month for staff?",
    "proposedValue": { "costs": { "Staff": 50000 } }
  }
- If clear, return:
  {
    "value": { "costs": { ... } }
  }
`;
      break;
    }

    default:
      screenContext = 'Map user text to relevant process simulation fields.';
  }

  return `You are an intake parsing assistant for SPOT, a business simulation platform.
You convert a business owner's plain-English typed answer into structured JSON for an onboarding wizard.

${screenContext}

MANDATORY RESPONSE FORMAT:
Respond with ONLY valid JSON (no markdown formatting, no backticks, no comments).
Your JSON must strictly be ONE of these two shapes:
1. When clear and unambiguous:
{
  "value": { ...fieldsForThisScreen }
}

2. When ambiguous, vague, or when a required number was not specified by the user:
{
  "proposal": "<Friendly clarifying question or proposal under 100 characters>",
  "proposedValue": { ...fieldsForThisScreen }
}

STRICT CONSTRAINTS:
- JSON only.
- NEVER invent numbers that the user did not say.
- Map fields for Screen ${screenId} ONLY. Do not output fields for other screens.
`;
}

/**
 * Parses user typed answer for a given screenId.
 *
 * @param {object} param0
 * @param {number} param0.screenId - 1..7
 * @param {string} param0.text - user typed text
 * @param {object} param0.currentAnswers - existing intake answers
 * @param {object} param0.rawDiagram - raw BPMN diagram
 * @returns {Promise<{ value?: object, proposal?: string, proposedValue?: object, fallback?: boolean, text: string }>}
 */
async function parseIntakeAnswer({ screenId, text, currentAnswers = {}, rawDiagram = {} }) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    return { fallback: true, text: text || '' };
  }

  const prompt = buildScreenPrompt(screenId, rawDiagram, currentAnswers);
  const contents = [
    {
      role: 'user',
      parts: [{ text: `User typed answer for Screen ${screenId}: "${text.trim()}"` }],
    },
  ];

  try {
    const raw = await aiService.callGemini({
      systemPrompt: prompt,
      contents,
      generationConfig: {
        maxOutputTokens: 800,
        responseMimeType: 'application/json',
      },
      expectJson: true,
    });

    let parsed;
    try {
      const clean = raw.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      console.warn('⚠️ Intake parse JSON error, returning fallback:', parseErr.message);
      return { fallback: true, text };
    }

    if (!parsed || typeof parsed !== 'object') {
      return { fallback: true, text };
    }

    // Ambiguous -> Proposal shape
    if (parsed.proposal && typeof parsed.proposal === 'string') {
      return {
        proposal: parsed.proposal.trim(),
        proposedValue: parsed.proposedValue || {},
        text,
      };
    }

    // Clear -> Value shape
    if (parsed.value && typeof parsed.value === 'object') {
      return {
        value: parsed.value,
        text,
      };
    }

    return { fallback: true, text };
  } catch (err) {
    console.warn('⚠️ Gemini call failed during parse-answer, returning fallback:', err.message);
    // On Gemini failure (429, 503, network, etc.), return { fallback: true } and keep text.
    return { fallback: true, text, reason: err.message };
  }
}

module.exports = { parseIntakeAnswer, buildScreenPrompt };
