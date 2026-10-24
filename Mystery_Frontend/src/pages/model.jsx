'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Grid3x3, Sparkles, MousePointerClick, ChevronRight, ChevronDown, Shapes,
  Play, ZoomIn, ZoomOut, Maximize2, RotateCcw, RotateCw,
  FolderOpen, Save, Download, CloudUpload, CloudDownload, Loader2, FileDown, FilePlus, ExternalLink, Plus,
  Clipboard, CheckSquare, Filter, Type, Check, Copy, ClipboardPaste, Scissors, X, Lock,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { GuestLockModal } from '@/components/auth/GuestLockModal';
import { saveProcess, updateProcess, getAllProcesses, shapeBackendToFrontend } from '../lib/apiService';
import AiPanel from './AiPanel';
import SpotAssistant from '../components/SpotAssistant';
import { NW, NH, elCenter, bestPorts, isXorGateway, outlineAnchor } from '../components/model/bpmnGeometry';
import { Shape } from '../components/model/BpmnShape';
import { DiagramEdge as Edge, tempConnectionLine } from '../components/model/DiagramEdge';
import DiagramCanvas from '../components/model/DiagramCanvas';

// ─── Constants ────────────────────────────────────────────────────────────────
const GRID = 8;
const MIN_ZOOM = 0.15, MAX_ZOOM = 3;
const POOL_LANE_HDR = 30;
const LANE_HDR = 30;
const MIN_POOL_W = 200;
const MIN_POOL_H = 96;
const MIN_LANE_H = 44;

function makeId(type) {
  return `${type}_${Math.random().toString(36).substring(2, 9)}`;
}

function autoConnectOnDelete(connections, removedIds, remainingIds) {
  let nextConns = [...connections];
  for (const id of removedIds) {
    const inc = nextConns.filter(c => c.toId === id && c.type === 'sequence-flow');
    const out = nextConns.filter(c => c.fromId === id && c.type === 'sequence-flow');
    if (inc.length === 1 && out.length === 1) {
      nextConns.push({
        id: makeId('conn'),
        fromId: inc[0].fromId,
        toId: out[0].toId,
        type: 'sequence-flow'
      });
    }
    nextConns = nextConns.filter(c => c.toId !== id && c.fromId !== id);
  }
  return nextConns.filter(c => remainingIds.has(c.fromId) && remainingIds.has(c.toId));
}

function createElement(type, label, position, extras = {}, canvasWidth = 1000) {
  if (type === 'pool') return { id: makeId(type), type, label: label ?? 'Pool', position: { ...position }, width: 600, height: 220, ...extras };
  if (type === 'lane') return { id: makeId(type), type, label: label ?? 'Lane', position: { ...position }, width: 540, height: 150, ...extras };
  if (type === 'annotation') return { id: makeId(type), type, label: label ?? 'Text Annotation', position: { ...position }, width: 180, height: 90, ...extras };
  return { id: makeId(type), type, label, position: { ...position } };
}

function poolLanes(elements, poolId) {
  return elements.filter(e => e.type === 'lane' && e.poolId === poolId).sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0));
}

function applyPoolLayout(elements) {
  const pools = elements.filter(e => e.type === 'pool');
  let out = elements.map(e => ({ ...e }));
  for (const pool of pools) {
    const lanes = poolLanes(out, pool.id);
    if (!lanes.length) continue;
    const W = pool.width ?? 800, H = pool.height ?? 200;
    const n = lanes.length;
    const laneW = Math.max(48, W - POOL_LANE_HDR - LANE_HDR);
    const laneH = Math.round(H / n);
    for (let idx = 0; idx < lanes.length; idx++) {
      const lane = lanes[idx];
      const i = out.findIndex(e => e.id === lane.id);
      if (i >= 0) {
        out[i] = {
          ...out[i],
          position: { x: pool.position.x + POOL_LANE_HDR + LANE_HDR, y: Math.round(pool.position.y + idx * laneH) },
          width: laneW,
          height: laneH,
          rowIndex: idx,
        };
      }
    }
  }
  return out;
}

function ensurePoolMinHeight(elements, poolId) {
  const n = poolLanes(elements, poolId).length;
  if (!n) return elements;
  const need = Math.max(MIN_POOL_H, n * MIN_LANE_H);
  return elements.map(e => (e.id === poolId && e.type === 'pool' && (e.height ?? MIN_POOL_H) < need)
    ? { ...e, height: need } : e);
}

function addDividePoolLanes(elements, poolId) {
  const pool = elements.find(e => e.id === poolId && e.type === 'pool');
  if (!pool) return [elements, null];
  if (poolLanes(elements, poolId).length > 0) return [elements, null];
  const l0 = { ...createElement('lane', 'Lane 1', pool.position), poolId, rowIndex: 0 };
  const l1 = { ...createElement('lane', 'Lane 2', pool.position), poolId, rowIndex: 1 };
  let next = [...elements, l0, l1];
  next = next.map(e => (e.id === poolId && e.type === 'pool' ? { ...e, height: Math.max(e.height ?? 150, MIN_LANE_H * 2) } : e));
  return [applyPoolLayout(next), l1.id];
}

function addLaneToPoolEnd(elements, poolId, atTop) {
  const pool = elements.find(e => e.id === poolId && e.type === 'pool');
  if (!pool) return [elements, null];
  let next = elements.map(e => ({ ...e }));
  const lanes = poolLanes(next, poolId);
  const label = `Lane ${lanes.length + 1}`;
  let newLane;
  if (atTop) {
    next = next.map(el => (el.type === 'lane' && el.poolId === poolId
      ? { ...el, rowIndex: (el.rowIndex ?? 0) + 1 } : el));
    newLane = { ...createElement('lane', label, pool.position), poolId, rowIndex: 0 };
    next.push(newLane);
  } else {
    newLane = { ...createElement('lane', label, pool.position), poolId, rowIndex: lanes.length };
    next.push(newLane);
  }
  next = ensurePoolMinHeight(next, poolId);
  return [applyPoolLayout(next), newLane.id];
}

function addLaneAdjacentToLane(elements, laneId, above) {
  const lane = elements.find(e => e.id === laneId && e.type === 'lane');
  if (!lane?.poolId) return [elements, null];
  const poolId = lane.poolId;
  const ri = lane.rowIndex ?? 0;
  let next = elements.map(el => {
    if (el.type !== 'lane' || el.poolId !== poolId) return el;
    const r = el.rowIndex ?? 0;
    if (above ? r >= ri : r > ri) return { ...el, rowIndex: r + 1 };
    return el;
  });
  const pool = next.find(e => e.id === poolId && e.type === 'pool');
  const label = `Lane ${poolLanes(next, poolId).length + 1}`;
  const newRi = above ? ri : ri + 1;
  const newLane = { ...createElement('lane', label, pool?.position ?? { x: 0, y: 0 }), poolId, rowIndex: newRi };
  next.push(newLane);
  next = ensurePoolMinHeight(next, poolId);
  return [applyPoolLayout(next), newLane.id];
}

function removeLaneFromPool(elements, laneId) {
  const lane = elements.find(e => e.id === laneId && e.type === 'lane');
  if (!lane || !lane.poolId) return elements.filter(e => e.id !== laneId);
  const poolId = lane.poolId;
  const ri = lane.rowIndex ?? 0;

  const pool = elements.find(e => e.id === poolId && e.type === 'pool');
  let laneRect = null;
  if (pool) {
    const siblings = poolLanes(elements, poolId);
    const n = siblings.length || 1;
    const pH = pool.height ?? 220, pW = pool.width ?? 600;
    const lH = Math.round(pH / n);
    const lW = Math.max(48, pW - POOL_LANE_HDR - LANE_HDR);
    const lx = pool.position.x + POOL_LANE_HDR + LANE_HDR;
    const ly = pool.position.y + ri * lH;
    laneRect = { x: lx, y: ly, w: lW, h: lH };
  }

  let next = elements.filter(e => {
    if (e.id === laneId) return false;
    if (laneRect && e.type !== 'pool' && e.type !== 'lane' && pointInRect(elCenter(e), laneRect)) return false;
    return true;
  }).map(el => {
    if (el.type === 'lane' && el.poolId === poolId && (el.rowIndex ?? 0) > ri)
      return { ...el, rowIndex: (el.rowIndex ?? 0) - 1 };
    return el;
  });
  return applyPoolLayout(next);
}

function removePoolCascade(elements, poolId) {
  const pool = elements.find(e => e.id === poolId && e.type === 'pool');
  if (!pool) return elements.filter(e => e.id !== poolId && !(e.type === 'lane' && e.poolId === poolId));
  const rect = { x: pool.position.x, y: pool.position.y, w: pool.width ?? 600, h: pool.height ?? 150 };
  return elements.filter(e => {
    if (e.id === poolId) return false;
    if (e.type === 'lane' && e.poolId === poolId) return false;
    if (e.type !== 'pool' && e.type !== 'lane' && pointInRect(elCenter(e), rect)) return false;
    return true;
  });
}

function applyResizeRect(orig, handle, dx, dy, minW, minH) {
  let { x, y, w, h } = orig;
  if (handle.includes('e')) w = Math.max(minW, orig.w + dx);
  if (handle.includes('w')) {
    const nw = Math.max(minW, orig.w - dx);
    x = orig.x + orig.w - nw;
    w = nw;
  }
  if (handle.includes('s')) h = Math.max(minH, orig.h + dy);
  if (handle.includes('n')) {
    const nh = Math.max(minH, orig.h - dy);
    y = orig.y + orig.h - nh;
    h = nh;
  }
  return { x, y, w, h };
}

function pointInRect(pt, rect) {
  return pt.x >= rect.x && pt.x <= rect.x + rect.w && pt.y >= rect.y && pt.y <= rect.y + rect.h;
}

const isEndEvent = (el) => !!el && typeof el.type === 'string' && el.type.endsWith('end-event');
function orientConnection(fId, tId, els) {
  const src = els.find(e => e.id === fId);
  const tgt = els.find(e => e.id === tId);
  if (isEndEvent(src) && isEndEvent(tgt)) return null;
  if (isEndEvent(src)) return { fromId: tId, toId: fId };
  return { fromId: fId, toId: tId };
}

function scalePointBetweenRects(pt, fromRect, toRect) {
  const sx = fromRect.w > 0 ? (pt.x - fromRect.x) / fromRect.w : 0;
  const sy = fromRect.h > 0 ? (pt.y - fromRect.y) / fromRect.h : 0;
  return { x: toRect.x + sx * toRect.w, y: toRect.y + sy * toRect.h };
}

export { Shape, elCenter, bestPorts };

