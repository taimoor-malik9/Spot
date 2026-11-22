/** Shared BPMN layout constants and connection geometry for Model + Simulate. */
export const NW = 80;
export const NH = 80;
export const POOL_LANE_HDR = 30;
export const LANE_HDR = 30;

export function poolLanes(elements, poolId) {
  return (elements || [])
    .filter(e => e.type === 'lane' && (e.poolId === poolId || e.pool === poolId || e.data?.poolId === poolId || e.data?.pool === poolId) && !e.implicitLane && !e.data?.implicitLane)
    .sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0));
}

export function isXorGateway(type) {
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

export function elCenter(el) {
  return {
    x: (el.position?.x ?? 0) + (el.width || NW) / 2,
    y: (el.position?.y ?? 0) + (el.height || NH) / 2,
  };
}

function typeOf(el) {
  return el?.type || '';
}

export function isEventType(t) {
  if (!t) return false;
  const s = t.toLowerCase();
  if (s.includes('gateway') || s.includes('task') || s.includes('subprocess') || s.includes('call-activity') || s.includes('pool') || s.includes('lane') || s.includes('data') || s.includes('annotation') || s.includes('group')) {
    return false;
  }
  return s.includes('event') || s.includes('start') || s.includes('end') ||
         s.includes('catch') || s.includes('throw') || s.includes('intermediate') ||
         s.includes('terminate');
}

export function isGatewayType(t) {
  return t ? t.toLowerCase().includes('gateway') : false;
}

export function isTaskType(t) {
  if (!t) return false;
  const s = t.toLowerCase();
  return s.includes('task') || s === 'subprocess' || s === 'call-activity';
}

/** Half of the SVG stroke, converted from viewBox units into element pixels. */
function strokePad(el, extraViewBox = 0) {
  const w = el.width || NW;
  const h = el.height || NH;
  const t = typeOf(el).toLowerCase();
  const sw = (t.includes('end') || t.includes('terminate')) ? 6.3 : 1.8;
  return ((sw + extraViewBox) / 2) * Math.min(w, h) / 120;
}

function pushAlong(from, to, dist) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: to.x + (dx / len) * dist, y: to.y + (dy / len) * dist };
}

function intersectAABB(cx, cy, px, py, left, top, right, bottom) {
  const dx = px - cx;
  const dy = py - cy;
  let tx = Infinity;
  let ty = Infinity;
  if (dx > 1e-9) tx = (right - cx) / dx;
  else if (dx < -1e-9) tx = (left - cx) / dx;
  if (dy > 1e-9) ty = (bottom - cy) / dy;
  else if (dy < -1e-9) ty = (top - cy) / dy;
  const t = Math.min(tx, ty);
  if (!Number.isFinite(t) || t <= 0) return { x: cx, y: cy };
  return { x: cx + dx * t, y: cy + dy * t };
}

function raySeg(cx, cy, px, py, ax, ay, bx, by) {
  const rdx = px - cx;
  const rdy = py - cy;
  const sdx = bx - ax;
  const sdy = by - ay;
  const den = rdx * sdy - rdy * sdx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((ax - cx) * sdy - (ay - cy) * sdx) / den;
  const u = ((ax - cx) * rdy - (ay - cy) * rdx) / den;
  if (t > 1e-6 && u >= -0.001 && u <= 1.001) return { x: cx + rdx * t, y: cy + rdy * t, t };
  return null;
}

function intersectPolygon(cx, cy, px, py, pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const hit = raySeg(cx, cy, px, py, a.x, a.y, b.x, b.y);
    if (hit && (!best || hit.t < best.t)) best = hit;
  }
  return best ? { x: best.x, y: best.y } : { x: cx, y: cy };
}

/**
 * Point on the *drawn* shape outline (not the 80×80 hit box) facing `toward`.
 * Matches BpmnShape viewBox 0..120 scaled to element width/height.
 */
