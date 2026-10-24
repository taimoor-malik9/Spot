/** Shared BPMN layout constants and connection geometry for Model + Simulate. */
export const NW = 80;
export const NH = 80;
export const POOL_LANE_HDR = 30;
export const LANE_HDR = 30;

export function poolLanes(elements, poolId) {
  return (elements || [])
    .filter(e => e.type === 'lane' && e.poolId === poolId && !e.implicitLane && !e.data?.implicitLane)
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
