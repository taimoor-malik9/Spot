/**
 * apiService.js - Clean version with proxy support
 */

const configuredBaseUrl = (import.meta.env?.VITE_API_URL || '/api').trim().replace(/\/+$/, '');
const BASE_URL = configuredBaseUrl === '' || configuredBaseUrl === '/api'
  ? '/api'
  : configuredBaseUrl.endsWith('/api')
    ? configuredBaseUrl
    : `${configuredBaseUrl}/api`;

function getFullUrl(path) {
  let cleanPath = path.startsWith('/api') ? path.replace(/^\/api/, '') : path;
  return BASE_URL === '/api' ? `/api${cleanPath}` : `${BASE_URL}${cleanPath}`;
}

export async function request(path, options = {}) {
  const url = getFullUrl(path);
  const token = typeof window !== 'undefined'
    ? (localStorage.getItem('spot_token') || sessionStorage.getItem('spot_token'))
    : null;
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  try {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...(options.headers || {}),
      },
      ...options,
    });

    const contentType = res.headers.get('content-type');
    let data = {};

    if (contentType?.includes('application/json')) {
      data = await res.json();
    } else {
      const text = await res.text();
      if (text) data = { message: text };
    }

    if (!res.ok) {
      if (res.status === 401 && !path.includes('/auth/login') && !path.includes('/auth/signup')) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('spot_token');
          sessionStorage.removeItem('spot_token');
          sessionStorage.removeItem('spot_guest');
          window.dispatchEvent(new CustomEvent('spot:unauthorized'));
          if (!window.location.pathname.startsWith('/login')) {
            window.location.href = '/login';
          }
        }
      }
      const errorMsg = data?.error || data?.message || `HTTP ${res.status}`;
      const error = new Error(errorMsg);
      error.status = res.status;
      error.code = data?.code;
      throw error;
    }

    return data;
  } catch (err) {
    console.error(`❌ API Error [${url}]:`, err.message);
    throw err;
  }
}

// ─── Helpers: shape conversion ─────────────────────────────────────────────

// Pool membership on the canvas is GEOMETRIC: the Model page decides it with
// getPoolForNode (the node's centre lies inside a pool rectangle). Canvas
// nodes therefore usually carry no explicit `pool`, and saving wrote
// pool: null for both ends of a message flow. The backend validator then read
// them as "the same pool" and rejected the save ("Message flow ... must only
// connect nodes across different pools"). Derive the pool from geometry, only
// when the node has no explicit pool, using the same rule as the Model page.
const CANVAS_NODE_W = 80;
const CANVAS_NODE_H = 80;

function inferPoolIds(elements) {
  const pools = elements.filter(e => e && e.type === 'pool');
  const inferred = {};
  if (!pools.length) return inferred;
  elements.forEach(el => {
    if (!el || ['pool', 'lane'].includes(el.type)) return;
    if (el.pool || el.poolId) return;
    if (!el.position || !Number.isFinite(el.position.x) || !Number.isFinite(el.position.y)) return;
    const cx = el.position.x + (el.width || CANVAS_NODE_W) / 2;
    const cy = el.position.y + (el.height || CANVAS_NODE_H) / 2;
    const hit = pools.find(pool => {
      const px = pool.position?.x ?? 0;
      const py = pool.position?.y ?? 0;
      const pw = pool.width ?? 600;
      const ph = pool.height ?? 300;
      return cx >= px && cx <= px + pw && cy >= py && cy <= py + ph;
    });
    if (hit) inferred[el.id] = hit.id;
  });
  return inferred;
}

