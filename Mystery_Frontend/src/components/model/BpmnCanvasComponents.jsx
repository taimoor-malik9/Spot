import React, { useState } from 'react';
import { NW, NH, isXorGateway } from './bpmnGeometry';
import { DiagramEdge as Edge, tempConnectionLine } from './DiagramEdge';

export { Edge, tempConnectionLine };

export function makeId(type) {
  return `${type}_${Math.random().toString(36).substring(2, 9)}`;
}

export function createElement(type, label, position, extras = {}, canvasWidth = 1000) {
  if (type === 'pool') return { id: makeId(type), type, label: label ?? 'Pool', position: { ...position }, width: 600, height: 220, ...extras };
  if (type === 'lane') return { id: makeId(type), type, label: label ?? 'Lane', position: { ...position }, width: 540, height: 150, ...extras };
  if (type === 'annotation') return { id: makeId(type), type, label: label ?? 'Text Annotation', position: { ...position }, width: 180, height: 90, ...extras };
  return {
    id: makeId(type),
    type,
    label,
    position: { ...position },
    width: 80,
    height: 80,
    data: { label, duration: 5, ...extras }
  };
}

export const isEndEvent = (el) => !!el && typeof el.type === 'string' && el.type.endsWith('end-event');

export function orientConnection(fId, tId, els) {
  const src = els.find(e => e.id === fId);
  const tgt = els.find(e => e.id === tId);
  if (isEndEvent(src) && isEndEvent(tgt)) return null;
  if (isEndEvent(src)) return { fromId: tId, toId: fId };
  return { fromId: fId, toId: tId };
}

export function scalePointBetweenRects(pt, fromRect, toRect) {
  const sx = fromRect.w > 0 ? (pt.x - fromRect.x) / fromRect.w : 0;
  const sy = fromRect.h > 0 ? (pt.y - fromRect.y) / fromRect.h : 0;
  return { x: toRect.x + sx * toRect.w, y: toRect.y + sy * toRect.h };
}

export function nodeCenter(el) {
  const pos = el.position || { x: el.x || 0, y: el.y || 0 };
  return { x: pos.x + (el.width ? el.width / 2 : 40), y: pos.y + (el.height ? el.height / 2 : 40) };
}

export function getPoolForNode(node, elements) {
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
    const px = pool.position?.x ?? pool.x ?? 0;
    const py = pool.position?.y ?? pool.y ?? 0;
    const pw = pool.width ?? 600;
    const ph = pool.height ?? 300;
    if (center.x >= px && center.x <= px + pw && center.y >= py && center.y <= py + ph) return pool;
  }
  return null;
}

