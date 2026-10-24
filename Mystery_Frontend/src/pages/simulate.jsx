'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Play, Pause, RotateCcw, User, Laptop, Gauge, Truck, Building2,
  TestTube, Box, X, Loader2, CheckCircle2, AlertCircle, Zap, Settings, Target, Info
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { runSimulation, saveProcess, updateProcess } from '../lib/apiService';
import { NW, NH, elCenter } from '../components/model/bpmnGeometry';
import DiagramCanvas from '../components/model/DiagramCanvas';

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS & DEFAULTS
   ═══════════════════════════════════════════════════════════════ */

const DEFAULT_RESOURCES = [
  {
    id: 'staff',
    payloadKey: 'staff',
    displayName: 'Staff / Employee',
    icon: User,
    type: 'staff',
    quantity: 3,
    hours_per_day: 8,
    monthly_salary: 50000,
    purchase_price: null,
    lifespan_months: null,
    monthly_running_cost: null,
    monthly_rent: null
  },
  {
    id: 'workstation',
    payloadKey: 'workstation',
    displayName: 'Computer / Workstation',
    icon: Laptop,
    type: 'equipment',
    quantity: 2,
    hours_per_day: 10,
    monthly_salary: null,
    purchase_price: 45000,
    lifespan_months: 36,
    monthly_running_cost: 500,
    monthly_rent: null
  },
  {
    id: 'equipment',
    payloadKey: 'equipment',
    displayName: 'Equipment / Machine',
    icon: Gauge,
    type: 'equipment',
    quantity: 1,
    hours_per_day: 10,
    monthly_salary: null,
    purchase_price: 45000,
    lifespan_months: 36,
    monthly_running_cost: 500,
    monthly_rent: null
  },
  {
    id: 'vehicle',
    payloadKey: 'delivery_van',
    displayName: 'Vehicle / Delivery Van',
    icon: Truck,
    type: 'vehicle',
    quantity: 1,
    hours_per_day: 6,
    monthly_salary: null,
    purchase_price: 2500000,
    lifespan_months: 60,
    monthly_running_cost: 15000,
    monthly_rent: null
  },
  {
    id: 'room',
    payloadKey: 'room',
    displayName: 'Room / Consultation Room',
    icon: Building2,
    type: 'facility',
    quantity: 1,
    hours_per_day: 12,
    monthly_salary: null,
    purchase_price: null,
    lifespan_months: null,
    monthly_running_cost: null,
    monthly_rent: 80000,
    isRented: true
  },
  {
    id: 'specialist',
    payloadKey: 'specialist',
    displayName: 'Specialist',
    icon: TestTube,
    type: 'staff',
    quantity: 1,
    hours_per_day: 8,
    monthly_salary: 75000,
    purchase_price: null,
    lifespan_months: null,
    monthly_running_cost: null,
    monthly_rent: null
  },
];

const VISUAL_ONLY_TYPES = new Set(['pool', 'lane', 'data-object', 'document', 'annotation', 'input', 'output']);

const TRAVEL_MS       = 450;   // edge travel animation
const PROCESSING_MS   = 1200;  // default dwell if no sim data
const WAITING_MS      = 300;   // stagger between queued tokens
const QUEUE_OFFSET_PX = 12;
// Visual spawn interval — ALWAYS 2.5s so the canvas fills with tokens.
// This is INDEPENDENT of backend arrival_rate (which controls the SimPy engine).
const VISUAL_SPAWN_MS = 2500;

const STATE = { MOVING: 'moving', WAITING: 'waiting', PROCESSING: 'processing' };

/* ═══════════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════════ */

function toPositiveInt(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function readModelFromStorage() {
  if (typeof window === 'undefined') return { nodes: [], connections: [] };
  const raw = localStorage.getItem('spot:model:nodes');
  if (!raw) return { nodes: [], connections: [] };
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return { nodes: data, connections: [] };
    const conns = (data.connections || []).map(c => ({
      ...c, from: c.from ?? c.fromId, to: c.to ?? c.toId,
    }));
    return { nodes: data.nodes || [], connections: conns };
  } catch { return { nodes: [], connections: [] }; }
}

function nodeCenter(el) {
  return { x: (el.position?.x ?? 0) + (el.width ? el.width/2 : 40), y: (el.position?.y ?? 0) + (el.height ? el.height/2 : 40) };
}

function getPoolForNode(node, elements) {
  if (!node || !Array.isArray(elements)) return null;
  if (node.pool) {
    const poolEl = elements.find(e => e.id === node.pool && e.type === 'pool');
    if (poolEl) return poolEl;
  }
  if (node.poolId) {
    const laneEl = elements.find(e => e.id === node.poolId);
    if (laneEl?.poolId) {
      const poolEl = elements.find(e => e.id === laneEl.poolId && e.type === 'pool');
      if (poolEl) return poolEl;
    }
    const poolEl = elements.find(e => e.id === node.poolId && e.type === 'pool');
    if (poolEl) return poolEl;
  }
  const center = nodeCenter(node);
  for (const pool of elements.filter(e => e.type === 'pool')) {
    const px = pool.position?.x ?? 0, py = pool.position?.y ?? 0;
    const pw = pool.width  ?? 600,    ph = pool.height ?? 300;
    if (center.x >= px && center.x <= px + pw && center.y >= py && center.y <= py + ph) return pool;
  }
  return null;
}

function getProcessingMs(nodeId, simResults) {
  if (!simResults?.activity_results) return PROCESSING_MS;
  const act = simResults.activity_results[nodeId];
  if (!act) return PROCESSING_MS;
  const mins = act.avg_processing_time ?? act.avg_cycle_time ?? null;
  if (mins == null || mins <= 0) return PROCESSING_MS;

  // Scale relative to the longest task so differences are visible,
  // capped to [400ms, 3500ms] so the animation doesn't stall.
  const allActs = Object.values(simResults.activity_results);
  const maxMins = Math.max(...allActs.map(a => a.avg_processing_time ?? a.avg_cycle_time ?? 0), 0.01);
  const ratio = mins / maxMins;
  return Math.round(400 + ratio * 3100); // 400ms for fastest, 3500ms for slowest
}

function validateModel(elements, connections, resources, mode, arrivalRate) {
  const simNodes = elements.filter(el => !VISUAL_ONLY_TYPES.has(el.type));
  const errors = [];

  if (arrivalRate == null || isNaN(arrivalRate) || arrivalRate <= 0) {
    errors.push({ title: 'Invalid Arrival Frequency', message: 'Arrival rate must be greater than zero.' });
  }

  if (!simNodes.length) {
    errors.push({ title: 'Empty Process', message: 'Please draw your process on the Model page first.' });
    return errors;
  }

  const hasStart = simNodes.some(n => n.type === 'start-event' || n.type === 'start');
  const hasEnd   = simNodes.some(n => n.type === 'end-event'   || n.type === 'end');
  if (!hasStart) errors.push({ title: 'Missing Start', message: 'Add a Start Event to your process.' });
  if (!hasEnd)   errors.push({ title: 'Missing End', message: 'Add an End Event to your process.' });

  const invalidResources = (resources || []).filter(r => {
    const q = r.quantity;
    if (q === '' || q == null) return true;
    if (Number(q) <= 0) return true;
    if (!Number.isInteger(Number(q))) return true;
    return false;
  });
  if (invalidResources.length > 0) {
    errors.push({ title: 'Invalid Resource Quantity', message: `Resource quantities must be whole numbers greater than zero. Please fix or remove resources with 0 or decimal values.` });
  }

  const selectedResources = (resources || []).filter(r => (parseInt(r.quantity, 10) || 0) > 0);
  if (!selectedResources.length && invalidResources.length === 0) {
    errors.push({ title: 'No Resources', message: 'Add at least one resource in the left sidebar.' });
  }

  const missingDuration = simNodes
    .filter(n => n.type === 'task' || n.type === 'subprocess')
    .filter(n => {
      const d = n.data || n;
      if (mode === 'quick') {
        return !(d.duration != null && Number(d.duration) > 0);
      } else {
        return !(d.duration_min != null && d.duration_max != null
                 && Number(d.duration_max) >= Number(d.duration_min)
                 && Number(d.duration_max) > 0);
      }
    })
    .map(n => n.label || n.id);
  if (missingDuration.length) {
    const names = missingDuration.slice(0, 3).map(l => `"${l}"`).join(', ');
    errors.push({ title: 'Missing Task Duration', message: `Set duration for: ${names}${missingDuration.length > 3 ? '...' : ''}` });
  }

  const allEdgeSrc = new Set(connections.map(c => c.from ?? c.fromId));
  const allEdgeTgt = new Set(connections.map(c => c.to   ?? c.toId));
  const disconnected = simNodes.filter(n => {
    if (n.type === 'start-event' || n.type === 'start') return !allEdgeSrc.has(n.id);
    if (n.type === 'end-event'   || n.type === 'end')   return !allEdgeTgt.has(n.id);
    return !allEdgeSrc.has(n.id) && !allEdgeTgt.has(n.id);
  }).map(n => n.label || n.id);
  if (disconnected.length) {
    const names = disconnected.slice(0, 3).map(l => `"${l}"`).join(', ');
    errors.push({ title: 'Unconnected Elements', message: `Connect these shapes: ${names}${disconnected.length > 3 ? '...' : ''}` });
  }

  // Only flag actual cross-POOL connections (cross-lane is valid BPMN)
  const pools = elements.filter(e => e.type === 'pool');
   if (false && pools.length > 1) {
    for (const conn of connections) {
      const src = elements.find(e => e.id === (conn.from ?? conn.fromId));
      const tgt = elements.find(e => e.id === (conn.to   ?? conn.toId));
      if (src && tgt && !VISUAL_ONLY_TYPES.has(src.type) && !VISUAL_ONLY_TYPES.has(tgt.type)) {
        const sp = getPoolForNode(src, elements);
        const tp = getPoolForNode(tgt, elements);
        if (sp && tp && sp.id !== tp.id) {
          errors.push({ title: 'Invalid Connection', message: `Cannot connect "${src.label}" across pools.` });
          break;
        }
      }
    }
  }

  return errors;
}



/* ═══════════════════════════════════════════════════════════════
   TOKEN COMPONENT
   ═══════════════════════════════════════════════════════════════ */

