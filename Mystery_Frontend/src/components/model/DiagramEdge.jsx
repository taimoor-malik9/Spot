import {
  bestPorts,
  connectionAnchors,
  elCenter,
  isXorGateway,
  outlineAnchor,
  computeOrthogonalWaypoints,
  generateRoundedSvgPath,
  computeEdgeLabelPosition,
  isMergeGateway,
} from './bpmnGeometry';

function xorBranchLabel(conn, from, elements, connections) {
  let labelText = conn.label || conn.name;
  if (!labelText && from?.type && isXorGateway(from.type) && !isMergeGateway(from, connections)) {
    const outgoing = connections.filter(c => (c.fromId === from.id || c.from === from.id));
    if (outgoing.length >= 2) {
      const sorted = [...outgoing].sort((a, b) => {
        const toA = elements.find(e => e.id === a.toId || e.id === a.to);
        const toB = elements.find(e => e.id === b.toId || e.id === b.to);
        return (toA ? toA.position.y : 0) - (toB ? toB.position.y : 0);
      });
      const idx = sorted.findIndex(c => c.id === conn.id);
      if (idx === 0) labelText = 'Yes';
      else if (idx === 1) labelText = 'No';
      else labelText = `Branch ${idx + 1}`;
    }
  }

  if (!labelText) return '';

  if (conn.probability !== undefined && conn.probability !== null && !String(labelText).includes('%')) {
    const probVal = Number(conn.probability);
    if (!Number.isNaN(probVal)) {
      const probPct = Math.round(probVal <= 1 ? probVal * 100 : probVal);
      return `${labelText} (${probPct}%)`;
    }
  }
  return String(labelText);
}

/**
 * BPMN 2.0 Sequence / message / association flow with 90-degree orthogonal Manhattan routing,
 * rounded corners, and crisp pill badge labels.
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

  const waypoints = computeOrthogonalWaypoints(from, to, conn, elements, connections);
  const fp = waypoints[0] || { x: 0, y: 0 };
  const tp = waypoints[waypoints.length - 1] || { x: 0, y: 0 };

  const midIndex = Math.floor((waypoints.length - 1) / 2);
  const pA = waypoints[midIndex] || fp;
  const pB = waypoints[midIndex + 1] || tp;
  const cx = (pA.x + pB.x) / 2;
  const cy = (pA.y + pB.y) / 2;

  const isMsg = conn.type === 'message-flow';
  const isAssoc = conn.type === 'association';
  const col = selected ? '#0284c7' : active ? '#0ea5e9' : '#4b5563';
  const d = generateRoundedSvgPath(waypoints, 6);
  const safeId = String(conn.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  const markerId = `arrow-${isMsg ? 'open' : 'filled'}-${safeId}-${selected ? 'sel' : active ? 'act' : 'norm'}`;
  const startMarkerId = `circle-start-${safeId}-${selected ? 'sel' : active ? 'act' : 'norm'}`;

  const labelText = xorBranchLabel(conn, from, elements, connections);
  const labelPos = labelText ? computeEdgeLabelPosition(waypoints, conn, from, to) : { x: 0, y: 0 };
  const badgeW = labelText ? Math.max(34, labelText.length * 7 + 14) : 0;
  const badgeH = 20;

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
        <g transform={`translate(${labelPos.x}, ${labelPos.y})`} style={{ pointerEvents: 'none', userSelect: 'none' }}>
          <rect
            x={-badgeW / 2}
            y={-badgeH / 2}
            width={badgeW}
            height={badgeH}
            rx={4}
            fill="#ffffff"
            stroke="#cbd5e1"
            strokeWidth={1}
            filter="drop-shadow(0px 1px 2px rgba(0,0,0,0.06))"
          />
          <text
            x={0}
            y={0}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="10.5"
            fontWeight="700"
            fill={labelText.startsWith('Yes') ? '#16a34a' : labelText.startsWith('No') ? '#dc2626' : '#1e293b'}
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