// ─── Context pad ──────────────────────────────────────────────────────────────
function ContextPad({ el, elements, connections, setElements, setConnections, setSelId, connMode, coords = 'global', onDelete, onRename, showMsg }) {
  const w = el.width || NW, h = el.height || NH;
  const cx = coords === 'local' ? w / 2 : el.position.x + w / 2;
  const cy = coords === 'local' ? h / 2 : el.position.y + h / 2;
  const R = 56;

  const handleConnect = (mode) => {
    const pcx = el.position.x + w;
    const pcy = el.position.y + h / 2;
    let closest = null, minDist = Infinity;
    for (const n of elements) {
      if (n.id === el.id || n.type === 'pool' || n.type === 'lane') continue;
      const nx = n.position.x;
      const ny = n.position.y + (n.height || NH) / 2;
      if (nx > pcx - 20) {
        const dist = Math.hypot(nx - pcx, ny - pcy);
        if (dist < minDist && dist < 350) { minDist = dist; closest = n; }
      }
    }
    if (closest) {
      if (mode === 'message-flow') {
        const p1 = getPoolForNode(el, elements);
        const p2 = getPoolForNode(closest, elements);
        if (p1 === p2) {
          showMsg('error', 'Message flows cannot connect elements within the same pool.');
          return;
        }
      }
      setConnections(prev => {
        const next = [...prev, { id: makeId('conn'), fromId: el.id, toId: closest.id, type: mode }];
        if (el.type === 'exclusive-gateway' || el.type === 'inclusive-gateway' || el.type === 'gateway') {
          const outgoing = next.filter(c => c.fromId === el.id);
          const split = Math.floor(100 / outgoing.length);
          return next.map(c => {
            if (c.fromId !== el.id) return c;
            const idx = outgoing.findIndex(o => o.id === c.id);
            return { ...c, probability: idx === 0 ? (100 - split * (outgoing.length - 1)) / 100 : split / 100 };
          });
        }
        return next;
      });
      setSelId(closest.id);
    } else {
      const newEl = createElement('task', 'Task', { x: el.position.x + w + 90, y: el.position.y });
      const conn = { id: makeId('conn'), fromId: el.id, toId: newEl.id, type: mode };
      setElements(p => [...p, newEl]);
      setConnections(p => [...p, conn]);
      setSelId(newEl.id);
    }
  };

  const handleAppend = (type, label) => {
    let newY = el.position.y;
    if (el.type.includes('gateway')) {
      const branches = connections.filter(c => c.fromId === el.id).length;
      if (branches > 0) {
        const offsetMultiplier = Math.ceil(branches / 2) * (branches % 2 === 0 ? -1 : 1);
        newY += offsetMultiplier * 120;
      }
    }

    const newEl = createElement(type, label, { x: el.position.x + w + 90, y: newY });
    setElements(p => [...p, newEl]);

    const outgoing = connections.filter(c => c.fromId === el.id && c.type === 'sequence-flow');
    if (outgoing.length === 1 && connMode === 'sequence-flow' && !el.type.includes('gateway')) {
      const oldConn = outgoing[0];
      const conn1 = { id: makeId('conn'), fromId: el.id, toId: newEl.id, type: connMode };
      const conn2 = { id: makeId('conn'), fromId: newEl.id, toId: oldConn.toId, type: connMode };
      setConnections(p => [...p.filter(c => c.id !== oldConn.id), conn1, conn2]);
    } else {
      const conn = { id: makeId('conn'), fromId: el.id, toId: newEl.id, type: connMode };
      setConnections(p => [...p, conn]);
    }
    setSelId(el.type.includes('gateway') ? el.id : newEl.id);
  };

  const isEnd = isEndEvent(el);
  const allBtns = [
    { angle: 0, key: 'seq', col: '#1e40af', bg: '#dbeafe', icon: '→', title: 'Sequence Flow', cb: () => handleConnect('sequence-flow') },
    { angle: 50, key: 'msg', col: '#6b21a8', bg: '#f3e8ff', icon: '⇢', title: 'Message Flow', cb: () => handleConnect('message-flow') },
    { angle: 100, key: 'task', col: '#065f46', bg: '#d1fae5', icon: '▭', title: 'Append Task', cb: () => handleAppend('task', 'Task') },
    { angle: 150, key: 'gw', col: '#92400e', bg: '#fef3c7', icon: '◇', title: 'Add Decision Point', cb: () => handleAppend('exclusive-gateway', 'Decision Point') },
    { angle: 200, key: 'end', col: '#991b1b', bg: '#fee2e2', icon: '◉', title: 'Append End', cb: () => handleAppend('end-event', 'End') },
    { angle: 270, key: 'del', col: '#dc2626', bg: '#fee2e2', icon: '✕', title: 'Delete', cb: onDelete },
    { angle: 320, key: 'ren', col: '#374151', bg: '#f3f4f6', icon: '✎', title: 'Rename', cb: onRename },
  ];
  const btns = isEnd ? allBtns.filter(b => b.key === 'del' || b.key === 'ren') : allBtns;
  return (
    <g data-context-pad="true" style={{ pointerEvents: 'all' }} onMouseDown={e => e.stopPropagation()}>
      {btns.map(b => {
        const rad = (b.angle * Math.PI) / 180;
        const bx = cx + R * Math.cos(rad);
        const by = cy + R * Math.sin(rad);
        const active = (b.key === 'seq' && connMode === 'sequence-flow') || (b.key === 'msg' && connMode === 'message-flow');
        return (
          <g key={b.key}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); b.cb(); }}
            style={{ cursor: 'pointer' }}>
            <circle cx={bx} cy={by} r={14} fill={active ? b.col : b.bg} stroke={b.col} strokeWidth={active ? 0 : 1.5} />
            <text x={bx} y={by + 5} textAnchor="middle" fontSize="12"
              fill={active ? 'white' : b.col}
              style={{ userSelect: 'none', fontFamily: 'system-ui', pointerEvents: 'none' }}>
              {b.icon}
            </text>
            <title>{b.title}</title>
          </g>
        );
      })}
    </g>
  );
}

// ─── Swimlane resize + context pad ────────────────────────────────────────────
function RectResizeHandles({ x, y, w, h, visible, onResizeStart }) {
  if (!visible) return null;
  const s = 7, o = s / 2;
  const pts = [
    { k: 'nw', cx: x - o, cy: y - o, cur: 'nwse-resize' },
    { k: 'n', cx: x + w / 2 - o, cy: y - o, cur: 'ns-resize' },
    { k: 'ne', cx: x + w - o, cy: y - o, cur: 'nesw-resize' },
    { k: 'e', cx: x + w - o, cy: y + h / 2 - o, cur: 'ew-resize' },
    { k: 'se', cx: x + w - o, cy: y + h - o, cur: 'nwse-resize' },
    { k: 's', cx: x + w / 2 - o, cy: y + h - o, cur: 'ns-resize' },
    { k: 'sw', cx: x - o, cy: y + h - o, cur: 'nesw-resize' },
    { k: 'w', cx: x - o, cy: y + h / 2 - o, cur: 'ew-resize' },
  ];
  return (
    <g style={{ pointerEvents: 'all' }}>
      {pts.map(p => (
        <rect key={p.k} x={p.cx} y={p.cy} width={s} height={s} rx={1}
          fill="#f3f4f6" stroke="#9ca3af" strokeWidth={1.5}
          data-resize-handle="true" data-handle={p.k}
          style={{ cursor: p.cur }}
          onMouseDown={e => { e.stopPropagation(); onResizeStart(e, p.k); }} />
      ))}
    </g>
  );
}

function SwimlanePadButton({ bx, by, title, glyph, onClick, accent = '#374151', bg = '#f8fafc' }) {
  return (
    <g
      onMouseDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onClick(); }}
      style={{ cursor: 'pointer' }}>
      <rect x={bx} y={by} width={40} height={34} rx={8} fill={bg} stroke={accent} strokeWidth={1.5} />
      <text x={bx + 20} y={by + 21} textAnchor="middle" fontSize="14" fill={accent} fontWeight="600"
        style={{ userSelect: 'none', fontFamily: 'system-ui', pointerEvents: 'none' }}>{glyph}</text>
      <title>{title}</title>
    </g>
  );
}

function SwimlaneContextPad({ ox, oy, variant, onAddAbove, onDivide, onAddBelow, onRename, onDelete }) {
  const gap = 5;
  const y = 0;
  const rows = [];
  if (variant === 'pool') {
    rows.push({ key: 'ab', title: 'Add lane above', glyph: '▔', cb: onAddAbove });
    rows.push({ key: 'dv', title: 'Divide into lanes', glyph: '═', cb: onDivide });
    rows.push({ key: 'bl', title: 'Add lane below', glyph: '▁', cb: onAddBelow });
    rows.push({ key: 'rn', title: 'Rename', glyph: '✎', cb: onRename });
    rows.push({ key: 'dl', title: 'Delete pool', glyph: '✕', cb: onDelete, accent: '#b91c1c', bg: '#fef2f2' });
  } else if (variant === 'lane-in-pool') {
    rows.push({ key: 'ab', title: 'Add lane above', glyph: '▔', cb: onAddAbove });
    rows.push({ key: 'bl', title: 'Add lane below', glyph: '▁', cb: onAddBelow });
    rows.push({ key: 'rn', title: 'Rename', glyph: '✎', cb: onRename });
    rows.push({ key: 'dl', title: 'Delete lane', glyph: '✕', cb: onDelete, accent: '#b91c1c', bg: '#fef2f2' });
  } else {
    rows.push({ key: 'rn', title: 'Rename', glyph: '✎', cb: onRename });
    rows.push({ key: 'dl', title: 'Delete', glyph: '✕', cb: onDelete, accent: '#b91c1c', bg: '#fef2f2' });
  }
  const uniqRows = Array.from(new Map(rows.map(r => [r.key, r])).values());
  return (
    <g data-context-pad="true" transform={`translate(${ox},${oy})`} style={{ pointerEvents: 'all' }} onMouseDown={e => e.stopPropagation()}>
      {uniqRows.map((r, i) => {
        const by = y + i * (34 + gap);
        return (
          <SwimlanePadButton
            key={r.key}
            bx={0}
            by={by}
            title={r.title}
            glyph={r.glyph}
            onClick={r.cb}
            accent={r.accent ?? '#374151'}
            bg={r.bg ?? '#f8fafc'} />
        );
      })}
    </g>
  );
}