function Token({ token }) {
  const size  = token.state === STATE.PROCESSING ? 11 : 9;
  const pulse = token.state === STATE.PROCESSING;
  const dim   = token.state === STATE.WAITING ? 0.65 : 1;

  return (
    <g
      style={{
        transform: `translate(${token.x}px, ${token.y}px)`,
        willChange: 'transform',
        transition: token.state === STATE.MOVING
          ? `transform ${TRAVEL_MS}ms cubic-bezier(0.4,0,0.2,1)`
          : 'none',
        opacity: dim,
      }}
    >
      {pulse && (
        <circle r={size + 5} fill="none" stroke={token.color} strokeWidth="1.5" opacity="0.3">
          <animate attributeName="r" values={`${size+4};${size+10};${size+4}`} dur="1.2s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.4;0;0.4" dur="1.2s" repeatCount="indefinite"/>
        </circle>
      )}
      <circle r={size} fill={token.color} stroke="white" strokeWidth="2"/>
      <circle r={size * 0.35} fill="white" opacity="0.85"/>
      {token.state === STATE.WAITING && (
        <text y="0.4em" textAnchor="middle" fontSize="6" fill="white" fontWeight="bold">W</text>
      )}
    </g>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CONCURRENT TOKEN ENGINE HOOK
   ═══════════════════════════════════════════════════════════════ */

let _tokenIdCounter = 0;

function useConcurrentTokenEngine({ modelElements, connections, simResults, isRunning, arrivalRate }) {
  const [tokens, setTokens]   = useState([]);
  const tokensRef             = useRef([]);
  const isRunningRef          = useRef(false);
  const spawnRef              = useRef(null);

  const { adj, startEl } = useMemo(() => {
    const sn  = modelElements.filter(el => !VISUAL_ONLY_TYPES.has(el.type));
    const map = {};
    sn.forEach(el => { map[el.id] = []; });
    connections.forEach(c => {
      const src = c.from ?? c.fromId, tgt = c.to ?? c.toId;
      if (map[src] !== undefined) map[src].push({ target: tgt, probability: c.probability });
    });
    const start = sn.find(el => el.type === 'start-event' || el.type === 'start') || sn[0];
    return { adj: map, startEl: start };
  }, [modelElements, connections]);

  const nodeQueues = useRef({});
  const getNodeQueue  = (id) => { if (!nodeQueues.current[id]) nodeQueues.current[id] = new Set(); return nodeQueues.current[id]; };
  const joinNodeQueue = (id, tid) => getNodeQueue(id).add(tid);
  const leaveNodeQueue= (id, tid) => getNodeQueue(id).delete(tid);
  const getQueueIndex = (id, tid) => { const q = getNodeQueue(id); let i = 0; for (const x of q) { if (x === tid) return i; i++; } return 0; };

  const updateTokens = useCallback((updater) => {
    tokensRef.current = updater(tokensRef.current);
    setTokens([...tokensRef.current]);
  }, []);

  const removeToken = useCallback((tokenId) => {
    Object.keys(nodeQueues.current).forEach(id => nodeQueues.current[id].delete(tokenId));
    updateTokens(prev => prev.filter(t => t.id !== tokenId));
  }, [updateTokens]);

  const walkToken = useCallback((tokenId, nodeId, visited = new Set()) => {
    if (!isRunningRef.current) return;
    const el = modelElements.find(e => e.id === nodeId);
    if (!el || VISUAL_ONLY_TYPES.has(el.type)) { removeToken(tokenId); return; }

    const center      = nodeCenter(el);
    const isTask      = el.type === 'task' || el.type === 'subprocess';
    const processingMs= getProcessingMs(nodeId, simResults);

    joinNodeQueue(nodeId, tokenId);
    const qIdx      = getQueueIndex(nodeId, tokenId);
    const offsetX   = qIdx > 0 ? -(qIdx * QUEUE_OFFSET_PX) : 0;
    const offsetY   = qIdx > 0 ? (qIdx % 2 === 0 ? 0 : -QUEUE_OFFSET_PX * 0.5) : 0;
    const arrState  = qIdx > 0 ? STATE.WAITING : (isTask ? STATE.PROCESSING : STATE.MOVING);

    updateTokens(prev => {
      const exists = prev.some(t => t.id === tokenId);
      const patch  = {
        id: tokenId,
        x: center.x + offsetX,
        y: center.y + offsetY,
        color: prev.find(t => t.id === tokenId)?.color || `hsl(${(_tokenIdCounter * 53 + 190) % 360}, 75%, 52%)`,
        state: arrState,
        dwellNode: nodeId,
        currentEdge: null,
      };
      return exists ? prev.map(t => t.id === tokenId ? patch : t) : [...prev, patch];
    });

    const waitDelay = qIdx > 0 ? WAITING_MS * Math.min(qIdx + 1, 4) : 0;  // cap stagger at 4 slots
    const dwellDelay= waitDelay + (isTask ? processingMs : 400);

    setTimeout(() => {
      if (!isRunningRef.current) return;
      if (qIdx > 0 && isTask) {
        updateTokens(prev => prev.map(t =>
          t.id === tokenId ? { ...t, state: STATE.PROCESSING, x: center.x, y: center.y } : t
        ));
      }

      setTimeout(() => {
        if (!isRunningRef.current) return;
        leaveNodeQueue(nodeId, tokenId);

        const neighbors = adj[nodeId] || [];
        if (!neighbors.length) { removeToken(tokenId); return; }

        const newVisited = new Set(visited);
        newVisited.add(nodeId);

        let nextIds = [];
        const type  = el.type;

        if (type === 'exclusive-gateway' || type === 'gateway' || type === 'inclusive-gateway') {
          const targets = neighbors.map(n => n.target);
          let probs = neighbors.map(n => n.probability);
          if (probs.every(p => p == null)) probs = targets.map(() => 1 / targets.length);
          else {
            const known = probs.reduce((s, p) => s + (p ?? 0), 0);
            const nones = probs.filter(p => p == null).length;
            const fill  = nones > 0 ? (1 - known) / nones : 0;
            probs = probs.map(p => p ?? fill);
          }
          const total = probs.reduce((a, b) => a + b, 0);
          const norm  = probs.map(p => p / total);
          let r = Math.random(), cum = 0, chosen = targets[targets.length - 1];
          for (let i = 0; i < targets.length; i++) { cum += norm[i]; if (r <= cum) { chosen = targets[i]; break; } }
          nextIds = [chosen];
        } else if (type === 'parallel-gateway') {
          nextIds = neighbors.map(n => n.target);
        } else {
          nextIds = [neighbors[0].target];
        }

        nextIds = nextIds.filter(id => !newVisited.has(id));
        if (!nextIds.length) { removeToken(tokenId); return; }

        const branches = [{ id: tokenId, target: nextIds[0] }];
        for (let i = 1; i < nextIds.length; i++) {
          const newId      = `tok-${++_tokenIdCounter}`;
          const parentColor= tokensRef.current.find(t => t.id === tokenId)?.color || '#0ea5e9';
          updateTokens(prev => [...prev, { id: newId, x: center.x, y: center.y, color: parentColor, state: STATE.MOVING, dwellNode: null, currentEdge: null }]);
          branches.push({ id: newId, target: nextIds[i] });
        }

        branches.forEach(branch => {
          const targetEl = modelElements.find(e => e.id === branch.target);
          if (!targetEl || VISUAL_ONLY_TYPES.has(targetEl.type)) { removeToken(branch.id); return; }
          const tgt = nodeCenter(targetEl);

          updateTokens(prev => prev.map(t =>
            t.id === branch.id
              ? { ...t, state: STATE.MOVING, dwellNode: null, currentEdge: { from: nodeId, to: branch.target } }
              : t
          ));

          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (!isRunningRef.current) return;
              updateTokens(prev => prev.map(t => t.id === branch.id ? { ...t, x: tgt.x, y: tgt.y } : t));
              setTimeout(() => walkToken(branch.id, branch.target, newVisited), TRAVEL_MS + 20);
            });
          });
        });

      }, isTask ? processingMs : 0);
    }, waitDelay);

  }, [modelElements, adj, simResults, updateTokens, removeToken]);

  const spawnToken = useCallback(() => {
    if (!startEl || !isRunningRef.current) return;
    const id    = `tok-${++_tokenIdCounter}`;
    const color = `hsl(${(_tokenIdCounter * 53 + 190) % 360}, 72%, 55%)`;
    const c     = nodeCenter(startEl);
    updateTokens(prev => [...prev, { id, x: c.x, y: c.y, color, state: STATE.MOVING, dwellNode: null, currentEdge: null }]);
    walkToken(id, startEl.id);
  }, [startEl, walkToken, updateTokens]);

  const start = useCallback(() => {
    isRunningRef.current = true;
    _tokenIdCounter      = 0;
    nodeQueues.current   = {};
    tokensRef.current    = [];
    setTokens([]);
    // Always use fixed visual spawn interval so the canvas fills with concurrent tokens.
    // The backend arrival_rate is what drives the SimPy engine — the animation is cosmetic.
    spawnToken();
    spawnRef.current = setInterval(spawnToken, VISUAL_SPAWN_MS);
  }, [spawnToken]);

  const stop = useCallback(() => {
    isRunningRef.current = false;
    clearInterval(spawnRef.current);
    nodeQueues.current   = {};
  }, []);

  const reset = useCallback(() => {
    stop();
    _tokenIdCounter   = 0;
    tokensRef.current = [];
    setTokens([]);
  }, [stop]);

  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);
  useEffect(() => () => { stop(); }, [stop]);

  const activeEdgeSet  = useMemo(() => new Set(tokens.filter(t => t.currentEdge).map(t => `${t.currentEdge.from}__${t.currentEdge.to}`)), [tokens]);
  const processingSet  = useMemo(() => new Set(tokens.filter(t => t.state === STATE.PROCESSING).map(t => t.dwellNode)), [tokens]);
  const waitingSet     = useMemo(() => new Set(tokens.filter(t => t.state === STATE.WAITING).map(t => t.dwellNode)), [tokens]);
  const activeDwellSet = useMemo(() => new Set(tokens.filter(t => t.dwellNode).map(t => t.dwellNode)), [tokens]);

  return { tokens, start, stop, reset, activeEdgeSet, processingSet, waitingSet, activeDwellSet };
}



/* ═══════════════════════════════════════════════════════════════
   INLINE STYLES
   ═══════════════════════════════════════════════════════════════ */

const labelStyle = {
  display: 'block', fontSize: '10px', fontWeight: 600,
  color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px',
};
const inputStyle = {
  padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px',
  fontSize: '13px', color: '#1f2937', background: '#fff', outline: 'none',
};
const selectStyle = {
  padding: '6px 28px 6px 10px', border: '1px solid #d1d5db', borderRadius: '6px',
  fontSize: '13px', color: '#1f2937',
  background: `#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath fill='%236b7280' d='M5 7L0 2h10z'/%3E%3C/svg%3E") no-repeat right 8px center`,
  backgroundSize: '10px', appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
  outline: 'none', cursor: 'pointer', minWidth: '68px',
};

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════ */