export function outlineAnchor(el, toward) {
  const x = el.position?.x ?? 0;
  const y = el.position?.y ?? 0;
  const w = el.width || NW;
  const h = el.height || NH;
  const sx = w / 120;
  const sy = h / 120;
  const t = typeOf(el);
  const pad = strokePad(el);
  const c = elCenter(el);
  const tx = toward?.x ?? c.x + w;
  const ty = toward?.y ?? c.y;
  if (Math.hypot(tx - c.x, ty - c.y) < 0.5) {
    return { x: c.x + w / 2, y: c.y };
  }

  if (isEventType(t) && !t.includes('gateway')) {
    const cx = x + 60 * sx;
    const cy = y + 60 * sy;
    const rx = 32 * sx + pad;
    const ry = 32 * sy + pad;
    const vx = tx - cx;
    const vy = ty - cy;
    const n = Math.hypot(vx / rx, vy / ry) || 1;
    return { x: cx + vx / n, y: cy + vy / n };
  }

  if (isGatewayType(t)) {
    const pts = [
      { x: x + 60 * sx, y: y + 8 * sy },
      { x: x + 112 * sx, y: y + 60 * sy },
      { x: x + 60 * sx, y: y + 112 * sy },
      { x: x + 8 * sx, y: y + 60 * sy },
    ];
    const hit = intersectPolygon(c.x, c.y, tx, ty, pts);
    return pushAlong(c, hit, pad);
  }

  if (t === 'subprocess') {
    const hit = intersectAABB(c.x, c.y, tx, ty, x + 10 * sx, y + 16 * sy, x + 110 * sx, y + 100 * sy);
    return pushAlong(c, hit, pad);
  }

  if (isTaskType(t)) {
    const hit = intersectAABB(c.x, c.y, tx, ty, x + 10 * sx, y + 20 * sy, x + 110 * sx, y + 100 * sy);
    return pushAlong(c, hit, pad);
  }

  if (t === 'data-object') {
    const pts = [
      { x: x + 22 * sx, y: y + 12 * sy },
      { x: x + 80 * sx, y: y + 12 * sy },
      { x: x + 98 * sx, y: y + 32 * sy },
      { x: x + 98 * sx, y: y + 108 * sy },
      { x: x + 22 * sx, y: y + 108 * sy },
    ];
    return pushAlong(c, intersectPolygon(c.x, c.y, tx, ty, pts), pad);
  }

  if (t === 'input' || t === 'output') {
    const hit = intersectAABB(c.x, c.y, tx, ty, x + 14 * sx, y + 24 * sy, x + 106 * sx, y + 96 * sy);
    return pushAlong(c, hit, pad);
  }

  if (t === 'document') {
    const hit = intersectAABB(c.x, c.y, tx, ty, x + 16 * sx, y + 10 * sy, x + 104 * sx, y + 110 * sy);
    return pushAlong(c, hit, pad);
  }

  if (t === 'data-store') {
    const hit = intersectAABB(c.x, c.y, tx, ty, x + 22 * sx, y + 18 * sy, x + 98 * sx, y + 102 * sy);
    return pushAlong(c, hit, pad);
  }

  const hit = intersectAABB(c.x, c.y, tx, ty, x, y, x + w, y + h);
  return pushAlong(c, hit, pad);
}

function elPort(el, side) {
  const dummy = {
    right: { x: (el.position?.x ?? 0) + 10000, y: elCenter(el).y },
    left: { x: (el.position?.x ?? 0) - 10000, y: elCenter(el).y },
    top: { x: elCenter(el).x, y: (el.position?.y ?? 0) - 10000 },
    bottom: { x: elCenter(el).x, y: (el.position?.y ?? 0) + 10000 },
  };
  return outlineAnchor(el, dummy[side] || dummy.right);
}

export function bestPorts(from, to) {
  if (!from || !to) {
    return { fp: { x: 0, y: 0 }, tp: { x: 0, y: 0 } };
  }
  const fc = elCenter(from);
  const tc = elCenter(to);

  // If from or to is a pool container, anchor message flows to the pool boundary facing the element
  if (from.type === 'pool' && to.type !== 'pool') {
    const poolX = from.position?.x ?? 0;
    const poolY = from.position?.y ?? 0;
    const poolW = from.width || NW;
    const poolH = from.height || NH;
    const targetX = Math.max(poolX + 30, Math.min(poolX + poolW - 30, tc.x));
    const isAbove = (poolY + poolH) <= (to.position?.y ?? 0) + 10;
    const fp = isAbove ? { x: targetX, y: poolY + poolH } : { x: targetX, y: poolY };
    const tp = elPort(to, isAbove ? 'top' : 'bottom');
    return { fp, tp };
  }

  if (to.type === 'pool' && from.type !== 'pool') {
    const poolX = to.position?.x ?? 0;
    const poolY = to.position?.y ?? 0;
    const poolW = to.width || NW;
    const poolH = to.height || NH;
    const sourceX = Math.max(poolX + 30, Math.min(poolX + poolW - 30, fc.x));
    const isBelow = poolY >= (from.position?.y ?? 0) + (from.height || NH) - 10;
    const fp = elPort(from, isBelow ? 'bottom' : 'top');
    const tp = isBelow ? { x: sourceX, y: poolY } : { x: sourceX, y: poolY + poolH };
    return { fp, tp };
  }

  const dx = tc.x - fc.x;
  const dy = tc.y - fc.y;
  let fromSide, toSide;
  if (Math.abs(dx) >= Math.abs(dy)) {
    fromSide = dx >= 0 ? 'right' : 'left';
    toSide = dx >= 0 ? 'left' : 'right';
  } else {
    fromSide = dy >= 0 ? 'bottom' : 'top';
    toSide = dy >= 0 ? 'top' : 'bottom';
  }
  return {
    fp: elPort(from, fromSide),
    tp: elPort(to, toSide),
  };
}

