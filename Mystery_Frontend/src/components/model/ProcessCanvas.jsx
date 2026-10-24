import { Shape } from './BpmnShape';
import { DiagramEdge } from './DiagramEdge';
import { NW, NH, POOL_LANE_HDR, LANE_HDR } from './bpmnGeometry';

const VISUAL_ONLY = new Set(['pool', 'lane']);

function poolLanes(elements, poolId) {
  return elements
    .filter(e => e.type === 'lane' && e.poolId === poolId && !e.implicitLane && !e.data?.implicitLane)
    .sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0));
}

function highlightColors(state) {
  if (state === 'processing') {
    return { stroke: '#f59e0b', fill: '#fffbeb', glow: 'drop-shadow(0 0 10px rgba(245,158,11,0.7))' };
  }
  if (state === 'waiting') {
    return { stroke: '#a855f7', fill: '#faf5ff', glow: 'drop-shadow(0 0 8px rgba(168,85,247,0.6))' };
  }
  if (state === 'active') {
    return { stroke: '#0ea5e9', fill: '#f0f9ff', glow: 'drop-shadow(0 0 8px rgba(14,165,233,0.6))' };
  }
  return {};
}

function SwimlanesSvg({ elements }) {
  const pools = elements.filter(e => e.type === 'pool');
  return (
    <g className="process-swimlanes">
      {pools.map(pool => {
        const px = pool.position?.x ?? 0;
        const py = pool.position?.y ?? 0;
        const W = pool.width ?? 600;
        const H = pool.height ?? 150;
        const rawLanes = poolLanes(elements, pool.id);
        const lanes = rawLanes.length >= 2 ? rawLanes : [];
        return (
          <g key={pool.id}>
            <rect x={px} y={py} width={W} height={H} rx="3" fill="white" stroke="#9ca3af" strokeWidth="1.5" />
            <rect x={px + 1.5} y={py + 1.5} width={POOL_LANE_HDR - 1.5} height={H - 3} fill="#e5e7eb" stroke="none" rx="2" />
            <line x1={px + POOL_LANE_HDR} y1={py + 1} x2={px + POOL_LANE_HDR} y2={py + H - 1} stroke="#9ca3af" strokeWidth="1.5" />
            <foreignObject x={px} y={py} width={POOL_LANE_HDR} height={H}>
              <div style={{
                width: H, height: POOL_LANE_HDR,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transform: `rotate(-90deg) translateX(-${H}px)`,
                transformOrigin: '0 0',
                fontSize: 11, fontWeight: 600, color: '#374151',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                pointerEvents: 'none', userSelect: 'none',
              }}>
                {(pool.label || 'Pool').length > 14 ? String(pool.label).slice(0, 13) + '…' : (pool.label || 'Pool')}
              </div>
            </foreignObject>
            {lanes.map((lane, laneIdx) => {
              const n = lanes.length || 1;
              const lH = Math.round(H / n);
              const lW = Math.max(48, W - POOL_LANE_HDR - LANE_HDR);
              const lx = px + POOL_LANE_HDR;
              const ly = py + laneIdx * lH;
              return (
                <g key={lane.id}>
                  {laneIdx > 0 && (
                    <line x1={px + POOL_LANE_HDR} y1={ly} x2={px + W} y2={ly} stroke="#d1d5db" strokeWidth="1" />
                  )}
                  <rect x={lx} y={ly} width={LANE_HDR} height={lH} fill="#e5e7eb" stroke="none" />
                  <line x1={lx + LANE_HDR} y1={ly} x2={lx + LANE_HDR} y2={ly + lH} stroke="#9ca3af" strokeWidth="1.5" />
                  <foreignObject x={lx} y={ly} width={LANE_HDR} height={lH}>
                    <div style={{
                      width: lH, height: LANE_HDR,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transform: `rotate(-90deg) translateX(-${lH}px)`,
                      transformOrigin: '0 0',
                      fontSize: 11, fontWeight: 600, color: '#374151',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      pointerEvents: 'none', userSelect: 'none',
                    }}>
                      {(lane.label || 'Lane').length > 14 ? String(lane.label).slice(0, 13) + '…' : (lane.label || 'Lane')}
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

/**
 * Read-only process diagram that uses the same glyphs, swimlanes and
 * connection geometry as the Model editor.
 */
export function ProcessCanvasWorld({
  elements = [],
  connections = [],
  nodeState = {},
  selectedId,
  activeEdgeSet,
  onNodeClick,
  taskAssignments,
  showResourceHint = false,
  tokenCounts = {},
  bottleneckId,
}) {
  const nodes = elements.filter(e => !VISUAL_ONLY.has(e.type));

  return (
    <g>
      <SwimlanesSvg elements={elements} />

      {nodes.map(el => {
        const nodeW = el.width || NW;
        const nodeH = el.height || NH;
        const state = nodeState[el.id];
        const colors = highlightColors(state);
        const isTask = el.type === 'task' || el.type === 'subprocess' || (el.type || '').includes('task');
        const isGateway = (el.type || '').includes('gateway');
        const isSelectable = isTask || isGateway;
        const count = tokenCounts[el.id] || 0;
        const assignments = taskAssignments?.[el.id] || {};
        const hasResource = Object.values(assignments).some(a => a.enabled);
        const labelColor = state === 'processing' ? '#b45309' : state === 'waiting' ? '#7c3aed' : state === 'active' ? '#0369a1' : '#1f2937';

        return (
          <g
            key={el.id}
            transform={`translate(${el.position?.x ?? 0},${el.position?.y ?? 0})`}
            style={{ cursor: isSelectable ? 'pointer' : 'default' }}
            onClick={(e) => {
              e.stopPropagation();
              if (isSelectable) onNodeClick?.(el);
            }}
          >
            {bottleneckId === el.id && (
              <rect x={-6} y={-6} width={nodeW + 12} height={nodeH + 12} rx="40"
                fill="rgba(239, 68, 68, 0.08)" stroke="rgba(239, 68, 68, 0.5)" strokeWidth="2" strokeDasharray="5 4" />
            )}
            <Shape
              type={el.type}
              sel={selectedId === el.id}
              w={nodeW}
              h={nodeH}
              stroke={colors.stroke}
              fill={colors.fill}
              glow={colors.glow}
            />
            {isTask ? (
              <foreignObject x={8} y={18} width={Math.max(1, nodeW - 16)} height={Math.max(1, nodeH - 32)}>
                <div style={{
                  width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 600, color: labelColor, textAlign: 'center', lineHeight: 1.1,
                  pointerEvents: 'none', userSelect: 'none', overflow: 'hidden',
                }}>
                  <span style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {el.label}
                  </span>
                </div>
              </foreignObject>
            ) : (
              <text x={nodeW / 2} y={nodeH + 13} textAnchor="middle" fontSize="11"
                fill={labelColor} fontWeight="500" style={{ pointerEvents: 'none', userSelect: 'none' }}>
                {(el.label || '').length > 15 ? el.label.slice(0, 14) + '…' : el.label}
              </text>
            )}
            {count > 0 && (
              <g>
                <circle cx={nodeW - 2} cy={4} r="9" fill={state === 'processing' ? '#f59e0b' : state === 'waiting' ? '#a855f7' : '#0ea5e9'} stroke="white" strokeWidth="1.5" />
                <text x={nodeW - 2} y={4} textAnchor="middle" dominantBaseline="central" fontSize="9" fontWeight="700" fill="#fff">{count}</text>
              </g>
            )}
            {showResourceHint && isTask && !hasResource && (
              <text x={nodeW / 2} y={nodeH + 26} textAnchor="middle" fontSize="10" fill="#60a5fa" style={{ pointerEvents: 'none' }}>
                Click to add resources
              </text>
            )}
            {state === 'processing' && (
              <text x={nodeW / 2} y={nodeH + (isTask ? 26 : 28)} textAnchor="middle" fontSize="9" fontWeight="600" fill="#92400e">⚙ working</text>
            )}
            {state === 'waiting' && (
              <text x={nodeW / 2} y={nodeH + (isTask ? 26 : 28)} textAnchor="middle" fontSize="9" fontWeight="600" fill="#6b21a8">⏳ in queue</text>
            )}
          </g>
        );
      })}

      {connections.map(conn => {
        const key = `${conn.from ?? conn.fromId}__${conn.to ?? conn.toId}`;
        return (
          <DiagramEdge
            key={conn.id || key}
            conn={conn}
            elements={elements}
            connections={connections}
            selected={false}
            active={activeEdgeSet?.has(key)}
            interactive={false}
          />
        );
      })}
    </g>
  );
}