export default function SimulatePage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [simulationMode,   setSimulationMode]   = useState('quick');
  const [isSimulating,     setIsSimulating]     = useState(false);
  const [progress,         setProgress]         = useState(0);
  const [duration,         setDuration]         = useState(60);
  const [durationUnit,     setDurationUnit]     = useState('minutes');
  const [durationMin,      setDurationMin]      = useState(30);
  const [durationMax,      setDurationMax]      = useState(90);
  const [modelElements,    setModelElements]    = useState([]);
  const [connections,      setConnections]      = useState([]);
  const [globalResources,  setGlobalResources]  = useState(() => {
    try {
      const stored = localStorage.getItem('spot:globalResources');
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.map(res => {
          const defaultRes = DEFAULT_RESOURCES.find(d => d.id === res.id);
          return { ...res, icon: defaultRes ? defaultRes.icon : Box };
        });
      }
    } catch {}
    return DEFAULT_RESOURCES;
  });

  useEffect(() => {
    localStorage.setItem('spot:globalResources', JSON.stringify(globalResources));
  }, [globalResources]);

  const [selectedTask,     setSelectedTask]     = useState(null);
  const [taskAssignments,  setTaskAssignments]  = useState(() => {
    try { return JSON.parse(localStorage.getItem('spot:taskAssignments') || '{}'); } catch { return {}; }
  });
  const [customName,       setCustomName]       = useState('');
  const [customQty,        setCustomQty]        = useState(1);
  const [customType,       setCustomType]       = useState('staff');
  const [editingResource,  setEditingResource]  = useState(null);
  const [showAdd,          setShowAdd]          = useState(false);

  const handleSaveResourceConfig = (updatedRes) => {
    const cleanedRes = { ...updatedRes };
    const t = cleanedRes.type;
    
    cleanedRes.hours_per_day = cleanedRes.hours_per_day !== undefined && cleanedRes.hours_per_day !== null && cleanedRes.hours_per_day !== '' ? Number(cleanedRes.hours_per_day) : null;
    cleanedRes.working_days_per_month = cleanedRes.working_days_per_month !== undefined && cleanedRes.working_days_per_month !== null && cleanedRes.working_days_per_month !== '' ? Number(cleanedRes.working_days_per_month) : null;
    cleanedRes.monthly_salary = cleanedRes.monthly_salary !== undefined && cleanedRes.monthly_salary !== null && cleanedRes.monthly_salary !== '' ? Number(cleanedRes.monthly_salary) : null;
    cleanedRes.purchase_price = cleanedRes.purchase_price !== undefined && cleanedRes.purchase_price !== null && cleanedRes.purchase_price !== '' ? Number(cleanedRes.purchase_price) : null;
    cleanedRes.lifespan_months = cleanedRes.lifespan_months !== undefined && cleanedRes.lifespan_months !== null && cleanedRes.lifespan_months !== '' ? Number(cleanedRes.lifespan_months) : null;
    cleanedRes.monthly_running_cost = cleanedRes.monthly_running_cost !== undefined && cleanedRes.monthly_running_cost !== null && cleanedRes.monthly_running_cost !== '' ? Number(cleanedRes.monthly_running_cost) : null;
    cleanedRes.monthly_rent = cleanedRes.monthly_rent !== undefined && cleanedRes.monthly_rent !== null && cleanedRes.monthly_rent !== '' ? Number(cleanedRes.monthly_rent) : null;

    if (t === 'staff') {
      cleanedRes.purchase_price = null;
      cleanedRes.lifespan_months = null;
      cleanedRes.monthly_running_cost = null;
      cleanedRes.monthly_rent = null;
    } else if (t === 'equipment' || t === 'vehicle') {
      cleanedRes.monthly_salary = null;
      cleanedRes.monthly_rent = null;
    } else if (t === 'facility') {
      cleanedRes.working_days_per_month = null;
      cleanedRes.monthly_salary = null;
      cleanedRes.monthly_running_cost = null;
      if (cleanedRes.isRented) {
        cleanedRes.purchase_price = null;
        cleanedRes.lifespan_months = null;
      } else {
        cleanedRes.monthly_rent = null;
      }
    }

    setGlobalResources(prev => prev.map(r => r.id === cleanedRes.id ? cleanedRes : r));
    setEditingResource(null);
  };
  const [validationErrors, setValidationErrors] = useState([]);
  const [backendRunning,   setBackendRunning]   = useState(false);
  const [backendError,     setBackendError]     = useState(null);
  const [backendDone,      setBackendDone]      = useState(false);
  const [simResults,       setSimResults]       = useState(null);
  const [totalInstances,   setTotalInstances]   = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('spot:totalInstances');
        if (stored && !isNaN(Number(stored)) && Number(stored) > 0) return Number(stored);
        const cfg = JSON.parse(localStorage.getItem('spot:simulationConfig') || '{}');
        if (cfg.total_instances) return Number(cfg.total_instances);
      } catch {}
    }
    return 500;
  });
  const [arrivalRate,      setArrivalRate]      = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('spot:arrivalRate');
        if (stored && !isNaN(Number(stored)) && Number(stored) > 0) return Number(stored);
        const cfg = JSON.parse(localStorage.getItem('spot:simulationConfig') || '{}');
        if (cfg.arrival_rate) return Number(cfg.arrival_rate);
      } catch {}
    }
    return 0.1;
  });
  const [arrivalValue,     setArrivalValue]     = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const storedVal = localStorage.getItem('spot:arrivalValue');
        if (storedVal && !isNaN(Number(storedVal)) && Number(storedVal) > 0) return Number(storedVal);
        const cfg = JSON.parse(localStorage.getItem('spot:simulationConfig') || '{}');
        if (cfg.arrival_gap_minutes) return Number(cfg.arrival_gap_minutes);
        if (cfg.arrival_rate) return Number((1 / cfg.arrival_rate).toFixed(2));
      } catch {}
    }
    return 10;
  });
  const [arrivalUnit,      setArrivalUnit]      = useState('minutes'); // 'seconds', 'minutes', 'hours', 'days'

  useEffect(() => {
    const val = parseFloat(arrivalValue);
    if (isNaN(val) || val <= 0) {
      setArrivalRate(0);
      return;
    }
    const unitMultipliers = {
      seconds: 1 / 60,
      minutes: 1,
      hours: 60,
      days: 1440
    };
    const mult = unitMultipliers[arrivalUnit] || 1;
    setArrivalRate(1 / (val * mult));
  }, [arrivalValue, arrivalUnit]);

  const [leftSidebarWidth, setLeftSidebarWidth] = useState(248);
  const startLeftResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = leftSidebarWidth;
    const onMove = (me) => setLeftSidebarWidth(Math.max(200, Math.min(500, startW + (me.clientX - startX))));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const containerRef = useRef(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [manualZoom, setManualZoom] = useState(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [setupOpen, setSetupOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  const [rightSidebarWidth, setRightSidebarWidth] = useState(288);
  const startRightResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rightSidebarWidth;
    const onMove = (me) => setRightSidebarWidth(Math.max(200, Math.min(600, startW - (me.clientX - startX))));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const simTimerRef = useRef(null);

  const engine = useConcurrentTokenEngine({
    modelElements, connections, simResults,
    isRunning: isSimulating,
    arrivalRate,
  });

  useEffect(() => {
    const { nodes, connections: conns } = readModelFromStorage();
    setModelElements(nodes || []);
    setConnections(conns || []);
  }, []);

  useEffect(() => {
    if (!modelElements.length) { setTaskAssignments({}); return; }
    const tasks = modelElements.filter(el => el.type === 'task' || el.type === 'subprocess');
    setTaskAssignments(prev => {
      const next = {};
      tasks.forEach(task => {
        const p = prev[task.id] || {};
        // Also check the task's own data.resources as a fallback source of truth
        const taskResMap = task.data?.resources || {};
        next[task.id] = {};
        globalResources.forEach(r => {
          const fromPrev = p[r.id];
          // If the node's data.resources already has this key enabled, respect that
          const fromNode = taskResMap[r.payloadKey] != null || taskResMap[r.id] != null;
          const qty = fromPrev?.quantity ?? taskResMap[r.payloadKey] ?? taskResMap[r.id] ?? 1;
          const enabled = fromPrev?.enabled ?? fromNode;
          next[task.id][r.id] = { enabled, quantity: qty };
        });
      });
      return next;
    });
  }, [modelElements, globalResources]);

  useEffect(() => () => { clearInterval(simTimerRef.current); }, []);

  const startProgressTicker = useCallback((onComplete) => {
    let val = 0;
    simTimerRef.current = setInterval(() => {
      val += 1.2;
      if (val >= 100) {
        val = 100;
        clearInterval(simTimerRef.current);
        setIsSimulating(false);
        engine.stop();
        onComplete?.();
      }
      setProgress(val);
    }, 120);
  }, [engine]);

  const handleRun = useCallback(async () => {
    const errs = validateModel(modelElements, connections, globalResources, simulationMode, arrivalRate);
    setValidationErrors(errs);
    if (errs.length) return;

    setBackendRunning(true);
    setBackendError(null);
    setBackendDone(false);

    try {
      const title = localStorage.getItem('spot:processTitle') || 'Untitled Process';
      const elementsToSave = modelElements.map(el => {
        if (el.type === 'task' || el.type === 'subprocess') {
          const assignments = taskAssignments[el.id] || {};

          const resourcesDict = {};
          Object.entries(assignments).forEach(([resId, asgn]) => {
            if (asgn.enabled) {
              const globalRes = globalResources.find(r => r.id === resId || r.displayName === resId || r.name === resId);
              const nameKey = globalRes?.displayName || globalRes?.name || globalRes?.payloadKey || resId;
              resourcesDict[nameKey] = asgn.quantity;
            }
          });

          // Fall back to diagram's el.data.resources or el.data.resource if no right-panel checkboxes were modified
          if (Object.keys(resourcesDict).length === 0) {
            if (el.data?.resources && typeof el.data.resources === 'object') {
              Object.entries(el.data.resources).forEach(([k, qty]) => {
                const globalRes = globalResources.find(r => r.id === k || r.displayName === k || r.name === k);
                const nameKey = globalRes?.displayName || globalRes?.name || globalRes?.payloadKey || (k && !k.startsWith('res_') ? k : null);
                if (nameKey) {
                  resourcesDict[nameKey] = qty || 1;
                }
              });
            }
            if (Object.keys(resourcesDict).length === 0 && el.data?.resource) {
              const rawRes = el.data.resource;
              const globalRes = globalResources.find(r => r.id === rawRes || r.displayName === rawRes || r.name === rawRes);
              const nameKey = globalRes?.displayName || globalRes?.name || globalRes?.payloadKey || (rawRes && !rawRes.startsWith('res_') ? rawRes : null);
              if (nameKey) {
                resourcesDict[nameKey] = 1;
              }
            }
          }

          const primaryResource = Object.keys(resourcesDict)[0] || null;

          return {
            ...el,
            data: {
              ...(el.data || {}),
              duration:      el.data?.duration ?? null,
              duration_min:  el.data?.duration_min ?? null,
              duration_max:  el.data?.duration_max ?? null,
              duration_unit: el.data?.duration_unit ?? durationUnit,
              resource:      primaryResource,
              resources:     resourcesDict,
            },
          };
        }
        return el;
      });

      const effectiveResources = globalResources.map(r => ({
        ...r,
        id: r.displayName || r.name || r.id,
        name: r.displayName || r.name || r.id,
      }));
      elementsToSave.forEach(el => {
        if (el.type === 'task' || el.type === 'subprocess') {
          const r = el.data?.resource;
          if (r && !effectiveResources.find(gr => gr.displayName === r || gr.name === r || gr.id === r)) {
            effectiveResources.push({ id: r, name: r, displayName: r, quantity: 1 });
          }
        }
      });

      // If this model was already saved to the backend (spot:processId exists),
      // update that same process instead of creating a duplicate one each run.
      // Creating a new process every time silently orphans any scenarios that
      // were built against the previous process ID, which is why What-If
      // comparisons on the Results page would go missing after re-running here.
      const existingProcessId = localStorage.getItem('spot:processId');
      const saved = existingProcessId
        ? await updateProcess(existingProcessId, elementsToSave, connections, title, effectiveResources)
        : await saveProcess(elementsToSave, connections, title, effectiveResources);

      const processId = saved?.process?._id || saved?.process?.id || saved?._id || saved?.id || existingProcessId;
      if (!processId) { setBackendError('Saved but no process ID returned.'); setBackendRunning(false); return; }
      localStorage.setItem('spot:processId', processId);

      const simConfig = simulationMode === 'quick'
        ? { mode: 'quick', duration, duration_unit: durationUnit, total_instances: totalInstances, arrival_rate: arrivalRate }
        : { mode: 'deep', duration_min: durationMin, duration_max: durationMax, duration_unit: durationUnit, total_instances: totalInstances, arrival_rate: arrivalRate };

      const res     = await runSimulation(processId, simConfig);
      const results = res.results || res;
      results.mode  = simulationMode;
      results.arrival_rate = arrivalRate; // cases per minute — Results page uses it for capacity vs arrival
      localStorage.setItem('spot:simulationResults', JSON.stringify(results));
      // This is a fresh run of the baseline model — keep it in sync as "the"
      // baseline for What-If comparisons, and clear any stale what-if flag so
      // the Results page doesn't show an old comparison against this new run.
      localStorage.setItem('spot:baselineResults', JSON.stringify(results));
      localStorage.setItem('spot:hasWhatIfResults', 'false');
      setSimResults(results);
      setBackendDone(true);

      setProgress(0);
      setIsSimulating(true);
      engine.start();
      startProgressTicker(() => {
        // Simulation done — user can click "View Results" when ready (no auto-redirect)
      });

    } catch (err) {
      setBackendError(err.message || 'Simulation failed. Check your process and try again.');
    } finally {
      setBackendRunning(false);
    }
  }, [simulationMode, duration, durationUnit, durationMin, durationMax, totalInstances, arrivalRate,
      globalResources, modelElements, connections, taskAssignments, engine, startProgressTicker, navigate]);

  const handlePause = () => {
    clearInterval(simTimerRef.current);
    engine.stop();
    setIsSimulating(false);
  };

  const handleReset = () => {
    clearInterval(simTimerRef.current);
    engine.reset();
    setIsSimulating(false);
    setProgress(0);
    setDuration(60); setDurationUnit('minutes'); setDurationMin(30); setDurationMax(90);
    setTotalInstances(500);
    setBackendDone(false); setBackendError(null); setValidationErrors([]);
  };

  const handleCancel = () => {
    clearInterval(simTimerRef.current);
    engine.reset();
    setIsSimulating(false);
    setProgress(0);
    setBackendRunning(false);
    setBackendDone(false);
  };

  const autorunDoneRef = useRef(false);
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    if (query.get('autorun') === 'true' && modelElements.length > 0 && !autorunDoneRef.current) {
      autorunDoneRef.current = true;
      navigate(location.pathname, { replace: true });
      setTimeout(() => {
        handleRun();
      }, 100);
    }
  }, [location.search, modelElements, handleRun, navigate, location.pathname]);

  const updateResourceQty = (id, val) =>
    setGlobalResources(prev => prev.map(r => r.id === id ? { ...r, quantity: val } : r));

  const deleteGlobalResource = (id) =>
    setGlobalResources(prev => prev.filter(r => r.id !== id));

  const addCustomResource = () => {
    const name = customName.trim(); if (!name) return;
    const id   = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (globalResources.some(r => r.id === id)) return;
    const newRes = {
      id,
      payloadKey: id,
      icon: Box,
      displayName: name,
      name: name,
      type: customType,
      quantity: toPositiveInt(customQty, 1),
      hours_per_day: customType === 'facility' ? 12 : 8,
      monthly_salary: customType === 'staff' ? 50000 : null,
      purchase_price: (customType === 'equipment' || customType === 'vehicle') ? 45000 : null,
      lifespan_months: (customType === 'equipment' || customType === 'vehicle') ? 36 : null,
      monthly_running_cost: (customType === 'equipment' || customType === 'vehicle') ? 500 : null,
      monthly_rent: customType === 'facility' ? 80000 : null,
      isRented: customType === 'facility' ? true : undefined
    };
    setGlobalResources(prev => [...prev, newRes]);
    setCustomName(''); setCustomQty(1); setCustomType('staff');
  };

  const updateTaskAssignment = (taskId, resourceId, patch) => {
    setTaskAssignments(prev => {
      const next = { ...prev, [taskId]: { ...prev[taskId], [resourceId]: { ...prev[taskId]?.[resourceId], ...patch } } };
      localStorage.setItem('spot:taskAssignments', JSON.stringify(next));

      // Also write resource into the node's data in spot:model:nodes so it's
      // available when elementsToSave is built on Run Simulation.
      // Use globalResources (includes custom ones) not DEFAULT_RESOURCES.
      setModelElements(els => {
        const assignments = next[taskId] || {};
        const resourcesDict = {};
        Object.entries(assignments).forEach(([resId, asgn]) => {
          if (asgn?.enabled) {
            // Look up in full globalResources state first, fall back to resId
            const globalRes = globalResources.find(r => r.id === resId);
            const key = globalRes?.payloadKey || globalRes?.id || resId;
            resourcesDict[key] = asgn.quantity ?? 1;
          }
        });
        const primaryResource = Object.keys(resourcesDict)[0] || null;
        const updated = els.map(el => el.id === taskId
          ? { ...el, data: { ...(el.data || {}), resource: primaryResource, resources: resourcesDict } }
          : el
        );
        const existing = (() => { try { return JSON.parse(localStorage.getItem('spot:model:nodes') || '{}'); } catch { return {}; } })();
        localStorage.setItem('spot:model:nodes', JSON.stringify({ ...existing, nodes: updated, connections: existing.connections || [] }));
        return updated;
      });

      return next;
    });
  };

  const updateTaskProperty = (taskId, key, value) => {
    setModelElements(prev => {
      const next = prev.map(el => el.id === taskId ? { ...el, data: { ...(el.data || {}), [key]: value } } : el);
      // Persist back to localStorage so data survives page reload and is
      // present when elementsToSave is built on Run Simulation
      const existing = (() => { try { return JSON.parse(localStorage.getItem('spot:model:nodes') || '{}'); } catch { return {}; } })();
      localStorage.setItem('spot:model:nodes', JSON.stringify({ ...existing, nodes: next, connections: existing.connections || [] }));
      return next;
    });
    if (selectedTask?.id === taskId) setSelectedTask(prev => ({ ...prev, data: { ...(prev.data || {}), [key]: value } }));
  };

  const updateConnectionProbability = (fromId, toId, probability) => {
    setConnections(prev => {
      const next = prev.map(c => 
        ((c.from ?? c.fromId) === fromId && (c.to ?? c.toId) === toId) 
          ? { ...c, probability } 
          : c
      );
      const existing = (() => { try { return JSON.parse(localStorage.getItem('spot:model:nodes') || '{}'); } catch { return {}; } })();
      localStorage.setItem('spot:model:nodes', JSON.stringify({ ...existing, connections: next }));
      return next;
    });
  };

  const { tokens, activeEdgeSet, processingSet, waitingSet, activeDwellSet } = engine;

  const simEls = modelElements.filter(el => !VISUAL_ONLY_TYPES.has(el.type));

  const totalResources = globalResources.reduce((s, r) => s + (parseInt(r.quantity, 10) || 0), 0);
  const hasToast       = validationErrors.length > 0 || backendError || (backendDone && !backendError);

  // Live utilization estimate — warns when arrival rate exceeds resource capacity
  const utilizationWarning = useMemo(() => {
    const tasks = modelElements.filter(el => el.type === 'task' || el.type === 'subprocess');
    if (!tasks.length) return null;
    // Estimate average service time per case (sum of all task midpoints in minutes)
    let totalServiceMin = 0;
    tasks.forEach(el => {
      const d = el.data || {};
      const unit = d.duration_unit || 'minutes';
      const mult = unit === 'seconds' ? 1/60 : unit === 'hours' ? 60 : unit === 'days' ? 1440 : unit === 'weeks' ? 10080 : unit === 'months' ? 43200 : 1;
      const dur = d.duration_min != null && d.duration_max != null
        ? (Number(d.duration_min) + Number(d.duration_max)) / 2 * mult
        : (d.duration != null ? Number(d.duration) * mult : 0);
      totalServiceMin += dur;
    });
    if (totalServiceMin <= 0) return null;
    // Staff is the shared resource; use its quantity as the server count
    const staffRes = globalResources.find(r => r.id === 'staff');
    const staffEnabled = tasks.some(t => {
      const assignments = taskAssignments[t.id] || {};
      return Object.values(assignments).some(a => a.enabled);
    });
    if (!staffEnabled) return null;
    const staffQty = staffRes ? toPositiveInt(staffRes.quantity, 1) : 1;
    // utilization = (arrival_rate cases/min × service_time min/case) / servers
    const utilization = (arrivalRate * totalServiceMin) / staffQty;
    if (utilization > 0.85) {
      return {
        pct: Math.round(utilization * 100),
        overloaded: utilization >= 1.0,
        safeRate: Math.floor((staffQty * 0.8) / totalServiceMin * 10) / 10,
      };
    }
    return null;
  }, [modelElements, globalResources, taskAssignments, arrivalRate]);

  const bottleneckNodeId = useMemo(() => {
    if (!tokens.length) return null;
    const counts = {};
    tokens.filter(t => t.state === STATE.WAITING && t.dwellNode).forEach(t => {
      counts[t.dwellNode] = (counts[t.dwellNode] || 0) + 1;
    });
    const entries = Object.entries(counts);
    if (!entries.length) return null;
    return entries.sort((a, b) => b[1] - a[1])[0][0];
  }, [tokens]);

  /* ─────────────────────────────────────────────────────────────
     FIT VIEW & ZOOM CONTROLS
     Auto-fit on load matches Model page fitView logic.
  ───────────────────────────────────────────────────────────────*/
  const fitView = useCallback(() => {
    if (!modelElements.length || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    modelElements.forEach(el => {
      const w = el.width || NW, h = el.height || NH;
      minX = Math.min(minX, el.position?.x ?? 0);
      minY = Math.min(minY, el.position?.y ?? 0);
      maxX = Math.max(maxX, (el.position?.x ?? 0) + w);
      maxY = Math.max(maxY, (el.position?.y ?? 0) + h);
    });
    const pad = 80, dw = maxX - minX + pad * 2, dh = maxY - minY + pad * 2;
    const nz = Math.min(3, Math.max(0.15, Math.min(rect.width / dw, rect.height / dh)));
    setZoomScale(nz);
    setPan({
      x: (rect.width - dw * nz) / 2 + pad * nz - minX * nz,
      y: (rect.height - dh * nz) / 2 + pad * nz - minY * nz,
    });
  }, [modelElements]);

  const pendingFitRef = useRef(true);
  useEffect(() => {
    if (!pendingFitRef.current) return;
    if (!modelElements.length || !containerRef.current) return;
    const id = requestAnimationFrame(() => {
      fitView();
      pendingFitRef.current = false;
    });
    return () => cancelAnimationFrame(id);
  }, [modelElements, fitView]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      if (manualZoom === null) {
        fitView();
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [fitView, manualZoom]);

  const zoomToCenter = useCallback((factor) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mx = rect.width / 2;
    const my = rect.height / 2;
    setZoomScale(z => {
      const nz = Math.min(3, Math.max(0.15, z * factor));
      setPan(p => ({
        x: mx - (mx - p.x) * (nz / z),
        y: my - (my - p.y) * (nz / z),
      }));
      return nz;
    });
  }, []);

  const handleZoomIn = () => {
    zoomToCenter(1.15);
    setManualZoom(true);
  };
  const handleZoomOut = () => {
    zoomToCenter(0.85);
    setManualZoom(true);
  };
  const handleZoom100 = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mx = rect.width / 2;
    const my = rect.height / 2;
    setZoomScale(z => {
      const nz = 1;
      setPan(p => ({
        x: mx - (mx - p.x) * (nz / z),
        y: my - (my - p.y) * (nz / z),
      }));
      return nz;
    });
    setManualZoom(true);
  };
  const handleZoomAuto = () => {
    setManualZoom(null);
    fitView();
  };
  const handleZoomFit = () => {
    fitView();
    setManualZoom(true);
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheelHandler = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        setZoomScale(z => {
          const nz = Math.min(3, Math.max(0.15, z * factor));
          setPan(p => ({
            x: mx - (mx - p.x) * (nz / z),
            y: my - (my - p.y) * (nz / z),
          }));
          return nz;
        });
        setManualZoom(true);
      } else {
        setPan(p => ({
          x: p.x - e.deltaX,
          y: p.y - e.deltaY,
        }));
      }
    };
    el.addEventListener('wheel', onWheelHandler, { passive: false });
    return () => el.removeEventListener('wheel', onWheelHandler);
  }, []);

  const onCanvasMouseDown = (e) => {
    if (e.target.closest('button, input, select, textarea')) return;
    if (e.button === 0 || e.button === 1) {
      setIsPanning(true);
      panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }
  };

  const onCanvasMouseMove = (e) => {
    if (!isPanning) return;
    setPan({
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y,
    });
  };

  const onCanvasMouseUp = () => {
    setIsPanning(false);
  };

  const getArrivalExplanation = () => {
    const val = parseFloat(arrivalValue);
    if (isNaN(val) || val <= 0) return "Please enter a positive arrival frequency.";

    const unitMultipliers = {
      seconds: 1 / 60,
      minutes: 1,
      hours: 60,
      days: 1440
    };
    const mult = unitMultipliers[arrivalUnit] || 1;
    const minsBetween = val * mult;

    const casesPerHour = 60 / minsBetween;
    const casesPerDay = 1440 / minsBetween;

    let eqText = "";
    if (minsBetween < 1) {
      eqText = `~${(1 / minsBetween).toFixed(1)} cases/min`;
    } else if (minsBetween >= 1440) {
      eqText = `~${casesPerDay.toFixed(1)} cases/day`;
    } else {
      eqText = `~${casesPerHour.toFixed(1)} cases/hr`;
    }
    const unitSingular = val === 1 ? arrivalUnit.slice(0, -1) : (arrivalUnit === 'seconds' ? 'seconds' : arrivalUnit);
    return `On average, 1 case enters every ${val} ${unitSingular} (${eqText}).`;
  };

  return (
    <>
      <style>{`
        @keyframes spin      { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes slideDown { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse     { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>

      {/* ── Error Modal Popup ── */}
      {validationErrors.length > 0 && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(17, 24, 39, 0.4)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{
            background: '#fff', borderRadius: 12, padding: '24px', width: '420px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ background: '#fef3c7', padding: 8, borderRadius: '50%', display: 'flex' }}>
                  <AlertCircle size={20} style={{ color: '#d97706' }} />
                </div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111827' }}>Simulation Issues</h3>
              </div>
              <button onClick={() => setValidationErrors([])} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}>
                <X size={18} style={{ color: '#9ca3af' }}/>
              </button>
            </div>
            
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#4b5563' }}>Please fix the following issues before running the simulation:</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '300px', overflowY: 'auto' }}>
              {validationErrors.map((err, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, padding: '12px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', background: '#d1d5db',
                    color: '#4b5563', fontSize: 11, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                  }}>
                    {i + 1}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 2 }}>{err.title}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.4 }}>{err.message}</div>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={() => setValidationErrors([])} style={{
              width: '100%', marginTop: 20, padding: '10px', background: '#0ea5e9', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(14, 165, 233, 0.2)'
            }}>
              Got it
            </button>
          </div>
        </div>
      )}

      {/* ── Notification Banner ── */}
      {hasToast && !validationErrors.length && (
        <div style={{ width: '100%', padding: '8px 12px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {backendError && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, borderRadius: 8, border: '1px solid #fca5a5', background: '#fef2f2', padding: '10px 14px' }}>
              <AlertCircle size={14} style={{ color: '#ef4444', flexShrink: 0, marginTop: 2 }}/>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 2px', fontSize: 12, fontWeight: 700, color: '#991b1b' }}>Simulation failed</p>
                <p style={{ margin: 0, fontSize: 11, color: '#b91c1c' }}>{backendError}</p>
              </div>
              <button onClick={() => setBackendError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                <X size={13} style={{ color: '#ef4444' }}/>
              </button>
            </div>
          )}
          {backendDone && !backendError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderRadius: 8, border: '1px solid #6ee7b7', background: '#ecfdf5', padding: '10px 14px' }}>
              <CheckCircle2 size={14} style={{ color: '#10b981', flexShrink: 0 }}/>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#065f46' }}>Simulation complete — starting animation…</p>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', background: '#f3f4f6', gap: 12, padding: 12 }}>

        {/* ══════════════ LEFT SIDEBAR ══════════════ */}
        {setupOpen && (
        <div style={{ display: 'flex', position: 'relative' }}>
          <aside style={{
            width: leftSidebarWidth, flexShrink: 0, display: 'flex', flexDirection: 'column',
            overflow: 'hidden', borderRadius: 12, border: '1px solid #e5e7eb',
            background: '#ffffff', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.07)',
          }}>
          <div style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid #f0f9ff', background: 'linear-gradient(to right,#f0f9ff,#ecfeff)',
            padding: '14px 16px'
          }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#111827' }}>Simulation Setup</h2>
              <p style={{ margin: '3px 0 0', fontSize: 11, color: '#6b7280' }}>{totalResources} resource{totalResources !== 1 ? 's' : ''} configured</p>
            </div>
            <button
              onClick={() => setSetupOpen(false)}
              style={{ padding: 6, background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 8 }}
            >
              <X size={16} style={{ color: '#6b7280' }}/>
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* Mode */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f3f4f6' }}>
              <label style={labelStyle}>Detail Level</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[{ id: 'quick', label: 'Quick' }, { id: 'deep', label: 'Detailed' }].map(m => (
                  <button key={m.id} type="button" onClick={() => setSimulationMode(m.id)} style={{
                    flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                    border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                    background: simulationMode === m.id ? '#0284c7' : '#f3f4f6',
                    color:      simulationMode === m.id ? '#fff'     : '#4b5563',
                    boxShadow:  simulationMode === m.id ? '0 1px 3px rgba(2,132,199,0.4)' : 'none',
                  }}>{m.label}</button>
                ))}
              </div>
            </div>

            {/* Concurrency Config */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f3f4f6', background: '#fafbff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <Zap size={11} style={{ color: '#6366f1' }}/>
                <label style={{ ...labelStyle, color: '#6366f1', margin: 0 }}>Traffic</label>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Max Cases slider */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>Total Cases</label>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#4f46e5' }}>{totalInstances}</span>
                  </div>
                  <input type="range" min={50} max={2000} step={50}
                    value={totalInstances}
                    onChange={e => setTotalInstances(Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#6366f1', cursor: 'pointer' }}/>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                    <span style={{ fontSize: 9, color: '#cbd5e1' }}>Fast (50)</span>
                    <span style={{ fontSize: 9, color: '#cbd5e1' }}>Accurate (2,000)</span>
                  </div>
                </div>

                {/* Simplified Arrival Frequency Panel */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Arrival Frequency
                    </label>
                  </div>
                  
                  {/* Input Fields Row */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="number"
                      min="0.001"
                      step="any"
                      value={arrivalValue}
                      onChange={e => setArrivalValue(e.target.value)}
                      placeholder="e.g. 10"
                      style={{
                        ...inputStyle,
                        flex: 1,
                        padding: '6px 8px',
                        fontSize: 12,
                        minWidth: 0,
                      }}
                    />
                    <select
                      value={arrivalUnit}
                      onChange={e => setArrivalUnit(e.target.value)}
                      style={{
                        ...selectStyle,
                        padding: '6px 20px 6px 8px',
                        fontSize: 12,
                        minWidth: 85,
                      }}
                    >
                      <option value="seconds">Seconds</option>
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                    </select>
                  </div>

                  {/* Real-time Explanation */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 6,
                    padding: '8px 10px',
                    background: '#f0f9ff',
                    borderLeft: '3px solid #0284c7',
                    borderRadius: 4,
                    fontSize: 11,
                    color: '#0369a1',
                    lineHeight: '1.4'
                  }}>
                    <Info size={13} style={{ marginTop: 2, flexShrink: 0 }} />
                    <div style={{ wordBreak: 'break-word' }}>{getArrivalExplanation()}</div>
                  </div>

                  {/* Presets */}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 9, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Presets:</span>
                    <button
                      type="button"
                      onClick={() => { setArrivalValue(1); setArrivalUnit('hours'); }}
                      style={{
                        fontSize: 9,
                        background: '#f3f4f6',
                        border: '1px solid #e5e7eb',
                        borderRadius: 4,
                        padding: '3px 8px',
                        cursor: 'pointer',
                        color: '#4b5563',
                        fontWeight: 500,
                      }}
                    >
                      Quiet (1 case/hr)
                    </button>
                    <button
                      type="button"
                      onClick={() => { setArrivalValue(10); setArrivalUnit('minutes'); }}
                      style={{
                        fontSize: 9,
                        background: '#f3f4f6',
                        border: '1px solid #e5e7eb',
                        borderRadius: 4,
                        padding: '3px 8px',
                        cursor: 'pointer',
                        color: '#4b5563',
                        fontWeight: 500,
                      }}
                    >
                      Normal (10 min)
                    </button>
                    <button
                      type="button"
                      onClick={() => { setArrivalValue(30); setArrivalUnit('seconds'); }}
                      style={{
                        fontSize: 9,
                        background: '#f3f4f6',
                        border: '1px solid #e5e7eb',
                        borderRadius: 4,
                        padding: '3px 8px',
                        cursor: 'pointer',
                        color: '#4b5563',
                        fontWeight: 500,
                      }}
                    >
                      Busy (30 sec)
                    </button>
                  </div>
                </div>

              </div>
            </div>

            {/* Resources Pool */}
            <div style={{ padding: '14px 16px' }}>
              <label style={labelStyle}>Global Resources</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                {globalResources.map(resource => {
                  const Icon = resource.icon || Box;
                  const resLabel = resource.displayName || resource.name || resource.id || 'Staff / Specialist';
                  return (
                    <div key={resource.id || resLabel} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', borderRadius: 10,
                      background: '#fff', border: '1px solid #e5e7eb',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                    }}>
                      <Icon style={{ width: 15, height: 15, color: '#9ca3af', flexShrink: 0 }}/>
                      <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {resLabel}
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                        <input type="number" min="0" value={resource.quantity}
                          onChange={e => updateResourceQty(resource.id, e.target.value)}
                          style={{ width: 48, padding: '4px 6px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12, textAlign: 'center', background: '#f9fafb', outline: 'none' }}/>
                        <span style={{ fontSize: 9, color: '#9ca3af' }}>available</span>
                      </div>
                      <button type="button" onClick={() => deleteGlobalResource(resource.id)} style={{ padding: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center' }}>
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}

                <button type="button" onClick={() => setShowAdd(!showAdd)}
                  style={{ width: '100%', padding: 8, marginTop: 4, background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, color: '#0284c7', fontWeight: 500, borderRadius: 8 }}>
                  + Add custom resource
                </button>

                {showAdd && (
                  <div style={{ padding: 12, border: '1.5px dashed #d1d5db', borderRadius: 8, background: '#f9fafb', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input value={customName} onChange={e => setCustomName(e.target.value)} placeholder="Resource name"
                      style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, color: '#1f2937', background: '#fff', outline: 'none', boxSizing: 'border-box' }}/>
                    <select value={customType} onChange={e => setCustomType(e.target.value)}
                      style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, color: '#1f2937', background: '#fff', outline: 'none' }}>
                      <option value="staff">Staff / Employee</option>
                      <option value="equipment">Equipment / Machine</option>
                      <option value="vehicle">Vehicle / Van</option>
                      <option value="facility">Facility</option>
                    </select>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="number" min="1" value={customQty} onChange={e => setCustomQty(toPositiveInt(e.target.value, 1))}
                        style={{ flex: 1, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, outline: 'none' }}/>
                      <button type="button" onClick={addCustomResource}
                        style={{ flex: 1, padding: 6, background: '#0284c7', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        Add
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ padding: '14px 16px', borderTop: '1px solid #e5e7eb', background: '#f9fafb', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {!isSimulating ? (
                <button onClick={handleRun} disabled={backendRunning || !modelElements.length} style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, border: 'none',
                  borderBottom: modelElements.length && !backendRunning ? '2px solid #166534' : '2px solid #d1d5db',
                  background: modelElements.length && !backendRunning ? '#16a34a' : '#e5e7eb',
                  color:      modelElements.length && !backendRunning ? '#fff' : '#9ca3af',
                  cursor:     modelElements.length && !backendRunning ? 'pointer' : 'not-allowed',
                  boxShadow:  modelElements.length && !backendRunning ? '0 2px 6px rgba(22,163,74,0.25)' : 'none',
                  transition: 'all 0.15s',
                }}>
                  {backendRunning
                    ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }}/> Running…</>
                    : <><Play size={13} style={{ fill: 'currentColor' }}/> Run Simulation</>
                  }
                </button>
              ) : (
                <button onClick={handlePause} style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  border: 'none', borderBottom: '2px solid #92400e',
                  background: '#f59e0b', color: '#fff', cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(245,158,11,0.25)',
                }}>
                  <Pause size={13} style={{ fill: 'currentColor' }}/> Pause
                </button>
              )}
              <button onClick={handleReset} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '8px 10px', borderRadius: 8,
                border: '1.5px solid #e5e7eb', background: '#fff', color: '#6b7280',
                cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              }}>
                <RotateCcw size={14} strokeWidth={2.5}/>
              </button>
            </div>

            {progress > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 6 }}>
                  <span style={{ color: '#6b7280' }}>Progress</span>
                  <span style={{ fontWeight: 600, color: '#374151' }}>{Math.round(progress)}%</span>
                </div>
                <div style={{ width: '100%', background: '#e5e7eb', borderRadius: 9999, height: 8 }}>
                  <div style={{
                    background: 'linear-gradient(to right,#10b981,#14b8a6)',
                    height: 8, borderRadius: 9999, transition: 'width 0.3s',
                    width: `${progress}%`,
                  }}/>
                </div>
              </div>
            )}
          </div>
        </aside>
        <div
          onMouseDown={startLeftResize}
          style={{ width: 12, cursor: 'col-resize', position: 'absolute', right: -6, top: 0, bottom: 0, zIndex: 10 }}
        />
      </div>
      )}
        {/* ══════════════ MAIN CANVAS ══════════════ */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', minWidth: 0, minHeight: 0 }}>
          <div 
            ref={containerRef}
            onMouseDown={onCanvasMouseDown}
            onMouseMove={onCanvasMouseMove}
            onMouseUp={onCanvasMouseUp}
            style={{
              flex: 1, position: 'relative', background: '#f8fafc',
              borderRadius: 16, border: '1px solid rgba(229,231,235,0.8)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              overflow: 'hidden',
              userSelect: 'none',
              cursor: isPanning ? 'grabbing' : 'default',
              backgroundImage: 'radial-gradient(circle, #d4d4d8 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
          >
            {modelElements.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', width: '100%', height: '100%', gap: 12 }}>
                <span style={{ fontSize: 36 }}>🗺️</span>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#374151', margin: 0 }}>No process found</p>
                <p style={{ fontSize: 12, color: '#9ca3af', margin: 0, textAlign: 'center', maxWidth: 260 }}>
                  Go to the <strong>Model</strong> page first to draw your process, then come back here to run the simulation.
                </p>
              </div>
            ) : (
              <>
                {(isSimulating || backendRunning) && (
                  <button
                    onClick={handleCancel}
                    style={{
                      position: 'absolute', top: 16, right: 16, zIndex: 50,
                      background: '#d9534f', color: '#fff', border: 'none',
                      padding: '10px 24px', borderRadius: 6, fontSize: 13,
                      fontWeight: 600, cursor: 'pointer',
                      boxShadow: '0 2px 5px rgba(217, 83, 79, 0.4)',
                    }}
                  >
                    Cancel
                  </button>
                )}

                <DiagramCanvas
                  readOnly={true}
                  elements={modelElements}
                  connections={connections}
                  zoom={zoomScale}
                  pan={pan}
                  selectedId={selectedTask?.id}
                  activeEdgeSet={activeEdgeSet}
                  onNodeClick={(el) => {
                    const isTask = el.type === 'task' || el.type === 'subprocess';
                    const isGateway = el.type.includes('gateway');
                    if (isTask || isGateway) {
                      setSelectedTask(el);
                      setDetailsOpen(true);
                    }
                  }}
                  onNodeDoubleClick={(el) => {
                    const isTask = el.type === 'task' || el.type === 'subprocess';
                    const isGateway = el.type.includes('gateway');
                    if (isTask || isGateway) {
                      setSelectedTask(el);
                      setDetailsOpen(true);
                    }
                  }}
                  onCanvasClick={() => {
                    setSelectedTask(null);
                  }}
                  renderNodeOverlay={(el, { isSel, nodeW, nodeH }) => (
                    <>
                      {/* Bottleneck animated ring */}
                      {el.id === bottleneckNodeId && isSimulating && (
                        <foreignObject x="-8" y="-8" width={nodeW + 16} height={nodeH + 16} style={{ pointerEvents: 'none', overflow: 'visible' }}>
                          <div style={{
                            width: nodeW + 16, height: nodeH + 16,
                            borderRadius: (el.type === 'task' || el.type === 'subprocess') ? 14 : '50%',
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '2px dashed rgba(239, 68, 68, 0.5)',
                            animation: 'spin 8s linear infinite',
                          }}/>
                        </foreignObject>
                      )}

                      {/* Dwell token count badge */}
                      {(() => {
                        const count = tokens.filter(t => t.dwellNode === el.id).length;
                        if (count <= 0) return null;
                        const isProcessing = processingSet.has(el.id);
                        const isWaiting = waitingSet.has(el.id);
                        return (
                          <foreignObject x={nodeW - 10} y="-6" width="28" height="28" style={{ pointerEvents: 'none', overflow: 'visible' }}>
                            <div style={{
                              minWidth: 18, height: 18, borderRadius: 9,
                              background: isProcessing ? '#f59e0b' : isWaiting ? '#a855f7' : '#0ea5e9',
                              color: '#fff', fontSize: 9, fontWeight: 700,
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              padding: '0 4px', border: '1.5px solid white',
                              boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                            }}>
                              {count}
                            </div>
                          </foreignObject>
                        );
                      })()}

                      {/* "Click to add resources" for unassigned tasks when not simulating */}
                      {(el.type === 'task' || el.type === 'subprocess') && !isSimulating && (() => {
                        const assignments = taskAssignments[el.id] || {};
                        const hasResource = Object.values(assignments).some(a => a.enabled);
                        if (!hasResource) {
                          return (
                            <foreignObject x={nodeW / 2 - 70} y={nodeH + 3} width="140" height="22" style={{ pointerEvents: 'none', overflow: 'visible' }}>
                              <div style={{ fontSize: 10, color: '#60a5fa', opacity: 0.8, textAlign: 'center', fontWeight: 500 }}>
                                Click to add resources
                              </div>
                            </foreignObject>
                          );
                        }
                        return null;
                      })()}

                      {/* Simulating status badge ("working" / "in queue") */}
                      {isSimulating && activeDwellSet.has(el.id) && (() => {
                        const isProcessing = processingSet.has(el.id);
                        const isWaiting = waitingSet.has(el.id);
                        const isTask = el.type === 'task' || el.type === 'subprocess';
                        return (
                          <foreignObject x={nodeW / 2 - 50} y={isTask ? nodeH + 3 : nodeH + 20} width="100" height="22" style={{ pointerEvents: 'none', overflow: 'visible' }}>
                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                              <div style={{
                                fontSize: 9, fontWeight: 600, padding: '1px 6px',
                                borderRadius: 99, border: '1px solid',
                                borderColor: isProcessing ? '#fbbf24' : isWaiting ? '#c084fc' : '#7dd3fc',
                                color: isProcessing ? '#92400e' : isWaiting ? '#6b21a8' : '#0369a1',
                                background: isProcessing ? '#fef9c3' : isWaiting ? '#faf5ff' : '#e0f2fe',
                                whiteSpace: 'nowrap',
                              }}>
                                {isProcessing ? '⚙ working' : isWaiting ? '⏳ in queue' : '●'}
                              </div>
                            </div>
                          </foreignObject>
                        );
                      })()}
                    </>
                  )}
                  renderCanvasOverlay={() => (
                    <>
                      {tokens.map(token => <Token key={token.id} token={token} />)}
                    </>
                  )}
                />

                {/* Status overlay */}
                {isSimulating && (
                  <div style={{
                    position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
                    display: 'flex', alignItems: 'center', gap: 12,
                    background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)',
                    padding: '8px 18px', borderRadius: 9999,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)', border: '1px solid #e5e7eb',
                    pointerEvents: 'none', zIndex: 10,
                  }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981', animation: 'pulse 1.5s infinite' }}/>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>Simulation running</span>
                    <span style={{ fontSize: 12, color: '#9ca3af' }}>{tokens.length} case{tokens.length !== 1 ? 's' : ''} in progress</span>
                    {tokens.filter(t => t.state === STATE.WAITING).length > 0 && (
                      <span style={{ fontSize: 11, color: '#7c3aed', fontWeight: 600 }}>
                        ⏳ {tokens.filter(t => t.state === STATE.WAITING).length} waiting
                      </span>
                    )}
                    {tokens.filter(t => t.state === STATE.PROCESSING).length > 0 && (
                      <span style={{ fontSize: 11, color: '#b45309', fontWeight: 600 }}>
                        ⚙ {tokens.filter(t => t.state === STATE.PROCESSING).length} being processed
                      </span>
                    )}
                  </div>
                )}

                {Math.round(progress) === 100 && (
                  <div
                    onClick={() => navigate('/results')}
                    style={{
                      position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
                      background: '#059669', color: '#fff', padding: '10px 20px',
                      borderRadius: 9999, fontWeight: 600, fontSize: 13,
                      boxShadow: '0 4px 12px rgba(5,150,105,0.4)',
                      cursor: 'pointer', zIndex: 10, whiteSpace: 'nowrap',
                    }}>
                    ✓ Simulation Complete — View Results →
                  </div>
                )}

                {/* Setup panel floating toggle (bottom-left) */}
                <div style={{ position: 'absolute', bottom: 24, left: 16, zIndex: 20 }}>
                  <button
                    onClick={() => setSetupOpen(o => !o)}
                    style={{
                      background: setupOpen
                        ? 'linear-gradient(to right, #1e40af, #7c3aed)'
                        : 'linear-gradient(to right, #6366f1, #9333ea, #a855f7)',
                      color: 'white',
                      padding: '10px 18px',
                      borderRadius: '12px',
                      border: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px',
                      fontWeight: 700,
                      fontFamily: 'Inter, -apple-system, sans-serif',
                      cursor: 'pointer',
                      boxShadow: setupOpen
                        ? '0 4px 16px rgba(99,102,241,0.35)'
                        : '0 4px 16px rgba(147,51,234,0.35)',
                      opacity: 1,
                      transition: 'all 0.2s ease',
                      whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.opacity = '0.95'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.opacity = '1'; }}
                  >
                    <Settings size={15} className={setupOpen ? "animate-spin" : ""} />
                    {setupOpen ? 'Close Setup' : 'Setup'}
                  </button>
                </div>

                {/* Floating Run Simulation button when Setup is closed */}
                {!setupOpen && !isSimulating && (
                  <div style={{ position: 'absolute', bottom: 24, left: 125, zIndex: 20 }}>
                    <button
                      onClick={handleRun}
                      disabled={backendRunning || !modelElements.length}
                      style={{
                        background: 'linear-gradient(to right, #16a34a, #15803d)',
                        color: 'white',
                        padding: '10px 18px',
                        borderRadius: '12px',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '13px',
                        fontWeight: 700,
                        fontFamily: 'Inter, -apple-system, sans-serif',
                        cursor: modelElements.length && !backendRunning ? 'pointer' : 'not-allowed',
                        boxShadow: '0 4px 16px rgba(22,163,74,0.35)',
                        opacity: modelElements.length && !backendRunning ? 1 : 0.6,
                        transition: 'all 0.2s ease',
                        whiteSpace: 'nowrap',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}
                    >
                      {backendRunning
                        ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Running…</>
                        : <><Play size={15} style={{ fill: 'currentColor' }} /> Run Simulation</>
                      }
                    </button>
                  </div>
                )}

                {/* Floating Zoom Controls (bottom-right, above Task Details button) */}
                <div style={{
                  position: 'absolute', bottom: 74, right: 16, zIndex: 20,
                  display: 'flex', gap: 4, padding: '4px 8px', borderRadius: 8,
                  background: 'rgba(255, 255, 255, 0.92)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(229,231,235,0.9)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  alignItems: 'center',
                  pointerEvents: 'auto'
                }}>
                  <button
                    type="button"
                    onClick={handleZoomOut}
                    title="Zoom Out"
                    style={{
                      width: 24, height: 24, borderRadius: 6, border: 'none',
                      background: 'transparent', cursor: 'pointer', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', color: '#4b5563',
                      fontSize: 14, fontWeight: 'bold', transition: 'background 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    －
                  </button>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#374151', minWidth: 40, textAlign: 'center', userSelect: 'none' }}>
                    {Math.round(zoomScale * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={handleZoomIn}
                    title="Zoom In"
                    style={{
                      width: 24, height: 24, borderRadius: 6, border: 'none',
                      background: 'transparent', cursor: 'pointer', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', color: '#4b5563',
                      fontSize: 14, fontWeight: 'bold', transition: 'background 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    ＋
                  </button>
                  <div style={{ width: 1, height: 14, background: '#e5e7eb', margin: '0 4px' }} />
                  <button
                    type="button"
                    onClick={handleZoomAuto}
                    title="Auto Fit Zoom"
                    style={{
                      padding: '0 6px', height: 24, borderRadius: 6, border: 'none',
                      background: 'transparent', cursor: 'pointer', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', color: '#4f46e5',
                      fontSize: 10, fontWeight: 600, transition: 'background 0.2s',
                      textTransform: 'uppercase', letterSpacing: '0.05em'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    onClick={handleZoom100}
                    title="Zoom to 100%"
                    style={{
                      padding: '0 6px', height: 24, borderRadius: 6, border: 'none',
                      background: 'transparent', cursor: 'pointer', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', color: '#4f46e5',
                      fontSize: 10, fontWeight: 600, transition: 'background 0.2s',
                      textTransform: 'uppercase', letterSpacing: '0.05em'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    100%
                  </button>
                  <button
                    type="button"
                    onClick={handleZoomFit}
                    title="Fit to Screen"
                    style={{
                      padding: '0 6px', height: 24, borderRadius: 6, border: 'none',
                      background: 'transparent', cursor: 'pointer', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', color: '#4f46e5',
                      fontSize: 10, fontWeight: 600, transition: 'background 0.2s',
                      textTransform: 'uppercase', letterSpacing: '0.05em'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    Fit
                  </button>
                </div>

                {/* Task Details floating toggle (bottom-right) */}
                <div style={{ position: 'absolute', bottom: 24, right: 16, zIndex: 20 }}>
                  <button
                    onClick={() => setDetailsOpen(o => !o)}
                    style={{
                      background: detailsOpen
                        ? 'linear-gradient(to right, #1e40af, #7c3aed)'
                        : 'linear-gradient(to right, #6366f1, #9333ea, #a855f7)',
                      color: 'white',
                      padding: '10px 18px',
                      borderRadius: '12px',
                      border: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px',
                      fontWeight: 700,
                      fontFamily: 'Inter, -apple-system, sans-serif',
                      cursor: 'pointer',
                      boxShadow: detailsOpen
                        ? '0 4px 16px rgba(99,102,241,0.35)'
                        : '0 4px 16px rgba(147,51,234,0.35)',
                      opacity: 1,
                      transition: 'all 0.2s ease',
                      whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.opacity = '0.95'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.opacity = '1'; }}
                  >
                    <Target size={15} className={detailsOpen ? "animate-pulse" : ""} />
                    {detailsOpen ? 'Close Details' : 'Task Details'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ══════════════ RIGHT SIDEBAR: Task Setup ══════════════ */}
        {detailsOpen && (
        selectedTask ? (
          <div style={{ display: 'flex', position: 'relative' }}>
            <div
              onMouseDown={startRightResize}
              style={{ width: 12, cursor: 'col-resize', position: 'absolute', left: -6, top: 0, bottom: 0, zIndex: 10 }}
            />
            <aside style={{
              width: rightSidebarWidth, flexShrink: 0, display: 'flex', flexDirection: 'column',
              overflow: 'hidden', borderRadius: 12, border: '1px solid #e5e7eb',
              background: '#fff', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.07)',
            }}>
            <div style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              borderBottom: '1px solid #f0f9ff', background: 'linear-gradient(to right,#f0f9ff,#ecfeff)',
              padding: '14px 16px',
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#111827' }}>
                  {selectedTask.type.includes('gateway') ? 'Gateway Routing' : 'Task Setup'}
                </h3>
                <p style={{ margin: '3px 0 0', fontSize: 11, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                  {selectedTask.label || selectedTask.id}
                </p>
              </div>
              <button onClick={() => { setSelectedTask(null); setDetailsOpen(false); }} style={{ padding: 6, background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 8 }}>
                <X size={16} style={{ color: '#6b7280' }}/>
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
              {selectedTask.type.includes('gateway') ? (
                <div>
                  {selectedTask.type === 'parallel-gateway' ? (
                    <p style={{ fontSize: 12, color: '#4b5563', marginBottom: 16 }}>
                      Parallel Gateways (AND) route tokens to ALL outgoing paths simultaneously. No routing probabilities are needed.
                    </p>
                  ) : (
                    <>
                      <p style={{ fontSize: 12, color: '#4b5563', marginBottom: 16 }}>Set routing probabilities for outgoing paths. Values should be between 0 and 1 (e.g., 0.5 for 50%).</p>
                      {connections.filter(c => (c.from ?? c.fromId) === selectedTask.id).length === 0 ? (
                        <p style={{ fontSize: 12, color: '#9ca3af' }}>No outgoing paths found.</p>
                      ) : (
                        connections.filter(c => (c.from ?? c.fromId) === selectedTask.id).map(conn => {
                          const targetNode = modelElements.find(n => n.id === (conn.to ?? conn.toId));
                          const targetName = targetNode?.label || targetNode?.id || 'Unknown';
                          return (
                            <div key={conn.id || `${conn.from ?? conn.fromId}-${conn.to ?? conn.toId}`} style={{ marginBottom: 12 }}>
                              <label style={{ fontSize: 11, fontWeight: 600, color: '#4b5563', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                                <span>To: {targetName}</span>
                                {conn.label && <span style={{ color: '#0284c7' }}>"{conn.label}"</span>}
                              </label>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input type="number" min="0" max="1" step="0.1"
                                  value={conn.probability ?? ''}
                                  onChange={e => updateConnectionProbability((conn.from ?? conn.fromId), (conn.to ?? conn.toId), e.target.value === '' ? null : parseFloat(e.target.value))}
                                  placeholder="e.g. 0.5"
                                  style={{ ...inputStyle, flex: 1 }}/>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #f3f4f6' }}>
                    <label style={labelStyle}>Duration</label>
                    {simulationMode === 'quick' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="number" min="0" value={selectedTask.data?.duration ?? ''}
                          onChange={e => updateTaskProperty(selectedTask.id, 'duration', e.target.value === '' ? '' : parseInt(e.target.value))}
                          style={{ ...inputStyle, flex: 1, minWidth: 0 }}/>
                        <select value={selectedTask.data?.duration_unit || durationUnit}
                          onChange={e => updateTaskProperty(selectedTask.id, 'duration_unit', e.target.value)}
                          style={{ ...selectStyle, flexShrink: 0, width: 105 }}>
                          {['seconds','minutes','hours','days','weeks','months'].map(u => (
                            <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="number" min="0" value={selectedTask.data?.duration_min ?? ''}
                          onChange={e => updateTaskProperty(selectedTask.id, 'duration_min', e.target.value === '' ? '' : parseInt(e.target.value))}
                          placeholder="Min" style={{ ...inputStyle, flex: 1, minWidth: 0 }}/>
                        <span style={{ color: '#9ca3af', fontWeight: 500 }}>–</span>
                        <input type="number" min="0" value={selectedTask.data?.duration_max ?? ''}
                          onChange={e => updateTaskProperty(selectedTask.id, 'duration_max', e.target.value === '' ? '' : parseInt(e.target.value))}
                          placeholder="Max" style={{ ...inputStyle, flex: 1, minWidth: 0 }}/>
                        <select value={selectedTask.data?.duration_unit || durationUnit}
                          onChange={e => updateTaskProperty(selectedTask.id, 'duration_unit', e.target.value)}
                          style={{ ...selectStyle, flexShrink: 0, width: 105 }}>
                          {['seconds','minutes','hours','days','weeks','months'].map(u => (
                            <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <label style={labelStyle}>Assigned Resources</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {globalResources.map(resource => {
                      const resLabel = resource.displayName || resource.name || resource.id || 'Staff / Specialist';
                      const taskData = selectedTask.data || {};
                      const taskResMap = taskData.resources || {};
                      const assignedQty = taskResMap[resource.id] || taskResMap[resource.name] || taskResMap[resLabel] || (taskData.resource === resource.id || taskData.resource === resource.name || taskData.resource === resLabel ? 1 : 0);
                      
                      const savedAsgn = taskAssignments[selectedTask.id]?.[resource.id] || taskAssignments[selectedTask.id]?.[resLabel];
                      const assignment = savedAsgn || { enabled: assignedQty > 0, quantity: assignedQty > 0 ? assignedQty : 1 };
                      const Icon = resource.icon || Box;

                      return (
                        <div key={resource.id || resLabel} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          border: assignment.enabled ? '1px solid #7dd3fc' : '1px solid #e5e7eb',
                          borderRadius: 8, padding: '8px 12px',
                          background: assignment.enabled ? '#f0f9ff' : '#fff',
                          transition: 'all 0.15s',
                        }}>
                          <input type="checkbox" checked={assignment.enabled}
                            onChange={e => updateTaskAssignment(selectedTask.id, resource.id || resLabel, { enabled: e.target.checked, quantity: assignment.quantity ?? 1 })}
                            style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#0284c7', margin: 0 }}/>
                          <Icon style={{ width: 15, height: 15, color: assignment.enabled ? '#0284c7' : '#9ca3af', flexShrink: 0 }}/>
                          <span style={{ fontSize: 12, fontWeight: 600, flex: 1, color: assignment.enabled ? '#075985' : '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {resLabel}
                          </span>
                      <button
                        type="button"
                        onClick={() => setEditingResource(resource)}
                        style={{ padding: 4, background: 'transparent', border: 'none', color: '#9ca3af', display: 'flex', alignItems: 'center', opacity: assignment.enabled ? 1 : 0.5, cursor: assignment.enabled ? 'pointer' : 'not-allowed' }}
                        title="Edit Resource Properties"
                        disabled={!assignment.enabled}
                      >
                        <Settings size={14} />
                      </button>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, color: '#9ca3af' }}>Qty</span>
                        <input type="number" min="0" value={assignment.quantity ?? ''} disabled={!assignment.enabled}
                          onChange={e => updateTaskAssignment(selectedTask.id, resource.id, { quantity: e.target.value })}
                          style={{ width: 44, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, textAlign: 'center', outline: 'none', opacity: assignment.enabled ? 1 : 0.5, cursor: assignment.enabled ? 'text' : 'not-allowed' }}/>
                      </div>
                    </div>
                  );
                })}
                  </div>
                </>
              )}
            </div>

            <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb', background: '#f9fafb' }}>
              <button onClick={() => setSelectedTask(null)} style={{
                width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: '#0284c7', color: '#fff', border: 'none', cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(2,132,199,0.2)', transition: 'background 0.2s'
              }}>
                Close
              </button>
            </div>
          </aside>
          </div>
        ) : (
          <div style={{ display: 'flex', position: 'relative' }}>
            <aside style={{
              width: rightSidebarWidth, flexShrink: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', padding: '32px 24px',
              borderRadius: 12, border: '2px dashed #e2e8f0', background: '#f8fafc',
              textAlign: 'center', margin: '0 0 0 16px', position: 'relative'
            }}>
              <button
                onClick={() => setDetailsOpen(false)}
                style={{ position: 'absolute', top: 12, right: 12, padding: 6, background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 8 }}
              >
                <X size={16} style={{ color: '#6b7280' }}/>
              </button>
              <div style={{ width: 56, height: 56, background: '#e2e8f0', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Target size={28} color="#64748b" />
              </div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: 15, fontWeight: 700, color: '#334155' }}>No Task Selected</h3>
              <p style={{ margin: 0, fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                Click on any task in the process model to configure its resources and duration.
              </p>
            </aside>
          </div>
        ))}

        {/* ── ResourceConfigPanel Modal ── */}
        {editingResource && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 100,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
          }} onClick={() => setEditingResource(null)}>
            <div style={{
              width: 440, padding: 24, borderRadius: 16,
              background: 'white', border: '1px solid #e5e7eb',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
              margin: 'auto', display: 'flex', flexDirection: 'column', gap: 16
            }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1f2937' }}>Configure Resource</h3>
                <button onClick={() => setEditingResource(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}>
                  <X size={18} />
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '60vh', overflowY: 'auto', paddingRight: 4 }}>
                {/* Name */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>Resource Name</label>
                  <input type="text" value={editingResource.displayName}
                    onChange={e => setEditingResource(prev => ({ ...prev, displayName: e.target.value, name: e.target.value }))}
                    style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none' }} />
                </div>

                {/* Type */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>Resource Type</label>
                  <select value={editingResource.type || 'staff'}
                    onChange={e => {
                      const nextType = e.target.value;
                      setEditingResource(prev => ({
                        ...prev,
                        type: nextType,
                        hours_per_day: nextType === 'facility' ? 12 : 8,
                        monthly_salary: nextType === 'staff' ? 50000 : null,
                        purchase_price: (nextType === 'equipment' || nextType === 'vehicle') ? 45000 : null,
                        lifespan_months: (nextType === 'equipment' || nextType === 'vehicle') ? 36 : null,
                        monthly_running_cost: (nextType === 'equipment' || nextType === 'vehicle') ? 500 : null,
                        monthly_rent: nextType === 'facility' ? 80000 : null,
                        isRented: nextType === 'facility' ? true : undefined
                      }));
                    }}
                    style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none', background: 'white' }}>
                    <option value="staff">Staff / Employee</option>
                    <option value="equipment">Equipment / Machine</option>
                    <option value="vehicle">Vehicle / Van</option>
                    <option value="facility">Facility</option>
                  </select>
                </div>

                {/* Quantity */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>Quantity</label>
                  <input type="number" min="0" value={editingResource.quantity}
                    onChange={e => setEditingResource(prev => ({ ...prev, quantity: parseInt(e.target.value) || 0 }))}
                    style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none' }} />
                </div>

                {/* Hours per Day */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>Hours per Day</label>
                  <input type="number" min="1" max="24" value={editingResource.hours_per_day ?? ''}
                    onChange={e => setEditingResource(prev => ({ ...prev, hours_per_day: e.target.value === '' ? null : Number(e.target.value) }))}
                    style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none' }} />
                </div>

                {/* Staff fields */}
                {(editingResource.type === 'staff' || !editingResource.type) && (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>Monthly Salary</label>
                      <input type="number" min="0" value={editingResource.monthly_salary ?? ''}
                        onChange={e => setEditingResource(prev => ({ ...prev, monthly_salary: e.target.value === '' ? null : Number(e.target.value) }))}
                        style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none' }} />
                    </div>
                  </>
                )}

                {/* Equipment / Vehicle fields */}
                {(editingResource.type === 'equipment' || editingResource.type === 'vehicle') && (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>Purchase Price</label>
                      <input type="number" min="0" value={editingResource.purchase_price ?? ''}
                        onChange={e => setEditingResource(prev => ({ ...prev, purchase_price: e.target.value === '' ? null : Number(e.target.value) }))}
                        style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>Lifespan (Months)</label>
                      <input type="number" min="1" value={editingResource.lifespan_months ?? ''}
                        onChange={e => setEditingResource(prev => ({ ...prev, lifespan_months: e.target.value === '' ? null : Number(e.target.value) }))}
                        style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>Monthly Running Cost</label>
                      <input type="number" min="0" value={editingResource.monthly_running_cost ?? ''}
                        onChange={e => setEditingResource(prev => ({ ...prev, monthly_running_cost: e.target.value === '' ? null : Number(e.target.value) }))}
                        style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none' }} />
                    </div>
                  </>
                )}

                {/* Facility fields */}
                {editingResource.type === 'facility' && (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>Ownership Type</label>
                      <select value={editingResource.isRented ? 'rented' : 'owned'}
                        onChange={e => {
                          const rented = e.target.value === 'rented';
                          setEditingResource(prev => ({
                            ...prev,
                            isRented: rented,
                            monthly_rent: rented ? 80000 : null,
                            purchase_price: rented ? null : 12000000,
                            lifespan_months: rented ? null : 240,
                          }));
                        }}
                        style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none', background: 'white' }}>
                        <option value="rented">Rented</option>
                        <option value="owned">Owned</option>
                      </select>
                    </div>
                    {editingResource.isRented ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>Monthly Rent</label>
                        <input type="number" min="0" value={editingResource.monthly_rent ?? ''}
                          onChange={e => setEditingResource(prev => ({ ...prev, monthly_rent: e.target.value === '' ? null : Number(e.target.value) }))}
                          style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none' }} />
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>Purchase Price</label>
                          <input type="number" min="0" value={editingResource.purchase_price ?? ''}
                            onChange={e => setEditingResource(prev => ({ ...prev, purchase_price: e.target.value === '' ? null : Number(e.target.value) }))}
                            style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none' }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>Lifespan (Months)</label>
                          <input type="number" min="1" value={editingResource.lifespan_months ?? ''}
                            onChange={e => setEditingResource(prev => ({ ...prev, lifespan_months: e.target.value === '' ? null : Number(e.target.value) }))}
                            style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none' }} />
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
                <button type="button" onClick={() => setEditingResource(null)} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: '1px solid #d1d5db', background: 'white', color: '#374151', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="button" onClick={() => handleSaveResourceConfig(editingResource)} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: 'none', background: '#6366f1', color: 'white', cursor: 'pointer' }}>
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}