export function connectionAnchors(from, to) {
  return bestPorts(from, to);
}

export function elPortSide(el, side) {
  return elPort(el, side);
}

export function isMergeGateway(node, connections = []) {
  if (!node) return false;
  if (node.gateway_role === 'merge' || node.role === 'merge') return true;
  if (node.data?.gateway_role === 'merge' || node.data?.role === 'merge') return true;
  if (/merge|join/i.test(node.id || '')) return true;
  const incoming = (connections || []).filter(c => (c.toId === node.id || c.to === node.id));
  if (incoming.length >= 2) return true;
  return false;
}

/**
 * 90-degree Manhattan orthogonal waypoints generator for BPMN 2.0 sequence,
 * message, and loopback flows.
 */
export function computeOrthogonalWaypoints(from, to, conn = {}, elements = [], connections = []) {
  if (!from || !to) return [];

  const fc = elCenter(from);
  const tc = elCenter(to);
  const isMsg = conn.type === 'message-flow' || conn.flowType === 'message';

  // 1. External pool message flows: strictly vertical routing
  if (from.type === 'pool' && to.type !== 'pool') {
    const poolX = from.position?.x ?? 0;
    const poolY = from.position?.y ?? 0;
    const poolW = from.width || NW;
    const poolH = from.height || NH;
    const targetX = Math.max(poolX + 30, Math.min(poolX + poolW - 30, tc.x));
    const isAbove = (poolY + poolH) <= (to.position?.y ?? 0) + 15;
    const startY = isAbove ? poolY + poolH : poolY;
    const toPort = elPort(to, isAbove ? 'top' : 'bottom');
    return [{ x: targetX, y: startY }, { x: targetX, y: toPort.y }];
  }

  if (to.type === 'pool' && from.type !== 'pool') {
    const poolX = to.position?.x ?? 0;
    const poolY = to.position?.y ?? 0;
    const poolW = to.width || NW;
    const poolH = to.height || NH;
    const sourceX = Math.max(poolX + 30, Math.min(poolX + poolW - 30, fc.x));
    const isBelow = poolY >= (from.position?.y ?? 0) + (from.height || NH) - 15;
    const fromPort = elPort(from, isBelow ? 'bottom' : 'top');
    const endY = isBelow ? poolY : poolY + poolH;
    return [{ x: sourceX, y: fromPort.y }, { x: sourceX, y: endY }];
  }

  // 2. Loopback flows (target is behind source: tc.x <= fc.x + 5)
  if (!isMsg && tc.x <= fc.x + 5) {
    let maxBottom = Math.max(
      (from.position?.y ?? 0) + (from.height || NH),
      (to.position?.y ?? 0) + (to.height || NH)
    );
    const minX = Math.min(from.position?.x ?? 0, to.position?.x ?? 0);
    const maxX = Math.max(
      (from.position?.x ?? 0) + (from.width || NW),
      (to.position?.x ?? 0) + (to.width || NW)
    );
    if (Array.isArray(elements)) {
      elements.forEach(el => {
        if (el.type === 'pool' || el.type === 'lane') return;
        const ex = el.position?.x ?? 0;
        const ew = el.width || NW;
        const ey = el.position?.y ?? 0;
        const eh = el.height || NH;
        if (ex + ew >= minX - 10 && ex <= maxX + 10) {
          maxBottom = Math.max(maxBottom, ey + eh);
        }
      });
    }
    const channelY = maxBottom + 35 + (conn.bend?.y || 0);
    const P0 = elPort(from, 'bottom');
    const P1 = { x: P0.x, y: channelY };
    const P2 = { x: tc.x, y: channelY };
    const P3 = elPort(to, 'bottom');
    return [P0, P1, P2, P3];
  }

  // 3. Forward flows: Determine port sides for Split & Merge gateways
  const isFromGw = isGatewayType(from.type);
  const fromOutgoing = (connections || []).filter(c => (c.fromId === from.id || c.from === from.id));
  const isSplit = isFromGw && fromOutgoing.length >= 2 && !isMergeGateway(from, connections);

  let fromSide = 'right';
  if (isSplit) {
    const sortedOut = [...fromOutgoing].sort((a, b) => {
      const nA = (elements || []).find(e => e.id === (a.toId || a.to));
      const nB = (elements || []).find(e => e.id === (b.toId || b.to));
      return (nA ? elCenter(nA).y : 0) - (nB ? elCenter(nB).y : 0);
    });
    const outIdx = sortedOut.findIndex(c => c.id === conn.id);

    if (sortedOut.length === 2) {
      const target0 = (elements || []).find(e => e.id === (sortedOut[0].toId || sortedOut[0].to));
      const target1 = (elements || []).find(e => e.id === (sortedOut[1].toId || sortedOut[1].to));
      const y0 = target0 ? elCenter(target0).y : fc.y;
      const y1 = target1 ? elCenter(target1).y : fc.y;
      const diff0 = y0 - fc.y;
      const diff1 = y1 - fc.y;

      if (diff0 < -15 && diff1 > 15) {
        fromSide = (outIdx === 0) ? 'top' : 'bottom';
      } else if (diff1 > 15 && Math.abs(diff0) <= 15) {
        fromSide = (outIdx === 0) ? 'right' : 'bottom';
      } else if (diff0 < -15 && Math.abs(diff1) <= 15) {
        fromSide = (outIdx === 0) ? 'top' : 'right';
      } else {
        fromSide = (outIdx === 0) ? 'top' : 'bottom';
      }
    } else if (sortedOut.length >= 3) {
      if (outIdx === 0) fromSide = 'top';
      else if (outIdx === sortedOut.length - 1) fromSide = 'bottom';
      else fromSide = 'right';
    }
  }

  const isToGw = isGatewayType(to.type);
  const toIncoming = (connections || []).filter(c => (c.toId === to.id || c.to === to.id));
  const isMerge = isToGw && (isMergeGateway(to, connections) || toIncoming.length >= 2);

  let toSide = 'left';
  if (isMerge && toIncoming.length >= 2) {
    const diff = fc.y - tc.y;
    if (diff < -15) {
      toSide = 'top';
    } else if (diff > 15) {
      toSide = 'bottom';
    } else {
      toSide = 'left';
    }
  }

  const startPort = elPort(from, fromSide);
  const endPort = elPort(to, toSide);

  // 4. Construct orthogonal waypoints based on assigned port sides
  if (fromSide === 'right' && toSide === 'left') {
    if (Math.abs(startPort.y - endPort.y) < 4) {
      return [startPort, endPort];
    }
    const midX = (startPort.x + endPort.x) / 2 + (conn.bend?.x || 0);
    return [
      startPort,
      { x: midX, y: startPort.y },
      { x: midX, y: endPort.y },
      endPort,
    ];
  }

  if (fromSide === 'top' && toSide === 'left') {
    if (endPort.y <= startPort.y + 5) {
      return [startPort, { x: startPort.x, y: endPort.y }, endPort];
    }
    const liftY = startPort.y - 20 + (conn.bend?.y || 0);
    const midX = (startPort.x + endPort.x) / 2;
    return [
      startPort,
      { x: startPort.x, y: liftY },
      { x: midX, y: liftY },
      { x: midX, y: endPort.y },
      endPort,
    ];
  }

  if (fromSide === 'bottom' && toSide === 'left') {
    if (endPort.y >= startPort.y - 5) {
      return [startPort, { x: startPort.x, y: endPort.y }, endPort];
    }
    const dropY = startPort.y + 20 + (conn.bend?.y || 0);
    const midX = (startPort.x + endPort.x) / 2;
    return [
      startPort,
      { x: startPort.x, y: dropY },
      { x: midX, y: dropY },
      { x: midX, y: endPort.y },
      endPort,
    ];
  }

  if (fromSide === 'right' && toSide === 'top') {
    return [startPort, { x: endPort.x, y: startPort.y }, endPort];
  }

  if (fromSide === 'right' && toSide === 'bottom') {
    return [startPort, { x: endPort.x, y: startPort.y }, endPort];
  }

  if (fromSide === 'top' && toSide === 'top') {
    const bridgeY = Math.min(startPort.y, endPort.y) - 25 + (conn.bend?.y || 0);
    return [
      startPort,
      { x: startPort.x, y: bridgeY },
      { x: endPort.x, y: bridgeY },
      endPort,
    ];
  }

  if (fromSide === 'bottom' && toSide === 'bottom') {
    const bridgeY = Math.max(startPort.y, endPort.y) + 25 + (conn.bend?.y || 0);
    return [
      startPort,
      { x: startPort.x, y: bridgeY },
      { x: endPort.x, y: bridgeY },
      endPort,
    ];
  }

  // Fallback forward Manhattan
  const midX = (startPort.x + endPort.x) / 2 + (conn.bend?.x || 0);
  return [
    startPort,
    { x: midX, y: startPort.y },
    { x: midX, y: endPort.y },
    endPort,
  ];
}