// ─── Context pad ──────────────────────────────────────────────────────────────
export function ContextPad({ el, elements, connections, setElements, setConnections, setSelId, connMode = 'sequence-flow', coords = 'global', onDelete, onRename, showMsg }) {
  const elPos = el.position || { x: el.x || 0, y: el.y || 0 };
  const w = el.width || NW, h = el.height || NH;
  const cx = coords === 'local' ? w / 2 : elPos.x + w / 2;
  const cy = coords === 'local' ? h / 2 : elPos.y + h / 2;
  const R = 56;

  const handleConnect = (mode) => {
    const pcx = elPos.x + w;
    const pcy = elPos.y + h / 2;
    let closest = null, minDist = Infinity;
    for (const n of elements) {
      if (n.id === el.id || n.type === 'pool' || n.type === 'lane') continue;
      const nPos = n.position || { x: n.x || 0, y: n.y || 0 };
      const nx = nPos.x;
      const ny = nPos.y + (n.height || NH) / 2;
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
          if (showMsg) showMsg('error', 'Message flows cannot connect elements within the same pool.');
          return;
        }
      }
      setConnections(prev => {
        const next = [...prev, { id: makeId('conn'), fromId: el.id, toId: closest.id, from: el.id, to: closest.id, type: mode }];
        if (el.type === 'exclusive-gateway' || el.type === 'inclusive-gateway' || el.type === 'gateway') {
          const outgoing = next.filter(c => (c.fromId === el.id || c.from === el.id || c.source === el.id));
          const split = Math.floor(100 / outgoing.length);
          return next.map(c => {
            if (c.fromId !== el.id && c.from !== el.id && c.source !== el.id) return c;
            const idx = outgoing.findIndex(o => o.id === c.id);
            return { ...c, probability: idx === 0 ? (100 - split * (outgoing.length - 1)) / 100 : split / 100 };
          });
        }
        return next;
      });
      setSelId(closest.id);
    } else {
      const newEl = createElement('task', 'Task', { x: elPos.x + w + 90, y: elPos.y });
      const conn = { id: makeId('conn'), fromId: el.id, toId: newEl.id, from: el.id, to: newEl.id, type: mode };
      setElements(p => [...p, newEl]);
      setConnections(p => [...p, conn]);
      setSelId(newEl.id);
    }
  };

  const handleAppend = (type, label) => {
    let newY = elPos.y;
    if (el.type && el.type.includes('gateway')) {
      const branches = connections.filter(c => (c.fromId === el.id || c.from === el.id || c.source === el.id)).length;
      if (branches > 0) {
        const offsetMultiplier = Math.ceil(branches / 2) * (branches % 2 === 0 ? -1 : 1);
        newY += offsetMultiplier * 120;
      }
    }

    const newEl = createElement(type, label, { x: elPos.x + w + 90, y: newY });
    setElements(p => [...p, newEl]);

    const outgoing = connections.filter(c => (c.fromId === el.id || c.from === el.id || c.source === el.id) && (c.type === 'sequence-flow' || !c.type || c.flowType === 'sequence'));
    if (outgoing.length === 1 && connMode === 'sequence-flow' && !(el.type && el.type.includes('gateway'))) {
      const oldConn = outgoing[0];
      const oldTargetId = oldConn.toId || oldConn.to || oldConn.target;
      const conn1 = { id: makeId('conn'), fromId: el.id, toId: newEl.id, from: el.id, to: newEl.id, type: connMode };
      const conn2 = { id: makeId('conn'), fromId: newEl.id, toId: oldTargetId, from: newEl.id, to: oldTargetId, type: connMode };
      setConnections(p => [...p.filter(c => c.id !== oldConn.id), conn1, conn2]);
    } else {
      const conn = { id: makeId('conn'), fromId: el.id, toId: newEl.id, from: el.id, to: newEl.id, type: connMode };
      setConnections(p => [...p, conn]);
    }
    setSelId(el.type && el.type.includes('gateway') ? el.id : newEl.id);
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
            id={`pad-btn-${b.key}`}
            data-testid={`pad-btn-${b.key}`}
            onMouseDown={e => { e.stopPropagation(); }}
            onClick={e => { e.stopPropagation(); b.cb(); }}
            style={{ cursor: 'pointer', pointerEvents: 'all' }}>
            <circle cx={bx} cy={by} r={14} fill={active ? b.col : b.bg} stroke={b.col} strokeWidth={active ? 0 : 1.5} style={{ pointerEvents: 'all' }} />
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

// ─── Gateway "How Often" Popover ─────────────────────────────────────────────
export function GatewayPopover({ gateway, connections, onUpdateProbability, onClose }) {
  const outgoing = connections.filter(c => (c.fromId === gateway.id || c.from === gateway.id || c.source === gateway.id));
  const isOR = gateway.type === 'inclusive-gateway';

  // Initialise sliders from existing probability or equal split
  const equalVal = isOR ? 50 : Math.floor(100 / (outgoing.length || 1));
  const initVals = () => {
    const vals = outgoing.map(c =>
      c.probability != null ? Math.round(c.probability * 100) : (c.data?.probability != null ? Math.round(c.data.probability * 100) : equalVal)
    );
    // Make sure they sum to 100 by adjusting the first entry (only for XOR)
    if (!isOR && vals.length > 0) {
      const sum = vals.reduce((a, b) => a + b, 0);
      if (sum !== 100) vals[0] += 100 - sum;
    }
    return vals;
  };

  const [vals, setVals] = useState(initVals);
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

  const px = (gateway.position?.x ?? gateway.x ?? 0) + 90;
  const py = (gateway.position?.y ?? gateway.y ?? 0) - 20;

  return (
    <foreignObject x={px} y={py} width="230" height={80 + outgoing.length * 56} style={{ overflow: 'visible', pointerEvents: 'all' }}>
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
          <div key={conn.id || idx} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>
                {conn.label || conn.name || (isXorGateway(gateway.type) ? (outgoing.length >= 2 ? (idx === 0 ? 'Yes' : idx === 1 ? 'No' : `Branch ${idx + 1}`) : 'Yes') : `Path ${idx + 1}`)}
              </span>
              <span style={{ fontSize: 11, color: '#6b4de6', fontWeight: 700 }}>{vals[idx]}%</span>
            </div>
            <input
              id={`gw-slider-${idx}`}
              data-testid={`gw-slider-${idx}`}
              type="range"
              min={isOR ? 0 : 1}
              max={isOR ? 100 : 99}
              value={vals[idx] ?? 50}
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
