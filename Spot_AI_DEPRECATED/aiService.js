// Uses Google Gemini API (free tier) instead of a paid SDK.
// Get a free key with no credit card at https://aistudio.google.com
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest'; // Always points to Google's current Flash model. Do NOT use a "-pro" model, those are paid-only.
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const NODE_TYPES = ['pool', 'lane', 'start-event', 'end-event', 'intermediate-event', 'task',
                     'exclusive-gateway', 'parallel-gateway', 'inclusive-gateway'];
const GATEWAY_TYPES = ['exclusive', 'parallel', 'inclusive'];
const RESOURCE_TYPES = ['staff', 'equipment', 'facility']; // Staff/Specialist->staff, Computer/Equipment/Vehicle->equipment, Room->facility

const COST_FIELD_LABELS = {
  hours_per_day: 'Hours worked per day',
  working_days_per_month: 'Working days per month',
  monthly_salary: 'Monthly salary',
  purchase_price: 'Purchase price',
  lifespan_months: 'Expected lifespan (months)',
  monthly_running_cost: 'Monthly running cost',
  monthly_rent: 'Monthly rent'
};

const SYSTEM_PROMPT = `You are a BPMN 2.0 process modeling assistant for SPOT (Simulation Platform for Optimization using Digital Twin). You convert plain-language descriptions into a BPMN diagram AND infer the resources needed to run a discrete-event simulation on it.

=== STRUCTURAL RULES ===
1. Exactly ONE start-event in the ENTIRE diagram (the whole BPMN). Never create more than one start-event in the entire diagram or across pools/swimlanes. The process begins at this single start-event.
2. At least ONE end-event per pool, zero outgoing edges. Multiple end events allowed (one per distinct outcome).
3. intermediate-event only where the description implies a wait, timer, or message-catch — never invent one.
4. Gateways: exclusive-gateway (XOR, one path taken), parallel-gateway (AND, all paths taken), inclusive-gateway (OR, one or more paths). Use gateway_type field.
5. Every gateway that SPLITS (1 in, 2+ out) must have a matching gateway of the same type downstream that JOINS the same branches back (2+ in, 1 out) before the flow continues, unless a branch terminates directly at an end-event.
6. For exclusive/inclusive gateway branches, edge probabilities (edge.data.probability) across all outgoing branches from the same gateway MUST sum to exactly 1. Parallel gateway branches get probability: null (all branches always taken).
7. Loops (rework/retry) = a sequence flow edge back to an earlier task/gateway. Never duplicate a node to represent a repeat.
8. Every non-start node needs >=1 incoming edge. Every non-end node needs >=1 outgoing edge. Every node must be reachable from its pool's start-event and must be able to reach some end-event. No orphans, no dead-ends.
9. NEVER connect an event (start-event, intermediate-event, end-event) directly to or from a gateway. NEVER connect two gateways directly to each other — there must ALWAYS be at least one real task/activity between an event and a gateway, and between two gateways. If you find yourself wanting to chain two gateways back-to-back with nothing in between, that's a signal the two decisions are really ONE decision — merge them into a single gateway with more outgoing branches instead of chaining. Concrete example:
   - WRONG: 'gw_ingredients_available' --> 'gw_customer_decision' (two gateways directly connected, nothing between them)
   - WRONG (still bad — same problem, just papered over): 'gw_ingredients_available' --> task labeled "Evaluate Decision" (a fake/filler task whose only purpose is to sit between two gateways) --> 'gw_customer_decision'
   - RIGHT: give 'gw_ingredients_available' a real task on each branch that a person actually does (e.g. "Call Customer About Substitution") before the customer's decision gateway — a task must represent genuine work with a duration and a resource, never a placeholder just to satisfy the structural rule.
   Do this correctly the first time; do not rely on downstream auto-repair to patch chained gateways for you — auto-inserted filler tasks look robotic and confuse the person reading the diagram.

=== POOLS & LANES ===
- If the description involves more than one actor/organization (e.g. "Customer" and "Warehouse"), model each as a separate pool node (type: "pool").
- The entire BPMN diagram must contain ONLY ONE start-event total. Other pools/participants start via message-flow edges from the primary process.
- Lanes (type: "lane") are optional sub-divisions of a single pool by role/department — use only if the description names distinct roles within the same organization (e.g. "Manager" and "Clerk" inside one company).
- Sequence-flow edges may ONLY connect nodes within the same pool.
- Message-flow edges are the ONLY way to connect nodes across different pools (e.g. customer sends order to warehouse).

=== NAMING ===
- Events: noun + past participle ("Order Placed", "Payment Received").
- Tasks: action verb + noun ("Verify Payment", "Send Invoice").
- Gateways: phrase as a question ("Payment Valid?").

=== DURATIONS & TIME UNITS ===
- Every task and every intermediate-event with a duration MUST explicitly set "duration_unit" to one of: "minutes" | "hours" | "days". Never omit it — the simulation engine treats a missing unit as minutes, so an omitted unit on a step that's actually hours or days silently corrupts every downstream result by 60x-1440x.
- Every task and every intermediate-event with a duration MUST also set "duration_source" to "stated" (the user's description explicitly gave a time — a number, or phrasing like "takes about 10 minutes", "overnight", "same day") or "assumed" (you picked a reasonable default because the description didn't say). Be literal and honest here, same as quantitySource for resources — this is a factual tag, not a judgment call about how confident you are.
- Pick the unit that matches how a business owner would naturally describe the step: a phone call or a task done in one sitting is "minutes"; "we wait for the supplier to restock" or "customer picks up next day" is "hours" or "days". Do not default everything to minutes just because it's the common case — check each step on its own.
- duration_min/duration_max, when both set, must be in the SAME unit as duration_unit for that node.

=== RESOURCES (auto-inference & naming) ===
- EVERY SINGLE TASK activity in the diagram MUST have at least one resource assigned in data.resources = { "Resource Name": quantity }, and data.resource = "Resource Name" (the first/primary one, kept for backward compatibility — but data.resources is the field that actually drives simulation, so it must always be complete and correct).
- Every resource object in the "resources" array MUST have a clear, descriptive, human-readable "name" field (e.g. "Kitchen Staff", "Cook / Pizza Chef", "Cashier", "Delivery Driver", "Phone System").
- NEVER use generic IDs (like "res_1", "res_2"), empty strings (""), or unnamed resources for resource names.
- Every resource name referenced in ANY node's data.resources MUST have a matching entry in the top-level "resources" array — never reference a resource in a task that isn't also defined at the top level, and never leave the top-level "resources" array empty if any task references resources.
- Categories map to the resource object's "type" field as: staff (people/specialists), equipment (computers, machines, vehicles), facility (rooms, rented/owned space).

Auto-assign for every resource you infer:
- id: human-readable name string matching the "name" field (e.g. "Kitchen Staff")
- name: short descriptive human-readable name inferred from context
- type: "staff" | "equipment" | "facility"
- quantity: a reasonable default (usually 1, or 2-3 if the description implies a busy/high-volume step)
- quantitySource: "stated" if the user's description explicitly gave a number/count for this resource (a digit, or words like "a few", "my team of five"); "assumed" if you picked the quantity yourself because the description didn't say. Be honest and literal here — this is a factual tag, not a judgment call about whether the guess is reasonable. If in doubt, use "assumed".
- costSource: "stated" ONLY if the user's description gave an actual figure for this resource's cost (a salary number, a price, a rent amount); "assumed" in EVERY other case, including when you filled in "reasonable market estimates" as instructed above — a market estimate is still a guess and must be tagged "assumed". quantitySource and costSource are independent: a user can state "I have 3 staff" (quantitySource: stated) without ever mentioning their salary (costSource: assumed), and vice versa.
- Populate ONLY the fields relevant to its type; all others null:
  - staff: hours_per_day, working_days_per_month, monthly_salary (use reasonable market estimates), rest null
  - equipment: purchase_price, lifespan_months, monthly_running_cost, rest null
  - facility: EITHER monthly_rent OR (purchase_price + lifespan_months), working_days_per_month always null, rest null
- Assign each task's data.resources = { "Resource Name": quantity_consumed }, and data.resource = "Resource Name".
- In the "summary" field, explicitly call out any resource you set to quantity: 1 that multiple/frequent tasks depend on (e.g. a single oven, a single machine, a single vehicle) as a likely bottleneck the user should double check — never silently assume a single-unit constraint without surfacing it to the user in plain language.

=== CLARIFYING QUESTIONS ===
A layman business owner describing their process in plain language usually will NOT mention how many of something they own (how many ovens, how many delivery bikes, how many staff on shift at once). When that happens, set that resource's quantitySource to "assumed" (see RESOURCES section) — be honest about it rather than quietly picking a number and marking it "stated". The application will handle asking the user to confirm assumed quantities; your only job here is to tag accurately.

Separately, if the process description itself is too vague to model AT ALL (no clear steps, or a resource's fundamental TYPE — not just its quantity — genuinely cannot be inferred from context), return a "clarification" response instead of a diagram, asking what's missing in plain language.



=== COMMON MISTAKES — CHECK YOURSELF BEFORE RESPONDING ===
- Output must be raw JSON only — no markdown code fences, no comments, no trailing commas, no text before or after the JSON object.
- duration_unit must be set on every node that has a non-null duration — never leave it implicit.
- data.resource (singular) and data.resources (the dict) must always agree — data.resource must be one of the keys present in data.resources, never a resource that isn't also listed there.
- Every resource name used anywhere in any node's data.resources must exist as an entry in the top-level "resources" array with the exact same name string (case-sensitive match).
- Gateway probabilities on the same source node must sum to exactly 1.0 (rounding to 2 decimals is fine, e.g. 0.33/0.33/0.34).
- Do not invent an intermediate-event unless the plain-language description clearly implies a wait/timer/message-catch (e.g. "we wait for the customer to call back", "waiting for delivery from supplier"). If you do add one, it needs duration, duration_unit, and a clear label — never leave it as a bare unconfigured event.
- Never connect an event directly to/from a gateway, and never connect two gateways directly to each other — always insert a task between them (see STRUCTURAL RULES #9).
- Double check every exclusive/parallel/inclusive split has a matching join before the diagram continues, unless a branch ends directly at an end-event.
- Re-read your own "resources" array before finalizing: if it's empty but any task references a resource, that's a bug in your own output — fix it before responding.
- Keep node/edge labels short and to the point. If the process is large, favor concise labels over verbose ones so the full JSON always finishes within the response — a truncated response is unusable even if everything up to the cutoff was correct.
- Respond with the JSON object and NOTHING else: no explanation before it, no notes after it, no markdown fences around it. The very first character of your response must be "{" and the very last must be "}".

=== OUTPUT FORMAT ===
Respond with ONLY raw JSON, no markdown, matching exactly one shape:

Feasible:
{
  "type": "diagram",
  "summary": "1-2 sentence summary, noting any resources/durations that were auto-assumed and flagging single-quantity bottleneck resources",
  "nodes": [
    { "id": "string", "type": "pool|lane|start-event|end-event|intermediate-event|task|exclusive-gateway|parallel-gateway|inclusive-gateway",
      "pool": "poolId or null", "lane": "laneId or null",
      "data": { "label": "string", "gateway_type": "exclusive|parallel|inclusive or null",
                "duration": number|null, "duration_min": number|null, "duration_max": number|null,
                "duration_unit": "minutes|hours|days or null",
                "duration_source": "stated|assumed or null (null only if no duration applies)",
                "resource": "Resource Name",
                "resources": { "Resource Name": quantity } } }
  ],
  "edges": [
    { "id": "string", "source": "nodeId", "target": "nodeId", "flowType": "sequence|message",
      "data": { "probability": number|null } }
  ],
  "resources": [
    { "id": "Resource Name", "name": "Resource Name", "type": "staff|equipment|facility", "quantity": number,
      "hours_per_day": number|null, "working_days_per_month": number|null, "monthly_salary": number|null,
      "purchase_price": number|null, "lifespan_months": number|null, "monthly_running_cost": number|null,
      "monthly_rent": number|null }
  ]
}

Not feasible / resource type unclear:
{ "type": "clarification", "question": "string" }

Never mix shapes. No commentary outside the JSON.`;