/**
 * Converts a sequence of waypoints into an SVG path with smooth rounded corners (e.g. 6px radius).
 */
export function generateRoundedSvgPath(points, radius = 6) {
  if (!points || points.length === 0) return '';
  const pts = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (pts.length === 0) {
      pts.push(p);
    } else {
      const prev = pts[pts.length - 1];
      if (Math.hypot(p.x - prev.x, p.y - prev.y) > 0.5) {
        pts.push(p);
      }
    }
  }

  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];

    const v1 = { x: prev.x - cur.x, y: prev.y - cur.y };
    const v2 = { x: next.x - cur.x, y: next.y - cur.y };
    const d1 = Math.hypot(v1.x, v1.y) || 1;
    const d2 = Math.hypot(v2.x, v2.y) || 1;

    // Check if straight collinear
    const cross = (v1.x * v2.y - v1.y * v2.x) / (d1 * d2);
    const dot = (v1.x * v2.x + v1.y * v2.y) / (d1 * d2);
    if (Math.abs(cross) < 1e-4 && dot < 0) {
      d += ` L ${cur.x} ${cur.y}`;
      continue;
    }

    const r = Math.min(radius, d1 / 2, d2 / 2);
    const startCorner = {
      x: cur.x + (v1.x / d1) * r,
      y: cur.y + (v1.y / d1) * r,
    };
    const endCorner = {
      x: cur.x + (v2.x / d2) * r,
      y: cur.y + (v2.y / d2) * r,
    };

    d += ` L ${startCorner.x} ${startCorner.y} Q ${cur.x} ${cur.y} ${endCorner.x} ${endCorner.y}`;
  }
  d += ` L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  return d;
}

/**
 * Computes non-overlapping edge label placement, positioning split gateway branch
 * labels along the segment just after the split port (offset 25-35px).
 */
export function computeEdgeLabelPosition(waypoints, conn, from, to) {
  if (!waypoints || waypoints.length === 0) return { x: 0, y: 0 };
  if (waypoints.length === 1) return { x: waypoints[0].x, y: waypoints[0].y };

  const isFromGw = isGatewayType(from?.type) && !isMergeGateway(from);

  if (isFromGw && waypoints.length >= 2) {
    const p0 = waypoints[0];
    const p1 = waypoints[1];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy) || 1;

    if (len >= 30) {
      const offsetDist = Math.min(len - 10, 28);
      const lx = p0.x + (dx / len) * offsetDist;
      const ly = p0.y + (dy / len) * offsetDist;

      if (Math.abs(dx) < 1) {
        return { x: lx + 22, y: ly };
      } else {
        return { x: lx, y: ly - 14 };
      }
    } else if (waypoints.length >= 3) {
      const p2 = waypoints[2];
      const dx2 = p2.x - p1.x;
      const dy2 = p2.y - p1.y;
      const len2 = Math.hypot(dx2, dy2) || 1;
      const offsetDist = Math.min(len2 - 10, 24);
      const lx = p1.x + (dx2 / len2) * offsetDist;
      const ly = p1.y + (dy2 / len2) * offsetDist;
      return { x: lx, y: ly - 14 };
    }
  }

  if (waypoints.length === 2) {
    return {
      x: (waypoints[0].x + waypoints[1].x) / 2,
      y: (waypoints[0].y + waypoints[1].y) / 2 - 14,
    };
  }

  const midIdx = Math.floor((waypoints.length - 1) / 2);
  const pA = waypoints[midIdx];
  const pB = waypoints[midIdx + 1];
  return {
    x: (pA.x + pB.x) / 2,
    y: (pA.y + pB.y) / 2 - 14,
  };
}
