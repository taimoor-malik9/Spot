'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  Search,
  Pencil,
  Plus,
  Minus,
  X,
  GitCompare,
  Trash2,
  Lightbulb,
  Layers,
  Loader2,
  Play,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid3x3,
  Clipboard,
  CheckSquare,
  Filter,
  Type,
  Check,
  MousePointerClick,
  Copy,
  ClipboardPaste,
  Scissors,
  Settings,
  User,
  Laptop,
  Gauge,
  Truck,
  Building2,
  TestTube,
  Box,
  Target,
  Shapes
} from 'lucide-react';
import {
  createScenario,
  updateScenario,
  updateProcess,
  getProcess,
  getScenarios,
  runScenarioSimulation,
  runSimulation,
  runWhatIfAnalysis,
  shapeFrontendToBackend,
  shapeBackendToFrontend,
  deleteScenario as deleteScenarioApi
} from '../lib/apiService';
import {
  Edge,
  ContextPad,
  GatewayPopover,
} from '../components/model/BpmnCanvasComponents';

function isXorGateway(type) {
  if (!type) return false;
  const t = type.toLowerCase();
  if (t === 'parallel-gateway' || t.includes('parallel') ||
      t === 'inclusive-gateway' || t.includes('inclusive') ||
      t === 'complex-gateway' || t.includes('complex') ||
      t === 'event-based-gateway' || t.includes('event-based')) {
    return false;
  }
  return t === 'exclusive-gateway' || t === 'xor-gateway' || t === 'gateway' || t.includes('exclusive') || t.includes('xor');
}

const POOL_LANE_HDR = 36;
const LANE_HDR = 32;

function poolLanes(elements, poolId) {
  if (!Array.isArray(elements) || !poolId) return [];
  const directLanes = elements.filter(e => e && e.type === 'lane' && e.poolId === poolId).sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0));
  if (directLanes.length > 0) return directLanes;
  const pools = elements.filter(e => e && e.type === 'pool');
  if (pools.length === 1 && pools[0].id === poolId) {
    return elements.filter(e => e && e.type === 'lane').sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0));
  }
  return elements.filter(e => e && e.type === 'lane' && (!e.poolId || e.poolId === poolId)).sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0));
}

const NW = 80, NH = 80;

function elCenter(el) {
  const px = el.position?.x ?? el.x ?? 0;
  const py = el.position?.y ?? el.y ?? 0;
  const w = el.width || NW;
  const h = el.height || NH;
  return { x: px + w / 2, y: py + h / 2 };
}

function shapeBounds(el) {
  const w = el.width || NW;
  const h = el.height || NH;
  const scaleX = w / 120;
  const scaleY = h / 120;
  if (el.type?.includes('event')) return { left: 28 * scaleX, right: 92 * scaleX, top: 28 * scaleY, bottom: 92 * scaleY };
  if (el.type?.includes('task') || el.type === 'subprocess' || el.type === 'call-activity') {
    const topOffset = el.type === 'subprocess' ? 16 : 20;
    return { left: 10 * scaleX, right: 110 * scaleX, top: topOffset * scaleY, bottom: 100 * scaleY };
  }
  if (el.type?.includes('gateway')) return { left: 8 * scaleX, right: 112 * scaleX, top: 8 * scaleY, bottom: 112 * scaleY };
  return { left: 0, right: w, top: 0, bottom: h };
}

function elPort(el, side) {
  const { x, y } = elCenter(el);
  const px = el.position?.x ?? el.x ?? 0;
  const py = el.position?.y ?? el.y ?? 0;
  const b = shapeBounds(el);
  if (side === 'right') return { x: px + b.right, y };
  if (side === 'left') return { x: px + b.left, y };
  if (side === 'top') return { x, y: py + b.top };
  if (side === 'bottom') return { x, y: py + b.bottom };
  return { x, y };
}

function bestPorts(from, to) {
  const fc = elCenter(from), tc = elCenter(to);
  const dx = tc.x - fc.x, dy = tc.y - fc.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { fp: elPort(from, 'right'), tp: elPort(to, 'left') }
      : { fp: elPort(from, 'left'), tp: elPort(to, 'right') };
  }
  return dy >= 0
    ? { fp: elPort(from, 'bottom'), tp: elPort(to, 'top') }
    : { fp: elPort(from, 'top'), tp: elPort(to, 'bottom') };
}

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

// Resource objects carry a React icon component reference (e.g. `icon: User`
// from lucide-react). JSON.stringify silently drops functions/forwardRef
// objects and can leave behind a mangled plain object in their place, which
// then crashes React ("Element type is invalid... got: object") the moment
// it's rendered as <Icon />. Use a shallow clone instead — every other field
// is a primitive, so a shallow copy is all that's needed and it keeps the
// icon reference intact.
function cloneResourceList(list) {
  return (list || []).map(r => ({ ...r }));
}