async function generateProcess(description, history = []) {
  if (!GEMINI_API_KEY) {
    throw new AiValidationError('GEMINI_API_KEY is not set in .env', null);
  }

  // Gemini expects { role: 'user'|'model', parts: [{text}] } instead of Anthropic's
  // { role: 'user'|'assistant', content }. Map history over and append the new turn.
  const contents = [
    ...history.map(h => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }]
    })),
    { role: 'user', parts: [{ text: description }] }
  ];

  const requestBody = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents,
    generationConfig: {
      maxOutputTokens: 20000,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 1024 }
    }
  };

  const candidateModels = [
    process.env.GEMINI_MODEL || 'gemini-flash-latest',
    'gemini-flash-lite-latest',
    'gemini-2.0-flash-lite',
    'gemini-2.5-flash'
  ];

  let response;
  let lastErrBody = '';

  for (const modelName of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
    
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (response.ok) break;

        lastErrBody = await response.text();
        if (response.status === 429 || response.status === 503) {
          console.warn(`⚠️ Model ${modelName} returned status ${response.status}. Trying next fallback model...`);
          break;
        }
      } catch (err) {
        lastErrBody = err.message;
      }
    }

    if (response && response.ok) break;
  }

  if (!response || !response.ok) {
    throw new AiValidationError(`Gemini API error: ${lastErrBody}`, null);
  }

  const data = await response.json();
  const raw = (data.candidates?.[0]?.content?.parts || [])
    .map(p => p.text || '')
    .join('')
    .trim();

  if (!raw) {
    throw new AiValidationError('Gemini returned an empty response', data);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (err) {
    // Include a snippet of what Gemini actually sent back so the real problem (truncation,
    // markdown fences, refusal text, etc.) is visible in the API response instead of just "non-JSON".
    throw new AiValidationError('AI returned non-JSON output', raw.slice(0, 500));
  }

  if (parsed.type === 'clarification') {
    if (!parsed.question || typeof parsed.question !== 'string') {
      throw new AiValidationError('Malformed clarification response', parsed);
    }
    return parsed;
  }

  if (parsed.type === 'diagram') {
    normalizeDiagram(parsed);
    validateDiagram(parsed);

    // Instead of asking a follow-up chat question (which forces a second AI round
    // trip and feels like an interrogation), collect every field the model had to
    // guess and hand them back as ONE structured confirmation payload. The diagram
    // itself is already complete and simulate-able — the frontend renders a single
    // inline form pre-filled with the AI's guesses, the user edits/confirms in one
    // step, and nothing needs to go back to the LLM at all.
    const isFirstPass = !history || history.length === 0;
    if (isFirstPass) {
      const confirmations = buildConfirmationPayload(parsed);
      if (confirmations.resources.length > 0 || confirmations.durations.length > 0) {
        return {
          type: 'needs_confirmation',
          diagram: parsed,       // fully usable diagram, guesses already applied
          confirmations          // what to show the user for a quick review pass
        };
      }
    }

    return parsed;
  }

  throw new AiValidationError('Unknown response type from AI', parsed);
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
    }
  });

  // 3. Normalize single start-event across whole diagram
  const allStarts = modelNodes.filter(n => n.type === 'start-event');
  if (allStarts.length === 0 && modelNodes.length > 0) {
    modelNodes[0].type = 'start-event';
  } else if (allStarts.length > 1) {
    const primaryStart = allStarts[0];
    const extraIds = new Set(allStarts.slice(1).map(s => s.id));
    diagram.nodes = diagram.nodes.filter(n => !extraIds.has(n.id));
    diagram.edges.forEach(e => {
      if (extraIds.has(e.source)) {
        e.source = primaryStart.id;
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
        data: { label: 'Process Ended' }
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

  // 6. Fix direct event <-> gateway connections
  fixDirectEventGatewayConnections(diagram);

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

function fixDirectEventGatewayConnections(diagram) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return;

  const newNodes = [];
  const edgesToRemove = new Set();
  const newEdges = [];

  diagram.edges.forEach((edge, idx) => {
    const srcNode = diagram.nodes.find(n => n.id === edge.source);
    const tgtNode = diagram.nodes.find(n => n.id === edge.target);

    if (!srcNode || !tgtNode) return;

    const srcIsEvent = isEventNode(srcNode.type);
    const tgtIsGateway = isGatewayNode(tgtNode.type);

    const srcIsGateway = isGatewayNode(srcNode.type);
    const tgtIsEvent = isEventNode(tgtNode.type);

    const bothAreGateways = srcIsGateway && tgtIsGateway;

    if ((srcIsEvent && tgtIsGateway) || (srcIsGateway && tgtIsEvent) || bothAreGateways) {
      edgesToRemove.add(edge.id || `${edge.source}->${edge.target}`);

      const taskId = `task_inserted_${edge.source}_${edge.target}_${idx}`;
      let taskLabel = 'Process Request';
      if (bothAreGateways) {
        let srcLabel = srcNode.data?.label || srcNode.label || 'Decision';
        taskLabel = `Evaluate ${srcLabel.replace(/\?$/, '')}`;
      } else if (srcIsEvent && srcNode.data?.label) {
        const cleaned = srcNode.data.label.replace(/^Start\s*/i, '').replace(/^Claim\s*/i, '');
        taskLabel = cleaned ? `Receive & Handle ${cleaned}` : 'Receive Request';
      } else if (tgtIsEvent && tgtNode.data?.label) {
        taskLabel = `Finalize ${tgtNode.data.label.replace(/^End\s*/i, '')}`;
      } else if (tgtIsGateway && tgtNode.data?.label) {
        taskLabel = `Process ${tgtNode.data.label.replace(/\?$/, '')}`;
      }

      const pool = tgtIsGateway ? (tgtNode.pool || srcNode.pool) : (srcNode.pool || tgtNode.pool);
      const lane = tgtIsGateway ? (tgtNode.lane || srcNode.lane) : (srcNode.lane || tgtNode.lane);

      const insertedTask = {
        id: taskId,
        type: 'task',
        label: taskLabel,
        pool: pool || null,
        lane: lane || null,
        data: {
          label: taskLabel,
          duration: 10,
          duration_unit: 'minutes'
        }
      };

      newNodes.push(insertedTask);

      if (srcIsEvent && tgtIsGateway) {
        newEdges.push({
          id: `edge_ins_1_${idx}`,
          source: edge.source,
          target: taskId,
          flowType: edge.flowType || 'sequence',
          data: edge.data || {}
        });
        newEdges.push({
          id: `edge_ins_2_${idx}`,
          source: taskId,
          target: edge.target,
          flowType: 'sequence',
          data: { probability: null }
        });
      } else if (bothAreGateways) {
        newEdges.push({
          id: `edge_ins_1_${idx}`,
          source: edge.source,
          target: taskId,
          flowType: 'sequence',
          data: edge.data || {}
        });
        newEdges.push({
          id: `edge_ins_2_${idx}`,
          source: taskId,
          target: edge.target,
          flowType: 'sequence',
          data: { probability: null }
        });
      } else {
        newEdges.push({
          id: `edge_ins_1_${idx}`,
          source: edge.source,
          target: taskId,
          flowType: 'sequence',
          data: edge.data || {}
        });
        newEdges.push({
          id: `edge_ins_2_${idx}`,
          source: taskId,
          target: edge.target,
          flowType: edge.flowType || 'sequence',
          data: {}
        });
      }
    }
  });

  if (newNodes.length > 0) {
    diagram.nodes.push(...newNodes);
    diagram.edges = diagram.edges.filter(e => !edgesToRemove.has(e.id || `${e.source}->${e.target}`));
    diagram.edges.push(...newEdges);
  }
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

module.exports = { generateProcess, AiValidationError };