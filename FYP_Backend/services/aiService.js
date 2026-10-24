const path = require('path');

// Uses Google Gemini API (free tier) instead of a paid SDK.
// Get a free key with no credit card at https://aistudio.google.com
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest'; // Always points to Google's current Flash model. Do NOT use a "-pro" model, those are paid-only.
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// Module I2g: Spec Compiler Feature Flag (enabled by default; set USE_SPEC_COMPILER=false to use legacy path)
const USE_SPEC_COMPILER = process.env.USE_SPEC_COMPILER !== 'false';

let compileBpmnModule = null;
async function getCompiler() {
  if (!compileBpmnModule) {
    const compilerPath = path.resolve(__dirname, '../../Mystery_Frontend/src/lib/intake/compileBpmn.js');
    compileBpmnModule = await import(compilerPath);
  }
  return compileBpmnModule;
}

let validateBpmnModule = null;
async function getValidator() {
  if (!validateBpmnModule) {
    const validatorPath = path.resolve(__dirname, '../../Mystery_Frontend/src/lib/intake/validateBpmn.js');
    validateBpmnModule = await import(validatorPath);
  }
  return validateBpmnModule;
}

const NODE_TYPES = ['pool', 'lane', 'start-event', 'end-event', 'intermediate-event', 'task',
                     'exclusive-gateway', 'parallel-gateway', 'inclusive-gateway',
                     'message-start-event', 'timer-start-event',
                     'message-intermediate-catch', 'message-intermediate-throw', 'timer-intermediate-catch',
                     'message-end-event'];
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

const SPEC_SYSTEM_PROMPT = `You are a BPMN process modeling assistant for SPOT (Simulation Platform for Optimization using Digital Twin).
You convert plain-language business descriptions into a structured process SPECification, which is then compiled deterministically into a valid BPMN 2.0 diagram.
Do NOT output nodes and edges. Output ONLY the high-level process specification.

=== RESPONSE FORMAT ===
Always return pure valid JSON with NO Markdown fences, NO commentary.
Return either:
1. Clarification (only if the description is completely ambiguous, off-topic, or missing basic steps):
{
  "type": "clarification",
  "question": "Plain English question asking for the missing info"
}

2. Process SPEC:
{
  "type": "spec",
  "pools": [
    {
      "name": "Pool / Participant Name",
      "steps": [
        {
          "id": "step_id",
          "label": "Action Verb + Noun",
          "kind": "task" | "wait_for_message" | "send_message",
          "lane": "Lane Name",
          "origin": "stated" | "inferred",
          "duration": 5,
          "duration_unit": "minutes" | "hours" | "days",
          "resource": "Resource Name or null"
        }
      ],
      "branches": [
        {
          "afterStepId": "step_id_before_decision",
          "question": "Decision Question?",
          "options": [
            {
              "label": "Option Label",
              "probability": 0.8,
              "steps": ["step_id_a", "step_id_b"],
              "rejoin": true
            }
          ]
        }
      ]
    }
  ],
  "handoffs": [
    {
      "fromStepId": "step_id_in_pool_A",
      "toStepId": "step_id_in_pool_B"
    }
  ],
  "resources": [
    {
      "id": "Resource Name",
      "name": "Resource Name",
      "type": "staff" | "equipment" | "facility",
      "quantity": 1,
      "quantitySource": "stated" | "assumed",
      "costSource": "stated" | "assumed",
      "hours_per_day": 8,
      "working_days_per_month": 22,
      "monthly_salary": 50000
    }
  ]
}

=== RULES FOR SPEC GENERATION ===
1. POOLS & PARTICIPANTS:
   - Identify each distinct actor/organization (e.g. "Customer", "Store", "Cashier", "Kitchen", "Delivery Driver").
   - Give each actor their own pool in "pools".
2. STEPS & KINDS:
   - "task": active work being performed by someone or something (has duration and resource).
   - "wait_for_message": waiting for a message, order, trigger, or delivery from another pool. When this is the first step of a receiving pool, the compiler automatically turns it into a message start event.
   - "send_message": sending a confirmation, notification, or handoff to another pool. When this is the last step of a sending pool, the compiler automatically turns it into a message end event.
   - "origin": "stated" if explicitly mentioned by user; "inferred" if added for logical completeness. Inferred steps have duration 0.
   - "lane": swimlane within the pool. If no sub-lanes, use the pool name. Never leave empty.
3. BRANCHES & DECISIONS:
   - "afterStepId": the step ID after which the decision gateway is placed.
   - "question": phrase as a question ("Payment Valid?", "Item in Stock?").
   - "options": at least 2 choices. Probabilities across options must sum to 1.0.
   - "steps": MUST be an array of valid step IDs belonging to that branch path. NEVER empty. Every step ID in "steps" must be defined in the pool's "steps" array.
   - "rejoin": true if the branch merges back into the main workflow; false if the branch terminates the process (e.g. order rejected/cancelled).
4. HANDOFFS:
   - Model all interactions between different pools as handoffs from a sending step to a receiving step:
     { "fromStepId": "sending_step_id", "toStepId": "receiving_step_id" }.
   - Cross-pool sequence flows are not allowed; handoffs become BPMN message flows.
5. RESOURCES:
   - Infer resources (staff, equipment, facility) needed for simulation.
   - The customer / applicant / requester is the process subject and NEVER a resource.
   - All server/worker roles (Cashier, Chef, Driver, Clerk) must be defined in "resources".
`;