function fmt(mins) {
  if (mins == null || isNaN(mins)) return '—';
  if (mins < 1) return `${Math.round(mins * 60)}s`;
  if (mins < 60) return `${Math.round(mins)}m`;
  if (mins < 1440) {
    const h = Math.floor(mins / 60), m = Math.round(mins % 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${(mins / 1440).toFixed(1)}d`;
}

function extractThroughput(results) {
  const raw = results?.throughput_rates ?? results?.throughput_rate ?? results?.throughput ?? 0;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'object' && raw !== null) {
    return raw.avg ?? raw.value ?? raw.per_hour ?? raw.per_unit ?? Object.values(raw)[0] ?? 0;
  }
  return 0;
}

function formatScenarioTime(timestamp) {
  if (!timestamp) return 'just now';
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return 'just now';
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return 'just now';
  }
}

function getUniqueScenarioName(desiredName, existingList) {
  const existingNames = new Set(
    (existingList || []).map(item => (typeof item === 'string' ? item : item?.name)).filter(Boolean)
  );
  if (!existingNames.has(desiredName)) {
    return desiredName;
  }
  const match = desiredName.match(/^(.*?)\s*\((\d+)\)$/);
  const base = match ? match[1] : desiredName;
  let counter = match ? parseInt(match[2], 10) + 1 : 2;
  while (existingNames.has(`${base} (${counter})`)) {
    counter++;
  }
  return `${base} (${counter})`;
}

const MAX_COMPARE = 4;

/** Visual distinction for up to 7 scenarios in the comparison strip */
const COMPARE_CARD_STYLES = [
  { border: 'border-sky-200', bg: 'from-sky-50/80 to-white', dot: 'bg-sky-500', badge: 'bg-sky-100 text-sky-800' },
  { border: 'border-indigo-200', bg: 'from-indigo-50/80 to-white', dot: 'bg-indigo-500', badge: 'bg-indigo-100 text-indigo-800' },
  { border: 'border-emerald-200', bg: 'from-emerald-50/80 to-white', dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-800' },
  { border: 'border-violet-200', bg: 'from-violet-50/80 to-white', dot: 'bg-violet-500', badge: 'bg-violet-100 text-violet-800' },
  { border: 'border-rose-200', bg: 'from-rose-50/80 to-white', dot: 'bg-rose-500', badge: 'bg-rose-100 text-rose-800' },
  { border: 'border-amber-200', bg: 'from-amber-50/80 to-white', dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-800' },
  { border: 'border-teal-200', bg: 'from-teal-50/80 to-white', dot: 'bg-teal-500', badge: 'bg-teal-100 text-teal-800' },
];

const PREVIEW_METRICS = [
  { key: 'cycle', label: 'Avg. cycle time', hint: 'end-to-end' },
  { key: 'cost', label: 'Cost per case', hint: 'estimate' },
  { key: 'throughput', label: 'Throughput', hint: 'cases / period' },
];

/** Match Model page: palette drop uses top-left at cursor; elements use position + optional width/height */
function defaultSizeForType(type) {
  if (type === 'pool') return { width: 600, height: 150 };
  if (type === 'lane') return { width: 500, height: 100 };
  return { width: 80, height: 80 };
}

function normalizeCanvasElement(el) {
  const { width, height } = defaultSizeForType(el.type);
  
  // Force x, y, and position into perfect sync so downstream code never gets confused
  const x = el.position?.x ?? el.x ?? 0;
  const y = el.position?.y ?? el.y ?? 0;

  return {
    ...el,
    x,
    y,
    position: { x, y },
    width: el.width ?? width,
    height: el.height ?? height,
  };
}

// ─── Context menu for copy/cut/paste/delete ────────────────────────────────────────
function useContextMenu() {
  const [contextMenu, setContextMenu] = useState(null);
  const [clipboard, setClipboard] = useState(null);

  const handleCopy = (element) => {
    setClipboard({ ...element, originalId: element.id, operation: 'copy' });
    setContextMenu(null);
  };

  const handleCut = (element, elements, setElements, connections, setConnections) => {
    setClipboard({ ...element, originalId: element.id, operation: 'cut' });
    setElements(elements.filter(el => el.id !== element.id));
    setConnections(connections.filter(conn => conn.fromId !== element.id && conn.toId !== element.id));
    setContextMenu(null);
  };

  const handlePaste = (clipboardData, mousePos, elements, setElements) => {
    if (clipboardData) {
      const newElement = {
        ...clipboardData,
        id: `${clipboardData.type}-${Date.now()}`,
        position: { x: mousePos.x || 100, y: mousePos.y || 100 }
      };
      delete newElement.originalId;
      delete newElement.operation;
      setElements([...elements, newElement]);
    }
  };

  const handleDelete = (elementId, elements, setElements, connections, setConnections) => {
    setElements(elements.filter(el => el.id !== elementId));
    setConnections(connections.filter(conn => conn.fromId !== elementId && conn.toId !== elementId));
    setContextMenu(null);
  };

  return { contextMenu, setContextMenu, clipboard, setClipboard, handleCopy, handleCut, handlePaste, handleDelete };
}

function PaletteIcon({ id }) {
  switch (id) {
    // ─── Events ───
    case 'start-event':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
    case 'message-start-event':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <rect x="7.5" y="9.5" width="9" height="6" rx="0.5" strokeWidth="1.5" />
          <path d="M7.5 10L12 12.5L16.5 10" strokeWidth="1.5" />
        </svg>
      );
    case 'timer-start-event':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" strokeWidth="1.5" />
          <polyline points="12 9 12 12 14 12" strokeWidth="1.5" />
        </svg>
      );
    case 'conditional-start-event':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <rect x="8.5" y="7.5" width="7" height="9" rx="0.5" strokeWidth="1.5" />
          <line x1="10.5" y1="10" x2="13.5" y2="10" strokeWidth="1.2" />
          <line x1="10.5" y1="12.5" x2="13.5" y2="12.5" strokeWidth="1.2" />
        </svg>
      );
    case 'signal-start-event':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <polygon points="12 6.5 16.5 14.5 7.5 14.5" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );
    case 'intermediate-event':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="7" strokeWidth="1" />
        </svg>
      );
    case 'message-intermediate-catch':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="7" strokeWidth="1" />
          <rect x="8" y="9.5" width="8" height="5" rx="0.5" strokeWidth="1.2" />
          <path d="M8 10L12 12L16 10" strokeWidth="1.2" />
        </svg>
      );
    case 'message-intermediate-throw':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="7" strokeWidth="1" />
          <rect x="8" y="9.5" width="8" height="5" rx="0.5" fill="currentColor" strokeWidth="1.2" />
          <path d="M8 10L12 12L16 10" stroke="currentColor" fill="none" strokeWidth="1.2" />
        </svg>
      );
    case 'timer-intermediate-catch':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="7" strokeWidth="1" />
          <circle cx="12" cy="12" r="4.5" strokeWidth="1.2" />
          <polyline points="12 10 12 12 13.5 12" strokeWidth="1.2" />
        </svg>
      );
    case 'conditional-intermediate-catch':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="7" strokeWidth="1" />
          <rect x="9" y="8.5" width="6" height="7" rx="0.5" strokeWidth="1.2" />
          <line x1="11" y1="10.5" x2="13" y2="10.5" strokeWidth="1" />
          <line x1="11" y1="12.5" x2="13" y2="12.5" strokeWidth="1" />
        </svg>
      );
    case 'signal-intermediate-catch':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="7" strokeWidth="1" />
          <polygon points="12 7.5 16 14.5 8 14.5" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      );
    case 'signal-intermediate-throw':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="7" strokeWidth="1" />
          <polygon points="12 7.5 16 14.5 8 14.5" fill="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      );
    case 'end-event':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="6" fill="#000000" stroke="none" />
        </svg>
      );
    case 'message-end-event':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <circle cx="12" cy="12" r="8.5" />
          <rect x="8.5" y="9.5" width="7" height="5" rx="0.5" strokeWidth="1.2" />
          <path d="M8.5 10L12 12L15.5 10" strokeWidth="1.2" />
        </svg>
      );
    case 'error-end-event':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <circle cx="12" cy="12" r="8.5" />
          <polygon points="12 7 9.5 12.5 12 12.5 11 16.5 14.5 11 12 11" strokeWidth="1.2" fill="none" />
        </svg>
      );
    case 'escalation-end-event':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <circle cx="12" cy="12" r="8.5" />
          <polygon points="12 8 15 13.5 12 12 9 13.5" strokeWidth="1.2" fill="none" />
        </svg>
      );
    case 'signal-end-event':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <circle cx="12" cy="12" r="8.5" />
          <polygon points="12 8.5 15.5 14.5 8.5 14.5" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      );
    case 'terminate-end-event':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none" />
        </svg>
      );

    // ─── Activities ───
    case 'task':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="14" rx="2" />
        </svg>
      );
    case 'user-task':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="8" cy="10.5" r="1.8" strokeWidth="1.5" />
          <path d="M5 14.5c0-1.8 1.5-1.8 3-1.8s3 0 3 1.8" strokeWidth="1.5" />
        </svg>
      );
    case 'service-task':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="12" cy="12" r="2.5" strokeWidth="1.5" />
          <path d="M12 9v1M12 14v1M9 12h1M14 12h1" strokeWidth="1.5" />
        </svg>
      );
    case 'script-task':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <rect x="6.5" y="8.5" width="5" height="7" rx="0.5" strokeWidth="1.2" />
          <line x1="8" y1="10.5" x2="10" y2="10.5" strokeWidth="1" />
          <line x1="8" y1="12.5" x2="10" y2="12.5" strokeWidth="1" />
        </svg>
      );
    case 'manual-task':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M6 14.5v-3.5c0-.5.5-.5.5-.5s.5 0 .5.5v-1.5c0-.5.5-.5.5-.5s.5 0 .5.5v-1c0-.5.5-.5.5-.5s.5 0 .5.5v.5c0-.5.5-.5.5-.5s.5 0 .5.5v4" strokeWidth="1.2" />
        </svg>
      );
    case 'send-task':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <rect x="6" y="9" width="7" height="5" rx="0.5" strokeWidth="1.2" />
          <path d="M6 9.5L9.5 11.5L13 9.5" strokeWidth="1.2" />
          <path d="M14 9.5h3v2M17 9.5l-3.5 3.5" strokeWidth="1.2" />
        </svg>
      );
    case 'receive-task':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <rect x="6" y="9" width="7" height="5" rx="0.5" strokeWidth="1.2" />
          <path d="M6 9.5L9.5 11.5L13 9.5" strokeWidth="1.2" />
          <path d="M17 13.5h-3v-2M14 13.5l3.5-3.5" strokeWidth="1.2" />
        </svg>
      );
    case 'business-rule-task':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <rect x="7" y="8.5" width="10" height="7" strokeWidth="1.2" />
          <line x1="7" y1="12" x2="17" y2="12" strokeWidth="1" />
          <line x1="12" y1="8.5" x2="12" y2="15.5" strokeWidth="1" />
        </svg>
      );
    case 'subprocess':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <rect x="10" y="14" width="4" height="4" rx="0.5" strokeWidth="1.2" />
          <line x1="12" y1="15" x2="12" y2="17" strokeWidth="1" />
          <line x1="11" y1="16" x2="13" y2="16" strokeWidth="1" />
        </svg>
      );
    case 'call-activity':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
          <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
        </svg>
      );

    // ─── Gateways ───
    case 'exclusive-gateway':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="12 3 21 12 12 21 3 12" />
          <line x1="9.5" y1="9.5" x2="14.5" y2="14.5" strokeWidth="2" />
          <line x1="14.5" y1="9.5" x2="9.5" y2="14.5" strokeWidth="2" />
        </svg>
      );
    case 'parallel-gateway':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="12 3 21 12 12 21 3 12" />
          <line x1="12" y1="8" x2="12" y2="16" strokeWidth="2.2" />
          <line x1="8" y1="12" x2="16" y2="12" strokeWidth="2.2" />
        </svg>
      );
    case 'inclusive-gateway':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="12 3 21 12 12 21 3 12" />
          <circle cx="12" cy="12" r="3.5" strokeWidth="1.8" />
        </svg>
      );
    case 'complex-gateway':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="12 3 21 12 12 21 3 12" />
          <line x1="12" y1="7.5" x2="12" y2="16.5" strokeWidth="1.5" />
          <line x1="7.5" y1="12" x2="16.5" y2="12" strokeWidth="1.5" />
          <line x1="9" y1="9" x2="15" y2="15" strokeWidth="1.5" />
          <line x1="15" y1="9" x2="9" y2="15" strokeWidth="1.5" />
        </svg>
      );
    case 'event-based-gateway':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="12 3 21 12 12 21 3 12" />
          <circle cx="12" cy="12" r="4.5" strokeWidth="1.2" />
          <circle cx="12" cy="12" r="2" strokeWidth="1.2" />
        </svg>
      );

    // ─── Flows ───
    case 'sequence-flow':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="12" x2="21" y2="12" />
          <polyline points="15 6 21 12 15 18" />
        </svg>
      );
    case 'message-flow':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="4" cy="12" r="2.2" />
          <line x1="6.5" y1="12" x2="21" y2="12" strokeDasharray="3 3" />
          <polyline points="15 6 21 12 15 18" />
        </svg>
      );
    case 'association':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="2 2">
          <line x1="3" y1="12" x2="21" y2="12" />
          <polyline points="16 7 21 12 16 17" fill="none" strokeDasharray="none" />
        </svg>
      );

    // ─── Swimlanes ───
    case 'pool':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="16" rx="1.5" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="14" x2="21" y2="14" />
        </svg>
      );
    case 'lane':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="8.5" width="18" height="7" rx="0.5" />
        </svg>
      );

    // ─── Artifacts ───
    case 'data-object':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      );
    case 'data-store':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
        </svg>
      );
    case 'document':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="8" y1="13" x2="16" y2="13" strokeWidth="1.5" />
          <line x1="8" y1="17" x2="16" y2="17" strokeWidth="1.5" />
        </svg>
      );
    case 'annotation':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 3H4v18h8" />
          <line x1="4" y1="12" x2="16" y2="12" strokeWidth="1.5" strokeDasharray="3 3" />
        </svg>
      );
    case 'group':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 3">
          <rect x="3" y="3" width="18" height="18" rx="2" />
        </svg>
      );
    case 'input':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <polyline points="10 8 6 12 10 16" />
          <line x1="6" y1="12" x2="16" y2="12" />
        </svg>
      );
    case 'output':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <polyline points="14 8 18 12 14 16" />
          <line x1="18" y1="12" x2="8" y2="12" />
        </svg>
      );

    default:
      return null;
  }
}

// ─── BPMN Palette (mirrors model.jsx) ────────────────────────────────────────
function BPMNPalette({
  expanded = new Set(['events', 'activities', 'gateways', 'flows']),
  setExpanded,
  showAdv = new Set(),
  setShowAdv,
  onAdd
}) {
  const [internalExpanded, setInternalExpanded] = useState(expanded);
  const [internalShowAdv, setInternalShowAdv] = useState(showAdv);

  const currentExpanded = setExpanded ? expanded : internalExpanded;
  const currentShowAdv = setShowAdv ? showAdv : internalShowAdv;

  const toggleCategory = (catId) => {
    if (setExpanded) {
      setExpanded(prev => {
        const next = new Set(prev);
        next.has(catId) ? next.delete(catId) : next.add(catId);
        return next;
      });
    } else {
      setInternalExpanded(prev => {
        const next = new Set(prev);
        next.has(catId) ? next.delete(catId) : next.add(catId);
        return next;
      });
    }
  };

  const toggleAdv = (catId) => {
    if (setShowAdv) {
      setShowAdv(prev => {
        const next = new Set(prev);
        next.has(catId) ? next.delete(catId) : next.add(catId);
        return next;
      });
    } else {
      setInternalShowAdv(prev => {
        const next = new Set(prev);
        next.has(catId) ? next.delete(catId) : next.add(catId);
        return next;
      });
    }
  };

  const categories = [
    {
      id: 'events', name: 'Events',
      items: [
        { id: 'start-event',              label: 'Start Event',              icon: '◯', advanced: false },
        { id: 'message-start-event',      label: 'Message Start',            icon: '✉◯', advanced: true },
        { id: 'timer-start-event',        label: 'Timer Start',              icon: '⏰◯', advanced: true },
        { id: 'conditional-start-event',  label: 'Conditional Start',        icon: '📋◯', advanced: true },
        { id: 'signal-start-event',       label: 'Signal Start',             icon: '⚠◯', advanced: true },
        { id: 'intermediate-event',       label: 'Intermediate Event',       icon: '◎', advanced: true },
        { id: 'message-intermediate-catch',label: 'Message Intermediate Catch', icon: '✉◎', advanced: true },
        { id: 'message-intermediate-throw',label: 'Message Intermediate Throw', icon: '✉●◎', advanced: true },
        { id: 'timer-intermediate-catch',  label: 'Timer Intermediate Catch',    icon: '⏰◎', advanced: true },
        { id: 'conditional-intermediate-catch',label: 'Conditional Intermediate Catch', icon: '📋◎', advanced: true },
        { id: 'signal-intermediate-catch', label: 'Signal Intermediate Catch',   icon: '⚠◎', advanced: true },
        { id: 'signal-intermediate-throw', label: 'Signal Intermediate Throw',   icon: '⚠●◎', advanced: true },
        { id: 'end-event',                label: 'End Event',                icon: '◉', advanced: false },
        { id: 'message-end-event',        label: 'Message End',              icon: '✉◉', advanced: true },
        { id: 'error-end-event',          label: 'Error End',                icon: '⚡◉', advanced: true },
        { id: 'escalation-end-event',     label: 'Escalation End',           icon: '▲◉', advanced: true },
        { id: 'signal-end-event',         label: 'Signal End',               icon: '⚠◉', advanced: true },
        { id: 'terminate-end-event',      label: 'Terminate End',            icon: '●◉', advanced: true },
      ],
    },
    {
      id: 'activities', name: 'Activities',
      items: [
        { id: 'task',                 label: 'Task',                 icon: '▭', advanced: false },
        { id: 'user-task',            label: 'User Task',            icon: '👤▭', advanced: false },
        { id: 'service-task',         label: 'Service Task',         icon: '⚙▭', advanced: true },
        { id: 'script-task',          label: 'Script Task',          icon: '📄▭', advanced: true },
        { id: 'manual-task',          label: 'Manual Task',          icon: '✍▭', advanced: true },
        { id: 'send-task',            label: 'Send Task',            icon: '✉➡▭', advanced: true },
        { id: 'receive-task',         label: 'Receive Task',         icon: '✉⬅▭', advanced: true },
        { id: 'business-rule-task',   label: 'Business Rule Task',   icon: '田▭', advanced: true },
        { id: 'subprocess',           label: 'Sub-Process',          icon: '⊞', advanced: true },
        { id: 'call-activity',        label: 'Call Activity',        icon: '🗂', advanced: true },
      ],
    },
    {
      id: 'gateways', name: 'Gateways',
      items: [
        { id: 'exclusive-gateway',   label: 'Exclusive Gateway',   icon: '✕◇', advanced: false },
        { id: 'parallel-gateway',    label: 'Parallel Gateway',    icon: '+◇', advanced: false },
        { id: 'inclusive-gateway',   label: 'Inclusive Gateway',   icon: '○◇', advanced: true },
        { id: 'complex-gateway',     label: 'Complex Gateway',     icon: '*◇', advanced: true },
        { id: 'event-based-gateway', label: 'Event-Based Gateway', icon: '◯◇', advanced: true },
      ],
    },
    {
      id: 'flows', name: 'Flows',
      items: [
        { id: 'sequence-flow', label: 'Sequence Flow', icon: '→', advanced: false },
        { id: 'message-flow',  label: 'Message Flow',  icon: '⇢', advanced: false },
        { id: 'association',   label: 'Association',   icon: '⤏', advanced: true },
      ],
    },
    { id: 'swimlanes', name: 'Swimlanes', items: [
        { id: 'pool', label: 'Pool', icon: '▭▭', advanced: false },
        { id: 'lane', label: 'Lane', icon: '║', advanced: false },
    ]},
    { id: 'artifacts', name: 'Artifacts', items: [
        { id: 'data-object', label: 'Data Object', icon: '📄', advanced: false },
        { id: 'data-store',  label: 'Data Store',  icon: '🛢', advanced: true },
        { id: 'document',    label: 'Document',    icon: '📋', advanced: false },
        { id: 'annotation',  label: 'Annotation',  icon: '[', advanced: true },
        { id: 'group',       label: 'Group',       icon: '░', advanced: true },
        { id: 'input',       label: 'Input',       icon: '⬅', advanced: true },
        { id: 'output',      label: 'Output',      icon: '➜', advanced: true },
    ]},
  ];

  return (
    <div className="pb-6">
      {categories.map(cat => {
        const basic = cat.items.filter(i => !i.advanced);
        const adv = cat.items.filter(i => i.advanced);
        const open = currentExpanded.has(cat.id);
        const advOn = currentShowAdv.has(cat.id);
        return (
          <div key={cat.id} className="mb-0.5">
            <button
              type="button"
              onClick={() => toggleCategory(cat.id)}
              className="w-full flex items-center gap-2.5 pl-6 pr-3 min-h-[44px] py-2.5 hover:bg-slate-50 transition-all text-left border-b border-slate-100/50"
            >
              {open ? (
                <ChevronDown size={14} strokeWidth={3} className="text-slate-400 shrink-0" />
              ) : (
                <ChevronRight size={14} strokeWidth={3} className="text-slate-400 shrink-0" />
              )}
              <span className="text-[13px] font-bold text-slate-700 uppercase tracking-tight">{cat.name}</span>
            </button>
            {open && (
              <div className="py-1 bg-white">
                {/* Basic Items */}
                {basic.map(item => (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('application/reactflow', JSON.stringify({ type: item.id, label: item.label }));
                    }}
                    onClick={() => onAdd?.(item.id, item.label)}
                    className="flex items-center gap-3.5 pl-11 pr-4 min-h-[44px] py-3 cursor-pointer select-none group transition-all border-l-4 border-transparent hover:bg-slate-50 hover:border-slate-200"
                  >
                    <span className="w-6 h-6 flex items-center justify-center shrink-0 transition-transform group-hover:scale-110 text-slate-400 group-hover:text-sky-500">
                      <PaletteIcon id={item.id} />
                    </span>
                    <span className="text-[13px] font-medium leading-snug text-slate-600 group-hover:text-slate-900">{item.label}</span>
                  </div>
                ))}

                {/* Advanced Items */}
                {advOn && adv.map(item => (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('application/reactflow', JSON.stringify({ type: item.id, label: item.label }));
                    }}
                    onClick={() => onAdd?.(item.id, item.label)}
                    className="flex items-center gap-3.5 pl-11 pr-4 min-h-[44px] py-3 cursor-pointer select-none group transition-all border-l-4 border-transparent hover:bg-slate-50 hover:border-slate-200"
                  >
                    <span className="w-6 h-6 flex items-center justify-center shrink-0 transition-transform group-hover:scale-110 text-slate-400 group-hover:text-sky-500">
                      <PaletteIcon id={item.id} />
                    </span>
                    <span className="text-[13px] font-medium leading-snug text-slate-600 group-hover:text-slate-900">{item.label}</span>
                  </div>
                ))}

                {/* More/Hide Elements Button */}
                {adv.length > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleAdv(cat.id)}
                    className="flex items-center justify-center gap-1.5 w-full min-h-[36px] py-2.5 text-[11px] font-bold text-sky-600 hover:text-sky-700 hover:bg-sky-50/50 transition-all tracking-wide uppercase"
                  >
                    {advOn ? '− Show Less' : '+ Show More'}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TBtn({ onClick, disabled, title, children, variant = 'default', className = '' }) {
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    height: '38px', // Increased from 32px
    borderRadius: '8px',
    border: '1px solid',
    fontSize: '13px',
    fontWeight: 500,
    fontFamily: 'Inter, -apple-system, sans-serif',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    transition: 'background 0.12s, opacity 0.12s',
    whiteSpace: 'nowrap',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
    outline: 'none',
    padding: '0 14px',
    flexShrink: 0,
  };
  const variants = {
    default: { background: '#ffffff', color: '#374151', borderColor: '#d1d5db' },
    icon:    { background: '#ffffff', color: '#4b5563', borderColor: '#d1d5db', padding: '0', width: '38px' }, // Increased from 32px
    active:  { background: '#eef2ff', color: '#4f46e5', borderColor: '#c7d2fe' },
    primary: { background: '#5E43F3', color: '#ffffff', borderColor: 'transparent' },
    danger:  { background: '#ffffff', color: '#dc2626', borderColor: '#fecaca' },
  };
  const merged = { ...base, ...variants[variant] };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={merged}
      className={className}
      onMouseEnter={e => {
        if (disabled) return;
        if (variant === 'default' || variant === 'icon') e.currentTarget.style.background = '#f9fafb';
        if (variant === 'active') e.currentTarget.style.background = '#e0e7ff';
        if (variant === 'primary') e.currentTarget.style.background = '#4c35db';
        if (variant === 'danger') e.currentTarget.style.background = '#fef2f2';
      }}
      onMouseLeave={e => {
        if (disabled) return;
        e.currentTarget.style.background = merged.background;
      }}
    >
      {children}
    </button>
  );
}

// ─── Mini BPMN shape renderer (same viewBox & core geometry as Model page, 80×80 display) ───
function BPMNShape({ type, sel, w, h }) {
  const str = sel ? '#0284c7' : '#4b5563';
  const fil = sel ? '#e0f2fe' : '#ffffff';
  const sw = sel ? 2.5 : 1.8;
  const glow = sel
    ? 'drop-shadow(0 0 7px rgba(2,132,199,.5))'
    : 'drop-shadow(0 1px 3px rgba(0,0,0,.13))';
  const bW = 120, bH = 120;
  return (
    <svg viewBox={`0 0 ${bW} ${bH}`} width={w || 80} height={h || 80} preserveAspectRatio="none" style={{ filter: glow, display: 'block' }}>
      {/* START EVENTS */}
      {type === 'start-event' && <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw}/>}
      {type === 'message-start-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw}/>
        <rect x="47" y="50" width="26" height="18" rx="1.5" fill="none" stroke={str} strokeWidth={sw}/>
        <polyline points="47,52.5 60,60 73,52.5" fill="none" stroke={str} strokeWidth={sw}/>
      </>}
      {type === 'timer-start-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw}/>
        <circle cx="60" cy="60" r="16" fill="none" stroke={str} strokeWidth={sw}/>
        <polyline points="60,49 60,60 68,60" fill="none" stroke={str} strokeWidth={sw}/>
        <line x1="60" y1="41" x2="60" y2="44" stroke={str} strokeWidth={sw}/>
        <line x1="60" y1="76" x2="60" y2="79" stroke={str} strokeWidth={sw}/>
        <line x1="41" y1="60" x2="44" y2="60" stroke={str} strokeWidth={sw}/>
        <line x1="76" y1="60" x2="79" y2="60" stroke={str} strokeWidth={sw}/>
      </>}
      {type === 'conditional-start-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw}/>
        <rect x="49" y="47" width="22" height="26" rx="1" fill="none" stroke={str} strokeWidth={sw}/>
        <line x1="53" y1="53" x2="67" y2="53" stroke={str} strokeWidth={sw - 0.4}/>
        <line x1="53" y1="60" x2="67" y2="60" stroke={str} strokeWidth={sw - 0.4}/>
      </>}
      {type === 'signal-start-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw}/>
        <polygon points="60,45 76,71 44,71" fill="none" stroke={str} strokeWidth={sw}/>
      </>}

      {/* INTERMEDIATE EVENTS */}
      {type === 'intermediate-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw}/>
        <circle cx="60" cy="60" r="25" fill="none" stroke={str} strokeWidth={sw - 0.4}/>
      </>}
      {type === 'message-intermediate-catch' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw}/>
        <circle cx="60" cy="60" r="25" fill="none" stroke={str} strokeWidth={sw - 0.4}/>
        <rect x="47" y="50" width="26" height="18" rx="1.5" fill="none" stroke={str} strokeWidth={sw - 0.4}/>
        <polyline points="47,52.5 60,60 73,52.5" fill="none" stroke={str} strokeWidth={sw - 0.4}/>
      </>}
      {type === 'message-intermediate-throw' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw}/>
        <circle cx="60" cy="60" r="25" fill="none" stroke={str} strokeWidth={sw - 0.4}/>
        <rect x="47" y="50" width="26" height="18" rx="1.5" fill={str} stroke={str} strokeWidth={sw - 0.4}/>
        <polyline points="47,52.5 60,60 73,52.5" fill="none" stroke={fil} strokeWidth={sw - 0.4}/>
      </>}
      {type === 'timer-intermediate-catch' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw}/>
        <circle cx="60" cy="60" r="25" fill="none" stroke={str} strokeWidth={sw - 0.4}/>
        <circle cx="60" cy="60" r="14" fill="none" stroke={str} strokeWidth={sw - 0.4}/>
        <polyline points="60,51 60,60 67,60" fill="none" stroke={str} strokeWidth={sw - 0.4}/>
      </>}
      {type === 'conditional-intermediate-catch' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw}/>
        <circle cx="60" cy="60" r="25" fill="none" stroke={str} strokeWidth={sw - 0.4}/>
        <rect x="49" y="47" width="22" height="26" rx="1" fill="none" stroke={str} strokeWidth={sw - 0.4}/>
        <line x1="53" y1="53" x2="67" y2="53" stroke={str} strokeWidth={sw - 0.6}/>
        <line x1="53" y1="60" x2="67" y2="60" stroke={str} strokeWidth={sw - 0.6}/>
      </>}
      {type === 'signal-intermediate-catch' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw}/>
        <circle cx="60" cy="60" r="25" fill="none" stroke={str} strokeWidth={sw - 0.4}/>
        <polygon points="60,45 76,71 44,71" fill="none" stroke={str} strokeWidth={sw - 0.4}/>
      </>}
      {type === 'signal-intermediate-throw' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw}/>
        <circle cx="60" cy="60" r="25" fill="none" stroke={str} strokeWidth={sw - 0.4}/>
        <polygon points="60,45 76,71 44,71" fill={str} stroke={str} strokeWidth={sw - 0.4}/>
      </>}

      {/* END EVENTS */}
      {type === 'end-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw + 2}/>
        <circle cx="60" cy="60" r="24" fill="#000000" stroke="none"/>
      </>}
      {type === 'message-end-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw}/>
        <circle cx="60" cy="60" r="24" fill="none" stroke={str} strokeWidth={sw + 1.2}/>
        <rect x="48" y="51" width="24" height="16" rx="1" fill="none" stroke={str} strokeWidth={sw - 0.4}/>
        <polyline points="48,53.5 60,60 72,53.5" fill="none" stroke={str} strokeWidth={sw - 0.4}/>
      </>}
      {type === 'error-end-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw}/>
        <circle cx="60" cy="60" r="24" fill="none" stroke={str} strokeWidth={sw + 1.2}/>
        <polygon points="59,44 49,60 59,60 57,75 69,57 59,57" fill="none" stroke={str} strokeWidth={sw - 0.2}/>
      </>}
      {type === 'escalation-end-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw}/>
        <circle cx="60" cy="60" r="24" fill="none" stroke={str} strokeWidth={sw + 1.2}/>
        <polygon points="60,46 72,66 60,59 48,66" fill="none" stroke={str} strokeWidth={sw - 0.2}/>
      </>}
      {type === 'signal-end-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw}/>
        <circle cx="60" cy="60" r="24" fill="none" stroke={str} strokeWidth={sw + 1.2}/>
        <polygon points="60,45 76,71 44,71" fill="none" stroke={str} strokeWidth={sw - 0.2}/>
      </>}
      {type === 'terminate-end-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw}/>
        <circle cx="60" cy="60" r="24" fill="none" stroke={str} strokeWidth={sw + 1.2}/>
        <circle cx="60" cy="60" r="15" fill={str} stroke="none"/>
      </>}

      {/* ACTIVITIES */}
      {type === 'task' && <rect x="10" y="20" width="100" height="80" rx="6" fill={fil} stroke={str} strokeWidth={sw}/>}
      {type === 'user-task' && <>
        <rect x="10" y="20" width="100" height="80" rx="6" fill={fil} stroke={str} strokeWidth={sw}/>
        <circle cx="26" cy="35" r="5" fill="none" stroke={str} strokeWidth="1.5"/>
        <path d="M17,47 C17,42 21,42 26,42 C31,42 35,42 35,47" fill="none" stroke={str} strokeWidth="1.5"/>
      </>}
      {type === 'service-task' && <>
        <rect x="10" y="20" width="100" height="80" rx="6" fill={fil} stroke={str} strokeWidth={sw}/>
        <circle cx="26" cy="36" r="4.5" fill="none" stroke={str} strokeWidth="1.5"/>
        <circle cx="26" cy="36" r="7.5" fill="none" stroke={str} strokeWidth="1.5" strokeDasharray="3 2"/>
      </>}
      {type === 'script-task' && <>
        <rect x="10" y="20" width="100" height="80" rx="6" fill={fil} stroke={str} strokeWidth={sw}/>
        <rect x="18" y="29" width="14" height="16" rx="1" fill="none" stroke={str} strokeWidth="1.5"/>
        <line x1="21" y1="33" x2="29" y2="33" stroke={str} strokeWidth="1"/>
        <line x1="21" y1="37" x2="29" y2="37" stroke={str} strokeWidth="1"/>
      </>}
      {type === 'manual-task' && <>
        <rect x="10" y="20" width="100" height="80" rx="6" fill={fil} stroke={str} strokeWidth={sw}/>
        <path d="M19,45 L19,37 C19,35 20.5,35 20.5,37 L20.5,33 C20.5,31.5 22,31.5 22,33 L22,32 C22,30.5 23.5,30.5 23.5,32 L23.5,33 C23.5,31.5 25,31.5 25,33 L25,45" fill="none" stroke={str} strokeWidth="1.2"/>
      </>}
      {type === 'send-task' && <>
        <rect x="10" y="20" width="100" height="80" rx="6" fill={fil} stroke={str} strokeWidth={sw}/>
        <rect x="18" y="32" width="16" height="11" rx="1" fill="none" stroke={str} strokeWidth="1.2"/>
        <polyline points="18,34 26,39 34,34" fill="none" stroke={str} strokeWidth="1.2"/>
        <path d="M30,29 L36,29 L36,35 M36,29 L28,37" fill="none" stroke={str} strokeWidth="1.2"/>
      </>}
      {type === 'receive-task' && <>
        <rect x="10" y="20" width="100" height="80" rx="6" fill={fil} stroke={str} strokeWidth={sw}/>
        <rect x="18" y="32" width="16" height="11" rx="1" fill="none" stroke={str} strokeWidth="1.2"/>
        <polyline points="18,34 26,39 34,34" fill="none" stroke={str} strokeWidth="1.2"/>
        <path d="M24,29 L18,29 L18,35 M18,29 L26,37" fill="none" stroke={str} strokeWidth="1.2"/>
      </>}
      {type === 'business-rule-task' && <>
        <rect x="10" y="20" width="100" height="80" rx="6" fill={fil} stroke={str} strokeWidth={sw}/>
        <rect x="18" y="30" width="16" height="14" fill="none" stroke={str} strokeWidth="1.5"/>
        <line x1="18" y1="37" x2="34" y2="37" stroke={str} strokeWidth="1"/>
        <line x1="25" y1="30" x2="25" y2="44" stroke={str} strokeWidth="1"/>
      </>}
      {type === 'subprocess' && <>
        <rect x="10" y="16" width="100" height="84" rx="6" fill={fil} stroke={str} strokeWidth={sw}/>
        <rect x="50" y="88" width="20" height="13" rx="2" fill={fil} stroke={str} strokeWidth={sw - 0.5}/>
        <line x1="60" y1="91" x2="60" y2="98" stroke={str} strokeWidth={1.4}/>
        <line x1="57" y1="94.5" x2="63" y2="94.5" stroke={str} strokeWidth={1.4}/>
      </>}
      {type === 'call-activity' && <>
        <rect x="10" y="20" width="100" height="80" rx="6" fill={fil} stroke={str} strokeWidth={sw + 1.5}/>
      </>}

      {/* GATEWAYS */}
      {type === 'exclusive-gateway' && <>
        <polygon points="60,8 112,60 60,112 8,60" fill={fil} stroke={str} strokeWidth={sw}/>
        <line x1="44" y1="44" x2="76" y2="76" stroke={str} strokeWidth={sw + 1}/>
        <line x1="76" y1="44" x2="44" y2="76" stroke={str} strokeWidth={sw + 1}/>
      </>}
      {type === 'parallel-gateway' && <>
        <polygon points="60,8 112,60 60,112 8,60" fill={fil} stroke={str} strokeWidth={sw}/>
        <line x1="60" y1="36" x2="60" y2="84" stroke={str} strokeWidth={sw + 1.2}/>
        <line x1="36" y1="60" x2="84" y2="60" stroke={str} strokeWidth={sw + 1.2}/>
      </>}
      {type === 'inclusive-gateway' && <>
        <polygon points="60,8 112,60 60,112 8,60" fill={fil} stroke={str} strokeWidth={sw}/>
        <circle cx="60" cy="60" r="16" fill="none" stroke={str} strokeWidth={sw + 0.6}/>
      </>}
      {type === 'complex-gateway' && <>
        <polygon points="60,8 112,60 60,112 8,60" fill={fil} stroke={str} strokeWidth={sw}/>
        <line x1="60" y1="34" x2="60" y2="86" stroke={str} strokeWidth={sw + 0.8}/>
        <line x1="34" y1="60" x2="86" y2="60" stroke={str} strokeWidth={sw + 0.8}/>
        <line x1="42" y1="42" x2="78" y2="78" stroke={str} strokeWidth={sw + 0.8}/>
        <line x1="78" y1="42" x2="42" y2="78" stroke={str} strokeWidth={sw + 0.8}/>
      </>}
      {type === 'event-based-gateway' && <>
        <polygon points="60,8 112,60 60,112 8,60" fill={fil} stroke={str} strokeWidth={sw}/>
        <circle cx="60" cy="60" r="18" fill="none" stroke={str} strokeWidth={sw - 0.4}/>
        <circle cx="60" cy="60" r="11" fill="none" stroke={str} strokeWidth={sw - 0.4}/>
      </>}

      {/* SWIMLANES */}
      {type === 'pool' && <rect x="8" y="20" width="104" height="80" rx="3" fill="white" stroke={str} strokeWidth="2" />}
      
      {/* ARTIFACTS */}
      {type === 'data-object' && <>
        <polygon points="22,12 80,12 98,32 98,108 22,108" fill={fil} stroke={str} strokeWidth={sw}/>
        <polyline points="80,12 80,32 98,32" fill="none" stroke={str} strokeWidth={sw - 0.5}/>
      </>}
      {type === 'data-store' && <>
        <path d="M22,30 C22,18 98,18 98,30 C98,42 22,42 22,30" fill={fil} stroke={str} strokeWidth={sw}/>
        <path d="M22,30 L22,90 C22,102 98,102 98,90 L98,30" fill="none" stroke={str} strokeWidth={sw}/>
        <path d="M22,50 C22,62 98,62 98,50" fill="none" stroke={str} strokeWidth={sw}/>
        <path d="M22,70 C22,82 98,82 98,70" fill="none" stroke={str} strokeWidth={sw}/>
      </>}
      {type === 'document' && <>
        <rect x="16" y="10" width="88" height="100" rx="3" fill={fil} stroke={str} strokeWidth={sw}/>
        <line x1="30" y1="38" x2="90" y2="38" stroke={str} strokeWidth={1.3}/>
        <line x1="30" y1="54" x2="90" y2="54" stroke={str} strokeWidth={1.3}/>
        <line x1="30" y1="70" x2="70" y2="70" stroke={str} strokeWidth={1.3}/>
      </>}
      {type === 'annotation' && <>
        <line x1="28" y1="14" x2="12" y2="14" stroke={str} strokeWidth={sw}/>
        <line x1="12" y1="14" x2="12" y2="106" stroke={str} strokeWidth={sw}/>
        <line x1="12" y1="106" x2="28" y2="106" stroke={str} strokeWidth={sw}/>
      </>}
      {type === 'group' && <>
        <rect x="4" y="4" width="112" height="112" rx="8" fill="none" stroke={str} strokeWidth="1.2" strokeDasharray="5 5"/>
      </>}
      {type === 'input' && <>
        <rect x="14" y="24" width="92" height="72" rx="4" fill={fil} stroke={str} strokeWidth={sw}/>
        <polyline points="52,44 36,60 52,76" fill="none" stroke={str} strokeWidth={sw}/>
        <line x1="36" y1="60" x2="84" y2="60" stroke={str} strokeWidth={sw}/>
      </>}
      {type === 'output' && <>
        <rect x="14" y="24" width="92" height="72" rx="4" fill={fil} stroke={str} strokeWidth={sw}/>
        <polyline points="68,44 84,60 68,76" fill="none" stroke={str} strokeWidth={sw}/>
        <line x1="36" y1="60" x2="84" y2="60" stroke={str} strokeWidth={sw}/>
      </>}

      {!['start-event', 'message-start-event', 'timer-start-event', 'conditional-start-event', 'signal-start-event',
         'intermediate-event', 'message-intermediate-catch', 'message-intermediate-throw', 'timer-intermediate-catch', 'conditional-intermediate-catch', 'signal-intermediate-catch', 'signal-intermediate-throw',
         'end-event', 'message-end-event', 'error-end-event', 'escalation-end-event', 'signal-end-event', 'terminate-end-event',
         'task', 'user-task', 'service-task', 'script-task', 'manual-task', 'send-task', 'receive-task', 'business-rule-task', 'subprocess', 'call-activity',
         'exclusive-gateway', 'parallel-gateway', 'inclusive-gateway', 'complex-gateway', 'event-based-gateway',
         'data-object', 'data-store', 'document', 'annotation', 'group', 'input', 'output', 'pool', 'lane'].includes(type) && (
        <rect x="20" y="30" width="80" height="60" rx="4" fill="white" stroke="#9ca3af" strokeWidth="1.5" />
      )}
    </svg>
  );
}

// ─── Dotted canvas background ─────────────────────────────────────────────
const SCENE_GRID = 32;

function DottedCanvas({ children, isEmpty, emptyMsg, onDrop, onDragOver, onMouseDown, onMouseMove, onMouseUp, zoom = 1, pan = { x: 0, y: 0 }, gridType = 'dots', canvasRef }) {
  return (
    <div
      ref={canvasRef}
      className="relative w-full h-full overflow-hidden rounded-xl"
      style={{
        backgroundImage:
          gridType === 'dots'
            ? 'radial-gradient(circle, #d4d4d8 1px, transparent 1px)'
            : gridType === 'lines'
            ? 'linear-gradient(to right, #e2e8f0 1px, transparent 1px), linear-gradient(to bottom, #e2e8f0 1px, transparent 1px)'
            : 'none',
        backgroundSize: gridType !== 'none' ? `${SCENE_GRID * zoom}px ${SCENE_GRID * zoom}px` : 'auto',
        backgroundPosition: gridType !== 'none' ? `${pan.x % (SCENE_GRID * zoom)}px ${pan.y % (SCENE_GRID * zoom)}px` : '0 0',
        backgroundColor: '#f8fafc',
      }}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {/* World-space transform layer — all BPMN elements live here */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {children}
      </div>
      {isEmpty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none px-8">
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white/80 px-10 py-12 text-center max-w-md shadow-sm">
            <svg width="56" height="44" viewBox="0 0 52 40" fill="none" className="mx-auto mb-4 opacity-30">
              <circle cx="16" cy="20" r="12" stroke="#64748b" strokeWidth="2" />
              <circle cx="38" cy="20" r="8" stroke="#64748b" strokeWidth="2" />
              <line x1="28" y1="20" x2="30" y2="20" stroke="#64748b" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <p className="text-sm text-gray-600 leading-relaxed">{emptyMsg}</p>
          </div>
        </div>
      )}
    </div>
  );
}



function ComparisonPane({ scenarios, compareIds, scenarioResults, backendScenarioIds }) {
  if (compareIds.length < 2) return null;

  const [isCollapsed, setIsCollapsed] = useState(false);

  const selectedScenarios = compareIds.map(id => scenarios.find(s => s.id === id)).filter(Boolean);
  const baseline = selectedScenarios.find(s => s._isBaseline) || selectedScenarios[0];
  const others = selectedScenarios.filter(s => s.id !== baseline.id);

  const getMetrics = (s) => {
    const bId = backendScenarioIds[s.id] || s._backendId;
    const res = s._isBaseline ? scenarioResults.baseline : (bId ? scenarioResults[bId] : null);
    
    if (!res) return { cycle: null, throughput: null, maxWait: null };
    
    const tis = res.time_in_system || {};
    const avgCycle = tis.avg ?? res.average_cycle_time ?? res.totalTime ?? null;
    const throughput = extractThroughput(res) * 60; // per hour
    
    // Max Wait
    const queuesObj = res.queue_levels || {};
    const queueRows = Object.keys(res.activity_results || {}).map(id => {
      const qData = queuesObj[id];
      const aData = res.activity_results[id];
      return qData?.avg_wait_time ?? aData?.avg_wait_time ?? 0;
    });
    const maxWait = queueRows.length > 0 ? Math.max(0, ...queueRows) : null;

    return { cycle: avgCycle, throughput, maxWait };
  };

  const baseMetrics = getMetrics(baseline);

  const renderDiff = (baseVal, newVal, invertGood = false) => {
    if (baseVal == null || newVal == null || baseVal === 0) return null;
    const diff = newVal - baseVal;
    if (Math.abs(diff) < 0.01) return <span className="text-gray-400 text-[10px] ml-1">(-)</span>;
    const pct = ((diff / baseVal) * 100).toFixed(1);
    
    const isGood = invertGood ? diff > 0 : diff < 0;
    const color = isGood ? 'text-emerald-600' : 'text-rose-600';
    const sign = diff > 0 ? '+' : '';
    return <span className={`${color} text-[10px] font-semibold ml-1`}>({sign}{pct}%)</span>;
  };

  return (
    <div className={`shrink-0 bg-white border-t border-gray-200/80 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] w-full px-6 transition-all duration-200 ${
      isCollapsed ? 'py-2.5' : 'h-[240px] flex flex-col py-3 overflow-hidden'
    }`}>
      <div 
        className="flex items-center justify-between cursor-pointer select-none shrink-0"
        onClick={() => setIsCollapsed(c => !c)}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title={isCollapsed ? "Expand comparison table" : "Collapse comparison table"}
            onClick={(e) => {
              e.stopPropagation();
              setIsCollapsed(c => !c);
            }}
          >
            <ChevronDown size={15} className={`transition-transform duration-150 ${isCollapsed ? '-rotate-90' : ''}`} />
          </button>
          <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <GitCompare size={16} className="text-violet-500" />
            Scenario Comparison
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {compareIds.length > MAX_COMPARE && (
            <span className="text-xs text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
              Compare up to {MAX_COMPARE} at a time
            </span>
          )}
          <span className="text-xs text-gray-500">{compareIds.length} scenarios selected</span>
        </div>
      </div>
      
      {!isCollapsed && (
        <div className="mt-2 flex-1 min-h-0 overflow-y-auto overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="py-2 font-medium text-gray-500">Scenario</th>
              <th className="py-2 font-medium text-gray-500">Avg Cycle Time</th>
              <th className="py-2 font-medium text-gray-500">Throughput /hr</th>
              <th className="py-2 font-medium text-gray-500">Max Wait Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {selectedScenarios.map(s => {
              const m = getMetrics(s);
              const isBase = s.id === baseline.id;
              
              return (
                <tr key={s.id} className={isBase ? 'bg-slate-50/50' : ''}>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${s._isBaseline ? 'bg-sky-500' : 'bg-violet-400'}`} />
                      <span className={`font-medium ${isBase ? 'text-gray-900' : 'text-gray-700'}`}>{s.name}</span>
                      {isBase && <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 font-semibold uppercase">Base</span>}
                    </div>
                  </td>
                  <td className="py-2.5 text-gray-800 font-medium">
                    {m.cycle != null ? fmt(m.cycle) : '—'}
                    {!isBase && renderDiff(baseMetrics.cycle, m.cycle)}
                  </td>
                  <td className="py-2.5 text-gray-800 font-medium">
                    {m.throughput != null ? m.throughput.toFixed(1) : '—'}
                    {!isBase && renderDiff(baseMetrics.throughput, m.throughput, true)}
                  </td>
                  <td className="py-2.5 text-gray-800 font-medium">
                    {m.maxWait != null ? fmt(m.maxWait) : '—'}
                    {!isBase && renderDiff(baseMetrics.maxWait, m.maxWait)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

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

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ScenariosPage() {
  // ── Backend state ────────────────────────────────────────────────────────────
  const baseProcessId = localStorage.getItem('spot:processId') || null;
  const navigate = useNavigate();
  const [backendScenarioIds, setBackendScenarioIds] = useState({}); // { localId: backendId }
  const [scenarioSaving, setScenarioSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved'
  const savedTimerRef = useRef(null);
  const [scenarioSimulating, setScenarioSimulating] = useState({}); // { backendId: bool }
  const [scenarioResults, setScenarioResults] = useState({});       // { backendId: results }
  const [backendMsg, setBackendMsg]   = useState(null);

  const showMsg = (type, text) => {
    setBackendMsg({ type, text });
    setTimeout(() => setBackendMsg(null), 3500);
  };

  const [scenarios, setScenarios] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [compareIds, setCompareIds] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({ name: '', description: '' });

  const [gridType, setGridType] = useState('dots'); // 'none' | 'dots' | 'lines'
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 60, y: 60 });
  const [allSelected, setAllSelected] = useState(false);
  const canvasRef = useRef(null);
  const canvasPanRef = useRef(null);
  const spaceRef = useRef(false);

  // canvas elements per scenario id
  const [canvases, setCanvases] = useState({});  // { [id]: Element[] }
  const [canvasConnections, setCanvasConnections] = useState({}); // { [id]: Connection[] }
  const [templateElements, setTemplateElements] = useState([]);
  const [templateConnections, setTemplateConnections] = useState([]);
  const [resourceAllocations, setResourceAllocations] = useState(() => {
    let initialResources = DEFAULT_RESOURCES;
    try {
      const stored = localStorage.getItem('spot:globalResources');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          initialResources = parsed.map(r => {
            const defaultRes = DEFAULT_RESOURCES.find(d => d.id === r.id);
            return {
              ...r,
              icon: defaultRes ? defaultRes.icon : Box
            };
          });
        }
      }
    } catch {}
    return {
      baseline: initialResources
    };
  });

  const [renamingTabId, setRenamingTabId] = useState(null);
  const [renamingTabText, setRenamingTabText] = useState('');

  const [showSimConfigModal, setShowSimConfigModal] = useState(false);
  const [simConfigMode, setSimConfigMode] = useState('deep');
  const [simConfigInstances, setSimConfigInstances] = useState(500);
  const [simConfigArrivalValue, setSimConfigArrivalValue] = useState(10);
  const [simConfigArrivalUnit, setSimConfigArrivalUnit] = useState('minutes');


  // Right task settings sidebar states
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(340);

  const elements = activeId ? (canvases[activeId] || []) : [];
  const selectedTask = activeId ? (canvases[activeId] || []).find(el => el.id === selectedTaskId) : null;

  const startRightResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rightSidebarWidth;
    const onMove = (me) => setRightSidebarWidth(Math.max(280, Math.min(600, startW - (me.clientX - startX))));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const connections = activeId ? (canvasConnections[activeId] || []) : [];

  // Refs for tracking synchronous changes to prevent race conditions during baseline forking
  const activeIdRef = useRef(activeId);
  const canvasesRef = useRef(canvases);
  const canvasConnectionsRef = useRef(canvasConnections);
  const resourceAllocationsRef = useRef(resourceAllocations);
  const scenariosRef = useRef(scenarios);
  const backendScenarioIdsRef = useRef(backendScenarioIds);
  const baselineForkedThisSessionRef = useRef(false);
  const hasLoadedBackendScenariosRef = useRef(null);

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { canvasesRef.current = canvases; }, [canvases]);
  useEffect(() => { canvasConnectionsRef.current = canvasConnections; }, [canvasConnections]);
  useEffect(() => { resourceAllocationsRef.current = resourceAllocations; }, [resourceAllocations]);
  useEffect(() => { scenariosRef.current = scenarios; }, [scenarios]);
  useEffect(() => { backendScenarioIdsRef.current = backendScenarioIds; }, [backendScenarioIds]);

  // Debounced auto-save function
  const saveTimeoutRef = useRef(null);
  const saveScenarioDebounced = useCallback((localId) => {
    if (localId === 'baseline') return; // Read-only baseline in scenarios never auto-saves or shows saving
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      const baseId = localStorage.getItem('spot:processId') || null;
      if (!baseId) {
        setScenarioSaving(false);
        setSaveStatus('idle');
        return;
      }

      const els = canvasesRef.current[localId] || [];
      const conns = canvasConnectionsRef.current[localId] || [];
      const resList = resourceAllocationsRef.current[localId] || DEFAULT_RESOURCES;
      const scenario = scenariosRef.current.find(s => s.id === localId);
      if (!scenario) {
        setScenarioSaving(false);
        setSaveStatus('idle');
        return;
      }
      const title = scenario.name;

      setScenarioSaving(true);
      setSaveStatus('saving');
      try {
        const shaped = shapeFrontendToBackend(els, conns, title, resList);
        const backendId = backendScenarioIdsRef.current[localId] || scenario._backendId;

        // Preserve bend and probability overrides onto backend edges
        const preservedEdges = shaped.edges.map((edge, idx) => {
          const orig = conns[idx] || conns.find(c => (c.fromId || c.from) === edge.source && (c.toId || c.to) === edge.target);
          return {
            ...edge,
            id: orig?.id || edge.id,
            bend: orig?.bend,
            data: {
              ...(edge.data || {}),
              bend: orig?.bend,
              probability: orig?.probability != null ? Number(orig.probability) : edge.data?.probability,
            }
          };
        });

        const layoutEls = els.filter(el => el.type === 'pool' || el.type === 'lane');
        if (backendId) {
          await updateScenario(backendId, title, shaped.nodes, preservedEdges, shaped.resources, shaped.layoutElements || layoutEls);
        } else if (scenario._allowCreate) {
          console.trace('[Trace createScenario] Explicitly created scenario saving to backend:', title);
          const res = await createScenario(baseId, title, shaped.nodes, preservedEdges, shaped.resources, shaped.layoutElements || layoutEls);
          const newBackendId = res.scenario?._id;
          if (newBackendId) {
            backendScenarioIdsRef.current[localId] = newBackendId;
            setBackendScenarioIds(prev => ({ ...prev, [localId]: newBackendId }));
            setScenarios(prev => prev.map(s => s.id === localId ? { ...s, _backendId: newBackendId, _allowCreate: false } : s));
            scenariosRef.current = scenariosRef.current.map(s => s.id === localId ? { ...s, _backendId: newBackendId, _allowCreate: false } : s);
          }
        } else {
          console.warn('[AutoSave] Prevented unintended createScenario call for', localId);
        }
        setSaveStatus('saved');
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => {
          setSaveStatus('idle');
        }, 2000);
      } catch (err) {
        console.error("Failed to auto-save scenario:", err);
        setSaveStatus('idle');
      } finally {
        setScenarioSaving(false);
      }
    }, 500);
  }, []);

  // Synchronous baseline forking
  const forkBaseline = useCallback(() => {
    const newName = getUniqueScenarioName("What-If Scenario", scenariosRef.current);
    const localId = Date.now().toString();

    // 1. Update refs synchronously
    activeIdRef.current = localId;
    const baseEls = canvasesRef.current['baseline'] || [];
    const baseConns = canvasConnectionsRef.current['baseline'] || [];
    const baseRes = resourceAllocationsRef.current['baseline'] || DEFAULT_RESOURCES;

    canvasesRef.current[localId] = JSON.parse(JSON.stringify(baseEls));
    canvasConnectionsRef.current[localId] = JSON.parse(JSON.stringify(baseConns));
    resourceAllocationsRef.current[localId] = cloneResourceList(baseRes);
    const nowIso = new Date().toISOString();
    scenariosRef.current = [...scenariosRef.current, { id: localId, name: newName, description: 'Created new scenario', _backendId: null, _allowCreate: true, updatedAt: nowIso, createdAt: nowIso }];

    // 2. Update states
    setActiveId(localId);
    setScenarios(scenariosRef.current);
    setCanvases(prev => ({ ...prev, [localId]: JSON.parse(JSON.stringify(baseEls)) }));
    setCanvasConnections(prev => ({ ...prev, [localId]: JSON.parse(JSON.stringify(baseConns)) }));
    setResourceAllocations(prev => ({ ...prev, [localId]: cloneResourceList(baseRes) }));

    // 3. Trigger debounced save
    saveScenarioDebounced(localId);

    return localId;
  }, [saveScenarioDebounced]);

  // Combined synchronous updater
  const updateElementsAndConnections = useCallback((elementUpdater, connectionUpdater, isUserEvent = false) => {
    if (!activeIdRef.current) return;
    let targetActiveId = activeIdRef.current;

    // Never mutate the Baseline canvas in place. The Baseline tab represents
    // your original saved model — editing it directly would silently
    // overwrite that model on the backend and there'd be nothing left to
    // compare a what-if against. So the first edit made while on Baseline
    // auto-forks into a new What-If scenario and continues there instead.
    if (targetActiveId === 'baseline') {
      // Must only run from a REAL user edit event (pointer/keyboard) on the baseline.
      // Never from useEffect, hydration, layout repair, position normalization, zoom/pan or focus sync.
      if (!isUserEvent) {
        return;
      }
      // Baseline auto-create fires at most once per edit session
      if (baselineForkedThisSessionRef.current) {
        targetActiveId = activeIdRef.current;
        if (targetActiveId === 'baseline') return;
      } else {
        baselineForkedThisSessionRef.current = true;
        targetActiveId = forkBaseline();
        showMsg('info', 'Baseline is read-only — created a new What-If scenario for your changes.');
      }
    }

    let nextEls = canvasesRef.current[targetActiveId] || canvasesRef.current['baseline'] || [];
    let nextConns = canvasConnectionsRef.current[targetActiveId] || canvasConnectionsRef.current['baseline'] || [];

    if (elementUpdater) {
      nextEls = typeof elementUpdater === 'function' ? elementUpdater(nextEls) : elementUpdater;
    }
    if (connectionUpdater) {
      nextConns = typeof connectionUpdater === 'function' ? connectionUpdater(nextConns) : connectionUpdater;
    }

    canvasesRef.current[targetActiveId] = nextEls;
    canvasConnectionsRef.current[targetActiveId] = nextConns;

    setCanvases(prev => ({ ...prev, [targetActiveId]: nextEls }));
    setCanvasConnections(prev => ({ ...prev, [targetActiveId]: nextConns }));

    // Trigger debounced save
    saveScenarioDebounced(targetActiveId);
  }, [saveScenarioDebounced, forkBaseline]);

  const setElements = useCallback((updater, isUserEvent = false) => {
    updateElementsAndConnections(updater, null, isUserEvent);
  }, [updateElementsAndConnections]);

  const setConnections = useCallback((updater, isUserEvent = false) => {
    updateElementsAndConnections(null, updater, isUserEvent);
  }, [updateElementsAndConnections]);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [selectedElement, setSelectedElement] = useState(null);
  const [showCanvasTip, setShowCanvasTip] = useState(true);
  const [drawingConnection, setDrawingConnection] = useState(null);
  const [canvasMousePos, setCanvasMousePos] = useState({ x: 0, y: 0 });
  const [hoveredElement, setHoveredElement] = useState(null);

  // ── Zoom / Pan ──────────────────────────────────────────────────────────────
  const zoomToCenter = useCallback((factor) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = rect.width / 2, my = rect.height / 2;
    setZoom(z => {
      const nz = Math.min(3, Math.max(0.15, z * factor));
      setPan(p => ({ x: mx - (mx - p.x) * (nz / z), y: my - (my - p.y) * (nz / z) }));
      return nz;
    });
  }, []);

  const fitView = useCallback(() => {
    const els = (activeId ? (canvases[activeId] || []) : []).map(normalizeCanvasElement);
    if (!els.length || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    els.forEach(el => {
      const w = el.width || 80, h = el.height || 80;
      minX = Math.min(minX, el.position.x);
      minY = Math.min(minY, el.position.y);
      maxX = Math.max(maxX, el.position.x + w);
      maxY = Math.max(maxY, el.position.y + h);
    });
    const pad = 80, dw = maxX - minX + pad * 2, dh = maxY - minY + pad * 2;
    const nz = Math.min(3, Math.max(0.15, Math.min(rect.width / dw, rect.height / dh)));
    setZoom(nz);
    setPan({ x: (rect.width - dw * nz) / 2 + pad * nz - minX * nz, y: (rect.height - dh * nz) / 2 + pad * nz - minY * nz });
  }, [activeId, canvases]);

  const lastFittedId = useRef(null);
  useEffect(() => {
    if (activeId && canvases[activeId]?.length > 0 && lastFittedId.current !== activeId) {
      lastFittedId.current = activeId;
      const timer = setTimeout(() => {
        fitView();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [activeId, canvases, fitView]);

  // Wheel zoom — zoom to cursor position
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = e => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const delta = Math.exp(-e.deltaY * 0.0015);
      setZoom(z => {
        const nz = Math.min(3, Math.max(0.15, z * delta));
        setPan(p => ({ x: mx - (mx - p.x) * (nz / z), y: my - (my - p.y) * (nz / z) }));
        return nz;
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  });

  // Space key tracking for pan
  useEffect(() => {
    const kd = e => { if (e.code === 'Space' && !e.target.matches('input,textarea')) { e.preventDefault(); spaceRef.current = true; } };
    const ku = e => { if (e.code === 'Space') spaceRef.current = false; };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, []);

  // Canvas mousedown — starts panning on space+drag or middle mouse
  const handleCanvasMouseDown = useCallback((e) => {
    if (spaceRef.current || e.button === 1) {
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      const startPanX = pan.x, startPanY = pan.y;
      canvasPanRef.current = true;
      const handleWindowMove = (ev) => {
        setPan({ x: startPanX + ev.clientX - startX, y: startPanY + ev.clientY - startY });
      };
      const handleWindowUp = () => {
        canvasPanRef.current = null;
        window.removeEventListener('mousemove', handleWindowMove);
        window.removeEventListener('mouseup', handleWindowUp);
      };
      window.addEventListener('mousemove', handleWindowMove);
      window.addEventListener('mouseup', handleWindowUp);
    }
  }, [pan.x, pan.y]);

  // Backend state declared at top of ScenariosPage component

  // Load existing backend scenarios on mount if we have a base process
  useEffect(() => {
    if (!baseProcessId) return;
    (async () => {
      try {
        const list = await getScenarios(baseProcessId);
        if (!list?.length) return;

        // Fetch base process directly from API (avoiding in-memory race)
        let baseProcessData = null;
        try {
          baseProcessData = await getProcess(baseProcessId);
        } catch (err) {
          console.warn('Could not fetch base process for scenario hydration:', err);
        }

        let baseConns = [];
        let basePoolsLanes = [];
        let baseNodes = [];
        const baseNodeIds = new Set();

        if (baseProcessData) {
          const shapedBase = shapeBackendToFrontend(baseProcessData);
          baseConns = shapedBase.connections || [];
          const seenLayout = new Set();
          if (Array.isArray(baseProcessData.layoutElements)) {
            baseProcessData.layoutElements.forEach((el) => {
              if ((el.type === 'pool' || el.type === 'lane') && !seenLayout.has(el.id)) {
                seenLayout.add(el.id);
                basePoolsLanes.push({ ...el });
              }
            });
          }
          (shapedBase.elements || []).forEach((el) => {
            if (el.type === 'pool' || el.type === 'lane') {
              if (!seenLayout.has(el.id)) {
                seenLayout.add(el.id);
                basePoolsLanes.push({ ...el });
              }
            } else {
              baseNodes.push(el);
              baseNodeIds.add(el.id);
            }
          });
        }

        // Merge backend scenarios into local state (avoid duplicates by title)
        const names = [...scenariosRef.current.map((s) => s.name)];
        const newOnes = list.map((bs) => {
          const uniqueTitle = getUniqueScenarioName(bs.title, names);
          names.push(uniqueTitle);
          return { id: bs._id, name: uniqueTitle, description: '', _backendId: bs._id, updatedAt: bs.updatedAt, createdAt: bs.createdAt };
        });
        setScenarios((prev) => [...prev, ...newOnes]);
        scenariosRef.current = [...scenariosRef.current, ...newOnes];

        const idMap = {};
        list.forEach((bs) => { idMap[bs._id] = bs._id; });
        setBackendScenarioIds((prev) => ({ ...prev, ...idMap }));

        // Populate canvases, connections and resources
        const newCanvases = {};
        const newConnections = {};
        const newResources = {};
        const hydratedIds = new Set();

        list.forEach((bs) => {
          const { elements: scenEls, connections: scenConns } = shapeBackendToFrontend(bs);
          // Preserve bend and probability from raw bs.edges
          const enrichedConns = scenConns.map((conn, idx) => {
            const rawEdge = bs.edges?.[idx] || bs.edges?.find(e => e.source === (conn.fromId || conn.from) && e.target === (conn.toId || conn.to));
            return {
              ...conn,
              bend: rawEdge?.bend || rawEdge?.data?.bend || conn.bend,
              probability: rawEdge?.data?.probability ?? rawEdge?.probability ?? conn.probability,
            };
          });

          // Step P1: LOG count of pool/lane elements and set of node types
          const poolLaneCount = scenEls.filter((e) => e.type === 'pool' || e.type === 'lane').length;
          const scenNodeTypes = new Set((bs.nodes || []).map((n) => n.data?.customType || n.type));
          console.log(`[Scenario "${bs.title}"] Pool/Lane count: ${poolLaneCount}, Node types:`, Array.from(scenNodeTypes));

          const scenNonContainerNodes = scenEls.filter((e) => e.type !== 'pool' && e.type !== 'lane');
          const isSubset = scenNonContainerNodes.length > 0 && scenNonContainerNodes.every((sn) => baseNodeIds.has(sn.id));

          let finalEls = scenEls;
          let finalConns = enrichedConns;

          // Hydration condition:
          // Scenario has NO pool/lane elements, base process has at least one, and every scenario node id exists in base
          if (poolLaneCount === 0 && basePoolsLanes.length > 0 && isSubset) {
            const hydratedNodes = baseNodes.map((bn) => {
              const scenNode = scenNonContainerNodes.find((sn) => sn.id === bn.id);
              if (!scenNode || !scenNode.data) return { ...bn };

              const taskOverrides = {};
              if (scenNode.data.duration !== undefined) taskOverrides.duration = scenNode.data.duration;
              if (scenNode.data.duration_min !== undefined) taskOverrides.duration_min = scenNode.data.duration_min;
              if (scenNode.data.duration_max !== undefined) taskOverrides.duration_max = scenNode.data.duration_max;
              if (scenNode.data.duration_unit !== undefined) taskOverrides.duration_unit = scenNode.data.duration_unit;
              if (scenNode.data.resources !== undefined) taskOverrides.resources = scenNode.data.resources;
              if (scenNode.data.resource !== undefined) taskOverrides.resource = scenNode.data.resource;

              return {
                ...bn,
                data: {
                  ...bn.data,
                  ...taskOverrides,
                },
              };
            });

            finalEls = [...basePoolsLanes, ...hydratedNodes];
            finalConns = baseConns.map(bc => {
              const match = enrichedConns.find(ec => (ec.fromId || ec.from) === (bc.fromId || bc.from) && (ec.toId || ec.to) === (bc.toId || bc.to));
              return match ? { ...bc, ...match } : bc;
            });
            hydratedIds.add(bs._id);

            // Update refs immediately and persist layout via PUT to existing scenario (never create a new one)
            canvasesRef.current[bs._id] = finalEls;
            canvasConnectionsRef.current[bs._id] = finalConns;
            try {
              const shaped = shapeFrontendToBackend(finalEls, finalConns, bs.title, bs.resources || DEFAULT_RESOURCES);
              const layoutEls = finalEls.filter(el => el.type === 'pool' || el.type === 'lane');
              updateScenario(bs._id, bs.title, shaped.nodes, shaped.edges, shaped.resources, shaped.layoutElements || layoutEls).catch(err => {
                console.warn('[Hydration] Failed to persist layout to existing scenario:', err);
              });
            } catch (err) {
              console.warn('[Hydration] Error shaping layout:', err);
            }
          }

          newCanvases[bs._id] = finalEls;
          newConnections[bs._id] = finalConns;

          if (bs.resources) {
            newResources[bs._id] = bs.resources.map((r) => {
              const defaultRes = DEFAULT_RESOURCES.find((d) => d.id === r.id);
              return {
                id: r.id,
                displayName: r.name || r.id,
                icon: defaultRes ? defaultRes.icon : Box,
                type: r.type || 'staff',
                quantity: r.quantity ?? 0,
                hours_per_day: r.hours_per_day,
                working_days_per_month: r.working_days_per_month,
                monthly_salary: r.monthly_salary,
                purchase_price: r.purchase_price,
                lifespan_months: r.lifespan_months,
                monthly_running_cost: r.monthly_running_cost,
                monthly_rent: r.monthly_rent,
              };
            });
          } else {
            newResources[bs._id] = DEFAULT_RESOURCES;
          }
        });

        setCanvases((prev) => ({ ...prev, ...newCanvases }));
        setCanvasConnections((prev) => ({ ...prev, ...newConnections }));
        setResourceAllocations((prev) => ({ ...prev, ...newResources }));

        if (hydratedIds.size > 0) {
          setHydratedScenarioIds(hydratedIds);
        }

        const urlScenarioId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('scenarioId') : null;
        if (urlScenarioId && (newCanvases[urlScenarioId] || list.some(b => b._id === urlScenarioId))) {
          setActiveId(urlScenarioId);
          activeIdRef.current = urlScenarioId;
        } else if ((!activeIdRef.current || activeIdRef.current === 'baseline') && list.length > 0) {
          const baseNodes = canvasesRef.current['baseline'] || [];
          if (baseNodes.length === 0 && list[0]) {
            setActiveId(list[0]._id);
            activeIdRef.current = list[0]._id;
          }
        }

        // Restore any existing results
        const results = {};
        list.forEach((bs) => { if (bs.simulationResults) results[bs._id] = bs.simulationResults; });
        setScenarioResults(results);
      } catch (err) {
        console.warn('Failed to load scenarios:', err);
      }
    })();
  }, [baseProcessId]);

  // Track mouse position for connection drawing and paste position
  useEffect(() => {
    const handleMouseMove = (e) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);
  const [editingLabelId, setEditingLabelId] = useState(null);
  const [editingLabelText, setEditingLabelText] = useState('');
  const [editingResource, setEditingResource] = useState(null);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [hydratedScenarioIds, setHydratedScenarioIds] = useState(new Set());
  const [dismissedHydratedIds, setDismissedHydratedIds] = useState(new Set());
  const [paletteExpanded, setPaletteExpanded] = useState(new Set(['events', 'activities', 'gateways', 'flows']));
  const [paletteShowAdv, setPaletteShowAdv] = useState(new Set());
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Auto-dismiss "Restored layout from base" chip after 5 seconds on active scenario
  useEffect(() => {
    if (activeId && hydratedScenarioIds.has(activeId) && !dismissedHydratedIds.has(activeId)) {
      const timer = setTimeout(() => {
        setDismissedHydratedIds((prev) => new Set(prev).add(activeId));
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [activeId, hydratedScenarioIds, dismissedHydratedIds]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);
  const [selectedConnId, setSelectedConnId] = useState(null);
  const connDragging = useRef(null);

  const beginConnBendDrag = useCallback((e, connId) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelectedConnId(connId);
    setSelectedTaskId(null);
    connDragging.current = { id: connId };

    const onWindowMove = (ev) => {
      if (!connDragging.current) return;
      const cid = connDragging.current.id;
      const targetId = activeIdRef.current;
      const currentConns = canvasConnectionsRef.current[targetId] || [];
      const conn = currentConns.find(cn => cn.id === cid);
      if (!conn) return;
      const currentEls = canvasesRef.current[targetId] || [];
      const from = currentEls.find(el => el.id === (conn.fromId || conn.from));
      const to = currentEls.find(el => el.id === (conn.toId || conn.to));
      if (!from || !to) return;
      const { fp, tp } = bestPorts(from, to);
      const mid = { x: (fp.x + tp.x) / 2, y: (fp.y + tp.y) / 2 };
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const wx = (ev.clientX - rect.left - pan.x) / zoom;
      const wy = (ev.clientY - rect.top - pan.y) / zoom;
      setConnections(prev => prev.map(cn => cn.id === cid
        ? { ...cn, bend: { x: Math.round(wx - mid.x), y: Math.round(wy - mid.y) } }
        : cn));
    };

    const onWindowUp = () => {
      connDragging.current = null;
      window.removeEventListener('mousemove', onWindowMove);
      window.removeEventListener('mouseup', onWindowUp);
    };

    window.addEventListener('mousemove', onWindowMove);
    window.addEventListener('mouseup', onWindowUp);
  }, [pan.x, pan.y, zoom, setConnections]);

  const updateConnectionProbability = useCallback((connId, probability) => {
    setConnections(prev => prev.map(c => c.id === connId ? { ...c, probability } : c));
  }, [setConnections]);

  const handleSaveResourceConfig = useCallback((updatedRes) => {
    setResourceAllocations(prev => {
      const current = prev[activeId] || prev['baseline'] || DEFAULT_RESOURCES;
      return {
        ...prev,
        [activeId]: current.map(r => r.id === updatedRes.id ? updatedRes : r)
      };
    });
    setEditingResource(null);
  }, [activeId]);
  // Load & sync Baseline from Model page on mount and on window focus
  useEffect(() => {
    const syncBaselineFromModel = () => {
      const saved = localStorage.getItem('spot:model:nodes');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          const els = parsed?.nodes || (Array.isArray(parsed) ? parsed : []);
          const conns = parsed?.connections || [];
          if (els.length > 0) {
            localStorage.setItem('spot:scenario_template', saved);
            
            const baselineTitle = localStorage.getItem('spot:processTitle') || 'Baseline (Original)';
            
            // Sync viewport (zoom and pan) from Model page
            const savedVP = localStorage.getItem('spot:model:viewport');
            if (savedVP) {
              try {
                const vp = JSON.parse(savedVP);
                if (typeof vp.zoom === 'number' && vp.pan) {
                  setZoom(vp.zoom);
                  setPan(vp.pan);
                }
              } catch (e) {}
            }

            // Add or update Baseline scenario in list
            setScenarios(prev => {
              const hasBaseline = prev.some(s => s.id === 'baseline');
              if (hasBaseline) {
                return prev.map(s => s.id === 'baseline' ? { ...s, name: baselineTitle } : s);
              }
              return [{ id: 'baseline', name: baselineTitle, description: 'Original model', _isBaseline: true }, ...prev];
            });
            
            // Sync baseline canvas elements and connections from Model page
            setCanvases(prev => ({ ...prev, baseline: els }));
            setCanvasConnections(prev => ({ ...prev, baseline: conns }));
            
            const urlScenarioId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('scenarioId') : null;
            const savedActive = localStorage.getItem('spot:activeScenarioId');
            if (urlScenarioId) {
              setActiveId(urlScenarioId);
            } else if (savedActive) {
              setActiveId(savedActive);
              localStorage.removeItem('spot:activeScenarioId');
            } else if (!activeId) {
              setActiveId('baseline');
            }
            
            // Load Baseline simulation results if available
            const savedResults = localStorage.getItem('spot:simulationResults');
            if (savedResults) {
              try {
                const parsedRes = JSON.parse(savedResults);
                setScenarioResults(prev => ({ ...prev, baseline: parsedRes }));
              } catch (e) {}
            }
          }
        } catch {}
      }
    };

    syncBaselineFromModel();
    window.addEventListener('focus', syncBaselineFromModel);
    return () => window.removeEventListener('focus', syncBaselineFromModel);
  }, []);
  const { contextMenu, setContextMenu, clipboard, setClipboard, handleCopy, handleCut, handlePaste, handleDelete } = useContextMenu();

  const openCreate = (cloneFromId = 'baseline', customBaseName = null) => {
    const rawName = customBaseName || 'What-If Scenario';
    const newName = getUniqueScenarioName(rawName, scenariosRef.current);
    const localId = Date.now().toString();

    const baseEls = canvasesRef.current[cloneFromId] || canvasesRef.current['baseline'] || [];
    const baseConns = canvasConnectionsRef.current[cloneFromId] || canvasConnectionsRef.current['baseline'] || [];
    const baseRes = resourceAllocationsRef.current[cloneFromId] || resourceAllocationsRef.current['baseline'] || DEFAULT_RESOURCES;

    canvasesRef.current[localId] = JSON.parse(JSON.stringify(baseEls));
    canvasConnectionsRef.current[localId] = JSON.parse(JSON.stringify(baseConns));
    resourceAllocationsRef.current[localId] = cloneResourceList(baseRes);
    const nowIso = new Date().toISOString();
    scenariosRef.current = [...scenariosRef.current, { id: localId, name: newName, description: 'Created new scenario', _backendId: null, _allowCreate: true, updatedAt: nowIso, createdAt: nowIso }];

    setActiveId(localId);
    setScenarios(scenariosRef.current);
    setCanvases(prev => ({ ...prev, [localId]: JSON.parse(JSON.stringify(baseEls)) }));
    setCanvasConnections(prev => ({ ...prev, [localId]: JSON.parse(JSON.stringify(baseConns)) }));
    setResourceAllocations(prev => ({ ...prev, [localId]: cloneResourceList(baseRes) }));
    saveScenarioDebounced(localId);
  };

  const duplicateScenario = (sourceId) => {
    const src = scenariosRef.current.find(s => s.id === (sourceId || activeId));
    if (!src) return;
    const newName = getUniqueScenarioName(src.name, scenariosRef.current);
    openCreate(src.id, newName);
    showMsg('success', `Duplicated as "${newName}"`);
  };

  const handleRenameTab = (id, newName) => {
    if (!newName.trim()) return;
    const uniqueName = getUniqueScenarioName(newName.trim(), scenariosRef.current.filter(s => s.id !== id));
    setScenarios(prev => prev.map(s => s.id === id ? { ...s, name: uniqueName } : s));
    setRenamingTabId(null);
    
    // Auto-save renaming to backend
    setTimeout(() => {
      saveScenarioDebounced(id);
    }, 100);
  };

  // FIX: this used to call runScenarioSimulation(backendId) directly, with no
  // config. That sent { config: {} } to the backend — an empty object is
  // truthy, so it defeated the backend's own default fallback and forwarded
  // an unconfigured request straight to the simulation engine (silently
  // reintroducing the arrival_rate default-to-1.0/min bug). It also never
  // ran a matching baseline, never saved results to localStorage, and never
  // let you pick Quick vs Detailed, since it skipped the config modal
  // entirely. Now it just opens the same modal the toolbar "Run Simulation"
  // button uses, so both buttons share one correct, configured code path.
  const handleSimulateScenario = (localId) => {
    const backendId = backendScenarioIds[localId] ||
      scenarios.find(s => s.id === localId)?._backendId;
    if (!backendId) {
      showMsg('error', 'Scenario not yet saved to backend. Please re-save.');
      return;
    }
    if (activeId !== localId) {
      setActiveId(localId);
    }
    setShowSimConfigModal(true);
  };

  const executeSimulationRun = useCallback(async (simConfig) => {
    if (!activeId) return;
    if (activeId === 'baseline') {
      const baseId = localStorage.getItem('spot:processId') || null;
      if (!baseId) {
        showMsg('error', 'No base process ID found.');
        return;
      }
      setScenarioSimulating(prev => ({ ...prev, baseline: true }));
      try {
        const res = await runSimulation(baseId, simConfig);
        const results = res.results || res;
        results.mode = simConfig.mode;
        setScenarioResults(prev => ({ ...prev, baseline: results }));
        
        // Save to standard keys
        localStorage.setItem('spot:simulationResults', JSON.stringify(results));
        localStorage.setItem('spot:baselineResults', JSON.stringify(results));
        localStorage.setItem('spot:hasWhatIfResults', 'false');
        localStorage.removeItem('spot:comparisonResults');
        
        showMsg('success', 'Baseline simulation complete! Navigating to results...');
        setTimeout(() => {
          navigate('/results');
        }, 1000);
      } catch (err) {
        showMsg('error', `Baseline simulation failed: ${err.message}`);
      } finally {
        setScenarioSimulating(prev => ({ ...prev, baseline: false }));
      }
      return;
    }
    // Check if there's a backend scenario ID, otherwise trigger a save first
    let backendId = backendScenarioIds[activeId] || scenarios.find(s => s.id === activeId)?._backendId;
    const baseId = localStorage.getItem('spot:processId') || null;
    if (!baseId) {
      showMsg('error', 'No base process found.');
      return;
    }
    const els = canvasesRef.current[activeId] || [];
    const conns = canvasConnectionsRef.current[activeId] || [];
    const resList = resourceAllocationsRef.current[activeId] || DEFAULT_RESOURCES;
    const scenario = scenariosRef.current.find(s => s.id === activeId);
    if (!scenario) return;
    const title = scenario.name;

    // Cancel any pending debounced auto-save — we're about to do a synchronous
    // save ourselves, and we don't want a stale queued save to race/overwrite it.
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    showMsg('info', backendId ? 'Saving your latest changes before simulating…' : 'Saving scenario to backend before running simulation...');
    setScenarioSaving(true);
    setSaveStatus('saving');
    try {
      const shaped = shapeFrontendToBackend(els, conns, title, resList);
      const layoutEls = els.filter(el => el.type === 'pool' || el.type === 'lane');
      if (backendId) {
        // ALWAYS push the current canvas/resource state, even if this scenario
        // was already saved earlier — otherwise the backend may still hold a
        // stale (or baseline-identical) copy and the simulation would silently
        // run against that instead of your latest edits.
        await updateScenario(backendId, title, shaped.nodes, shaped.edges, shaped.resources, shaped.layoutElements || layoutEls);
      } else {
        console.trace('[Trace createScenario] Explicitly created scenario saving before simulation:', title);
        const res = await createScenario(baseId, title, shaped.nodes, shaped.edges, shaped.resources, shaped.layoutElements || layoutEls);
        backendId = res.scenario?._id;
        if (backendId) {
          backendScenarioIdsRef.current[activeId] = backendId;
          setBackendScenarioIds(prev => ({ ...prev, [activeId]: backendId }));
          setScenarios(prev => prev.map(s => s.id === activeId ? { ...s, _backendId: backendId, _allowCreate: false } : s));
          scenariosRef.current = scenariosRef.current.map(s => s.id === activeId ? { ...s, _backendId: backendId, _allowCreate: false } : s);
        } else {
          showMsg('error', 'Could not save scenario to backend.');
          setSaveStatus('idle');
          return;
        }
      }
      setSaveStatus('saved');
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => {
        setSaveStatus('idle');
      }, 2000);
    } catch (err) {
      showMsg('error', `Failed to save scenario: ${err.message}`);
      setSaveStatus('idle');
      return;
    } finally {
      setScenarioSaving(false);
    }

    // Now run simulation
    setScenarioSimulating(prev => ({ ...prev, [backendId]: true }));
    try {
      // What-If comparisons must run in "deep" mode — "quick" mode disables
      // resource contention entirely (see monte_carlo.py's run_single_pass:
      // resources = {} — literally no queueing modeled at all). Since the
      // whole point of this comparison is showing the effect of a resource
      // change, quick mode would silently produce a meaningless number no
      // matter what the config modal happens to be set to. Force it here so
      // the comparison is never accidentally run without resource modeling.
      const sharedSeed = simConfig.seed != null && simConfig.seed !== '' ? Number(simConfig.seed) : 42;
      const comparisonConfig = {
        ...simConfig,
        mode: 'deep',
        seed: sharedSeed,
        replications: 5,
        total_instances: simConfig.total_instances || 1000,
        arrival_rate: Number(simConfig.arrival_rate) || 1.0,
      };

      // 1. Run Scenario (What-If) Simulation
      const res = await runScenarioSimulation(backendId, comparisonConfig);
      const results = res.results || res;
      results.mode = comparisonConfig.mode;
      setScenarioResults(prev => ({ ...prev, [backendId]: results }));
      
      // Save what-if results to localStorage
      localStorage.setItem('spot:whatifResults', JSON.stringify(results));
      const scenario = scenarios.find(s => s.id === activeId);
      if (scenario) {
        localStorage.setItem('spot:whatifName', scenario.name);
      }
      localStorage.setItem('spot:hasWhatIfResults', 'true');

      // 2. Ensure baseline is run using the same config
      showMsg('info', 'Generating baseline simulation results with matching configuration for comparison...');
      const bRes = await runSimulation(baseId, comparisonConfig);
      const baseRes = bRes.results || bRes;
      baseRes.mode = comparisonConfig.mode;
      setScenarioResults(prev => ({ ...prev, baseline: baseRes }));

      localStorage.setItem('spot:baselineResults', JSON.stringify(baseRes));
      localStorage.setItem('spot:simulationResults', JSON.stringify(baseRes)); // standard fallback
      // Keep the pair together as one durable handoff. Results still supports
      // its original individual keys, but this prevents it from opening with
      // only one half of a comparison if navigation or a later state update
      // happens between separate localStorage writes.
      localStorage.setItem('spot:comparisonResults', JSON.stringify({
        baseline: baseRes,
        scenario: results,
        scenarioName: scenario?.name || title,
      }));

      showMsg('success', 'What-If Simulation complete! Navigating to results...');
      setTimeout(() => {
        navigate('/results');
      }, 1000);
    } catch (err) {
      showMsg('error', `Simulation failed: ${err.message}`);
    } finally {
      setScenarioSimulating(prev => ({ ...prev, [backendId]: false }));
    }
  }, [activeId, backendScenarioIds, scenarios, navigate]);

  const handleRunActiveSimulation = useCallback(() => {
    if (!activeId) return;
    setShowSimConfigModal(true);
  }, [activeId]);

  const startSimulationWithConfig = async () => {
    // Calculate arrival rate
    const val = parseFloat(simConfigArrivalValue);
    if (!Number.isFinite(val) || val <= 0) {
      showMsg('error', 'Enter an arrival frequency greater than zero.');
      return;
    }

    const unitMultipliers = {
      seconds: 1 / 60,
      minutes: 1,
      hours: 60,
      days: 1440
    };
    const mult = unitMultipliers[simConfigArrivalUnit] || 1;
    const calculatedArrivalRate = 1 / (val * mult);

    setShowSimConfigModal(false);

    const simConfig = {
      mode: simConfigMode,
      total_instances: simConfigInstances,
      arrival_rate: calculatedArrivalRate
    };

    await executeSimulationRun(simConfig);
  };

  const updateResourceAllocationQty = useCallback((resourceId, delta) => {
    if (!activeId) return;
    
    let targetActiveId = activeIdRef.current;

    if (targetActiveId === 'baseline') {
      if (baselineForkedThisSessionRef.current) {
        targetActiveId = activeIdRef.current;
        if (targetActiveId === 'baseline') return;
      } else {
        baselineForkedThisSessionRef.current = true;
        targetActiveId = forkBaseline();
        showMsg('info', 'Baseline is read-only — created a new What-If scenario for your changes.');
      }
    }
    
    setResourceAllocations(prev => {
      const list = prev[targetActiveId] || prev['baseline'] || DEFAULT_RESOURCES;
      const nextList = list.map(r => {
        if (r.id !== resourceId) return r;
        return { ...r, quantity: Math.max(0, (r.quantity ?? 0) + delta) };
      });
      resourceAllocationsRef.current[targetActiveId] = nextList;
      
      // Auto-save the new resource allocations
      setTimeout(() => {
        saveScenarioDebounced(targetActiveId);
      }, 100);
      
      return {
        ...prev,
        [targetActiveId]: nextList
      };
    });
  }, [activeId, saveScenarioDebounced, forkBaseline]);

  const deleteScenario = useCallback(async (id) => {
    if (id === 'baseline') return; // Cannot delete baseline

    // The backend copy must actually be deleted too — this used to only
    // clear local state, so the scenario reappeared on reload and kept
    // silently counting against the 7-scenario cap forever, eventually
    // blocking every new scenario (including ones from "Implement
    // Suggestion") with "Maximum 7 scenarios allowed!" even though the
    // person believed they'd freed up space by deleting old ones.
    const backendId = backendScenarioIdsRef.current[id] || backendScenarioIds[id] || scenariosRef.current.find(s => s.id === id)?._backendId;
    if (backendId) {
      try {
        await deleteScenarioApi(backendId);
      } catch (err) {
        showMsg('error', `Couldn't delete scenario on the server: ${err.message}`);
        return; // don't clear local state if the backend delete failed —
                 // otherwise it'll just reappear next load, confusingly.
      }
    }

    setScenarios(prev => prev.filter(s => s.id !== id));
    scenariosRef.current = scenariosRef.current.filter(s => s.id !== id);
    setCompareIds(prev => prev.filter(c => c !== id));
    setCanvases(prev => { const n = { ...prev }; delete n[id]; return n; });
    setCanvasConnections(prev => { const n = { ...prev }; delete n[id]; return n; });
    delete backendScenarioIdsRef.current[id];
    setBackendScenarioIds(prev => { const n = { ...prev }; delete n[id]; return n; });
    if (activeIdRef.current === id) {
      const nextId = scenariosRef.current.find(s => s.id !== id)?.id ?? 'baseline';
      setActiveId(nextId);
      activeIdRef.current = nextId;
    }
  }, [backendScenarioIds]);

  const handleDeleteSelected = useCallback(async () => {
    const toDelete = compareIds.filter(id => id !== 'baseline');
    if (!toDelete.length) return;
    const count = toDelete.length;
    if (!window.confirm(`Delete ${count} selected scenario${count === 1 ? '' : 's'}? This cannot be undone.`)) {
      return;
    }
    for (const id of toDelete) {
      await deleteScenario(id);
    }
    setCompareIds([]);
    showMsg('success', `Deleted ${count} scenario${count === 1 ? '' : 's'}.`);
  }, [compareIds, deleteScenario]);

  const toggleCompare = (id) =>
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((c) => c !== id);
      if (prev.length >= MAX_COMPARE) {
        showMsg('error', `Compare up to ${MAX_COMPARE} at a time`);
        return prev;
      }
      return [...prev, id];
    });

  // Drag start for palette items is handled inline in BPMNPalette

  // Element repositioning drag start
  const handleScenarioElementDragStart = useCallback((e, elementId) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    e.dataTransfer.setData('application/element-reposition', elementId);
    e.dataTransfer.setData(
      'application/element-offset',
      JSON.stringify([e.clientX - rect.left, e.clientY - rect.top])
    );
  }, []);

  // Canvas drop handling (new element or reposition) — accounts for zoom/pan
  const handleCanvasDrop = useCallback(
    (e) => {
      e.preventDefault();
      if (!activeId) return;
      const rect = (canvasRef.current || e.currentTarget).getBoundingClientRect();

      const repositioningId = e.dataTransfer.getData('application/element-reposition');
      if (repositioningId) {
        try {
          const offsetStr = e.dataTransfer.getData('application/element-offset');
          const [offsetX, offsetY] = JSON.parse(offsetStr);
          // Convert screen drop position to world coords, subtract offset (also in screen space → world space)
          const x = (e.clientX - rect.left - offsetX - pan.x) / zoom;
          const y = (e.clientY - rect.top - offsetY - pan.y) / zoom;
          setElements((prev) => prev.map((el) => {
            if (el.id !== repositioningId) return normalizeCanvasElement(el);
            const base = normalizeCanvasElement(el);
            return { ...base, position: { x: Math.max(0, x), y: Math.max(0, y) } };
          }), true);
        } catch (err) {
          console.error('Reposition error:', err);
        }
        return;
      }

      const data = e.dataTransfer.getData('application/reactflow');
      if (!data) return;
      try {
        const element = JSON.parse(data);
        // Convert screen drop position to world coords
        const x = (e.clientX - rect.left - pan.x) / zoom;
        const y = (e.clientY - rect.top - pan.y) / zoom;
        const { width, height } = defaultSizeForType(element.type);
        const newEl = {
          id: `${element.type}-${Date.now()}`,
          type: element.type,
          label: element.label,
          position: { x, y },
          width,
          height,
        };
        setElements((prev) => [...prev.map(normalizeCanvasElement), newEl], true);
        // Keep Elements card open after drop until closed by user
        setPaletteOpen(true);
      } catch (err) {
        console.error('Drop error:', err);
      }
    },
    [activeId, pan, zoom, setElements]
  );

  // Click-to-add from Elements palette
  const handleAddPaletteElement = useCallback((type, label) => {
    if (!activeId) return;
    const { width, height } = defaultSizeForType(type);
    const rect = canvasRef.current?.getBoundingClientRect();
    const cw = rect?.width || 800;
    const ch = rect?.height || 600;
    const currentElements = canvasesRef.current[activeId] || [];
    const off = ((currentElements.length || 0) * 24) % 120;
    const x = Math.round(((-pan.x + cw / 2 - width / 2) / zoom) + off);
    const y = Math.round(((-pan.y + ch / 2 - height / 2) / zoom) + off);
    const newEl = {
      id: `${type}-${Date.now()}`,
      type,
      label,
      position: { x: Math.max(20, x), y: Math.max(20, y) },
      width,
      height,
    };
    setElements((prev) => [...prev.map(normalizeCanvasElement), newEl], true);
    setSelectedTaskId(newEl.id);
    setPaletteOpen(false);
  }, [activeId, pan, zoom, setElements]);

  // Active scenario elements
  const activeElements = useMemo(() => {
    if (!activeId) return [];
    return (canvases[activeId] || []).map(normalizeCanvasElement);
  }, [activeId, canvases]);
  const activeConnections = useMemo(() => {
    if (!activeId) return [];
    return canvasConnections[activeId] || [];
  }, [activeId, canvasConnections]);

  const getElementBoundaryPoint = useCallback((element, direction) => {
    if (!element) return { x: 0, y: 0 };
    const px = element.position?.x ?? element.x ?? 0;
    const py = element.position?.y ?? element.y ?? 0;
    const t = element.type || '';
    const S = 80 / 120;

    if (t.includes('gateway')) {
      const y = py + 60 * S;
      return direction === 'right' ? { x: px + 110 * S, y } : { x: px + 10 * S, y };
    }
    if (t.includes('event')) {
      const cx = px + 60 * S;
      const cy = py + 60 * S;
      const r = 32 * S;
      return direction === 'right' ? { x: cx + r, y: cy } : { x: cx - r, y: cy };
    }
    if (t.includes('task') || t === 'subprocess' || t === 'call-activity') {
      const midY = py + 60 * S;
      return direction === 'right' ? { x: px + 100 * S, y: midY } : { x: px + 20 * S, y: midY };
    }
    const midY = py + 40;
    return direction === 'right' ? { x: px + 80, y: midY } : { x: px, y: midY };
  }, []);

  const startConnection = useCallback((elementId, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (activeId === 'baseline') return;
    const fromElement = activeElements.find((el) => el.id === elementId);
    if (!fromElement) return;
    const fromPos = getElementBoundaryPoint(fromElement, 'right');
    setDrawingConnection({ fromId: elementId, fromPos });
  }, [activeElements, getElementBoundaryPoint, activeId]);

  const endConnection = useCallback((targetId, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!activeId || !drawingConnection || drawingConnection.fromId === targetId) {
      setDrawingConnection(null);
      return;
    }
    setCanvasConnections((prev) => ({
      ...prev,
      [activeId]: [
        ...(prev[activeId] || []),
        {
          id: `conn-${Date.now()}`,
          fromId: drawingConnection.fromId,
          toId: targetId,
          type: 'sequence-flow',
        },
      ],
    }));
    setDrawingConnection(null);
  }, [activeId, drawingConnection]);

  const handleCanvasMouseMove = useCallback((e) => {
    if (canvasPanRef.current) return; // panning handled by window listener
    if (!drawingConnection) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Convert to world coords for the SVG overlay (which is inside the transform div)
    setCanvasMousePos({
      x: (e.clientX - rect.left - pan.x) / zoom,
      y: (e.clientY - rect.top - pan.y) / zoom,
    });
  }, [drawingConnection, pan, zoom]);

  const handleCanvasMouseUp = useCallback((e) => {
    if (canvasPanRef.current) return; // panning handled by window listener
    if (!drawingConnection) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Convert to world coords to hit-test elements
    const wx = (e.clientX - rect.left - pan.x) / zoom;
    const wy = (e.clientY - rect.top - pan.y) / zoom;
    const target = activeElements.find((el) => {
      const px = el.position?.x ?? el.x ?? 0;
      const py = el.position?.y ?? el.y ?? 0;
      return (
        el.id !== drawingConnection.fromId
        && el.type !== 'pool'
        && el.type !== 'lane'
        && wx >= px
        && wx <= px + (el.width || 80)
        && wy >= py
        && wy <= py + (el.height || 80)
      );
    });
    if (target) {
      endConnection(target.id, e);
      return;
    }
    setDrawingConnection(null);
  }, [activeElements, drawingConnection, endConnection, pan, zoom]);

  const compareSlotsFull = compareIds.length >= MAX_COMPARE;
  const canRunCompare = compareIds.length >= 2 && compareIds.length <= MAX_COMPARE;
  const totalCompareSlots = compareIds.length === 0 ? 1 : compareSlotsFull ? compareIds.length : compareIds.length + 1;

  // Popover switcher state
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const [scenarioSearch, setScenarioSearch] = useState('');
  const switcherRef = useRef(null);

  useEffect(() => {
    if (!isSwitcherOpen) return;
    const handleClickOutside = (e) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target)) {
        setIsSwitcherOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsSwitcherOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSwitcherOpen]);

  const currentScenario = scenarios.find((s) => s.id === activeId) || scenarios[0];

  const sortedScenarios = useMemo(() => {
    const q = scenarioSearch.trim().toLowerCase();
    const baseline = scenarios.find((s) => s._isBaseline || s.id === 'baseline');
    const others = scenarios.filter((s) => !(s._isBaseline || s.id === 'baseline'));

    const filteredOthers = q ? others.filter((s) => s.name?.toLowerCase().includes(q)) : others;
    filteredOthers.sort((a, b) => {
      const tA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const tB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return tB - tA;
    });

    if (!baseline) return filteredOthers;
    if (q && !baseline.name?.toLowerCase().includes(q)) return filteredOthers;
    return [baseline, ...filteredOthers];
  }, [scenarios, scenarioSearch]);

  // Refs for elements and connections
  const elementsRef = useRef([]);
  const connectionsRef = useRef([]);

  useEffect(() => {
    elementsRef.current = elements;
    connectionsRef.current = connections;
  }, [elements, connections]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't process shortcuts if typing in an input/textarea/select
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        return;
      }

      // Ctrl/Cmd+C - Copy
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (selectedElement) {
          e.preventDefault();
          setClipboard({ ...selectedElement, originalId: selectedElement.id, operation: 'copy' });
        }
        return;
      }

      // Ctrl/Cmd+X - Cut
      if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        if (selectedElement) {
          e.preventDefault();
          setClipboard({ ...selectedElement, originalId: selectedElement.id, operation: 'cut' });
          setElements(elements.filter(el => el.id !== selectedElement.id));
          setConnections(connections.filter(conn => conn.fromId !== selectedElement.id && conn.toId !== selectedElement.id));
          setSelectedElement(null);
        }
        return;
      }

      // Ctrl/Cmd+V - Paste
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (clipboard) {
          e.preventDefault();
          const newElement = {
            ...clipboard,
            id: clipboard.type + '-' + Date.now(),
            position: { x: mousePos.x || 100, y: mousePos.y || 100 }
          };
          delete newElement.originalId;
          delete newElement.operation;
          setElements([...elements, newElement]);
        }
        return;
      }

      // Delete / Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedElement) {
          e.preventDefault();
          handleDelete(selectedElement.id, elementsRef.current, setElements, connectionsRef.current, setConnections);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedElement, clipboard, mousePos, elements, connections]);

  // Context menu actions delegation
  const handleContextMenu = (e, element) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedElement(element);
    setContextMenu({ x: e.clientX, y: e.clientY, elementId: element.id });
  };

  const handleCanvasContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    setContextMenu({ x: e.clientX, y: e.clientY, canvasX, canvasY, elementId: null });
  };

  // Toolbar button handlers
  const handleCopyClick = () => {
    if (contextMenu?.elementId) {
      const element = elements.find((el) => el.id === contextMenu.elementId);
      if (element) handleCopy(element);
    }
  };

  const handleCutClick = () => {
    if (contextMenu?.elementId) {
      const element = elements.find((el) => el.id === contextMenu.elementId);
      if (element) handleCut(element, elements, setElements, connections, setConnections);
    }
  };

  const handleDeleteClick = () => {
    if (contextMenu?.elementId) {
      handleDelete(contextMenu.elementId, elements, setElements, connections, setConnections);
    }
    setContextMenu(null);
  };

  const handlePasteClick = () => {
    if (clipboard && contextMenu) {
      handlePaste(clipboard, { x: contextMenu.canvasX, y: contextMenu.canvasY }, elements, setElements);
    }
    setContextMenu(null);
  };

  // Handle label editing
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Enter' && editingLabelId !== null && editingLabelText.trim()) {
        setElements((prev) =>
          prev.map((el) =>
            el.id === editingLabelId ? { ...el, label: editingLabelText.trim() } : el
          )
        );
        setEditingLabelId(null);
        setEditingLabelText('');
      }
      if (e.key === 'Escape') {
        setEditingLabelId(null);
        setEditingLabelText('');
        if (paletteOpen) {
          setPaletteOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingLabelId, editingLabelText, paletteOpen, setElements]);

  const handleSelectScenario = (id) => {
    setActiveId(id);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location);
      if (id === 'baseline') url.searchParams.delete('scenarioId');
      else url.searchParams.set('scenarioId', id);
      window.history.replaceState({}, '', url);
    }
  };

  return (
    <div className="layout-scenarios-page flex flex-1 flex-col min-h-0 min-w-0 w-full overflow-hidden bg-slate-100/70">
      {/* Backend toast */}
      {backendMsg && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[999] flex items-center gap-2 px-4 py-2 rounded-lg shadow-lg text-sm font-medium pointer-events-none
          ${backendMsg.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {backendMsg.type === 'success' ? <CheckCircle2 size={14}/> : <AlertCircle size={14}/>}
          {backendMsg.text}
        </div>
      )}
      {/* No base process warning */}
      {!baseProcessId && (
        <div className="shrink-0 flex items-center gap-2 bg-amber-50 border-b border-amber-200 px-5 py-2 text-xs text-amber-800">
          <AlertCircle size={13}/>
          No saved process found. Go to <strong className="mx-1">Model</strong> page and click <strong className="mx-1">Save</strong> first — scenarios will then sync to the backend.
        </div>
      )}
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border border-gray-200/80 bg-white shadow-sm overflow-visible relative z-30 w-full mt-6">
        {/* Left Section: Scenario Switcher & Popover */}
        <div className="relative flex items-center gap-3 shrink-0" ref={switcherRef}>
          <div className="flex items-center border border-gray-200/80 bg-white rounded-lg shadow-2xs hover:border-gray-300 transition-colors">
            {renamingTabId === currentScenario?.id ? (
              <input
                type="text"
                value={renamingTabText}
                onChange={(e) => setRenamingTabText(e.target.value)}
                onBlur={() => handleRenameTab(currentScenario.id, renamingTabText)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameTab(currentScenario.id, renamingTabText);
                  if (e.key === 'Escape') setRenamingTabId(null);
                }}
                className="px-3 py-1.5 text-sm font-medium border border-indigo-300 rounded-l-lg focus:outline-none focus:ring-1 focus:ring-indigo-200"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <button
                type="button"
                onClick={() => setIsSwitcherOpen((prev) => !prev)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (currentScenario && !currentScenario._isBaseline) {
                    setRenamingTabId(currentScenario.id);
                    setRenamingTabText(currentScenario.name);
                  }
                }}
                className="flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-gray-800 hover:text-gray-900 text-left"
                title={currentScenario?._isBaseline ? 'Baseline process (read-only)' : 'Double-click to rename'}
              >
                <span className="font-semibold text-gray-900 max-w-[140px] sm:max-w-[200px] truncate">
                  {currentScenario?.name || 'Untitled Scenario'}
                </span>
                {currentScenario?._isBaseline ? (
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 shrink-0">
                    Baseline
                  </span>
                ) : (
                  <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-600 shrink-0">
                    What-If
                  </span>
                )}
                {activeId === currentScenario?.id && (
                  currentScenario?._isBaseline ? (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 shrink-0">
                      Read-only
                    </span>
                  ) : (
                    <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 shrink-0">
                      Editing
                    </span>
                  )
                )}
              </button>
            )}

            {/* Chevron button */}
            <button
              type="button"
              onClick={() => setIsSwitcherOpen((prev) => !prev)}
              className="p-2 pr-2.5 text-gray-400 hover:text-gray-600 transition-colors"
              title="Switch scenario"
              aria-label="Switch scenario"
            >
              <ChevronDown
                size={16}
                className={`transition-transform duration-150 ${isSwitcherOpen ? 'rotate-180' : ''}`}
              />
            </button>
          </div>

          {/* "Comparing n" chip beside the switcher */}
          {compareIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const compEl = document.querySelector('.layout-scenarios-page');
                if (compEl) compEl.scrollTo({ top: compEl.scrollHeight, behavior: 'smooth' });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200 transition-colors shrink-0 shadow-2xs"
              title="Open comparison table"
            >
              <GitCompare size={14} className="text-violet-600" />
              <span>Comparing {compareIds.length}</span>
            </button>
          )}

          {/* Saving / Saved chip (What-If only; never on read-only baseline) */}
          {activeId !== 'baseline' && saveStatus === 'saving' && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 border border-slate-200 transition-colors shrink-0 shadow-2xs">
              <Loader2 size={13} className="animate-spin text-slate-500" />
              <span>Saving...</span>
            </div>
          )}
          {activeId !== 'baseline' && saveStatus === 'saved' && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 transition-colors shrink-0 shadow-2xs">
              <CheckCircle2 size={14} className="text-emerald-600" />
              <span>Saved</span>
            </div>
          )}

          {/* "Restored layout from base" chip (only on hydrated scenario, only while active, auto-dismiss 5s) */}
          {hydratedScenarioIds.has(activeId) && !dismissedHydratedIds.has(activeId) && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 transition-colors shrink-0 shadow-2xs">
              <CheckCircle2 size={14} className="text-emerald-600" />
              <span>Restored layout from base</span>
              <button
                type="button"
                onClick={() => setDismissedHydratedIds((prev) => new Set(prev).add(activeId))}
                className="ml-1 p-0.5 text-emerald-500 hover:text-emerald-800 rounded transition-colors"
                title="Dismiss"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* Popover */}
          {isSwitcherOpen && (
            <div className="absolute top-full left-0 mt-2 w-[340px] bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden flex flex-col max-h-[60vh]">
              {/* Header: <n> scenarios + Delete selected */}
              <div className="px-3 py-2 flex items-center justify-between text-xs font-semibold text-gray-500 bg-slate-50/70 border-b border-gray-100 shrink-0">
                <span>{scenarios.length} scenario{scenarios.length === 1 ? '' : 's'}</span>
                {compareIds.filter(id => id !== 'baseline').length > 0 && (
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    className="text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 px-2 py-0.5 rounded transition-colors"
                    title="Delete selected scenarios"
                  >
                    Delete selected ({compareIds.filter(id => id !== 'baseline').length})
                  </button>
                )}
              </div>

              {/* Search box */}
              <div className="p-2 border-b border-gray-100 bg-white shrink-0">
                <div className="relative flex items-center">
                  <Search size={14} className="absolute left-2.5 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    value={scenarioSearch}
                    onChange={(e) => setScenarioSearch(e.target.value)}
                    placeholder="Search scenarios..."
                    className="w-full pl-8 pr-2.5 py-2 text-xs bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    autoFocus
                  />
                </div>
              </div>

              {/* Scenario list sorted with Baseline pinned on top */}
              <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
                {sortedScenarios.length === 0 ? (
                  <div className="py-6 text-center text-xs text-gray-400">
                    No scenarios found
                  </div>
                ) : (
                  sortedScenarios.map((s) => {
                    const isActive = s.id === activeId;
                    return (
                      <div
                        key={s.id}
                        className={`group flex items-center gap-2.5 px-3 py-1.5 min-h-[44px] text-xs transition-colors ${
                          isActive ? 'bg-indigo-50/70 border-l-2 border-indigo-600' : 'hover:bg-slate-50'
                        }`}
                      >
                        {/* Compare checkbox */}
                        <input
                          type="checkbox"
                          checked={compareIds.includes(s.id)}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleCompare(s.id);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="h-3.5 w-3.5 rounded border-gray-300 text-sky-600 focus:ring-sky-500 cursor-pointer shrink-0"
                          title="Compare scenario"
                        />

                        {/* Scenario info (click to select) */}
                        <div
                          className="flex-1 min-w-0 cursor-pointer py-0.5"
                          onClick={() => {
                            handleSelectScenario(s.id);
                            setIsSwitcherOpen(false);
                          }}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className={`truncate font-medium ${isActive ? 'text-indigo-900 font-semibold' : 'text-gray-800'}`}>
                              {s.name}
                            </span>
                            {s._isBaseline ? (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold uppercase shrink-0">
                                Base
                              </span>
                            ) : (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-semibold uppercase shrink-0">
                                What-If
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-400 mt-0.5 leading-none">
                            Edited {formatScenarioTime(s.updatedAt || s.createdAt)}
                          </div>
                        </div>

                        {/* Actions: Rename / Duplicate / Delete (shown on hover only) */}
                        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          {!s._isBaseline && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenamingTabId(s.id);
                                setRenamingTabText(s.name);
                                setIsSwitcherOpen(false);
                              }}
                              className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                              title="Rename"
                            >
                              <Pencil size={12} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              duplicateScenario(s.id);
                              setIsSwitcherOpen(false);
                            }}
                            className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                            title="Duplicate"
                          >
                            <Copy size={12} />
                          </button>
                          {!s._isBaseline && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm(`Delete "${s.name}"? This cannot be undone.`)) {
                                  deleteScenario(s.id);
                                }
                              }}
                              className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Bottom "+ New scenario" button */}
              <div className="sticky bottom-0 p-2 border-t border-gray-100 bg-white shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    openCreate();
                    setIsSwitcherOpen(false);
                  }}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-semibold text-indigo-600 bg-white hover:bg-indigo-50 border border-indigo-200 rounded-lg transition-colors shadow-2xs"
                >
                  <Plus size={13} />
                  <span>+ New scenario</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Middle Section: Tool Buttons */}
        <div className="flex items-center gap-2 sm:gap-2.5 justify-center shrink-0">
          {/* New */}
          <TBtn onClick={openCreate} title="New scenario" variant="default" className="text-gray-600 bg-white border border-gray-200">
            <Plus size={14}/> New
          </TBtn>

          <div className="h-6 w-px bg-gray-200 mx-1" />

          <TBtn onClick={() => setAllSelected(!allSelected)} title="Select all (Ctrl+A)" variant={allSelected ? 'active' : 'default'} className="border border-gray-200">
            <div className="w-3 h-3 border border-gray-400 rounded-sm mr-1" /> Select All
          </TBtn>

          <div className="h-6 w-px bg-gray-200 mx-1" />

          <TBtn onClick={() => zoomToCenter(1 / 1.2)} title="Zoom Out" variant="icon">
            <span className="font-bold text-gray-500 text-lg leading-none mb-1">−</span>
          </TBtn>
          <TBtn onClick={() => zoomToCenter(1.2)} title="Zoom In" variant="icon">
            <span className="font-bold text-gray-500 text-lg leading-none mb-1">+</span>
          </TBtn>
          <TBtn onClick={fitView} title="Fit to view" variant="icon">
            <Maximize2 size={16} className="text-gray-500"/>
          </TBtn>

          <div className="h-6 w-px bg-gray-200 mx-1" />

          <TBtn onClick={() => setGridType(g => g === 'none' ? 'dots' : g === 'dots' ? 'lines' : 'none')}
            title={gridType === 'none' ? 'Show Dotted Grid' : gridType === 'dots' ? 'Show Lined Grid' : 'Hide Grid'}
            variant={gridType !== 'none' ? 'active' : 'icon'}
            className={gridType !== 'none' ? "bg-[#5E43F3] text-white border-none" : ""}>
            <Grid3x3 size={16}/>
          </TBtn>
          
          <div className="h-6 w-px bg-gray-200 mx-1" />

          <TBtn onClick={handleCopyClick} title="Copy (Ctrl+C)" variant="icon">
            <Copy size={16} className="text-gray-500"/>
          </TBtn>
          <TBtn onClick={handlePasteClick} title="Paste (Ctrl+V)" variant="icon">
            <ClipboardPaste size={16} className="text-gray-500"/>
          </TBtn>
          <TBtn onClick={handleCutClick} title="Cut (Ctrl+X)" variant="icon">
            <Scissors size={16} className="text-gray-500"/>
          </TBtn>
          <TBtn onClick={handleDeleteClick} title="Delete (Del)" variant="icon">
            <Trash2 size={16} className="text-gray-500"/>
          </TBtn>
        </div>

        {/* Right Section: Setup & Run Simulation */}
        <div className="flex-1 flex justify-end gap-2 shrink-0">
          {activeId && (
            <>
              <TBtn
                onClick={() => setShowSetupModal(true)}
                title="Configure scenario simulation resources, hours and costs"
                className="text-gray-600 bg-white border border-gray-200 hover:bg-slate-50 px-3 shrink-0"
              >
                <Settings size={15} className="mr-1 text-gray-500" />
                Setup
              </TBtn>
              <TBtn
                onClick={handleRunActiveSimulation}
                disabled={scenarioSaving || (activeId === 'baseline' ? scenarioSimulating.baseline : scenarioSimulating[backendScenarioIds[activeId] || scenarios.find(s => s.id === activeId)?._backendId])}
                title="Run simulation for this scenario"
                className="text-gray-600 bg-white border border-gray-200 hover:bg-slate-50 px-4 shrink-0"
              >
                {scenarioSaving ? (
                  <Loader2 size={16} className="animate-spin mr-1 text-gray-500" />
                ) : (activeId === 'baseline' ? scenarioSimulating.baseline : scenarioSimulating[backendScenarioIds[activeId] || scenarios.find(s => s.id === activeId)?._backendId]) ? (
                  <Loader2 size={16} className="animate-spin mr-1 text-emerald-600" />
                ) : (
                  <Play size={16} className="mr-1 text-emerald-600 fill-emerald-600" />
                )}
                {scenarioSaving ? 'Saving…' : (activeId === 'baseline' ? scenarioSimulating.baseline : scenarioSimulating[backendScenarioIds[activeId] || scenarios.find(s => s.id === activeId)?._backendId]) ? 'Running…' : 'Run Simulation'}
              </TBtn>
            </>
          )}
        </div>
      </div>


      {/* Body */}
      <div className="layout-scenarios-body flex min-h-0 min-w-0 w-full flex-1 flex-row gap-4 overflow-hidden p-5 md:gap-5 lg:p-6">
        {/* Canvas container (full-width) */}
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden" style={{ marginTop: 10 }}>
          {/* Canvas */}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-sm">
            {activeId === 'baseline' && (
              <div className="shrink-0 flex items-center justify-center gap-2 bg-gradient-to-r from-blue-50 via-indigo-50 to-blue-50 text-blue-700 border-b border-blue-100 px-4 py-2 text-xs font-medium select-none z-10 shadow-2xs">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 uppercase tracking-wide">
                  Baseline Read-Only
                </span>
                <span>Editing canvas creates a new What-If scenario automatically</span>
              </div>
            )}
            <div className="min-h-0 flex-1 relative" onClick={() => { setSelectedTaskId(null); setSelectedConnId(null); }}>
              <DottedCanvas
                isEmpty={scenarios.length === 0 || activeElements.length === 0}
                emptyMsg={
                  scenarios.length === 0
                    ? 'Create a scenario with the “Add scenario” control above, then drag shapes from the left onto this area.'
                    : 'Drag shapes from the palette on the left onto this canvas. Drag placed shapes to move them.'
                }
                onDrop={handleCanvasDrop}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseDown={handleCanvasMouseDown}
                zoom={zoom}
                pan={pan}
                gridType={gridType}
                canvasRef={canvasRef}
              >
                {/* SVG for pools & connections — background layer (zIndex 1) */}
                <svg className="absolute pointer-events-none" style={{ left: 0, top: 0, width: 10000, height: 10000, zIndex: 1 }}>
                  {/* Swimlanes — pools (rendered first so background rect is on bottom) */}
                  {[...activeElements.filter(e => e && e.type === 'pool')].map(pool => {
                    const px = pool.position?.x ?? 0, py = pool.position?.y ?? 0;
                    const W = pool.width ?? 600, H = pool.height ?? 150;
                    const lanes = poolLanes(activeElements, pool.id);
                    const isSel = selectedTaskId === pool.id;
                    const pLabel = pool.label || '';
                    return (
                      <g key={pool.id} style={{ pointerEvents: 'all' }}>
                        <g style={{ cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); setSelectedTaskId(pool.id); }}
                          onDoubleClick={() => { setEditingLabelId(pool.id); setEditingLabelText(pLabel); }}>
                          <rect x={px} y={py} width={W} height={H} rx="3"
                            fill="white" stroke={isSel ? '#4b5563' : '#9ca3af'} strokeWidth={isSel ? 2 : 1.5} />
                          <rect x={px + 1.5} y={py + 1.5} width={POOL_LANE_HDR - 1.5} height={Math.max(1, H - 3)}
                            fill="#e5e7eb" stroke="none" rx="2" />
                          <line x1={px + POOL_LANE_HDR} y1={py + 1} x2={px + POOL_LANE_HDR} y2={py + H - 1}
                            stroke={isSel ? '#4b5563' : '#9ca3af'} strokeWidth="1.5" />
                          <foreignObject x={px} y={py} width={POOL_LANE_HDR} height={Math.max(1, H)}>
                            <div style={{
                              width: H, height: POOL_LANE_HDR,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transform: `rotate(-90deg) translateX(-${H}px)`,
                              transformOrigin: '0 0',
                              fontSize: 11, fontWeight: 600, color: '#374151',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              pointerEvents: 'none', userSelect: 'none',
                            }}>
                              {pLabel.length > 14 ? pLabel.slice(0, 13) + '…' : pLabel}
                            </div>
                          </foreignObject>
                        </g>
                        {lanes.map((lane, laneIdx) => {
                          const n = lanes.length;
                          const lH = Math.round(H / n);
                          const lW = Math.max(48, W - POOL_LANE_HDR - LANE_HDR);
                          const lx = px + POOL_LANE_HDR + LANE_HDR;
                          const ly = py + laneIdx * lH;
                          const lSel = selectedTaskId === lane.id;
                          const lhx = px + POOL_LANE_HDR;
                          const lLabel = lane.label || '';
                          return (
                            <g key={lane.id} style={{ pointerEvents: 'all', cursor: 'pointer' }}
                              onClick={(e) => { e.stopPropagation(); setSelectedTaskId(lane.id); }}
                              onDoubleClick={() => { setEditingLabelId(lane.id); setEditingLabelText(lLabel); }}>
                              {laneIdx > 0 && (
                                <line x1={px + POOL_LANE_HDR} y1={ly} x2={px + W} y2={ly}
                                  stroke={isSel ? '#4b5563' : '#9ca3af'} strokeWidth={isSel ? 2 : 1.5} />
                              )}
                              <rect x={lhx + 1} y={ly} width={LANE_HDR - 1} height={Math.max(1, lH)}
                                fill={lSel ? '#dbeafe' : '#f3f4f6'} stroke="none" />
                              <line x1={lhx + LANE_HDR} y1={ly} x2={lhx + LANE_HDR} y2={ly + lH}
                                stroke="#9ca3af" strokeWidth="1" />
                              <rect x={lx} y={ly} width={lW} height={Math.max(1, lH)}
                                fill={lSel ? '#f0f9ff' : 'transparent'} stroke="none" />
                              <foreignObject x={lhx} y={ly} width={LANE_HDR} height={Math.max(1, lH)}>
                                <div style={{
                                  width: lH, height: LANE_HDR,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  transform: `rotate(-90deg) translateX(-${lH}px)`,
                                  transformOrigin: '0 0',
                                  fontSize: 11, fontWeight: 500, color: '#374151',
                                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                  pointerEvents: 'none', userSelect: 'none',
                                }}>
                                  {lLabel.length > 14 ? lLabel.slice(0, 13) + '…' : lLabel}
                                </div>
                              </foreignObject>
                            </g>
                          );
                        })}
                      </g>
                    );
                  })}

                  {/* Standalone lanes */}
                  {[...activeElements.filter(e => e && e.type === 'lane' && !e.poolId)].map(lane => {
                    const lx = lane.position?.x ?? 0, ly = lane.position?.y ?? 0, lW = lane.width ?? 500, lH = lane.height ?? 100;
                    const lSel = selectedTaskId === lane.id;
                    const lLabel = lane.label || '';
                    return (
                      <g key={lane.id} style={{ pointerEvents: 'all', cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); setSelectedTaskId(lane.id); }}
                        onDoubleClick={() => { setEditingLabelId(lane.id); setEditingLabelText(lLabel); }}>
                        <rect x={lx} y={ly} width={lW} height={lH} rx="3"
                          fill="#f3f4f6" stroke={lSel ? '#6b7280' : '#9ca3af'} strokeWidth={lSel ? 2.5 : 1.5} />
                        <rect x={lx} y={ly} width={POOL_LANE_HDR} height={lH}
                          fill="#e5e7eb" stroke="none" />
                        <line x1={lx + POOL_LANE_HDR} y1={ly} x2={lx + POOL_LANE_HDR} y2={ly + lH}
                          stroke={lSel ? '#6b7280' : '#9ca3af'} strokeWidth={lSel ? 2.5 : 1.5} />
                        <foreignObject x={lx} y={ly} width={POOL_LANE_HDR} height={Math.max(1, lH)}>
                          <div style={{
                            width: lH, height: POOL_LANE_HDR,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transform: `rotate(-90deg) translateX(-${lH}px)`,
                            transformOrigin: '0 0',
                            fontSize: 11, fontWeight: 600, color: '#374151',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            pointerEvents: 'none', userSelect: 'none',
                          }}>
                            {lLabel.length > 14 ? lLabel.slice(0, 13) + '…' : lLabel}
                          </div>
                        </foreignObject>
                      </g>
                    );
                  })}

                  {/* Connection lines using Edge */}
                  {activeConnections.map((conn) => {
                    const isSelected = selectedConnId === conn.id;
                    return (
                      <Edge
                        key={conn.id || `${conn.fromId || conn.from}-${conn.toId || conn.to}`}
                        conn={conn}
                        elements={activeElements}
                        connections={activeConnections}
                        selected={isSelected}
                        interactive={true}
                        onClick={(id) => {
                          setSelectedConnId(id);
                          setSelectedTaskId(null);
                        }}
                        onBendStart={(e, id) => beginConnBendDrag(e, id)}
                      />
                    );
                  })}
                  {drawingConnection && (
                    <>
                      <line
                        x1={drawingConnection.fromPos.x}
                        y1={drawingConnection.fromPos.y}
                        x2={canvasMousePos.x}
                        y2={canvasMousePos.y}
                        stroke="#111827"
                        strokeWidth="2"
                        strokeDasharray="5,5"
                        strokeLinecap="round"
                        opacity="0.75"
                      />
                      <circle cx={canvasMousePos.x} cy={canvasMousePos.y} r="3" fill="#111827" opacity="0.65" />
                    </>
                  )}
                </svg>
                {activeElements.filter(e => e && e.type !== 'pool' && e.type !== 'lane').map((el) => {
                  const x = el.position?.x ?? el.x ?? 0;
                  const y = el.position?.y ?? el.y ?? 0;
                  return (
                    <div
                      key={el.id}
                      draggable={!drawingConnection}
                      className={`absolute select-none cursor-move ${selectedTaskId === el.id ? 'ring-2 ring-indigo-500 rounded-lg' : ''}`}
                      style={{ left: x, top: y, width: el.width, height: el.height, zIndex: 30 }}
                      onDragStart={(e) => handleScenarioElementDragStart(e, el.id)}
                      onMouseEnter={() => setHoveredElement(el.id)}
                      onMouseLeave={() => setHoveredElement((prev) => (prev === el.id ? null : prev))}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (el.type === 'task' || el.type === 'subprocess' || el.type.includes('gateway')) {
                          setSelectedTaskId(el.id);
                        }
                      }}
                      onDoubleClick={() => {
                        setEditingLabelId(el.id);
                        setEditingLabelText(el.label || '');
                      }}
                    >
                      <div className="relative flex h-full w-full items-center justify-center">
                        <BPMNShape type={el.type} sel={selectedTaskId === el.id} w={el.width} h={el.height} />
                        {(el.type === 'task' || el.type === 'subprocess') && editingLabelId !== el.id && (
                          <div style={{
                            position: 'absolute', top: 20, left: 13, width: 54, height: 40,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 2px',
                            pointerEvents: 'none'
                          }}>
                            <span style={{
                              fontSize: 9, fontWeight: 600, textAlign: 'center', lineHeight: 1.1, color: '#374151',
                              display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden'
                            }}>
                              {el.label}
                            </span>
                          </div>
                        )}
                        {editingLabelId === el.id ? (
                          <input
                            type="text"
                            value={editingLabelText}
                            onChange={(e) => setEditingLabelText(e.target.value)}
                            onBlur={() => {
                              setElements((prev) =>
                                prev.map((entry) =>
                                  entry.id === el.id ? { ...entry, label: editingLabelText.trim() || entry.label } : entry
                                )
                              );
                              setEditingLabelId(null);
                              setEditingLabelText('');
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                setElements((prev) =>
                                  prev.map((entry) =>
                                    entry.id === el.id ? { ...entry, label: editingLabelText.trim() || entry.label } : entry
                                  )
                                );
                                setEditingLabelId(null);
                                setEditingLabelText('');
                              }
                              if (e.key === 'Escape') {
                                setEditingLabelId(null);
                                setEditingLabelText('');
                              }
                            }}
                            autoFocus
                            className="absolute left-1/2 top-full z-10 mt-1 w-36 -translate-x-1/2 rounded border border-sky-300 bg-white px-2 py-1 text-xs"
                          />
                        ) : (
                          !(el.type === 'task' || el.type === 'subprocess') && (
                            <div className="absolute top-full mt-1 w-36 truncate text-center text-xs font-medium text-gray-700">
                              {el.label}
                            </div>
                          )
                        )}
                        {(hoveredElement === el.id || (drawingConnection && drawingConnection.fromId === el.id)) && (
                          <div
                            className="absolute right-0 top-1/2 z-50 h-4 w-4 -translate-y-1/2 translate-x-1/2 cursor-grab rounded-full bg-black shadow-md transition-all hover:bg-gray-700 active:cursor-grabbing"
                            title="Drag to create flow"
                            onMouseDown={(e) => startConnection(el.id, e)}
                            draggable="false"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Overlay SVG for ContextPad and GatewayPopover (zIndex 35, sits above task nodes) */}
                <svg className="absolute pointer-events-none" style={{ left: 0, top: 0, width: 10000, height: 10000, zIndex: 35 }}>
                  {/* Context pad on node select */}
                  {selectedTaskId && (() => {
                    const el = activeElements.find(e => e.id === selectedTaskId);
                    if (!el || el.type === 'pool' || el.type === 'lane') return null;
                    return (
                      <ContextPad
                        key={`context-pad-${el.id}`}
                        el={el}
                        elements={activeElements}
                        connections={activeConnections}
                        setElements={setElements}
                        setConnections={setConnections}
                        setSelId={setSelectedTaskId}
                        connMode="sequence-flow"
                        coords="global"
                        onDelete={() => {
                          handleDelete(el.id, activeElements, setElements, activeConnections, setConnections);
                          setSelectedTaskId(null);
                        }}
                        onRename={() => {
                          setEditingLabelId(el.id);
                          setEditingLabelText(el.label || '');
                        }}
                        showMsg={(type, msg) => console.log(type, msg)}
                      />
                    );
                  })()}

                  {/* Gateway "How Often" Popover on gateway select */}
                  {selectedTaskId && (() => {
                    const gw = activeElements.find(e => e.id === selectedTaskId);
                    if (!gw || !(gw.type === 'exclusive-gateway' || gw.type === 'inclusive-gateway' || gw.type === 'gateway')) return null;
                    const outgoing = activeConnections.filter(c => (c.fromId === gw.id || c.from === gw.id));
                    if (outgoing.length < 2) return null;
                    return (
                      <GatewayPopover
                        key={`gw-popover-${gw.id}`}
                        gateway={gw}
                        connections={outgoing}
                        onUpdateProbability={updateConnectionProbability}
                        onClose={() => setSelectedTaskId(null)}
                      />
                    );
                  })()}
                </svg>
              </DottedCanvas>
            </div>

            {/* Elements palette toggle button (bottom-left, matches Model page) */}
            <div className="absolute bottom-6 left-3 z-20">
              <button
                type="button"
                onClick={() => setPaletteOpen(o => !o)}
                style={{
                  background: paletteOpen
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
                  boxShadow: paletteOpen
                    ? '0 4px 16px rgba(99,102,241,0.35)'
                    : '0 4px 16px rgba(147,51,234,0.35)',
                  opacity: 1,
                  transition: 'all 0.2s ease',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.opacity = '0.95'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.opacity = '1'; }}
              >
                <Shapes size={15} className={paletteOpen ? "animate-pulse" : ""} />
                {paletteOpen ? 'Close' : 'Elements'}
              </button>
            </div>

            {/* Elements Palette Overlay */}
            {paletteOpen && (
              <aside
                style={{ bottom: 74, left: 12, width: 250, maxHeight: 'calc(100% - 90px)' }}
                className="absolute z-30 flex flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-150"
              >
                <div className="shrink-0 flex items-center justify-between border-b border-gray-100 bg-gradient-to-b from-slate-50 to-white px-4 py-3">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">BPMN Elements</h2>
                    <p className="text-[11px] text-gray-400 mt-0.5">Click or drag to add</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPaletteOpen(false)}
                    className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                    title="Close palette"
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full">
                  <BPMNPalette
                    expanded={paletteExpanded}
                    setExpanded={setPaletteExpanded}
                    showAdv={paletteShowAdv}
                    setShowAdv={setPaletteShowAdv}
                    onAdd={handleAddPaletteElement}
                  />
                </div>
              </aside>
            )}

            {/* Right-hand Task Setup drawer / overlay (320px, appears only when task or gateway is selected) */}
            {selectedTask && (
              <aside
                className="absolute right-3 top-3 bottom-3 z-30 flex flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-2xl animate-in slide-in-from-right duration-200"
                style={{ width: 320 }}
              >
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
                  <button onClick={() => setSelectedTaskId(null)} style={{ padding: 6, background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 8 }}>
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
                      {connections.filter(c => (c.from ?? c.fromId) === selectedTaskId).length === 0 ? (
                        <p style={{ fontSize: 12, color: '#9ca3af' }}>No outgoing paths found.</p>
                      ) : (
                        connections.filter(c => (c.from ?? c.fromId) === selectedTaskId).map(conn => {
                          const targetNode = elements.find(n => n.id === (conn.to ?? conn.toId));
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
                                  onChange={e => {
                                    const val = e.target.value === '' ? null : parseFloat(e.target.value);
                                    setConnections(prev => prev.map(c => 
                                      ((c.from ?? c.fromId) === (conn.from ?? conn.fromId) && (c.to ?? c.toId) === (conn.to ?? conn.toId))
                                        ? { ...c, probability: val }
                                        : c
                                    ));
                                  }}
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
                    {/* Task Name */}
                    <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #f3f4f6' }}>
                      <label style={labelStyle}>Task Name</label>
                  <input
                    type="text"
                    value={selectedTask.label || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setElements(prev => prev.map(el => el.id === selectedTaskId ? { ...el, label: val } : el));
                    }}
                    style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                  />
                </div>

                {/* Duration */}
                <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #f3f4f6' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <label style={{ ...labelStyle, margin: 0 }}>Duration</label>
                    <div style={{ display: 'flex', gap: 4, background: '#f3f4f6', padding: 2, borderRadius: 6 }}>
                      <button
                        type="button"
                        onClick={() => {
                          setElements(prev => prev.map(el => {
                            if (el.id !== selectedTaskId) return el;
                            return {
                              ...el,
                              data: {
                                ...el.data,
                                duration_min: null,
                                duration_max: null
                              }
                            };
                          }));
                        }}
                        style={{
                          padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, border: 'none', cursor: 'pointer',
                          background: selectedTask.data?.duration_min == null ? '#0284c7' : 'transparent',
                          color: selectedTask.data?.duration_min == null ? '#fff' : '#4b5563',
                        }}
                      >
                        Fixed
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setElements(prev => prev.map(el => {
                            if (el.id !== selectedTaskId) return el;
                            return {
                              ...el,
                              data: {
                                ...el.data,
                                duration_min: selectedTask.data?.duration || 5,
                                duration_max: (selectedTask.data?.duration || 5) * 2
                              }
                            };
                          }));
                        }}
                        style={{
                          padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, border: 'none', cursor: 'pointer',
                          background: selectedTask.data?.duration_min != null ? '#0284c7' : 'transparent',
                          color: selectedTask.data?.duration_min != null ? '#fff' : '#4b5563',
                        }}
                      >
                        Range
                      </button>
                    </div>
                  </div>

                  {selectedTask.data?.duration_min == null ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="number"
                        min="0"
                        value={selectedTask.data?.duration ?? ''}
                        onChange={(e) => {
                          const val = e.target.value === '' ? '' : parseInt(e.target.value);
                          setElements(prev => prev.map(el => {
                            if (el.id !== selectedTaskId) return el;
                            return {
                              ...el,
                              data: { ...el.data, duration: val }
                            };
                          }));
                        }}
                        style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                      />
                      <select
                        value={selectedTask.data?.duration_unit || 'minutes'}
                        onChange={(e) => {
                          const val = e.target.value;
                          setElements(prev => prev.map(el => {
                            if (el.id !== selectedTaskId) return el;
                            return {
                              ...el,
                              data: { ...el.data, duration_unit: val }
                            };
                          }));
                        }}
                        style={{ ...selectStyle, flexShrink: 0, width: 105 }}
                      >
                        {['seconds','minutes','hours','days','weeks','months'].map(u => (
                          <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="number"
                        min="0"
                        value={selectedTask.data?.duration_min ?? ''}
                        onChange={(e) => {
                          const val = e.target.value === '' ? '' : parseInt(e.target.value);
                          setElements(prev => prev.map(el => {
                            if (el.id !== selectedTaskId) return el;
                            return {
                              ...el,
                              data: { ...el.data, duration_min: val }
                            };
                          }));
                        }}
                        placeholder="Min"
                        style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                      />
                      <span style={{ color: '#9ca3af', fontWeight: 500 }}>–</span>
                      <input
                        type="number"
                        min="0"
                        value={selectedTask.data?.duration_max ?? ''}
                        onChange={(e) => {
                          const val = e.target.value === '' ? '' : parseInt(e.target.value);
                          setElements(prev => prev.map(el => {
                            if (el.id !== selectedTaskId) return el;
                            return {
                              ...el,
                              data: { ...el.data, duration_max: val }
                            };
                          }));
                        }}
                        placeholder="Max"
                        style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                      />
                      <select
                        value={selectedTask.data?.duration_unit || 'minutes'}
                        onChange={(e) => {
                          const val = e.target.value;
                          setElements(prev => prev.map(el => {
                            if (el.id !== selectedTaskId) return el;
                            return {
                              ...el,
                              data: { ...el.data, duration_unit: val }
                            };
                          }));
                        }}
                        style={{ ...selectStyle, flexShrink: 0, width: 105 }}
                      >
                        {['seconds','minutes','hours','days','weeks','months'].map(u => (
                          <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Assigned Resources */}
                <div>
                  <label style={labelStyle}>Assigned Resources</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(resourceAllocations[activeId] || resourceAllocations['baseline'] || DEFAULT_RESOURCES).map(resource => {
                      const qty = selectedTask.data?.resources?.[resource.id] ?? 0;
                      const isAssigned = qty > 0;
                      const Icon = resource.icon || Box;
                      return (
                        <div
                          key={resource.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            border: isAssigned ? '1px solid #7dd3fc' : '1px solid #e5e7eb',
                            borderRadius: 8,
                            padding: '8px 12px',
                            background: isAssigned ? '#f0f9ff' : '#fff',
                            transition: 'all 0.15s',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isAssigned}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setElements(prev => prev.map(el => {
                                if (el.id !== selectedTaskId) return el;
                                const currentResources = { ...(el.data?.resources || {}) };
                                if (checked) {
                                  currentResources[resource.id] = 1;
                                } else {
                                  delete currentResources[resource.id];
                                }
                                return {
                                  ...el,
                                  data: { ...el.data, resources: currentResources }
                                };
                              }));
                            }}
                            style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#0284c7', margin: 0 }}
                          />
                          <Icon style={{ width: 15, height: 15, color: isAssigned ? '#0284c7' : '#9ca3af', flexShrink: 0 }} />
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              flex: 1,
                              color: isAssigned ? '#075985' : '#374151',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {resource.displayName}
                          </span>
                          <button
                            type="button"
                            onClick={() => setEditingResource(resource)}
                            style={{ padding: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center' }}
                            title="Edit Resource Properties"
                          >
                            <Settings size={14} />
                          </button>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 10, color: '#9ca3af' }}>Qty</span>
                            {(() => {
                              const adjustQty = (delta) => {
                                setElements(prev => prev.map(el => {
                                  if (el.id !== selectedTaskId) return el;
                                  const currentResources = { ...(el.data?.resources || {}) };
                                  const nextVal = Math.max(1, (isAssigned ? qty : 0) + delta);
                                  currentResources[resource.id] = nextVal;
                                  return {
                                    ...el,
                                    data: { ...el.data, resources: currentResources }
                                  };
                                }));
                              };
                              const stepBtnStyle = {
                                width: 20,
                                height: 20,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: '1px solid #d1d5db',
                                borderRadius: 5,
                                background: '#fff',
                                cursor: isAssigned ? 'pointer' : 'not-allowed',
                                opacity: isAssigned ? 1 : 0.5,
                                padding: 0,
                                color: '#475569',
                                flexShrink: 0,
                              };
                              return (
                                <button
                                  type="button"
                                  disabled={!isAssigned || qty <= 1}
                                  onClick={() => adjustQty(-1)}
                                  title="Decrease quantity"
                                  style={{ ...stepBtnStyle, cursor: (!isAssigned || qty <= 1) ? 'not-allowed' : 'pointer', opacity: (!isAssigned || qty <= 1) ? 0.4 : 1 }}
                                >
                                  <Minus size={11} />
                                </button>
                              );
                            })()}
                            <input
                              type="number"
                              min="1"
                              value={isAssigned ? qty : ''}
                              disabled={!isAssigned}
                              onChange={(e) => {
                                const val = e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value, 10) || 1);
                                setElements(prev => prev.map(el => {
                                  if (el.id !== selectedTaskId) return el;
                                  const currentResources = { ...(el.data?.resources || {}) };
                                  if (val === '') {
                                    delete currentResources[resource.id];
                                  } else {
                                    currentResources[resource.id] = val;
                                  }
                                  return {
                                    ...el,
                                    data: { ...el.data, resources: currentResources }
                                  };
                                }));
                              }}
                              style={{
                                width: 36,
                                padding: '4px 4px',
                                border: '1px solid #d1d5db',
                                borderRadius: 6,
                                fontSize: 12,
                                textAlign: 'center',
                                outline: 'none',
                                opacity: isAssigned ? 1 : 0.5,
                                cursor: isAssigned ? 'text' : 'not-allowed',
                              }}
                            />
                            <button
                              type="button"
                              disabled={!isAssigned}
                              onClick={() => {
                                setElements(prev => prev.map(el => {
                                  if (el.id !== selectedTaskId) return el;
                                  const currentResources = { ...(el.data?.resources || {}) };
                                  currentResources[resource.id] = (isAssigned ? qty : 0) + 1;
                                  return {
                                    ...el,
                                    data: { ...el.data, resources: currentResources }
                                  };
                                }));
                              }}
                              title="Increase quantity"
                              style={{
                                width: 20,
                                height: 20,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: '1px solid #d1d5db',
                                borderRadius: 5,
                                background: '#fff',
                                cursor: isAssigned ? 'pointer' : 'not-allowed',
                                opacity: isAssigned ? 1 : 0.5,
                                padding: 0,
                                color: '#475569',
                                flexShrink: 0,
                              }}
                            >
                              <Plus size={11} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                  </>
                )}
              </div>

              {/* Close footer */}
              <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb', background: '#f9fafb' }}>
                <button
                  onClick={() => setSelectedTaskId(null)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    background: '#0284c7',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    boxShadow: '0 2px 4px rgba(2,132,199,0.2)',
                    transition: 'background 0.2s',
                  }}
                >
                  Close
                </button>
              </div>
            </aside>
          )}
        </div>
      </div>

      {editingLabelId !== null && (
        <div className="fixed inset-0 z-40" onClick={() => { setEditingLabelId(null); setEditingLabelText(''); }} />
      )}
    </div>
      
      {/* Comparison Pane */}
      <ComparisonPane 
        scenarios={scenarios} 
        compareIds={compareIds} 
        scenarioResults={scenarioResults} 
        backendScenarioIds={backendScenarioIds} 
      />

      {/* ── Simulation Setup (Resources) Modal ── */}
      {showSetupModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
        }} onClick={() => setShowSetupModal(false)}>
          <div style={{
            width: 480, padding: 24, borderRadius: 16,
            background: 'white', border: '1px solid #e5e7eb',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
            margin: 'auto', display: 'flex', flexDirection: 'column', gap: 16
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1f2937' }}>Simulation Setup</h3>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: '#6b7280' }}>
                  Resources, hours and costs for <strong className="text-gray-800">{currentScenario?.name || 'this scenario'}</strong>
                </p>
              </div>
              <button onClick={() => setShowSetupModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '55vh', overflowY: 'auto', paddingRight: 4 }}>
              {(resourceAllocations[activeId] || resourceAllocations['baseline'] || DEFAULT_RESOURCES).map(resource => {
                const Icon = resource.icon || Box;
                return (
                  <div
                    key={resource.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 14px', borderRadius: 10, border: '1px solid #e5e7eb',
                      background: '#f9fafb'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <Icon size={18} style={{ color: '#4f46e5', flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {resource.displayName}
                        </div>
                        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>
                          {resource.hours_per_day ? `${resource.hours_per_day}h/day` : ''}
                          {resource.monthly_salary ? ` • $${resource.monthly_salary.toLocaleString()}/mo` : ''}
                          {resource.purchase_price ? ` • $${resource.purchase_price.toLocaleString()}` : ''}
                          {resource.monthly_rent ? ` • $${resource.monthly_rent.toLocaleString()}/mo rent` : ''}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingResource(resource)}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200 transition-colors shrink-0 ml-2"
                    >
                      Configure
                    </button>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setShowSetupModal(false)}
                style={{ padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: '1px solid #d1d5db', background: 'white', color: '#374151', cursor: 'pointer' }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ResourceConfigPanel Modal ── */}
      {editingResource && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 110,
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

      {/* ── Simulation Run Config Modal ── */}
      {showSimConfigModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
        }} onClick={() => setShowSimConfigModal(false)}>
          <div style={{
            width: 440, padding: 24, borderRadius: 16,
            background: 'white', border: '1px solid #e5e7eb',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
            margin: 'auto', display: 'flex', flexDirection: 'column', gap: 16
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1f2937' }}>Start Scenario Simulation</h3>
                <p style={{ margin: '3px 0 0 0', fontSize: 11, color: '#6b7280' }}>
                  Set up parameters for comparing this scenario against Baseline
                </p>
              </div>
              <button onClick={() => setShowSimConfigModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Detail Level Mode */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>Detail Level (Simulation Mode)</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[{ id: 'quick', label: 'Quick' }, { id: 'deep', label: 'Detailed' }].map(m => (
                    <button key={m.id} type="button" onClick={() => setSimConfigMode(m.id)} style={{
                      flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                      border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                      background: simConfigMode === m.id ? '#6366f1' : '#f3f4f6',
                      color:      simConfigMode === m.id ? '#fff'     : '#4b5563',
                      boxShadow:  simConfigMode === m.id ? '0 1px 3px rgba(99,102,241,0.4)' : 'none',
                    }}>{m.label}</button>
                  ))}
                </div>
              </div>

              {/* Total Cases slider */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>Total Cases</label>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#6366f1' }}>{simConfigInstances}</span>
                </div>
                <input type="range" min={50} max={2000} step={50}
                  value={simConfigInstances}
                  onChange={e => setSimConfigInstances(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#6366f1', cursor: 'pointer' }}/>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 1 }}>
                  <span style={{ fontSize: 9, color: '#cbd5e1' }}>Fast (50)</span>
                  <span style={{ fontSize: 9, color: '#cbd5e1' }}>Accurate (2,000)</span>
                </div>
              </div>

              {/* Arrival Frequency (Traffic) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>Arrival Frequency (One case every...)</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={simConfigArrivalValue}
                    // Keep the raw value while the person is editing. Coercing
                    // an empty string to 1 here makes Backspace appear broken.
                    // Validation happens when they press Start Simulation.
                    onChange={e => setSimConfigArrivalValue(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      border: '1px solid #d1d5db',
                      borderRadius: 8,
                      fontSize: 13,
                      outline: 'none'
                    }}
                  />
                  <select
                    value={simConfigArrivalUnit}
                    onChange={e => setSimConfigArrivalUnit(e.target.value)}
                    style={{
                      padding: '8px 12px',
                      border: '1px solid #d1d5db',
                      borderRadius: 8,
                      fontSize: 13,
                      outline: 'none',
                      background: 'white',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="seconds">Seconds</option>
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
              <button type="button" onClick={() => setShowSimConfigModal(false)} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: '1px solid #d1d5db', background: 'white', color: '#374151', cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="button" onClick={startSimulationWithConfig} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: 'none', background: '#6366f1', color: 'white', cursor: 'pointer' }}>
                Run Simulation
              </button>
            </div>
          </div>
        </div>
      )}

      {import.meta.env.DEV && (
        <div
          className="fixed top-3 right-4 z-[200] rounded-md bg-slate-900 px-2 py-1 font-mono text-[10px] text-white shadow-lg pointer-events-none select-none opacity-90"
          title="Shown only when Vite dev is running. If missing, you are not on the dev server bundle."
        >
          Dev · Scenarios v2
        </div>
      )}
    </div>
  );
}