export function shapeFrontendToBackend(elements, connections, title, globalResources = []) {
  const resourcesList = globalResources
    .filter(r => (parseInt(r.quantity, 10) || 0) > 0)
    .map(r => {
      const resName = r.displayName || r.name || r.id;
      return {
        id: resName,
        name: resName,
        type: r.type || 'staff',
        quantity: parseInt(r.quantity, 10) || 0,
        hours_per_day: r.hours_per_day !== undefined && r.hours_per_day !== null ? Number(r.hours_per_day) : null,
        working_days_per_month: r.working_days_per_month !== undefined && r.working_days_per_month !== null ? Number(r.working_days_per_month) : null,
        monthly_salary: r.monthly_salary !== undefined && r.monthly_salary !== null ? Number(r.monthly_salary) : null,
        purchase_price: r.purchase_price !== undefined && r.purchase_price !== null ? Number(r.purchase_price) : null,
        lifespan_months: r.lifespan_months !== undefined && r.lifespan_months !== null ? Number(r.lifespan_months) : null,
        monthly_running_cost: r.monthly_running_cost !== undefined && r.monthly_running_cost !== null ? Number(r.monthly_running_cost) : null,
        monthly_rent: r.monthly_rent !== undefined && r.monthly_rent !== null ? Number(r.monthly_rent) : null,
      };
    });

  const inferredPools = inferPoolIds(elements);
  const nodePoolMap = {};
  elements.forEach(el => {
    if (el.pool) nodePoolMap[el.id] = el.pool;
    else if (el.poolId) nodePoolMap[el.id] = el.poolId;
    else if (inferredPools[el.id]) nodePoolMap[el.id] = inferredPools[el.id];
  });

  const resNameMap = {};
  resourcesList.forEach(r => {
    const resName = r.displayName || r.name || r.id;
    if (r.id) resNameMap[r.id] = resName;
    if (r.name) resNameMap[r.name] = resName;
    if (r.displayName) resNameMap[r.displayName] = resName;
  });

  const nodes = elements
    .filter(el => !['pool', 'lane'].includes(el.type))
    .map(el => {
      const cleanTaskRes = {};
      if (el.data?.resources && typeof el.data.resources === 'object') {
        Object.entries(el.data.resources).forEach(([k, q]) => {
          const mapped = resNameMap[k] || (k && !k.startsWith('res_') ? k : null);
          if (mapped) cleanTaskRes[mapped] = q;
        });
      }

      let primaryRes = el.data?.resource ? (resNameMap[el.data.resource] || (el.data.resource.startsWith('res_') ? null : el.data.resource)) : null;
      if (!primaryRes && Object.keys(cleanTaskRes).length > 0) {
        primaryRes = Object.keys(cleanTaskRes)[0];
      }
      if (Object.keys(cleanTaskRes).length === 0 && primaryRes) {
        cleanTaskRes[primaryRes] = 1;
      }

      return {
        id: el.id,
        type: normaliseBpmnType(el.type),
        pool: nodePoolMap[el.id] || null,
        lane: el.lane || null,
        parent: el.parent || null,
        // FIX: preserve canvas layout across save/reload — without these,
        // every node comes back from the backend defaulted to the same
        // (100, 100) position and visually collapses onto itself.
        position: el.position && typeof el.position.x === 'number' && typeof el.position.y === 'number'
          ? { x: el.position.x, y: el.position.y }
          : null,
        width: el.width ?? null,
        height: el.height ?? null,
        data: {
          label: el.label || el.data?.label || el.id,
          duration: Number(el.data?.duration) || 0,
          duration_min: el.data?.duration_min != null ? Number(el.data.duration_min) : null,
          duration_max: el.data?.duration_max != null ? Number(el.data.duration_max) : null,
          duration_unit: el.data?.duration_unit || 'minutes',
          resource: primaryRes,
          resources: cleanTaskRes,
          gateway_type: el.data?.gateway_type || null,
          customType: el.type,
        },
      };
    });

  const edges = connections.map(conn => {
    const srcId = conn.fromId || conn.from || conn.source;
    const tgtId = conn.toId || conn.to || conn.target;
    const sp = nodePoolMap[srcId];
    const tp = nodePoolMap[tgtId];
    const isCrossPool = sp && tp && sp !== tp;
    const isMessage =
      conn.type === 'message-flow' ||
      conn.type === 'message' ||
      conn.flowType === 'message' ||
      conn.data?.type === 'message-flow' ||
      conn.data?.flowType === 'message' ||
      isCrossPool;
    const typeStr = isMessage ? 'message-flow' : 'sequence-flow';

    return {
      id: conn.id,
      source: srcId,
      target: tgtId,
      type: typeStr,
      flowType: isMessage ? 'message' : 'sequence',
      data: {
        ...(conn.data || {}),
        probability: conn.probability != null ? Number(conn.probability) : (conn.data?.probability != null ? Number(conn.data.probability) : undefined),
        type: typeStr,
      },
    };
  });

  const layoutElements = elements
    .filter(el => ['pool', 'lane'].includes(el.type))
    .map(el => ({
      id: el.id,
      type: el.type,
      label: el.label || el.data?.label || el.id,
      position: el.position ? { x: el.position.x, y: el.position.y } : null,
      width: el.width ?? null,
      height: el.height ?? null,
      poolId: el.poolId || (el.type === 'lane' ? (el.parent || null) : null),
      rowIndex: el.rowIndex,
      data: el.data || {},
    }));

  return { title: title || 'Untitled Process', resources: resourcesList, nodes, edges, layoutElements };
}