const SYSTEM_PROMPT = `You are a BPMN 2.0 process modeling assistant for SPOT (Simulation Platform for Optimization using Digital Twin). You convert plain-language descriptions into a BPMN diagram AND infer the resources needed to run a discrete-event simulation on it.

=== STRUCTURAL RULES ===
1. Exactly ONE start-event in the ENTIRE diagram (the whole BPMN). Never create more than one start-event in the entire diagram or across pools/swimlanes. The process begins at this single start-event.
2. At least ONE end-event per pool, zero outgoing edges. Multiple end events allowed (one per distinct outcome).
3. Use the specific event subtype whenever one fits — message-intermediate-catch (receiving something mid-process), message-intermediate-throw (sending something mid-process), timer-intermediate-catch (a pure wait — "wait for delivery", "wait 2 days"), message-start-event / message-end-event (a message starts or ends the process). Fall back to the generic intermediate-event only when none of those fit, and only where the description implies a real wait or trigger — never invent one. See CHOOSING THE RIGHT NODE TYPE below for the full distinction.
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
- If the description involves more than one actor/organization (e.g. "Customer" and "Store"), model each as a separate pool node (type: "pool").
- The entire BPMN diagram must contain ONLY ONE start-event total. Other pools/participants start via message-flow edges from the primary process.
- Every task MUST be assigned to a lane (set "lane": "LaneName" and "pool": "PoolName"). If a pool has no sub-lanes, set "lane" to the pool name itself (e.g. "Customer", "Store"). Never leave "lane": null on any task.
- Sequence-flow edges (flowType: "sequence") may ONLY connect nodes within the same pool.
- Message-flow edges (flowType: "message") are the ONLY way to connect nodes across different pools (e.g. customer sends items to store).
- CRITICAL CONTINUITY RULE: Message flows across pools DO NOT REPLACE sequence flows. Within EACH pool, tasks and events MUST form an unbroken chain of sequence flows (flowType: "sequence"). For example, when a customer step sends a message flow to the store pool, that customer step MUST STILL connect with a sequence flow to the next customer step or message-catch in the customer pool. Every task and intermediate event in every pool must have exactly 1 incoming sequence flow and 1 outgoing sequence flow within its own pool.

=== NAMING ===
- Events: noun + past participle ("Order Placed", "Payment Received").
- Tasks: action verb + noun ("Verify Payment", "Send Invoice").
- Gateways: phrase as a question ("Payment Valid?").

=== CHOOSING THE RIGHT NODE TYPE (task vs event vs gateway) ===
This is standard BPMN, not a judgment call — get the category right and the rest follows:
- task: real work — someone or something actively spending time doing something. A task's duration is NEVER optional; if it's a task, it has genuine, non-zero duration. This is correct and required, not something to second-guess.
- gateway: a DECISION or BRANCH point. Never has a duration, never has a resource. "Customer decides whether to approve the quote" is a gateway (gateway_type set, question-phrased label), not a task.
- event: something that HAPPENS or is TRIGGERED — instantaneous by definition, the same as real BPMN. No work occurs during an event. The one nuance: a "timer-intermediate-catch" event's duration field represents elapsed WAITING time (e.g. "wait 2 days for the part to arrive from the supplier") — that's a delay, not work, which is why it's an event with a duration rather than a task. It's still not "processing time" in the task sense; nobody is doing anything for those 2 days.

The actual failure mode this section fixes: forcing something that is genuinely an event into "task" because task was the only node type you knew how to attach a duration or a wait to. That's a vocabulary problem, not a judgment problem — this schema supports the specific event subtypes below precisely so you never have to make that trade:
- message-start-event / message-end-event: the process starts or ends because a message arrived or was sent (e.g. "a WhatsApp order comes in" starting the process, or "confirmation is sent to the customer" ending it).
- message-intermediate-catch: receiving something mid-process — a reply, a delivery, a confirmation from another pool. Pair it with a message-flow from whatever sends it.
- message-intermediate-throw: sending something mid-process to another pool (a notification, a confirmation, a request).
- timer-intermediate-catch: a pure wait with no one actively working — "wait for the glue to dry", "wait 3 days for the part to arrive", a mandated cooling-off period. Give it the real wait duration. This is NOT a task, even though it has a duration — nothing is being worked on, time is just passing.
- Plain "intermediate-event" (no message/timer): something happens with no meaningful wait attached and no message pairing — use sparingly; most real "something happens" moments are better modeled as one of the specific subtypes above, or don't need their own node at all if they add no information.

If you find yourself about to invent a duration for a step that involves no one doing any work — waiting for a delivery, waiting for a reply, waiting for something external to happen — that is always a timer- or message-intermediate-catch event, never a task. A task with a duration but no real work behind it is the wrong node type, not an acceptable simplification.

=== DURATIONS & TIME UNITS ===
- Every task and every intermediate-event with a duration MUST explicitly set "duration_unit" to one of: "minutes" | "hours" | "days". Never omit it — the simulation engine treats a missing unit as minutes, so an omitted unit on a step that's actually hours or days silently corrupts every downstream result by 60x-1440x.
- Every task and every intermediate-event with a duration MUST also set "duration_source" to "stated" (the user's description explicitly gave a time — a number, or phrasing like "takes about 10 minutes", "overnight", "same day") or "assumed" (you picked a reasonable default because the description didn't say). Be literal and honest here, same as quantitySource for resources — this is a factual tag, not a judgment call about how confident you are.
- Pick the unit that matches how a business owner would naturally describe the step: a phone call or a task done in one sitting is "minutes"; "we wait for the supplier to restock" or "customer picks up next day" is "hours" or "days". Do not default everything to minutes just because it's the common case — check each step on its own.
- duration_min/duration_max, when both set, must be in the SAME unit as duration_unit for that node.

=== RESOURCES (auto-inference & naming) ===
- EVERY SINGLE TASK activity in the diagram MUST have at least one resource assigned in data.resources = { "Resource Name": quantity }, and data.resource = "Resource Name" (the first/primary one, kept for backward compatibility — but data.resources is the field that actually drives simulation, so it must always be complete and correct) — EXCEPT tasks performed by the process's own subject/requester, see WHO IS NEVER A RESOURCE below.
- Every resource object in the "resources" array MUST have a clear, descriptive, human-readable "name" field (e.g. "Kitchen Staff", "Cook / Pizza Chef", "Cashier", "Delivery Driver", "Phone System").
- NEVER use generic IDs (like "res_1", "res_2"), empty strings (""), or unnamed resources for resource names.
- Every resource name referenced in ANY node's data.resources MUST have a matching entry in the top-level "resources" array — never reference a resource in a task that isn't also defined at the top level, and never leave the top-level "resources" array empty if any task references resources.
- Categories map to the resource object's "type" field as: staff (people/specialists), equipment (computers, machines, vehicles), facility (rooms, rented/owned space).
- A resource never crosses a pool boundary. Every task's resource assignment must belong to the SAME pool that task sits in — no exceptions, and this applies to EVERY task in that pool, not just the one that first comes to mind. Concrete example of the exact mistake to avoid:
   - WRONG: Customer pool has "Look at Menu and Decide" (holding "Waiter") --> "Tell Order to Waiter" (also Customer pool). Even though the second task's name mentions the waiter, it is STILL a Customer-pool task — attaching the Restaurant's Waiter resource to either one is wrong, because the waiter isn't doing any work during the customer's decision-making, and the customer pool has no authority to hold a resource that belongs to a different organization.
   - RIGHT: Customer pool has "Look at Menu and Decide" (no resource, or a Customer-pool-native one) --> "Tell Order to Waiter" (still no Restaurant resource — the customer is the one acting here) --> message-flow --> Restaurant pool's "Write Down Order" (holds "Waiter" — this is the task where the waiter is actually the one doing something).
   The test: for any task, ask "does this pool's own organization employ or own this resource?" — if the task is in the Customer pool and the resource is restaurant/hospital/office staff or equipment, the answer is no, regardless of what the task's label says or how naturally the interaction reads. The interaction itself is fully represented by the message-flow edge; it needs no resource on the sending side.

=== WHO IS NEVER A RESOURCE ===
- The actor whose case/order/request/application this whole process exists to handle — the customer, patient, complainant, applicant, requester — is NEVER a resource, even when they have their own pool and perform their own tasks in it (e.g. "Approach Licensee for Redress", "Submit Complaint", "Sign the Form", "Pick Up Order"). Leave data.resources = {} and data.resource = null on those tasks. The task still has a duration — it just doesn't hold anyone's capacity.
- Why: a resource models SHARED, LIMITED capacity that different cases compete for — one Cashier has to finish case #1 before starting case #2. The process subject is the opposite: every simulated case already IS one instance of that actor, so they are never shared across cases and there is no capacity to model. Adding them as a resource with quantity: 1 invents fake contention between unrelated cases (as if every customer had to wait their turn to use "the customer slot" before they're allowed to act).
- Test before assigning a resource to any task: would adding MORE of it ever be a sensible fix for a bottleneck (hire another Cashier, buy a second oven, rent more space)? If yes, it's a real resource. If the idea is nonsensical (hire more customers, buy more patients, rent more complainants), it's the process subject — never create a resource for it, no matter how naturally the description phrases their actions as "steps."
- This is the only exception to the "every task needs a resource" rule above. Every OTHER actor — staff, organizations, or third parties that DO the serving/handling (the Cashier, the Licensee, the Registrar, the Designated Officer, the Warehouse) — still needs a resource exactly as normal, including in cross-pool processes where they respond to the process subject's pool via message-flow.

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
Two different kinds of missing information need two different responses — conflating them is why an AI that "never asks anything" and an AI that "asks about everything" are both failure modes.

SAFE TO ASSUME (a number — proceed with a diagram, tag the source honestly):
- How many of something they own (ovens, delivery bikes, staff on shift). Set quantitySource "assumed".
- How long a step takes, when no time was mentioned. Set duration_source "assumed".
- A resource's cost fields (salary, rent, purchase price). Set costSource "assumed".
These are all reviewed and correctable on the confirmation screen after generation — guessing wrong here costs the user one click to fix, so guessing is the right default.

MUST ASK (structure — return a "clarification" response instead of guessing):
A wrong guess here changes the SHAPE of the diagram, not just a number inside it — the confirmation screen never reviews structure, so a bad guess here silently ships as if it were correct. Ask when:
- The description implies a decision or branch but doesn't say what happens on each path (e.g. "the customer might not like it" — might not like it, then what? refund? remake? nothing is said).
- It's genuinely ambiguous whether something is ONE step or TWO (e.g. "we check and confirm the order" — is that one action or two separate ones with different people/timing?).
- It's unclear WHO performs a step when multiple actors are in play and the description doesn't say (e.g. two pools exist, and a step could plausibly belong to either).
- A step's outcome determines whether the process continues, loops, or ends, and the description doesn't say which.
- The overall scope is unclear enough that guessing the process's basic shape (how many major stages, what the end states are) would be inventing the process rather than modeling it.
Ask ONE specific, concrete question about the single biggest structural gap — not a checklist of every uncertainty. Phrase it the way a person would ask a colleague, not a form field: "When the customer isn't happy with the quote, do they get a refund, a redo, or something else?" — not "Please specify the outcome of dissatisfaction."

If the description is too vague to model at all, or a resource's fundamental TYPE (not quantity) can't be inferred, that's also a clarification case, as before.

=== NODE ORIGIN (stated vs inferred) & GATEWAY BRANCHES ===
- Every node in "nodes" MUST set "origin" to either "stated" or "inferred":
  - "stated": tasks directly mentioned or described in the owner's text.
  - Start/end events and join gateways required for BPMN structure may be added without flagging as inferred (set origin: "stated").
  - "inferred": ANY other task/activity that you add to bridge flow, fix connectivity, or evaluate conditions that was NOT explicitly stated by the owner MUST be marked origin: "inferred".
- Do not invent branches or gateway probabilities unless the owner's text states them. If a branch is implied without an explicit probability, set a reasonable probability and flag "probabilityEstimated": true on that edge's data object (edge.data.probabilityEstimated: true). If explicitly stated, flag probabilityEstimated: false.

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
- Re-check every resource against the WHO IS NEVER A RESOURCE test above: if any resource is really the customer/patient/complainant/applicant (the process subject) rather than staff/equipment/facility serving them, remove it from the top-level "resources" array and clear data.resources/data.resource on every task that referenced it — do not leave a resource in place just because you already wrote it.
- Re-check every task node: does real work happen during it, or is it actually a pure wait (→ timer-intermediate-catch), a message being sent/received (→ message-intermediate-catch/throw), or a decision (→ gateway)? A "task" whose duration represents waiting rather than working is the wrong node type — use the specific event subtype instead of stretching task to cover it.
- Go through EVERY task in the process-subject's pool (Customer/Patient/Applicant/etc.), one at a time, and check its resource assignment belongs to that SAME pool — not "does this feel wrong", but literally check the pool each assigned resource was defined for. Do this for every such task even if you already checked a neighboring one and it was fine; a compound task split into two still needs both halves checked.
- Before finalizing a "diagram" response, re-read the description once more for any branch, outcome, or actor-assignment you guessed rather than were told — if a wrong guess there would change the diagram's shape (not just a number in it), that should have been a "clarification" response instead. Don't rationalize a structural guess as acceptable just because you already built the rest of the diagram around it.
- Keep node/edge labels short and to the point. If the process is large, favor concise labels over verbose ones so the full JSON always finishes within the response — a truncated response is unusable even if everything up to the cutoff was correct.
- Respond with the JSON object and NOTHING else: no explanation before it, no notes after it, no markdown fences around it. The very first character of your response must be "{" and the very last must be "}".

=== OUTPUT FORMAT ===
Respond with ONLY raw JSON, no markdown, matching exactly one shape:

Feasible:
{
  "type": "diagram",
  "summary": "1-2 sentence summary, noting any resources/durations that were auto-assumed and flagging single-quantity bottleneck resources",
  "nodes": [
    { "id": "string", "type": "pool|lane|start-event|end-event|intermediate-event|task|exclusive-gateway|parallel-gateway|inclusive-gateway|message-start-event|timer-start-event|message-intermediate-catch|message-intermediate-throw|timer-intermediate-catch|message-end-event",
      "origin": "stated|inferred",
      "pool": "poolId or null", "lane": "laneId or null",
      "data": { "label": "string", "origin": "stated|inferred", "gateway_type": "exclusive|parallel|inclusive or null",
                "duration": number|null, "duration_min": number|null, "duration_max": number|null,
                "duration_unit": "minutes|hours|days or null",
                "duration_source": "stated|assumed or null (null only if no duration applies)",
                "resource": "Resource Name",
                "resources": { "Resource Name": quantity } } }
  ],
  "edges": [
    { "id": "string", "source": "nodeId", "target": "nodeId", "flowType": "sequence|message",
      "data": { "probability": number|null, "probabilityEstimated": boolean|null } }
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

async function callGemini({ systemPrompt, contents, generationConfig, expectJson = true }) {
  if (!GEMINI_API_KEY) {
    throw new AiValidationError('GEMINI_API_KEY is not set in .env', null);
  }

  const requestBody = {
    system_instruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
    contents,
    generationConfig: {
      maxOutputTokens: 2000,
      ...(expectJson ? { responseMimeType: 'application/json' } : {}),
      ...(generationConfig || {})
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

  return raw;
}

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

  const promptToUse = USE_SPEC_COMPILER ? SPEC_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const raw = await callGemini({
    systemPrompt: promptToUse,
    contents,
    generationConfig: {
      maxOutputTokens: 20000,
      thinkingConfig: { thinkingBudget: 1024 }
    },
    expectJson: true
  });

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

  // Module I2g: Deterministic BPMN Compiler Path
  if (USE_SPEC_COMPILER && (parsed.type === 'spec' || parsed.pools)) {
    const { compileBpmn, validateSpec } = await getCompiler();
    const { validateBpmn } = await getValidator();

    // 1. Check SPEC completeness: ask plain question if incomplete instead of silent repairs
    const specCheck = validateSpec(parsed);
    if (!specCheck.valid) {
      return {
        type: 'clarification',
        question: specCheck.question || 'Could you provide a few more details about this step?',
      };
    }

    // 2. Pure compilation to rawDiagram
    const compiled = compileBpmn(parsed);

    // 3. validateBpmn as safety net
    const validation = validateBpmn(compiled);
    if (validation.errors && validation.errors.length > 0) {
      console.warn('validateBpmn compiler safety net found issues:', validation.errors);
    }
    const finalDiagram = validation.repaired || compiled;

    // 4. Build confirmation payload for review card
    const isFirstPass = !history || history.length === 0;
    if (isFirstPass) {
      const confirmations = buildConfirmationPayload(finalDiagram);
      if (confirmations.resources.length > 0 || confirmations.durations.length > 0) {
        return {
          type: 'needs_confirmation',
          diagram: finalDiagram,
          confirmations,
          spec: parsed,
        };
      }
    }

    return {
      ...finalDiagram,
      spec: parsed,
    };
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

      // Ensure lane is ALWAYS assigned on every task (Rule 8)
      const assignedLane = n.lane || n.data?.lane || n.pool || n.data?.pool || 'Staff';
      n.lane = assignedLane;
      n.data.lane = assignedLane;
    }

    // Server-side enforcement: for every inferred task force duration=0, duration_min=null, duration_max=null, resources={}
    const nodeOrigin = n.origin || n.data?.origin || 'stated';
    n.origin = nodeOrigin;
    n.data.origin = nodeOrigin;

    if (n.type === 'task' && nodeOrigin === 'inferred') {
      n.data.duration = 0;
      n.data.duration_min = null;
      n.data.duration_max = null;
      n.data.resources = {};
      n.data.resource = null;
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
        origin: 'inferred',
        data: {
          label: taskLabel,
          origin: 'inferred',
          duration: 0,
          duration_min: null,
          duration_max: null,
          duration_unit: 'minutes',
          resources: {},
          resource: null,
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

module.exports = { generateProcess, AiValidationError, callGemini };