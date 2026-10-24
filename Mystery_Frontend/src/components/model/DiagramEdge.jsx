import { bestPorts, connectionAnchors, elCenter, isXorGateway, outlineAnchor } from './bpmnGeometry';

function xorBranchLabel(conn, from, elements, connections) {
  let labelText = conn.label || conn.name;
  if (labelText || !from?.type || !isXorGateway(from.type)) return labelText;
  const outgoing = connections.filter(c => (c.fromId === from.id || c.from === from.id));
  if (outgoing.length >= 2) {
    const sorted = [...outgoing].sort((a, b) => {
      const toA = elements.find(e => e.id === a.toId || e.id === a.to);
      const toB = elements.find(e => e.id === b.toId || e.id === b.to);
      return (toA ? toA.position.y : 0) - (toB ? toB.position.y : 0);
    });
    const idx = sorted.findIndex(c => c.id === conn.id);
    if (idx === 0) return 'Yes';
    if (idx === 1) return 'No';
    return `Branch ${idx + 1}`;
  }
  if (outgoing.length === 1) return 'Yes';
  return labelText;
}

/**
 * Sequence / message / association flow. Endpoints sit on each element's
 * drawn outline so both ends meet the glyphs.
 */
export function DiagramEdge({
  conn,
  elements,
  connections = [],
  selected,
  active,
  interactive = true,
  onClick,
  onBendStart,
  onEndpointDrag,
}) {
  const from = elements.find(e => e.id === conn.fromId || e.id === conn.from);
  const to = elements.find(e => e.id === conn.toId || e.id === conn.to);
  if (!from || !to) return null;

  const { fp, tp } = bestPorts(from, to);
  if (typeof window !== 'undefined' && window.__DEBUG_BPMN__) {
    console.debug(`[DiagramEdge] type=${conn.type} (${from.type}->${to.type}) fp=(${Math.round(fp.x)},${Math.round(fp.y)}) tp=(${Math.round(tp.x)},${Math.round(tp.y)})`);
  }
  const mx = (fp.x + tp.x) / 2;
  const my = (fp.y + tp.y) / 2;
  const bend = conn.bend || { x: 0, y: 0 };
  const cx = mx + bend.x;
  const cy = my + bend.y;
  const isMsg = conn.type === 'message-flow';
  const isAssoc = conn.type === 'association';
  const col = selected ? '#0284c7' : active ? '#0ea5e9' : '#4b5563';
  const d = `M ${fp.x} ${fp.y} Q ${cx} ${cy} ${tp.x} ${tp.y}`;
  const safeId = String(conn.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  const markerId = `arrow-${isMsg ? 'open' : 'filled'}-${safeId}-${selected ? 'sel' : active ? 'act' : 'norm'}`;
  const startMarkerId = `circle-start-${safeId}-${selected ? 'sel' : active ? 'act' : 'norm'}`;

  const labelText = xorBranchLabel(conn, from, elements, connections);

  let textX = 0;
  let textY = 0;
  if (labelText) {
    const t = 0.35;
    const lx = (1 - t) * (1 - t) * fp.x + 2 * (1 - t) * t * cx + t * t * tp.x;
    const ly = (1 - t) * (1 - t) * fp.y + 2 * (1 - t) * t * cy + t * t * tp.y;
    const segDx = cx - fp.x;
    const segDy = cy - fp.y;
    const segLen = Math.hypot(segDx, segDy) || 1;
    let nx = -segDy / segLen;
    let ny = segDx / segLen;
    if (ny > 0) { nx = -nx; ny = -ny; }
    if (Math.abs(ny) < 0.1 && Math.abs(segDy) > Math.abs(segDx)) {
      nx = segDx >= 0 ? -1 : 1;
      ny = -0.5;
    }
    textX = lx + nx * 14;
    textY = ly + ny * 14;
  }

  return (
    <g
      onClick={interactive && onClick ? (e) => { e.stopPropagation(); onClick(conn.id); } : undefined}
      style={{ cursor: interactive ? 'pointer' : 'default', pointerEvents: interactive ? 'auto' : 'none' }}
    >
      <defs>
        {isMsg && (
          <marker
            id={startMarkerId}
            markerUnits="userSpaceOnUse"
            orient="auto"
            refX="4"
            refY="4"
            markerWidth="8"
            markerHeight="8"
            overflow="visible"
          >
            <circle
              cx="4"
              cy="4"
              r="3.5"
              fill="#ffffff"
              stroke={col}
              strokeWidth="1.5"
              strokeDasharray="none"
            />
          </marker>
        )}
        {!isAssoc && (
          <marker
            id={markerId}
            markerUnits="userSpaceOnUse"
            orient="auto"
            refX="10"
            refY="5"
            markerWidth="10"
            markerHeight="10"
            overflow="visible"
          >
            {isMsg ? (
              <path
                d="M0,0 L10,5 L0,10 z"
                fill="#ffffff"
                stroke={col}
                strokeWidth="1.5"
                strokeDasharray="none"
              />
            ) : (
              <path
                d="M0,0 L10,5 L0,10 z"
                fill={col}
                stroke="none"
              />
            )}
          </marker>
        )}
      </defs>
      {interactive && <path d={d} fill="none" stroke="transparent" strokeWidth="14" />}
      <path
        d={d}
        fill="none"
        stroke={col}
        strokeWidth={selected || active ? 2.5 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={isMsg ? '7 4' : isAssoc ? '3 3' : 'none'}
        markerStart={isMsg ? `url(#${startMarkerId})` : undefined}
        markerEnd={!isAssoc ? `url(#${markerId})` : undefined}
      />

      {labelText && (
        <g transform={`translate(${textX}, ${textY})`} style={{ pointerEvents: 'none', userSelect: 'none' }}>
          <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="700" stroke="#ffffff" strokeWidth="4" strokeLinejoin="round">
            {labelText}
          </text>
          <text
            x={0}
            y={0}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="11"
            fontWeight="700"
            fill={labelText === 'Yes' ? '#16a34a' : labelText === 'No' ? '#dc2626' : '#1e293b'}
          >
            {labelText}
          </text>
        </g>
      )}

      {interactive && selected && (
        <>
          <circle cx={cx} cy={cy} r="6" fill="#ffffff" stroke="#0284c7" strokeWidth="2" style={{ cursor: 'grab', pointerEvents: 'none' }} />
          <circle cx={cx} cy={cy} r="16" fill="transparent" style={{ cursor: 'grab' }} onMouseDown={e => onBendStart?.(e, conn.id)} />
          <circle cx={fp.x} cy={fp.y} r="5.5" fill="#ffffff" stroke="#0284c7" strokeWidth="2" style={{ cursor: 'crosshair', pointerEvents: 'none' }} />
          <circle cx={fp.x} cy={fp.y} r="16" fill="transparent" style={{ cursor: 'crosshair' }} onMouseDown={e => onEndpointDrag?.(e, conn.id, 'from')} />
          <circle cx={tp.x} cy={tp.y} r="5.5" fill="#ffffff" stroke="#0284c7" strokeWidth="2" style={{ cursor: 'crosshair', pointerEvents: 'none' }} />
          <circle cx={tp.x} cy={tp.y} r="16" fill="transparent" style={{ cursor: 'crosshair' }} onMouseDown={e => onEndpointDrag?.(e, conn.id, 'to')} />
        </>
      )}
    </g>
  );
}

export function tempConnectionLine(fromEl, toPoint, hoveredEl) {
  if (!fromEl || !toPoint) return null;
  const toward = hoveredEl ? elCenter(hoveredEl) : toPoint;
  const fp = outlineAnchor(fromEl, toward);
  const tp = hoveredEl ? outlineAnchor(hoveredEl, elCenter(fromEl)) : toPoint;
  return { x1: fp.x, y1: fp.y, x2: tp.x, y2: tp.y };
}