// ─── Gateway "How Often" Popover ─────────────────────────────────────────────
function GatewayPopover({ gateway, connections, onUpdateProbability, onClose }) {
  const outgoing = connections.filter(c => c.fromId === gateway.id);
  const isOR = gateway.type === 'inclusive-gateway';

  // Initialise sliders from existing probability or equal split
  const equalVal = isOR ? 50 : Math.floor(100 / outgoing.length);
  const initVals = () => {
    const vals = outgoing.map(c =>
      c.probability != null ? Math.round(c.probability * 100) : equalVal
    );
    // Make sure they sum to 100 by adjusting the first entry (only for XOR)
    if (!isOR) {
      const sum = vals.reduce((a, b) => a + b, 0);
      if (sum !== 100) vals[0] += 100 - sum;
    }
    return vals;
  };

  const [vals, setVals] = React.useState(initVals);
  const total = vals.reduce((a, b) => a + b, 0);
  const valid = isOR ? true : total === 100;

  const handleSlider = (idx, newVal) => {
    let newVals;
    if (isOR) {
      // Independent sliders for OR gateways
      const clamped = Math.max(0, Math.min(100, Number(newVal)));
      newVals = [...vals];
      newVals[idx] = clamped;
    } else {
      // Linked sliders for XOR gateways
      const clamped = Math.max(1, Math.min(99, Number(newVal)));
      const others = outgoing.length - 1;
      if (others < 1) return;

      newVals = vals.map((_, i) => i === idx ? clamped : 0);
      let rem = 100 - clamped;
      const otherIdxs = vals.map((_, i) => i).filter(i => i !== idx);
      otherIdxs.forEach((i, pos) => {
        const share = pos === otherIdxs.length - 1 ? rem : Math.floor(rem / (otherIdxs.length - pos));
        newVals[i] = Math.max(1, share);
        rem -= newVals[i];
      });
    }

    setVals(newVals);
    // Save immediately
    outgoing.forEach((c, i) => onUpdateProbability(c.id, newVals[i] / 100));
  };

  const px = gateway.position.x + 90;
  const py = gateway.position.y - 20;

  return (
    <foreignObject x={px} y={py} width="230" height={80 + outgoing.length * 56} style={{ overflow: 'visible' }}>
      <div style={{
        background: '#fff',
        border: '1.5px solid #e2e8f0',
        borderRadius: 12,
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        padding: '14px 16px',
        fontFamily: 'Inter, system-ui, sans-serif',
        pointerEvents: 'all',
      }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>
            ⑂ How often does each path occur?
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
        </div>

        {outgoing.map((conn, idx) => (
          <div key={conn.id} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>
                {conn.label || conn.name || (isXorGateway(gateway.type) ? (outgoing.length >= 2 ? (idx === 0 ? 'Yes' : idx === 1 ? 'No' : `Branch ${idx + 1}`) : 'Yes') : `Path ${idx + 1}`)}
              </span>
              <span style={{ fontSize: 11, color: '#6b4de6', fontWeight: 700 }}>{vals[idx]}%</span>
            </div>
            <input
              type="range"
              min={isOR ? 0 : 1}
              max={isOR ? 100 : 99}
              value={vals[idx]}
              onChange={e => handleSlider(idx, e.target.value)}
              style={{ width: '100%', accentColor: '#6b4de6', cursor: 'pointer' }}
            />
          </div>
        ))}

        {!isOR && (
          <div style={{
            fontSize: 11, fontWeight: 600, marginTop: 4,
            color: valid ? '#10b981' : '#ef4444',
          }}>
            {valid ? '✓ Adds up correctly' : `⚠ Paths must add up to 100 (currently ${total})`}
          </div>
        )}
      </div>
    </foreignObject>
  );
}

// ─── Palette ──────────────────────────────────────────────────────────────────
const CATS = [
  {
    id: 'events', name: 'Events', items: [
      { id: 'start-event', label: 'Start Event', icon: '◯' },
      { id: 'message-start-event', label: 'Message Start', icon: '✉◯', adv: true },
      { id: 'timer-start-event', label: 'Timer Start', icon: '⏰◯', adv: true },
      { id: 'conditional-start-event', label: 'Conditional Start', icon: '📋◯', adv: true },
      { id: 'signal-start-event', label: 'Signal Start', icon: '⚠◯', adv: true },
      { id: 'intermediate-event', label: 'Intermediate Event', icon: '◎', adv: true },
      { id: 'message-intermediate-catch', label: 'Message Intermediate Catch', icon: '✉◎', adv: true },
      { id: 'message-intermediate-throw', label: 'Message Intermediate Throw', icon: '✉●◎', adv: true },
      { id: 'timer-intermediate-catch', label: 'Timer Intermediate Catch', icon: '⏰◎', adv: true },
      { id: 'conditional-intermediate-catch', label: 'Conditional Intermediate Catch', icon: '📋◎', adv: true },
      { id: 'signal-intermediate-catch', label: 'Signal Intermediate Catch', icon: '⚠◎', adv: true },
      { id: 'signal-intermediate-throw', label: 'Signal Intermediate Throw', icon: '⚠●◎', adv: true },
      { id: 'end-event', label: 'End Event', icon: '◉' },
      { id: 'message-end-event', label: 'Message End', icon: '✉◉', adv: true },
      { id: 'error-end-event', label: 'Error End', icon: '⚡◉', adv: true },
      { id: 'escalation-end-event', label: 'Escalation End', icon: '▲◉', adv: true },
      { id: 'signal-end-event', label: 'Signal End', icon: '⚠◉', adv: true },
      { id: 'terminate-end-event', label: 'Terminate End', icon: '●◉', adv: true },
    ]
  },
  {
    id: 'activities', name: 'Activities', items: [
      { id: 'task', label: 'Task', icon: '▭' },
      { id: 'user-task', label: 'User Task', icon: '👤▭' },
      { id: 'service-task', label: 'Service Task', icon: '⚙▭', adv: true },
      { id: 'script-task', label: 'Script Task', icon: '📄▭', adv: true },
      { id: 'manual-task', label: 'Manual Task', icon: '✍▭', adv: true },
      { id: 'send-task', label: 'Send Task', icon: '✉➡▭', adv: true },
      { id: 'receive-task', label: 'Receive Task', icon: '✉⬅▭', adv: true },
      { id: 'business-rule-task', label: 'Business Rule Task', icon: '田▭', adv: true },
      { id: 'subprocess', label: 'Sub-Process', icon: '⊞', adv: true },
      { id: 'call-activity', label: 'Call Activity', icon: '🗂', adv: true },
    ]
  },
  {
    id: 'gateways', name: 'Gateways', items: [
      { id: 'exclusive-gateway', label: 'Exclusive Gateway', icon: '✕◇' },
      { id: 'parallel-gateway', label: 'Parallel Gateway', icon: '+◇' },
      { id: 'inclusive-gateway', label: 'Inclusive Gateway', icon: '○◇', adv: true },
      { id: 'complex-gateway', label: 'Complex Gateway', icon: '*◇', adv: true },
      { id: 'event-based-gateway', label: 'Event-Based Gateway', icon: '◯◇', adv: true },
    ]
  },
  {
    id: 'flows', name: 'Flows', items: [
      { id: 'sequence-flow', label: 'Sequence Flow', icon: '→', flowMode: true },
      { id: 'message-flow', label: 'Message Flow', icon: '⇢', flowMode: true },
      { id: 'association', label: 'Association', icon: '⤏', flowMode: true, adv: true },
    ]
  },
  {
    id: 'swimlanes', name: 'Swimlanes', items: [
      { id: 'pool', label: 'Pool', icon: '▭▭' },
      { id: 'lane', label: 'Lane', icon: '║' },
    ]
  },
  {
    id: 'artifacts', name: 'Artifacts', items: [
      { id: 'data-object', label: 'Data Object', icon: '📄' },
      { id: 'data-store', label: 'Data Store', icon: '🛢', adv: true },
      { id: 'document', label: 'Document', icon: '📋' },
      { id: 'annotation', label: 'Annotation', icon: '[', adv: true },
      { id: 'group', label: 'Group', icon: '░', adv: true },
      { id: 'input', label: 'Input', icon: '⬅', adv: true },
      { id: 'output', label: 'Output', icon: '➜', adv: true },
    ]
  },
];

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

let paletteLastExp = new Set(['events', 'activities', 'gateways', 'flows', 'swimlanes']);
let paletteLastAdv = new Set();

function Palette({ onAdd, onStartFlow, activeFlowMode }) {
  const [exp, setExp] = useState(paletteLastExp);
  const [adv, setAdv] = useState(paletteLastAdv);
  const tog = id => setExp(p => {
    const s = new Set(p);
    s.has(id) ? s.delete(id) : s.add(id);
    paletteLastExp = s;
    return s;
  });
  const togAdv = id => setAdv(p => {
    const s = new Set(p);
    s.has(id) ? s.delete(id) : s.add(id);
    paletteLastAdv = s;
    return s;
  });

  return (
    <div className="pb-6">
      {CATS.map(cat => {
        const basics = cat.items.filter(i => !i.adv);
        const advItems = cat.items.filter(i => i.adv);
        const open = exp.has(cat.id);
        const sa = adv.has(cat.id);
        return (
          <div key={cat.id} className="mb-0.5">
            <button onClick={() => tog(cat.id)}
              className="w-full flex items-center gap-2.5 pl-6 pr-3 min-h-[44px] py-2.5 hover:bg-slate-50 transition-all text-left border-b border-slate-100/50">
              {open
                ? <ChevronDown size={14} strokeWidth={3} className="text-slate-400 shrink-0" />
                : <ChevronRight size={14} strokeWidth={3} className="text-slate-400 shrink-0" />}
              <span className="text-[13px] font-bold text-slate-700 uppercase tracking-tight">{cat.name}</span>
            </button>
            {open && (
              <div className="py-1 bg-white">
                {[...basics, ...(sa ? advItems : [])].map(item => {
                  const isActive = item.flowMode && activeFlowMode === item.id;
                  return (
                    <div key={item.id}
                      draggable={!item.flowMode}
                      onDragStart={e => {
                        if (item.flowMode) { e.preventDefault(); return; }
                        e.dataTransfer.effectAllowed = 'copy';
                        e.dataTransfer.setData('application/bpmn', JSON.stringify({ type: item.id, label: item.label }));
                      }}
                      onClick={() => item.flowMode ? onStartFlow(item.id) : onAdd(item.id, item.label)}
                      className={`flex items-center gap-3.5 pl-11 pr-4 min-h-[44px] py-3 cursor-pointer select-none group transition-all border-l-4 ${isActive
                        ? 'bg-sky-50 border-sky-600'
                        : 'border-transparent hover:bg-slate-50 hover:border-slate-200'
                        }`}>
                      <span className={`w-6 h-6 flex items-center justify-center shrink-0 transition-transform group-hover:scale-110 ${isActive ? 'text-sky-600' : 'text-slate-400 group-hover:text-sky-500'}`}>
                        <PaletteIcon id={item.id} />
                      </span>
                      <span className={`text-[13px] font-medium leading-snug ${isActive ? 'text-sky-700 font-bold' : 'text-slate-600 group-hover:text-slate-900'}`}>{item.label}</span>
                      {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.5)]" />}
                    </div>
                  );
                })}
                {advItems.length > 0 && (
                  <button onClick={() => togAdv(cat.id)}
                    className="flex items-center justify-center gap-1.5 w-full min-h-[36px] py-2.5 text-[11px] font-bold text-sky-600 hover:text-sky-700 hover:bg-sky-50/50 transition-all tracking-wide uppercase">
                    {sa ? '− Show Less' : '+ Show More'}
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

// ─── Toolbar Button Components ─────────────────────────────────────────────────
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
    icon: { background: '#ffffff', color: '#4b5563', borderColor: '#d1d5db', padding: '0', width: '38px' }, // Increased from 32px
    active: { background: '#eef2ff', color: '#4f46e5', borderColor: '#c7d2fe' },
    primary: { background: '#5E43F3', color: '#ffffff', borderColor: 'transparent' },
    danger: { background: '#ffffff', color: '#dc2626', borderColor: '#fecaca' },
  };
  const merged = { ...base, ...variants[variant] };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={merged}
      onMouseEnter={e => {
        if (disabled) return;
        if (variant === 'default' || variant === 'icon') e.currentTarget.style.background = '#f9fafb';
        if (variant === 'active') e.currentTarget.style.background = '#4338ca';
        if (variant === 'primary') e.currentTarget.style.background = '#0369a1';
        if (variant === 'danger') e.currentTarget.style.background = '#fef2f2';
      }}
      onMouseLeave={e => {
        if (disabled) return;
        e.currentTarget.style.background = merged.background;
      }}
      className={className}
    >
      {children}
    </button>
  );
}

function TDivider() {
  return <div style={{ height: '22px', width: '1px', background: '#e5e7eb', margin: '0 3px', flexShrink: 0 }} />;
}

// ─── Model Page ───────────────────────────────────────────────────────────────
export default function ModelPage() {
  const navigate = useNavigate();
  const { isGuest } = useAuth();
  const [guestModalOpen, setGuestModalOpen] = useState(false);

  const newModel = () => {
    localStorage.removeItem('spot:model:nodes');
    localStorage.removeItem('spot:processId');
    localStorage.removeItem('spot:processTitle');
    setSavedProcessId(null);
    setProcessTitle('Untitled Process');
    setElements([]);
    setConnections([]);
    setSelId(null);
    setSelConn(null);
  };

  const [elements, setElements] = useState([]);
  const [connections, setConnections] = useState([]);

  // ── Backend integration state ────────────────────────────────────────────────
  const [processTitle, setProcessTitle] = useState('Untitled Process');
  const [savedProcessId, setSavedProcessId] = useState(() => localStorage.getItem('spot:processId') || null);
  const [backendSaving, setBackendSaving] = useState(false);
  const [backendLoading, setBackendLoading] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [processList, setProcessList] = useState([]);
  const [backendMsg, setBackendMsg] = useState(null);

  const [leftSidebarWidth, setLeftSidebarWidth] = useState(240);
  const startLeftResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = leftSidebarWidth;
    const onMove = (me) => setLeftSidebarWidth(Math.max(200, Math.min(600, startW + (me.clientX - startX))));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const showMsg = (type, text) => {
    setBackendMsg({ type, text });
    setTimeout(() => setBackendMsg(null), 3500);
  };

  // Accepts explicit overrides so callers with FRESH data in hand (like
  // onApplyDiagram below) don't have to wait a render cycle for React state
  // to catch up before saving — closing over `elements`/`connections` here
  // would silently save the PREVIOUS diagram, not the one just applied.
  //
  // Also now correctly updates the existing process in place (reading the
  // stored id fresh from localStorage each call, not a possibly-stale React
  // state value) instead of unconditionally creating a new document on
  // every save — that was minting a fresh Process document (and a fresh
  // spot:processId) on every single save, silently orphaning the old one
  // and anything that still pointed at it.
  const saveToBackend = useCallback(async (overrides) => {
    if (isGuest) {
      setGuestModalOpen(true);
      return false;
    }
    const elsToSave = overrides?.elements ?? elements;
    const connsToSave = overrides?.connections ?? connections;
    const titleToSave = overrides?.title ?? processTitle;

    if (elsToSave.length === 0) { showMsg('error', 'Canvas is empty — add some nodes first.'); return false; }
    setBackendSaving(true);
    try {
      const existingId = localStorage.getItem('spot:processId');
      let res;
      if (existingId) {
        res = await updateProcess(existingId, elsToSave, connsToSave, titleToSave);
      } else {
        res = await saveProcess(elsToSave, connsToSave, titleToSave);
      }
      const id = res.process?._id || res.process?.id || existingId;
      if (id) {
        setSavedProcessId(id);
        localStorage.setItem('spot:processId', id);
        localStorage.setItem('spot:processTitle', titleToSave);
        localStorage.setItem('spot:model:nodes', JSON.stringify({ nodes: elsToSave, connections: connsToSave }));
        showMsg('success', 'Process saved to backend!');
        return id;
      }
    } catch (err) {
      showMsg('error', `Save failed: ${err.message}`);
    } finally {
      setBackendSaving(false);
    }
    return null;
  }, [elements, connections, processTitle, isGuest]);

  const handleRunSimulation = useCallback(async () => {
    if (isGuest) {
      setGuestModalOpen(true);
      return;
    }
    localStorage.setItem('spot:model:nodes', JSON.stringify({ nodes: elements, connections }));
    const success = await saveToBackend();
    if (success) {
      navigate('/simulate?autorun=true');
    }
  }, [elements, connections, saveToBackend, navigate, isGuest]);

  const openLoadModal = useCallback(async () => {
    setBackendLoading(true);
    setShowLoadModal(true);
    try {
      const list = await getAllProcesses();
      setProcessList(list);
    } catch (err) {
      showMsg('error', `Could not fetch processes: ${err.message}`);
      setShowLoadModal(false);
    } finally {
      setBackendLoading(false);
    }
  }, []);

  const loadProcessFromBackend = useCallback((process) => {
    const { elements: els, connections: conns } = shapeBackendToFrontend(process);
    localStorage.setItem('spot:processId', process._id || process.id);
    localStorage.setItem('spot:processTitle', process.title || 'Untitled Process');
    localStorage.setItem('spot:model:nodes', JSON.stringify({ nodes: els, connections: conns }));
    if (process.resources && Array.isArray(process.resources)) {
      localStorage.setItem('spot:globalResources', JSON.stringify(process.resources));
    }
    setSavedProcessId(process._id || process.id);
    setProcessTitle(process.title || 'Untitled Process');
    setElements(els);
    setConnections(conns);
    setShowLoadModal(false);
    showMsg('success', `Loaded "${process.title}"`);
    pendingFitRef.current = true;
  }, []);

  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [spotAssistantOpen, setSpotAssistantOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [openGatewayId, setOpenGatewayId] = useState(null);

  const [selId, setSelId] = useState(null);
  const [selConn, setSelConn] = useState(null);
  const [allSelected, setAllSelected] = useState(false);
  const [multiSel, setMultiSel] = useState(new Set());
  const [lasso, setLasso] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 60, y: 60 });
  const [gridType, setGridType] = useState('dots'); // 'none' | 'dots' | 'lines'
  const [hoveredId, setHoveredId] = useState(null);
  const [drawConn, setDrawConn] = useState(null); // { fromId?, toId?, type, pendingFromPalette? }
  const [connMode, setConnMode] = useState('sequence-flow');
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState('');
  const [ctxMenu, setCtxMenu] = useState(null);
  const [clipboard, setClipboard] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [deletePrompt, setDeletePrompt] = useState(null);
  // Auto-open the "how often" popover whenever an exclusive-gateway with
  // 2+ outgoing edges is selected. Close it when selection moves away.
  useEffect(() => {
    if (!selId) { setOpenGatewayId(null); return; }
    const el = elements.find(e => e.id === selId);
    if (el?.type === 'exclusive-gateway' || el?.type === 'inclusive-gateway' || el?.type === 'gateway') {
      const outgoing = connections.filter(c => c.fromId === selId);
      if (outgoing.length >= 2) {
        setOpenGatewayId(selId);
        return;
      }
    }
    setOpenGatewayId(null);
  }, [selId, elements, connections]);

  // ── Undo / Redo ─────────────────────────────────────────────────────────────
  const history = useRef([{ elements: [], connections: [] }]);
  const histIdx = useRef(0);
  const skipHist = useRef(false);

  const pushHistory = useCallback((els, conns) => {
    if (skipHist.current) return;
    const snap = JSON.stringify({ elements: els, connections: conns });
    const last = JSON.stringify(history.current[histIdx.current]);
    if (snap === last) return;
    history.current = history.current.slice(0, histIdx.current + 1);
    history.current.push({ elements: els, connections: conns });
    histIdx.current = history.current.length - 1;
  }, []);

  const elementsRef = useRef(elements);
  const connectionsRef = useRef(connections);
  useEffect(() => { elementsRef.current = elements; }, [elements]);
  useEffect(() => { connectionsRef.current = connections; }, [connections]);
  useEffect(() => { pushHistory(elements, connections); }, [elements, connections]); // eslint-disable-line

  const undo = useCallback(() => {
    if (histIdx.current <= 0) return;
    histIdx.current -= 1;
    const snap = history.current[histIdx.current];
    skipHist.current = true;
    setElements(snap.elements);
    setConnections(snap.connections);
    setTimeout(() => { skipHist.current = false; }, 0);
  }, []);

  const redo = useCallback(() => {
    if (histIdx.current >= history.current.length - 1) return;
    histIdx.current += 1;
    const snap = history.current[histIdx.current];
    skipHist.current = true;
    setElements(snap.elements);
    setConnections(snap.connections);
    setTimeout(() => { skipHist.current = false; }, 0);
  }, []);

  const [, forceRender] = useState(0);
  const canUndo = histIdx.current > 0;
  const canRedo = histIdx.current < history.current.length - 1;

  const canvasRef = useRef(null);
  const dragging = useRef(null);
  const panning = useRef(null);
  const resizing = useRef(null);
  const connDragging = useRef(null);
  const spaceRef = useRef(false);

  // ── Viewport rulers / scrollbars ────────────────────────────────────────────
  const [viewportW, setViewportW] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setViewportW(rect.width);
      setViewportH(rect.height);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const isSwimId = useCallback((id) => {
    const e = elements.find(x => x.id === id);
    return e?.type === 'pool' || e?.type === 'lane';
  }, [elements]);

  const isLoadedRef = useRef(false);

  // ── Persist / Load ──────────────────────────────────────────────────────────
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('new') === '1') {
      localStorage.removeItem('spot:model:nodes');
      localStorage.removeItem('spot:processId');
      localStorage.removeItem('spot:processTitle');
      setElements([]);
      setConnections([]);
      isLoadedRef.current = true;
      return;
    }
    const savedTitle = localStorage.getItem('spot:processTitle');
    if (savedTitle) setProcessTitle(savedTitle);
    const raw = localStorage.getItem('spot:model:nodes');
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      if (d.nodes?.length) {
        skipHist.current = true;
        setElements(d.nodes);
        setConnections(d.connections || []);
        setTimeout(() => { skipHist.current = false; }, 0);
      }
    } catch { } finally {
      isLoadedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (isLoadedRef.current) {
      localStorage.setItem('spot:model:nodes', JSON.stringify({ nodes: elements, connections }));
      localStorage.setItem('spot:model:viewport', JSON.stringify({ zoom, pan }));
    }
  }, [elements, connections, zoom, pan]);

  // ── Coords ──────────────────────────────────────────────────────────────────
  const toCanvas = useCallback((cx, cy) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (cx - rect.left - pan.x) / zoom, y: (cy - rect.top - pan.y) / zoom };
  }, [pan, zoom]);

  // ── Fit view ────────────────────────────────────────────────────────────────
  const fitView = useCallback(() => {
    if (!elements.length || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    elements.forEach(el => {
      const w = el.width || NW, h = el.height || NH;
      minX = Math.min(minX, el.position.x);
      minY = Math.min(minY, el.position.y);
      maxX = Math.max(maxX, el.position.x + w);
      maxY = Math.max(maxY, el.position.y + h);
    });
    const pad = 80, dw = maxX - minX + pad * 2, dh = maxY - minY + pad * 2;
    const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(rect.width / dw, rect.height / dh)));
    setZoom(nz);
    setPan({
      x: (rect.width - dw * nz) / 2 + pad * nz - minX * nz,
      y: (rect.height - dh * nz) / 2 + pad * nz - minY * nz
    });
  }, [elements]);

  const pendingFitRef = useRef(true);
  useEffect(() => {
    if (!pendingFitRef.current) return;
    if (!elements.length || !canvasRef.current) return;
    if (!viewportW || !viewportH) return;
    const id = requestAnimationFrame(() => {
      fitView();
      pendingFitRef.current = false;
    });
    return () => cancelAnimationFrame(id);
  }, [elements, viewportW, viewportH, fitView]);

  const zoomToCenter = useCallback((factor) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = rect.width / 2;
    const my = rect.height / 2;
    setZoom(z => {
      const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
      setPan(p => ({
        x: mx - (mx - p.x) * (nz / z),
        y: my - (my - p.y) * (nz / z)
      }));
      return nz;
    });
  }, []);

  // ── Absolute zoom-to-value (for the zoom % control) ──────────────────────
  const setZoomTo = useCallback((targetPercent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = rect.width / 2;
    const my = rect.height / 2;
    setZoom(z => {
      const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, targetPercent / 100));
      setPan(p => ({
        x: mx - (mx - p.x) * (nz / z),
        y: my - (my - p.y) * (nz / z)
      }));
      return nz;
    });
  }, []);

  // ── Wheel zoom (smooth, Figma/Miro-style easing) ─────────────────────────────
  const targetZoomRef = useRef(zoom);
  const zoomAnimRef = useRef(null);
  const zoomAnchorRef = useRef({ mx: 0, my: 0 });

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const animate = () => {
      setZoom(z => {
        const target = targetZoomRef.current;
        const next = z + (target - z) * 0.25; // easing factor — higher = snappier, lower = glidier
        const settled = Math.abs(target - next) < 0.001;
        const nz = settled ? target : next;

        const { mx, my } = zoomAnchorRef.current;
        setPan(p => ({ x: mx - (mx - p.x) * (nz / z), y: my - (my - p.y) * (nz / z) }));

        zoomAnimRef.current = settled ? null : requestAnimationFrame(animate);
        return nz;
      });
    };

    const handler = e => {
      e.preventDefault();

      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        zoomAnchorRef.current = { mx: e.clientX - rect.left, my: e.clientY - rect.top };
        const delta = Math.exp(-e.deltaY * 0.0015);
        targetZoomRef.current = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, targetZoomRef.current * delta));
        if (!zoomAnimRef.current) zoomAnimRef.current = requestAnimationFrame(animate);
        return;
      }

      // Shift+wheel or horizontal trackpad swipe = pan sideways
      const isHorizontalPan = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (isHorizontalPan) {
        const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        setPan(p => ({ ...p, x: p.x - dx }));
        return;
      }

      // Normal vertical mouse wheel / trackpad scroll = pan vertically (up/down)
      setPan(p => ({ ...p, y: p.y - e.deltaY }));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => {
      el.removeEventListener('wheel', handler);
      if (zoomAnimRef.current) cancelAnimationFrame(zoomAnimRef.current);
    };
  }, []);

  // ── Space key ───────────────────────────────────────────────────────────────
  const executeDelete = useCallback((idsToRemove, keepChildren) => {
    setElements(prevElements => {
      let nextEls = [...prevElements];
      for (const id of idsToRemove) {
        const hit = nextEls.find(n => n.id === id);
        if (hit?.type === 'pool') {
          if (keepChildren) {
            nextEls = nextEls.filter(e => e.id !== id && !(e.type === 'lane' && e.poolId === id));
          } else {
            nextEls = removePoolCascade(nextEls, id);
          }
        }
        else if (hit?.type === 'lane') nextEls = removeLaneFromPool(nextEls, id);
        else nextEls = nextEls.filter(n => n.id !== id);
      }
      const remainingIds = new Set(nextEls.map(e => e.id));
      const removedIds = prevElements.filter(e => !remainingIds.has(e.id)).map(e => e.id);

      setConnections(p => autoConnectOnDelete(p, removedIds, remainingIds));
      return nextEls;
    });

    setSelId(null);
    setMultiSel(new Set());
    setDeletePrompt(null);
  }, []);

  const handleDeleteElements = useCallback((idsToRemove) => {
    let hasPopulatedPool = false;
    for (const id of idsToRemove) {
      const hit = elementsRef.current.find(n => n.id === id);
      if (hit?.type === 'pool') {
        const rect = { x: hit.position.x, y: hit.position.y, w: hit.width ?? 600, h: hit.height ?? 150 };
        const poolElements = elementsRef.current.filter(e => e.id !== id && e.type !== 'pool' && e.type !== 'lane' && pointInRect(elCenter(e), rect));
        if (poolElements.length > 0) hasPopulatedPool = true;
      }
    }

    if (hasPopulatedPool) {
      setDeletePrompt({ ids: idsToRemove });
    } else {
      executeDelete(idsToRemove, false);
    }
  }, [executeDelete]);

  useEffect(() => {
    const kd = e => { if (e.code === 'Space' && !e.target.matches('input,textarea')) { e.preventDefault(); spaceRef.current = true; } };
    const ku = e => { if (e.code === 'Space') spaceRef.current = false; };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, []);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const kd = e => {
      const t = e.target;
      if (
        t instanceof HTMLElement
        && (t.matches('input,textarea') || t.isContentEditable)
      ) return;

      const k = (e.key || '').toLowerCase();
      const ctrlOrCmd = e.ctrlKey || e.metaKey;

      const isSelectAll = ctrlOrCmd && (k === 'a' || e.code === 'KeyA' || e.keyCode === 65);
      if (isSelectAll) {
        e.preventDefault();
        e.stopPropagation();
        if (elementsRef.current.length || connectionsRef.current.length) {
          setAllSelected(true);
          setSelId(null);
          setSelConn(null);
          setCtxMenu(null);
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (allSelected) {
          setElements([]);
          setConnections([]);
          setAllSelected(false);
          return;
        }
        if (selId || multiSel.size > 0) {
          handleDeleteElements(multiSel.size > 0 ? Array.from(multiSel) : [selId]);
        }
        if (selConn) {
          setConnections(p => p.filter(c => c.id !== selConn));
          setSelConn(null);
        }
      }
      if (ctrlOrCmd && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); forceRender(n => n + 1); }
      if (ctrlOrCmd && (k === 'y' || (e.shiftKey && k === 'z'))) { e.preventDefault(); redo(); forceRender(n => n + 1); }
      if (ctrlOrCmd && k === 'c' && selId) setClipboard(elements.find(n => n.id === selId));
      if (ctrlOrCmd && k === 'x' && selId) {
        setClipboard(elements.find(n => n.id === selId));
        setElements(p => p.filter(n => n.id !== selId));
        setSelId(null);
      }
      if (ctrlOrCmd && k === 'v' && clipboard) {
        const n = { ...clipboard, id: makeId(clipboard.type), position: { x: clipboard.position.x + 40, y: clipboard.position.y + 40 } };
        setElements(p => [...p, n]);
      }
      if (e.key === 'Escape') { setAllSelected(false); setMultiSel(new Set()); setDrawConn(null); setEditId(null); setConnMode('sequence-flow'); setPaletteOpen(false); }
    };
    window.addEventListener('keydown', kd, true);
    return () => {
      window.removeEventListener('keydown', kd, true);
    };
  }, [allSelected, multiSel, selId, selConn, clipboard, elements, connections, undo, redo, setElements]);

  // Refs to dynamic handlers to avoid closures locking old state during window drag
  const onMouseMoveRef = useRef(null);
  const onMouseUpRef = useRef(null);

  useEffect(() => {
    onMouseMoveRef.current = onMouseMove;
    onMouseUpRef.current = onMouseUp;
  });

  const windowMouseMoveRef = useRef(null);
  const windowMouseUpRef = useRef(null);

  const startWindowDrag = useCallback(() => {
    if (windowMouseMoveRef.current) return;
    const handleWindowMouseMove = (e) => {
      if (onMouseMoveRef.current) onMouseMoveRef.current(e);
    };
    const handleWindowMouseUp = (e) => {
      if (onMouseUpRef.current) onMouseUpRef.current(e);
      stopWindowDrag();
    };
    windowMouseMoveRef.current = handleWindowMouseMove;
    windowMouseUpRef.current = handleWindowMouseUp;
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
  }, []);

  const stopWindowDrag = useCallback(() => {
    if (windowMouseMoveRef.current) {
      window.removeEventListener('mousemove', windowMouseMoveRef.current);
      windowMouseMoveRef.current = null;
    }
    if (windowMouseUpRef.current) {
      window.removeEventListener('mouseup', windowMouseUpRef.current);
      windowMouseUpRef.current = null;
    }
  }, []);

  // ── Canvas mouse handlers ───────────────────────────────────────────────────
  const onMouseDown = e => {
    if (e.button === 1 || spaceRef.current) {
      panning.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
      e.preventDefault();
      startWindowDrag();
      return;
    }
    if (e.button === 0) {
      const t = e.target;
      if (typeof t?.closest === 'function' && t.closest('[data-context-pad="true"]')) return;
      if (typeof t?.closest === 'function' && t.closest('[data-resize-handle="true"]')) return;
      if (typeof t?.closest === 'function' && t.closest('[data-conn-handle="true"]')) return;
      setAllSelected(false);
      setMultiSel(new Set());
      setSelId(null); setSelConn(null); setCtxMenu(null);
      if (drawConn) { setDrawConn(null); setConnMode('sequence-flow'); }
      const c = toCanvas(e.clientX, e.clientY);
      setLasso({ start: c, end: c });
      startWindowDrag();
    }
  };

  const onMouseMove = e => {
    const c = toCanvas(e.clientX, e.clientY);
    setMousePos(c);
    if (lasso) {
      setLasso(p => ({ ...p, end: c }));
      return;
    }
    if (panning.current) {
      setPan({
        x: panning.current.px + e.clientX - panning.current.mx,
        y: panning.current.py + e.clientY - panning.current.my
      });
    }
    if (connDragging.current) {
      const { id } = connDragging.current;
      const conn = connectionsRef.current.find(cn => cn.id === id);
      if (!conn) return;
      const from = elementsRef.current.find(el => el.id === conn.fromId);
      const to = elementsRef.current.find(el => el.id === conn.toId);
      if (!from || !to) return;
      const { fp, tp } = bestPorts(from, to);
      const mid = { x: (fp.x + tp.x) / 2, y: (fp.y + tp.y) / 2 };
      setConnections(prev => prev.map(cn => cn.id === id
        ? { ...cn, bend: { x: c.x - mid.x, y: c.y - mid.y } }
        : cn));
      return;
    }
    if (resizing.current) {
      const { id, handle, orig, start, snapshot, affectedChildIds } = resizing.current;
      const dx = c.x - start.x, dy = c.y - start.y;
      const el = snapshot.find(x => x.id === id);
      if (!el) return;
      const n = el.type === 'pool' ? poolLanes(elementsRef.current, id).length : 0;
      const minH = el.type === 'pool' && n > 0 ? n * MIN_LANE_H : MIN_POOL_H;
      const minW = el.type === 'pool' ? MIN_POOL_W : 120;
      const { x, y, w, h } = applyResizeRect(orig, handle, dx, dy, minW, minH);
      const toRect = { x, y, w, h };
      setElements(() => {
        let next = snapshot.map(item => ({ ...item, position: { ...item.position } }));
        next = next.map(item => item.id === id ? { ...item, position: { x, y }, width: w, height: h } : item);
        if (el.type === 'pool' || (el.type === 'lane' && !el.poolId)) {
          const scaleX = orig.w > 0 ? toRect.w / orig.w : 1;
          const scaleY = orig.h > 0 ? toRect.h / orig.h : 1;
          for (const childId of affectedChildIds) {
            const idx = next.findIndex(item => item.id === childId);
            const src = snapshot.find(item => item.id === childId);
            if (idx < 0 || !src) continue;
            const relX = src.position.x - orig.x;
            const relY = src.position.y - orig.y;
            const newX = Math.round(toRect.x + relX * scaleX);
            const newY = Math.round(toRect.y + relY * scaleY);

            const origW = src.width || NW;
            const origH = src.height || NH;
            const newW = Math.max(20, Math.round(origW * scaleX));
            const newH = Math.max(20, Math.round(origH * scaleY));

            next[idx] = {
              ...next[idx],
              position: { x: newX, y: newY },
              width: newW,
              height: newH,
            };
          }
        }
        if (el.type === 'pool') next = applyPoolLayout(next);
        return next;
      });
      return;
    }
    if (dragging.current) {
      if (dragging.current.mode === 'all') {
        const { start, minX, minY, snapshot, moveIds } = dragging.current;
        const dx = Math.round((c.x - start.x) / GRID) * GRID;
        const dy = Math.round((c.y - start.y) / GRID) * GRID;
        setElements(() => snapshot.map(el => {
          if (!moveIds.has(el.id)) return { ...el, position: { ...el.position } };
          return {
            ...el,
            position: {
              x: el.position.x + dx,
              y: el.position.y + dy,
            },
          };
        }));
      } else {
        const { id, ox, oy } = dragging.current;
        const nx = Math.round((c.x - ox) / GRID) * GRID;
        const ny = Math.round((c.y - oy) / GRID) * GRID;
        setElements(p => {
          const cur = p.find(e => e.id === id);
          if (cur?.type === 'pool') {
            const dx = nx - cur.position.x;
            const dy = ny - cur.position.y;
            const innerElements = p.filter(e => e.type !== 'pool' && e.type !== 'lane' && pointInRect(elCenter(e), { x: cur.position.x, y: cur.position.y, w: cur.width ?? 600, h: cur.height ?? 150 }));
            const moved = p.map(el => {
              if (el.id === id) return { ...el, position: { x: nx, y: ny } };
              if (innerElements.some(ie => ie.id === el.id)) return { ...el, position: { x: el.position.x + dx, y: el.position.y + dy } };
              return el;
            });
            return applyPoolLayout(moved);
          }
          return p.map(el => el.id === id
            ? { ...el, position: { x: nx, y: ny } } : el);
        });
      }
    }
  };

  const onMouseUp = e => {
    panning.current = null;
    if (lasso) {
      const x1 = Math.min(lasso.start.x, lasso.end.x);
      const y1 = Math.min(lasso.start.y, lasso.end.y);
      const x2 = Math.max(lasso.start.x, lasso.end.x);
      const y2 = Math.max(lasso.start.y, lasso.end.y);
      if (x2 - x1 > 5 && y2 - y1 > 5) {
        const selected = elements.filter(el => {
          const cx = el.position.x + (el.width || NW) / 2;
          const cy = el.position.y + (el.height || NH) / 2;
          return cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2;
        }).map(el => el.id);
        if (selected.length > 0) setMultiSel(new Set(selected));
      }
      setLasso(null);
      return;
    }
    if (connDragging.current) { connDragging.current = null; return; }
    if (resizing.current) { resizing.current = null; return; }
    if (dragging.current) { dragging.current = null; return; }
    if (drawConn && !drawConn.pendingFromPalette) {
      const c = toCanvas(e.clientX, e.clientY);
      const hit = elements.find(el =>
        el.id !== (drawConn.fromId || drawConn.toId) &&
        el.type !== 'pool' && el.type !== 'lane' &&
        c.x >= el.position.x && c.x <= el.position.x + (el.width || NW) &&
        c.y >= el.position.y && c.y <= el.position.y + (el.height || NH));
      if (hit) {
        const rawFId = drawConn.fromId || hit.id;
        const rawTId = drawConn.toId || hit.id;
        const oriented = orientConnection(rawFId, rawTId, elements);
        if (!oriented) {
          showMsg('error', 'An end event cannot connect to another end event.');
          setDrawConn(null);
          setConnMode('sequence-flow');
          return;
        }
        const { fromId: fId, toId: tId } = oriented;
        const newConnId = makeId('conn');
        if (connMode === 'message-flow') {
          const src = elements.find(e => e.id === fId);
          const tgt = elements.find(e => e.id === tId);
          if (src && tgt && getPoolForNode(src, elements) === getPoolForNode(tgt, elements)) {
            showMsg('error', 'Message flows cannot connect elements within the same pool.');
            setDrawConn(null);
            setConnMode('sequence-flow');
            return;
          }
        }
        setConnections(prev => {
          const next = [...prev, { id: newConnId, fromId: fId, toId: tId, type: connMode }];
          // Auto equal-split if source is an exclusive gateway
          const src = elements.find(e => e.id === fId);
          if (src?.type === 'exclusive-gateway' || src?.type === 'inclusive-gateway' || src?.type === 'gateway') {
            const outgoing = next.filter(c => c.fromId === fId);
            const split = Math.floor(100 / outgoing.length);
            return next.map(c => {
              if (c.fromId !== fId) return c;
              const idx = outgoing.findIndex(o => o.id === c.id);
              return { ...c, probability: idx === 0 ? (100 - split * (outgoing.length - 1)) / 100 : split / 100 };
            });
          }
          return next;
        });
      }
      setDrawConn(null);
      setConnMode('sequence-flow');
    }
  };

  // ── Node interaction ────────────────────────────────────────────────────────
  const onNodeDown = (e, id) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    if (drawConn?.pendingFromPalette) {
      if (isSwimId(id)) return;
      setDrawConn({ fromId: id });
      return;
    }

    if (drawConn) {
      if (isSwimId(id) || isSwimId(drawConn.fromId || drawConn.toId)) return;
      if (id !== (drawConn.fromId || drawConn.toId)) {
        const rawFId = drawConn.fromId || id;
        const rawTId = drawConn.toId || id;
        const oriented = orientConnection(rawFId, rawTId, elements);
        if (!oriented) {
          showMsg('error', 'An end event cannot connect to another end event.');
          setDrawConn(null);
          setConnMode('sequence-flow');
          return;
        }
        const { fromId: fId, toId: tId } = oriented;
        if (connMode === 'message-flow') {
          const src = elements.find(e => e.id === fId);
          const tgt = elements.find(e => e.id === tId);
          if (src && tgt && getPoolForNode(src, elements) === getPoolForNode(tgt, elements)) {
            showMsg('error', 'Message flows cannot connect elements within the same pool.');
            setDrawConn(null);
            setConnMode('sequence-flow');
            return;
          }
        }
        setConnections(prev => {
          const newConn = { id: makeId('conn'), fromId: fId, toId: tId, type: connMode };
          const next = [...prev, newConn];
          // Auto equal-split if source is an exclusive gateway
          const src = elements.find(e => e.id === fId);
          if (src?.type === 'exclusive-gateway' || src?.type === 'inclusive-gateway' || src?.type === 'gateway') {
            const outgoing = next.filter(c => c.fromId === fId);
            const split = Math.floor(100 / outgoing.length);
            return next.map(c => {
              if (c.fromId !== fId) return c;
              const idx = outgoing.findIndex(o => o.id === c.id);
              return { ...c, probability: idx === 0 ? (100 - split * (outgoing.length - 1)) / 100 : split / 100 };
            });
          }
          return next;
        });
      }
      setDrawConn(null);
      setConnMode('sequence-flow');
      return;
    }

    if (allSelected || multiSel.size > 0) {
      if (!allSelected && !multiSel.has(id)) {
        setMultiSel(new Set());
        setAllSelected(false);
        setSelId(id);
      } else {
        const c = toCanvas(e.clientX, e.clientY);
        const moveItems = elements
          .filter(el => allSelected || multiSel.has(el.id))
          .filter(el => !(el.type === 'lane' && el.poolId))
          .map(el => ({ ...el, position: { ...el.position } }));
        dragging.current = {
          mode: 'all',
          start: c,
          snapshot: elements.map(el => ({ ...el, position: { ...el.position } })),
          moveIds: new Set(moveItems.map(el => el.id)),
          minX: moveItems.length ? Math.min(...moveItems.map(el => el.position.x)) : 0,
          minY: moveItems.length ? Math.min(...moveItems.map(el => el.position.y)) : 0,
        };
        startWindowDrag();
        return;
      }
    }

    setAllSelected(false);
    setMultiSel(new Set());
    setSelId(id); setSelConn(null);
    const c = toCanvas(e.clientX, e.clientY);
    const el = elements.find(n => n.id === id);
    if (!(el?.type === 'lane' && el.poolId)) {
      dragging.current = { id, ox: c.x - el.position.x, oy: c.y - el.position.y };
      startWindowDrag();
    }
  };

  // ── Drop from palette ───────────────────────────────────────────────────────
  const onDrop = e => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/bpmn');
    if (!raw) return;
    setPaletteOpen(false);
    const { type, label } = JSON.parse(raw);
    const c = toCanvas(e.clientX, e.clientY);
    const pos = { x: Math.round(c.x / GRID) * GRID, y: Math.round(c.y / GRID) * GRID };
    if (type === 'lane') {
      const hitPool = elements.find(el =>
        el.type === 'pool' &&
        c.x >= el.position.x && c.x <= el.position.x + (el.width ?? 600) &&
        c.y >= el.position.y && c.y <= el.position.y + (el.height ?? 150));
      if (hitPool) {
        const [next, nid] = addLaneToPoolEnd(elements, hitPool.id, false);
        setElements(next);
        if (nid) setSelId(nid);
        return;
      }
    }
    const el = createElement(type, label, pos);

    // Auto-connect / edge split logic
    if (['task', 'user-task', 'service-task', 'script-task', 'manual-task', 'send-task', 'receive-task', 'business-rule-task', 'subprocess', 'call-activity',
      'exclusive-gateway', 'parallel-gateway', 'inclusive-gateway', 'complex-gateway', 'event-based-gateway',
      'start-event', 'message-start-event', 'timer-start-event', 'conditional-start-event', 'signal-start-event',
      'intermediate-event', 'message-intermediate-catch', 'message-intermediate-throw', 'timer-intermediate-catch', 'conditional-intermediate-catch', 'signal-intermediate-catch', 'signal-intermediate-throw',
      'end-event', 'message-end-event', 'error-end-event', 'escalation-end-event', 'signal-end-event', 'terminate-end-event'].includes(type)) {
      const elCenterPt = { x: pos.x + (el.width || NW) / 2, y: pos.y + (el.height || NH) / 2 };
      let edgeToSplit = null;
      let minDist = 30; // threshold

      for (const conn of connectionsRef.current) {
        if (conn.type !== 'sequence-flow') continue;
        const from = elements.find(e => e.id === conn.fromId);
        const to = elements.find(e => e.id === conn.toId);
        if (!from || !to) continue;
        const { fp, tp } = bestPorts(from, to);

        const l2 = Math.pow(fp.x - tp.x, 2) + Math.pow(fp.y - tp.y, 2);
        let t = l2 === 0 ? 0 : ((elCenterPt.x - fp.x) * (tp.x - fp.x) + (elCenterPt.y - fp.y) * (tp.y - fp.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        const proj = { x: fp.x + t * (tp.x - fp.x), y: fp.y + t * (tp.y - fp.y) };
        const dist = Math.hypot(elCenterPt.x - proj.x, elCenterPt.y - proj.y);

        if (dist < minDist) {
          minDist = dist;
          edgeToSplit = conn;
        }
      }

      if (edgeToSplit) {
        setElements(p => [...p, el]);
        setConnections(p => {
          const next = p.filter(c => c.id !== edgeToSplit.id);
          next.push({ id: makeId('conn'), fromId: edgeToSplit.fromId, toId: el.id, type: 'sequence-flow' });
          next.push({ id: makeId('conn'), fromId: el.id, toId: edgeToSplit.toId, type: 'sequence-flow' });
          return next;
        });
        setSelId(el.id);
        return;
      }
    }

    setElements(p => [...p, el]);
    setSelId(el.id);
  };

  // ── Add via palette click ───────────────────────────────────────────────────
  const addElement = (type, label) => {
    setPaletteOpen(false);
    const sel = elements.find(n => n.id === selId);
    if (type === 'lane') {
      if (sel?.type === 'pool') {
        const [next, nid] = addLaneToPoolEnd(elements, sel.id, false);
        setElements(next);
        if (nid) setSelId(nid);
        return;
      }
      if (sel?.type === 'lane' && sel.poolId) {
        const [next, nid] = addLaneAdjacentToLane(elements, sel.id, false);
        setElements(next);
        if (nid) setSelId(nid);
        return;
      }
    }
    const off = elements.length * GRID * 4;
    const el = createElement(type, label, {
      x: Math.round((120 + off % 480) / GRID) * GRID,
      y: Math.round((120 + Math.floor(off / 480) * 160) / GRID) * GRID,
    }, {}, 2000);
    setElements(p => [...p, el]);
    setSelId(el.id);
  };

  // ── Flow mode from palette ──────────────────────────────────────────────────
  const startFlowFromPalette = (flowType) => {
    if (drawConn && connMode === flowType) {
      setDrawConn(null);
      setConnMode('sequence-flow');
    } else {
      setConnMode(flowType);
      setDrawConn({ pendingFromPalette: true });
    }
  };

  // ── Append from context pad ─────────────────────────────────────────────────
  const appendNode = (sourceId, type, label, cmode) => {
    const src = elements.find(e => e.id === sourceId);
    if (!src) return;

    let newY = src.position.y;
    if (src.type.includes('gateway')) {
      const branches = connectionsRef.current.filter(c => c.fromId === sourceId).length;
      if (branches > 0) {
        // Alternate branches above and below: +120, -120, +240, -240
        const offsetMultiplier = Math.ceil(branches / 2) * (branches % 2 === 0 ? -1 : 1);
        newY += offsetMultiplier * 120;
      }
    }

    const newEl = createElement(type, label, { x: src.position.x + (src.width || NW) + 90, y: newY });
    const conn = { id: makeId('conn'), fromId: sourceId, toId: newEl.id, type: cmode || connMode };
    setElements(p => [...p, newEl]);
    setConnections(p => [...p, conn]);
    setSelId(src.type.includes('gateway') ? src.id : newEl.id);
  };

  // ── Update connection probability (for gateway "how often" popover) ────────
  const updateConnectionProbability = useCallback((connId, probability) => {
    setConnections(prev => prev.map(c => c.id === connId ? { ...c, probability } : c));
  }, []);

  // ── Label edit ──────────────────────────────────────────────────────────────
  const startEdit = id => {
    const el = elements.find(e => e.id === id);
    if (!el) return;
    setEditId(id); setEditText(el.label || '');
  };
  const saveEdit = id => {
    if (editText.trim()) setElements(p => p.map(el => el.id === id ? { ...el, label: editText.trim() } : el));
    setEditId(null); setEditText('');
  };

  const beginResize = useCallback((e, id, handle) => {
    const rawEl = elements.find(x => x.id === id);
    if (!rawEl) return;
    const el = (rawEl.type === 'lane' && rawEl.poolId)
      ? elements.find(x => x.id === rawEl.poolId && x.type === 'pool')
      : rawEl;
    if (!el) return;
    const targetId = el.id;
    const orig = {
      x: el.position.x,
      y: el.position.y,
      w: el.width ?? (el.type === 'pool' ? 600 : el.type === 'lane' ? 500 : NW),
      h: el.height ?? (el.type === 'pool' ? 150 : el.type === 'lane' ? 100 : NH),
    };
    const snapshot = elements.map(item => ({ ...item, position: { ...item.position } }));
    const affectedChildIds = (el.type === 'pool' || (el.type === 'lane' && !el.poolId))
      ? snapshot
        .filter(item => item.type !== 'pool' && item.type !== 'lane' && pointInRect(elCenter(item), orig))
        .map(item => item.id)
      : [];
    resizing.current = {
      id: targetId,
      handle,
      orig,
      start: toCanvas(e.clientX, e.clientY),
      snapshot,
      affectedChildIds,
    };
    startWindowDrag();
  }, [elements, toCanvas]);

  const beginConnBendDrag = useCallback((e, connId) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setAllSelected(false);
    setSelConn(connId);
    setSelId(null);
    connDragging.current = { id: connId };
    startWindowDrag();
  }, []);

  const beginConnEndpointDrag = useCallback((e, connId, type) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const conn = connectionsRef.current.find(c => c.id === connId);
    if (!conn) return;
    setAllSelected(false);
    setSelConn(null);
    setSelId(null);
    setConnections(prev => prev.filter(c => c.id !== connId));
    setConnMode(conn.type);
    if (type === 'to') setDrawConn({ fromId: conn.fromId, type: conn.type });
    else setDrawConn({ toId: conn.toId, type: conn.type });
  }, []);

  // ── Temp line preview ───────────────────────────────────────────────────────
  const tempLine = (() => {
    if (!drawConn || drawConn.pendingFromPalette || (!drawConn.fromId && !drawConn.toId)) return null;
    let from, to;
    if (drawConn.fromId) {
      const el = elements.find(e => e.id === drawConn.fromId);
      if (!el) return null;
      from = elCenter(el);
      to = mousePos;
    } else {
      const el = elements.find(e => e.id === drawConn.toId);
      if (!el) return null;
      to = elCenter(el);
      from = mousePos;
    }
    return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
  })();

  // ── Save / Load / Export ────────────────────────────────────────────────────
  const saveToFile = () => {
    const data = JSON.stringify({ nodes: elements, connections }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${processTitle || 'spot-model'}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const loadFromFile = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const d = JSON.parse(ev.target.result);
          if (d.nodes) { setElements(d.nodes); setConnections(d.connections || []); }
        } catch { showMsg('error', 'Invalid file format.'); }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const exportSVG = () => {
    const svgEl = canvasRef.current?.querySelector('svg');
    if (!svgEl) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svgEl)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${processTitle || 'spot-model'}.svg`; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Context pad (selection wins over hover) ──────────────────────────────────
  const padTargetId = selId ?? hoveredId;
  const padEl = elements.find(e => e.id === padTargetId);
  const showPadOn = el =>
    padEl?.id === el.id
    && el.type !== 'pool'
    && el.type !== 'lane'
    && !allSelected
    && !drawConn
    && !editId;
  const activeFlowMode = drawConn ? connMode : null;
  const selectAllCanvas = useCallback(() => {
    if (elementsRef.current.length || connectionsRef.current.length) {
      setAllSelected(true);
      setSelId(null);
      setMultiSel(new Set());
      setSelConn(null);
      setCtxMenu(null);
    }
  }, []);

  // ── Horizontal scrollbar (bottom ruler) geometry ────────────────────────────
  const HSCROLL_PAD = 400; // world-space breathing room past the content edges
  const hScrollGeo = (() => {
    const vw = viewportW || 1;
    let contentMinX = 0, contentMaxX = vw / zoom;
    if (elements.length) {
      let minX = Infinity, maxX = -Infinity;
      elements.forEach(el => {
        const w = el.width || NW;
        minX = Math.min(minX, el.position.x);
        maxX = Math.max(maxX, el.position.x + w);
      });
      contentMinX = minX; contentMaxX = maxX;
    }
    const totalMin = contentMinX - HSCROLL_PAD;
    const totalMaxRaw = contentMaxX + HSCROLL_PAD;
    const totalMax = Math.max(totalMaxRaw, totalMin + vw / zoom);
    const totalW = Math.max(1, totalMax - totalMin);

    const visMin = -pan.x / zoom;
    const visMax = visMin + vw / zoom;

    const leftRatio = Math.min(1, Math.max(0, (visMin - totalMin) / totalW));
    const widthRatio = Math.min(1 - leftRatio, Math.max(0.05, (visMax - visMin) / totalW));

    return { totalW, thumbLeft: leftRatio * vw, thumbWidth: widthRatio * vw };
  })();

  const startHScrollDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startClientX = e.clientX;
    const startPanX = pan.x;
    const vw = viewportW || 1;
    const { totalW } = hScrollGeo;
    const z = zoom;
    const onMove = (me) => {
      const deltaPx = me.clientX - startClientX;
      const deltaWorld = (deltaPx / vw) * totalW;
      setPan(p => ({ ...p, x: startPanX - deltaWorld * z }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── Vertical scrollbar (right ruler) geometry ──────────────────────────────
  const VSCROLL_PAD = 400; // world-space breathing room past the content edges
  const vScrollGeo = (() => {
    const vh = viewportH || 1;
    let contentMinY = 0, contentMaxY = vh / zoom;
    if (elements.length) {
      let minY = Infinity, maxY = -Infinity;
      elements.forEach(el => {
        const h = el.height || NH;
        minY = Math.min(minY, el.position.y);
        maxY = Math.max(maxY, el.position.y + h);
      });
      contentMinY = minY; contentMaxY = maxY;
    }
    const totalMin = contentMinY - VSCROLL_PAD;
    const totalMaxRaw = contentMaxY + VSCROLL_PAD;
    const totalMax = Math.max(totalMaxRaw, totalMin + vh / zoom);
    const totalH = Math.max(1, totalMax - totalMin);

    const visMin = -pan.y / zoom;
    const visMax = visMin + vh / zoom;

    const topRatio = Math.min(1, Math.max(0, (visMin - totalMin) / totalH));
    const heightRatio = Math.min(1 - topRatio, Math.max(0.05, (visMax - visMin) / totalH));

    return { totalH, thumbTop: topRatio * vh, thumbHeight: heightRatio * vh };
  })();

  const startVScrollDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startClientY = e.clientY;
    const startPanY = pan.y;
    const vh = viewportH || 1;
    const { totalH } = vScrollGeo;
    const z = zoom;
    const onMove = (me) => {
      const deltaPx = me.clientY - startClientY;
      const deltaWorld = (deltaPx / vh) * totalH;
      setPan(p => ({ ...p, y: startPanY - deltaWorld * z }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-gray-100">
      {/* ═══════════════════════════════════════════════════════
          TOOLBAR — single bar, all buttons properly sized
      ═══════════════════════════════════════════════════════ */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border border-gray-200/80 bg-white shadow-sm overflow-x-auto w-full mt-6">
        {/* Left Section */}
        <div className="flex-1 flex items-center justify-start ml-4">
          {/* Process title input */}
          <input
            value={processTitle}
            onChange={e => setProcessTitle(e.target.value)}
            onBlur={e => localStorage.setItem('spot:processTitle', e.target.value)}
            placeholder="Process title…"
            className="text-sm font-semibold bg-transparent border-none outline-none focus:ring-0 text-gray-800 w-48 px-2 py-1 placeholder-gray-400"
          />
        </div>

        {/* Middle Section: Buttons */}
        <div className="flex items-center gap-3 justify-center shrink-0">
          {/* New */}
          <TBtn onClick={newModel} title="New model" variant="default" className="text-gray-600 bg-white border border-gray-200">
            <Plus size={14} /> New
          </TBtn>

          <div className="h-6 w-px bg-gray-200 mx-1" />

          <TBtn onClick={() => { undo(); forceRender(n => n + 1); }} disabled={!canUndo} title="Undo (Ctrl+Z)" variant="icon">
            <RotateCcw size={16} className="text-gray-500" />
          </TBtn>
          <TBtn onClick={() => { redo(); forceRender(n => n + 1); }} disabled={!canRedo} title="Redo (Ctrl+Y)" variant="icon">
            <RotateCw size={16} className="text-gray-500" />
          </TBtn>

          <div className="h-6 w-px bg-gray-200 mx-1" />

          <TBtn onClick={selectAllCanvas} title="Select all (Ctrl+A)" variant={allSelected ? 'active' : 'default'} className="border border-gray-200">
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
            <Maximize2 size={16} className="text-gray-500" />
          </TBtn>

          <div className="h-6 w-px bg-gray-200 mx-1" />

          <TBtn onClick={() => setGridType(g => g === 'none' ? 'dots' : g === 'dots' ? 'lines' : 'none')}
            title={gridType === 'none' ? 'Show Dotted Grid' : gridType === 'dots' ? 'Show Lined Grid' : 'Hide Grid'}
            variant={gridType !== 'none' ? 'active' : 'icon'}
            className={gridType !== 'none' ? "bg-[#5E43F3] text-white border-none" : ""}>
            <Grid3x3 size={16} />
          </TBtn>

          <div className="h-6 w-px bg-gray-200 mx-1" />

          <TBtn onClick={() => { if (selId) setClipboard(elements.find(n => n.id === selId)); }} title="Copy (Ctrl+C)" variant="icon">
            <Copy size={16} className="text-gray-500" />
          </TBtn>
          <TBtn onClick={() => {
            if (clipboard) {
              const n = { ...clipboard, id: makeId(clipboard.type), position: { x: clipboard.position.x + 40, y: clipboard.position.y + 40 } };
              setElements(p => [...p, n]);
            }
          }} title="Paste (Ctrl+V)" variant="icon">
            <ClipboardPaste size={16} className="text-gray-500" />
          </TBtn>
          <TBtn onClick={() => {
            if (selId) {
              setClipboard(elements.find(n => n.id === selId));
              setElements(p => p.filter(n => n.id !== selId));
              setSelId(null);
            }
          }} title="Cut (Ctrl+X)" variant="icon">
            <Scissors size={16} className="text-gray-500" />
          </TBtn>

          <div className="h-6 w-px bg-gray-200 mx-1" />

          <TBtn onClick={loadFromFile} title="Load from file" variant="icon">
            <FolderOpen size={16} className="text-gray-500" />
          </TBtn>
          <TBtn onClick={saveToFile} title="Export as JSON" variant="icon">
            <Download size={16} className="text-gray-500" />
          </TBtn>
          <TBtn onClick={exportSVG} title="Export as SVG" variant="icon">
            <FileDown size={16} className="text-gray-500" />
          </TBtn>
        </div>

        {/* Right Section: Save to Backend */}
        <div className="flex-1 flex justify-end mr-4 gap-3">
          <TBtn
            onClick={() => {
              if (isGuest) { setGuestModalOpen(true); return; }
              handleRunSimulation();
            }}
            disabled={backendSaving}
            title={isGuest ? "Sign up to use this" : "Run simulation for this model"}
            className={`text-gray-600 bg-white border border-gray-200 hover:bg-slate-50 px-4 ${isGuest ? 'opacity-60' : ''}`}
          >
            {isGuest ? (
              <Lock size={14} className="mr-1 text-slate-500" />
            ) : (
              <Play size={16} className="mr-1 text-emerald-600 fill-emerald-600" />
            )}
            Run Simulation
          </TBtn>
          <TBtn
            onClick={() => {
              if (isGuest) { setGuestModalOpen(true); return; }
              saveToBackend();
            }}
            disabled={backendSaving}
            title={isGuest ? "Sign up to use this" : "Save"}
            variant="primary"
            className={`bg-[#5E43F3] text-white hover:bg-[#4c35db] border-none px-4 ${isGuest ? 'opacity-60' : ''}`}
          >
            {isGuest ? (
              <Lock size={14} className="mr-1 text-white/90" />
            ) : backendSaving ? (
              <Loader2 size={16} className="animate-spin mr-1" />
            ) : (
              <Check size={16} className="mr-1" />
            )}
            {backendSaving ? 'Saving…' : 'Save'}
          </TBtn>
        </div>
      </div>
      {/* ══════════════════════════════════════════════════════ */}

      <div className="flex-1 flex overflow-hidden p-5 md:gap-5 lg:p-6">
        {/* ── Canvas ── */}
        <div className="flex-1 relative flex flex-col overflow-hidden rounded-2xl border border-gray-200/80 shadow-sm bg-white" style={{ marginTop: 10 }}>
          <div ref={canvasRef}
            className="flex-1 relative overflow-hidden bg-white"
            style={{
              cursor: spaceRef.current ? 'grab'
                : drawConn?.pendingFromPalette ? 'cell'
                  : drawConn ? 'crosshair'
                    : 'default',
              backgroundImage: gridType === 'dots' ? 'radial-gradient(circle, #d4d4d8 1px, transparent 1px)'
                : gridType === 'lines' ? 'linear-gradient(to right, #e2e8f0 1px, transparent 1px), linear-gradient(to bottom, #e2e8f0 1px, transparent 1px)'
                  : 'none',
              backgroundSize: gridType !== 'none' ? `${GRID * 4 * zoom}px ${GRID * 4 * zoom}px` : 'auto',
              backgroundPosition: gridType !== 'none' ? `${pan.x % (GRID * 4 * zoom)}px ${pan.y % (GRID * 4 * zoom)}px` : '0 0',
              backgroundColor: '#f8fafc',
            }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onDrop={onDrop}
            onDragOver={e => e.preventDefault()}
            onContextMenu={e => e.preventDefault()}>

            {/* Empty state */}
            {elements.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center text-gray-400">
                  <MousePointerClick className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">Drag BPMN elements here</p>
                  <p className="text-xs mt-1 opacity-60">Hover a node to see the context pad</p>
                </div>
              </div>
            )}

            {/* Flow mode hint banner */}
            {drawConn?.pendingFromPalette && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-sky-600 text-white text-xs px-4 py-1.5 rounded-full shadow-lg pointer-events-none select-none">
                Click a source node · then click target · Esc to cancel
              </div>
            )}

            {/* Backend toast notification */}
            {backendMsg && (
              <div className={`absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium pointer-events-none select-none
                ${backendMsg.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
                {backendMsg.text}
              </div>
            )}



            {/* Zoom indicator */}
            <div className="absolute bottom-[72px] left-3 z-20 text-[11px] text-gray-400 bg-white/80 backdrop-blur px-2 py-0.5 rounded border border-gray-200">
              {Math.round(zoom * 100)}%
            </div>

            {/* Elements palette toggle */}
            <div className="absolute bottom-6 left-3 z-20">
              <button
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
                onMouseDown={e => e.stopPropagation()}
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
                  <Palette onAdd={addElement} onStartFlow={startFlowFromPalette} activeFlowMode={activeFlowMode} />
                </div>
              </aside>
            )}

            {/* Model with AI */}
            <div className="absolute bottom-6 right-3 z-20">
              <button
                onClick={() => {
                  if (isGuest) { setGuestModalOpen(true); return; }
                  setAiPanelOpen(o => !o);
                }}
                title={isGuest ? "Sign up to use this" : undefined}
                style={{
                  background: isGuest
                    ? '#6366f1'
                    : aiPanelOpen
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
                  boxShadow: aiPanelOpen
                    ? '0 4px 16px rgba(99,102,241,0.35)'
                    : '0 4px 16px rgba(147,51,234,0.35)',
                  opacity: isGuest ? 0.6 : 1,
                  transition: 'all 0.2s ease',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => { if (!isGuest) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.opacity = '0.95'; } }}
                onMouseLeave={e => { if (!isGuest) { e.currentTarget.style.transform = 'none'; e.currentTarget.style.opacity = '1'; } }}
              >
                {isGuest ? <Lock size={15} /> : <Sparkles size={15} className={aiPanelOpen ? "animate-pulse" : ""} />}
                {aiPanelOpen ? 'Close AI' : 'Ask AI'}
              </button>
            </div>

            {/* Simulator-backed assistant — kept separate from diagram generation. */}
            <div className="absolute bottom-6 z-20" style={{ right: 145 }}>
              <button
                onClick={() => {
                  if (isGuest) { setGuestModalOpen(true); return; }
                  setSpotAssistantOpen(true);
                }}
                title={isGuest ? "Sign up to use this" : undefined}
                style={{
                  background: 'linear-gradient(to right, #0f766e, #0ea5e9)', color: 'white',
                  padding: '10px 18px', borderRadius: '12px', border: 'none', display: 'flex',
                  alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 700,
                  fontFamily: 'Inter, -apple-system, sans-serif', cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(14,165,233,0.28)', whiteSpace: 'nowrap',
                  opacity: isGuest ? 0.6 : 1,
                }}
              >
                {isGuest ? <Lock size={15} /> : <Sparkles size={15} />} Solve a problem
              </button>
            </div>

            {/* Horizontal scrollbar — bottom ruler to pan the canvas left/right */}
            <div
              className="absolute left-0 right-3.5 bottom-0 z-20"
              style={{ height: 14, background: '#f1f5f9', borderTop: '1px solid #e2e8f0' }}
              onClick={e => {
                // Click on empty track (not the thumb) jumps the view to that point.
                if (e.target !== e.currentTarget) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const targetLeft = Math.min(
                  Math.max(0, clickX - hScrollGeo.thumbWidth / 2),
                  (viewportW || 1) - hScrollGeo.thumbWidth
                );
                const deltaWorld = ((targetLeft - hScrollGeo.thumbLeft) / (viewportW || 1)) * hScrollGeo.totalW;
                setPan(p => ({ ...p, x: p.x - deltaWorld * zoom }));
              }}
            >
              <div
                onMouseDown={startHScrollDrag}
                title="Drag to scroll horizontally"
                className="absolute top-1/2 -translate-y-1/2 rounded-full bg-gray-400 hover:bg-gray-500 active:bg-gray-600 transition-colors"
                style={{
                  left: hScrollGeo.thumbLeft,
                  width: Math.max(hScrollGeo.thumbWidth, 28),
                  height: 8,
                  cursor: 'grab',
                }}
              />
            </div>

            {/* Vertical scrollbar — right ruler to pan the canvas up/down */}
            <div
              className="absolute right-0 top-0 bottom-3.5 z-20"
              style={{ width: 14, background: '#f1f5f9', borderLeft: '1px solid #e2e8f0' }}
              onClick={e => {
                if (e.target !== e.currentTarget) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const clickY = e.clientY - rect.top;
                const targetTop = Math.min(
                  Math.max(0, clickY - vScrollGeo.thumbHeight / 2),
                  (viewportH || 1) - vScrollGeo.thumbHeight
                );
                const deltaWorld = ((targetTop - vScrollGeo.thumbTop) / (viewportH || 1)) * vScrollGeo.totalH;
                setPan(p => ({ ...p, y: p.y - deltaWorld * zoom }));
              }}
            >
              <div
                onMouseDown={startVScrollDrag}
                title="Drag to scroll vertically"
                className="absolute left-1/2 -translate-x-1/2 rounded-full bg-gray-400 hover:bg-gray-500 active:bg-gray-600 transition-colors"
                style={{
                  top: vScrollGeo.thumbTop,
                  height: Math.max(vScrollGeo.thumbHeight, 28),
                  width: 8,
                  cursor: 'grab',
                }}
              />
            </div>

            {/* SVG canvas */}
            <DiagramCanvas
              readOnly={false}
              elements={elements}
              connections={connections}
              zoom={zoom}
              pan={pan}
              selectedId={selId}
              selectedConnId={selConn}
              allSelected={allSelected}
              multiSel={multiSel}
              hoveredId={hoveredId}
              setHoveredId={setHoveredId}
              padTargetId={padTargetId}
              drawConn={drawConn}
              tempLine={tempLine}
              connMode={connMode}
              editId={editId}
              editText={editText}
              setEditText={setEditText}
              saveEdit={saveEdit}
              setEditId={setEditId}
              startEdit={startEdit}
              setCtxMenu={setCtxMenu}
              beginResize={beginResize}
              RectResizeHandles={RectResizeHandles}
              ContextPad={ContextPad}
              SwimlaneContextPad={SwimlaneContextPad}
              GatewayPopover={GatewayPopover}
              showPadOn={showPadOn}
              openGatewayId={openGatewayId}
              setOpenGatewayId={setOpenGatewayId}
              updateConnectionProbability={updateConnectionProbability}
              addLaneToPoolEnd={addLaneToPoolEnd}
              addDividePoolLanes={addDividePoolLanes}
              addLaneAdjacentToLane={addLaneAdjacentToLane}
              setElements={setElements}
              setConnections={setConnections}
              setSelId={setSelId}
              handleDeleteElements={handleDeleteElements}
              showMsg={showMsg}
              lasso={lasso}
              beginConnBendDrag={beginConnBendDrag}
              beginConnEndpointDrag={beginConnEndpointDrag}
              onNodeDown={onNodeDown}
              onEdgeClick={id => { setAllSelected(false); setSelConn(id); setSelId(null); }}
            />
          </div>
        </div>

        {/* ── AI Chat Panel ── */}
        {aiPanelOpen && (
          <AiPanel
            open={aiPanelOpen}
            onClose={() => setAiPanelOpen(false)}
            elements={elements}
            connections={connections}
            onApplyDiagram={(newElements, newConnections, newResources) => {
              setElements(newElements);
              setConnections(newConnections);
              if (Array.isArray(newResources) && newResources.length) {
                const sanitized = newResources.map(r => {
                  const cleanName = r.displayName || r.name || r.id || 'Staff / Specialist';
                  return {
                    ...r,
                    id: cleanName,
                    name: cleanName,
                    displayName: cleanName,
                    payloadKey: cleanName,
                    type: r.type || 'staff',
                    quantity: Number(r.quantity) || 1
                  };
                });
                localStorage.setItem('spot:globalResources', JSON.stringify(sanitized));
              }
              // Persist immediately with the FRESH diagram (passed explicitly,
              // not read from component state — state hasn't caught up to
              // setElements/setConnections yet at this point in the same
              // synchronous handler). Without this, an AI-generated diagram
              // existed only on screen until the person remembered to click
              // Save — anything reading by processId in the meantime (Implement
              // Suggestion, forking a scenario, etc.) would silently fetch
              // whatever OLD process was last actually saved, which looks
              // exactly like "the diagram got scrambled" but is really just
              // "the diagram was never here to begin with."
              saveToBackend({ elements: newElements, connections: newConnections });
            }}
          />
        )}
        <SpotAssistant
          open={spotAssistantOpen}
          onClose={() => setSpotAssistantOpen(false)}
          processId={savedProcessId}
          ensureProcessSaved={async () => {
            const existing = localStorage.getItem('spot:processId');
            return existing || saveToBackend();
          }}
        />
      </div>

      {/* ── Load from Backend Modal ── */}
      {showLoadModal && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={() => setShowLoadModal(false)} />
          <div className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl border border-gray-200 w-[480px] max-h-[70vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Load Process from Cloud</h3>
              <button onClick={() => setShowLoadModal(false)} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors text-lg leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {backendLoading ? (
                <div className="flex items-center justify-center py-10 text-gray-400 gap-2">
                  <Loader2 size={18} className="animate-spin" /> Loading processes…
                </div>
              ) : processList.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">No saved processes found.</div>
              ) : (
                <div className="space-y-2">
                  {processList.map(proc => (
                    <button key={proc._id} onClick={() => loadProcessFromBackend(proc)}
                      className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-sky-300 hover:bg-sky-50 transition-colors group">
                      <p className="text-sm font-semibold text-gray-800 group-hover:text-sky-700 truncate">{proc.title || 'Untitled'}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {proc.nodes?.length || 0} nodes · {proc.edges?.length || 0} edges
                        {proc.createdAt ? ` · ${new Date(proc.createdAt).toLocaleDateString()}` : ''}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCtxMenu(null)} />
          <div className="fixed z-50 bg-white rounded-xl shadow-xl border border-gray-200 py-1 min-w-[148px]"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <button onClick={() => { startEdit(ctxMenu.id); setCtxMenu(null); }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-sky-50 text-gray-700 transition-colors">Rename</button>
            <button onClick={() => { setClipboard(elements.find(e => e.id === ctxMenu.id)); setCtxMenu(null); }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-sky-50 text-gray-700 transition-colors">Copy</button>
            <div className="border-t border-gray-100 my-0.5" />
            <button onClick={() => {
              handleDeleteElements([ctxMenu.id]);
              setCtxMenu(null);
            }} className="w-full px-4 py-2 text-left text-sm hover:bg-red-50 text-red-600 transition-colors">Delete</button>
          </div>
        </>
      )}

      {/* Delete Prompt Modal */}
      {deletePrompt && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: 'rgba(17, 24, 39, 0.5)', backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            background: '#ffffff', borderRadius: 16, width: 440, padding: 32,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', border: '1px solid #f3f4f6',
            display: 'flex', flexDirection: 'column', gap: 24,
            animation: 'fadeIn 0.2s ease-out'
          }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#ef4444' }}>⚠️</span> Delete Pool
              </h3>
              <p style={{ margin: '12px 0 0', fontSize: 14, color: '#4b5563', lineHeight: 1.6 }}>
                You are deleting a pool that currently contains other elements. Would you like to delete the pool <strong>and all its elements</strong>, or just the pool boundary itself?
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
              <button
                onClick={() => setDeletePrompt(null)}
                style={{
                  padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                  color: '#4b5563', background: '#f9fafb', border: '1px solid #e5e7eb',
                  cursor: 'pointer', outline: 'none'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => executeDelete(deletePrompt.ids, true)}
                style={{
                  padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                  color: '#0369a1', background: '#e0f2fe', border: 'none',
                  cursor: 'pointer', outline: 'none'
                }}
              >
                Delete Pool Only
              </button>
              <button
                onClick={() => executeDelete(deletePrompt.ids, false)}
                style={{
                  padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                  color: '#ffffff', background: '#dc2626', border: 'none',
                  cursor: 'pointer', outline: 'none', boxShadow: '0 4px 6px -1px rgba(220, 38, 38, 0.2)'
                }}
              >
                Delete Pool & Elements
              </button>
            </div>
          </div>
        </div>
      )}

      <GuestLockModal
        isOpen={guestModalOpen}
        onClose={() => setGuestModalOpen(false)}
      />
    </div>
  );
}