export function shapeBackendToFrontend(process) {
  const layoutElements = (process.layoutElements || []).map(layout => ({
    id: layout.id,
    type: layout.type,
    label: layout.label || layout.data?.label || layout.id,
    poolId: layout.poolId,
    position: layout.position || { x: 100, y: 100 },
    width: layout.width,
    height: layout.height,
    rowIndex: layout.rowIndex,
    data: layout.data || {},
  }));

  const nodeElements = (process.nodes || []).map(node => ({
    id: node.id,
    type: node.data?.customType || backendTypeToFrontend(node.type),
    label: node.data?.label || node.id,
    pool: node.pool || null,
    lane: node.lane || null,
    parent: node.parent || null,
    position: node.position || { x: 100, y: 100 },
    width: node.width,
    height: node.height,
    data: {
      label: node.data?.label || '',
      duration: node.data?.duration,
      duration_min: node.data?.duration_min,
      duration_max: node.data?.duration_max,
      resources: node.data?.resources || {},
      gateway_type: node.data?.gateway_type || null,
      customType: node.data?.customType || null,
    },
  }));

  const elements = [...layoutElements, ...nodeElements];

  const connections = (process.edges || []).map((edge, i) => {
    const isMessage =
      edge.flowType === 'message' ||
      edge.type === 'message-flow' ||
      edge.type === 'message' ||
      edge.data?.type === 'message-flow' ||
      edge.data?.flowType === 'message';
    return {
      id: edge._id || edge.id || `edge-${i}`,
      fromId: edge.source,
      toId: edge.target,
      from: edge.source,
      to: edge.target,
      type: isMessage ? 'message-flow' : 'sequence-flow',
      flowType: isMessage ? 'message' : 'sequence',
      probability: edge.data?.probability ?? edge.probability,
      data: edge.data || {},
    };
  });

  return { elements, connections };
}

function normaliseBpmnType(type) {
  // Pass through the original BPMN type — the simulation engine's graph.py
  // _TYPE_MAP handles the mapping to internal simulation types.
  // This preserves the distinction between e.g. user-task vs service-task.
  if (!type) return 'task';
  return type;
}

function backendTypeToFrontend(type) {
  if (type === 'start') return 'start-event';
  if (type === 'end') return 'end-event';
  if (type === 'gateway') return 'exclusive-gateway';
  return 'task';
}
// ─── AI API ────────────────────────────────────────────────────────────────
export async function generateAIProcess(description, history = []) {
  return request('/api/ai/generate-process', {
    method: 'POST',
    body: JSON.stringify({ description, history }),
  });
}
// ─── Process API ──────────────────────────────────────────────────────────

export async function saveProcess(elements, connections, title, globalResources = []) {
  const body = shapeFrontendToBackend(elements, connections, title, globalResources);
  return request('/api/process', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateProcess(id, elements, connections, title, globalResources = []) {
  const body = shapeFrontendToBackend(elements, connections, title, globalResources);
  return request(`/api/process/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

export async function getAllProcesses() {
  return request('/api/process');
}

export async function getProcess(id) {
  return request(`/api/process/${id}`);
}

// FIX (Problem 1): Accept simulationConfig and forward it to the backend.
// The backend route is POST /api/process/:id — no URL change needed.
export async function runSimulation(processId, simulationConfig = {}) {
  return request(`/api/process/${processId}`, {
    method: 'POST',
    body: JSON.stringify(simulationConfig),
  });
}

// ─── Simulator-backed AI options ──────────────────────────────────────────
export async function solveProblem(processId, message, config) {
  return request('/api/ai/solve-problem', {
    method: 'POST',
    body: JSON.stringify({ processId, message, ...(config ? { config } : {}) }),
  });
}

export async function applyAiOption(processId, variantDefinition) {
  return request('/api/ai/apply-option', {
    method: 'POST',
    body: JSON.stringify({ processId, variantDefinition }),
  });
}

// ─── Scenario API ──────────────────────────────────────────────────────────

export async function createScenario(baseProcessId, title, nodes, edges, resources, layoutElements) {
  return request(`/api/scenario/${baseProcessId}`, {
    method: 'POST',
    body: JSON.stringify({ title, nodes, edges, resources, layoutElements }),
  });
}

export async function updateScenario(scenarioId, title, nodes, edges, resources, layoutElements) {
  return request(`/api/scenario/${scenarioId}`, {
    method: 'PUT',
    body: JSON.stringify({ title, nodes, edges, resources, layoutElements }),
  });
}

export async function deleteScenario(scenarioId) {
  return request(`/api/scenario/${scenarioId}`, { method: 'DELETE' });
}

export async function getScenarios(baseProcessId) {
  return request(`/api/scenario/${baseProcessId}`);
}

export async function runScenarioSimulation(scenarioId, simulationConfig = {}) {
  return request(`/api/scenario/simulate/${scenarioId}`, {
    method: 'POST',
    body: JSON.stringify({ config: simulationConfig }),
  });
}

export async function repairScenario(scenarioId) {
  return request(`/api/scenario/repair/${scenarioId}`, {
    method: 'POST',
  });
}

export async function compareScenarios(baseProcessId) {
  return request(`/api/scenario/compare/${baseProcessId}`);
}

export async function runWhatIfAnalysis(baseProcessId) {
  return request(`/api/scenario/what-if/${baseProcessId}`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// ─── Intake API (Module I4) ───────────────────────────────────────────────

export async function parseTypedAnswer(screenId, text, currentAnswers = {}, rawDiagram = {}) {
  return request('/api/intake/parse-answer', {
    method: 'POST',
    body: JSON.stringify({ screenId, text, currentAnswers, rawDiagram }),
  });
}