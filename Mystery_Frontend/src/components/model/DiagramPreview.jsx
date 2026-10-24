// Mystery_Frontend/src/components/model/DiagramPreview.jsx
import React, { useMemo } from 'react';
import { layoutAiDiagram } from '../../lib/aiDiagramLayout';

/**
 * DiagramPreview component
 *
 * Renders a BPMN process diagram as an SVG.
 * Supports both:
 * 1) Compact preview (isFullView = false, fits in a small card/chat bubble)
 * 2) Full readable diagram (isFullView = true, for large zoomable modal view)
 */
export default function DiagramPreview({
  nodes,
  connections,
  rawDiagram,
  version = 1,
  isFullView = false,
}) {
  const layout = useMemo(() => {
    if (rawDiagram) return layoutAiDiagram(rawDiagram);
    return null;
  }, [rawDiagram, version]);

  const effectiveNodes = nodes || layout?.elements || [];
  const effectiveConnections = connections || layout?.connections || [];

  if (!effectiveNodes || effectiveNodes.length === 0) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
        No diagram nodes to display
      </div>
    );
  }

  // Separate swimlanes (pools/lanes) from model nodes (tasks/events/gateways)
  const swimlanes = effectiveNodes.filter(
    (n) => n.type === 'pool' || n.type === 'lane'
  );
  const modelNodes = effectiveNodes.filter(
    (n) => n.type !== 'pool' && n.type !== 'lane'
  );

  // If there are model nodes, use them for bounding calculations; otherwise use all nodes
  const targetNodes = modelNodes.length > 0 ? modelNodes : effectiveNodes;

  const PAD = isFullView ? 40 : 16;
  const NODE_W = isFullView ? 110 : 54;
  const NODE_H = isFullView ? 46 : 28;

  const xs = targetNodes.map((n) => n.position?.x ?? 0);
  const ys = targetNodes.map((n) => n.position?.y ?? 0);
  const minX = Math.min(...xs) - PAD;
  const minY = Math.min(...ys) - PAD;
  const maxX = Math.max(...xs) + (isFullView ? 140 : NODE_W) + PAD;
  const maxY = Math.max(...ys) + (isFullView ? 70 : NODE_H) + PAD;

  const rawW = Math.max(120, maxX - minX);
  const rawH = Math.max(80, maxY - minY);

  // In compact mode: scale down to fit max 280x140
  // In full mode: render at full natural pixel size for readability!
  const scale = isFullView
    ? 1
    : Math.min(1, 280 / rawW, 140 / rawH);

  const vW = isFullView ? rawW : rawW * scale;
  const vH = isFullView ? rawH : rawH * scale;

  function tx(x) {
    return (x - minX) * scale;
  }
  function ty(y) {
    return (y - minY) * scale;
  }
  function nw(n) {
    return (isFullView ? 110 : NODE_W) * scale;
  }
  function nh(n) {
    return (isFullView ? 46 : NODE_H) * scale;
  }
  function cx(n) {
    return tx(n.position?.x ?? 0) + nw(n) / 2;
  }
  function cy2(n) {
    return ty(n.position?.y ?? 0) + nh(n) / 2;
  }

  const nodeMap = Object.fromEntries(effectiveNodes.map((n) => [n.id, n]));

  const typeColor = (t) => {
    if (t?.includes('event')) return { fill: '#e0f2fe', stroke: '#0284c7' };
    if (t?.includes('gateway')) return { fill: '#fef9c3', stroke: '#ca8a04' };
    return { fill: '#f0fdf4', stroke: '#16a34a' };
  };

  return (
    <div
      style={{
        padding: isFullView ? '20px' : '10px 12px',
        background: isFullView ? '#ffffff' : '#faf9ff',
        borderRadius: isFullView ? 8 : 6,
        display: 'inline-block',
        minWidth: isFullView ? `${Math.min(vW, 700)}px` : undefined,
      }}
    >
      <svg
        width={vW}
        height={Math.max(vH, isFullView ? 100 : 50)}
        viewBox={`0 0 ${vW} ${Math.max(vH, isFullView ? 100 : 50)}`}
        style={{
          display: 'block',
          overflow: 'visible',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <defs>
          <marker
            id={`arr_${version}_${isFullView ? 'full' : 'mini'}`}
            markerWidth={isFullView ? 8 : 6}
            markerHeight={isFullView ? 8 : 6}
            refX={isFullView ? 7 : 5}
            refY={isFullView ? 4 : 3}
            orient="auto"
          >
            <path
              d={isFullView ? 'M0,0 L8,4 L0,8 Z' : 'M0,0 L6,3 L0,6 Z'}
              fill="#818cf8"
            />
          </marker>
        </defs>

        {/* Optional Swimlane Background Bands in Full View */}
        {isFullView &&
          swimlanes
            .filter((l) => l.type === 'lane' && !l.implicitLane && !l.data?.implicitLane)
            .map((lane) => {
              const lx = tx(lane.position?.x ?? minX);
              const ly = ty(lane.position?.y ?? 0);
              const lw = (lane.width || rawW) * scale;
              const lh = (lane.height || 120) * scale;
              return (
                <g key={lane.id}>
                  <rect
                    x={lx}
                    y={ly}
                    width={lw}
                    height={lh}
                    fill="#f8fafc"
                    stroke="#e2e8f0"
                    strokeWidth={1}
                    rx={6}
                  />
                  <text
                    x={lx + 10}
                    y={ly + 18}
                    fill="#64748b"
                    fontSize={11}
                    fontWeight="700"
                  >
                    {lane.label || 'Lane'}
                  </text>
                </g>
              );
            })}

        {/* Sequence Flow Edges */}
        {effectiveConnections.map((c) => {
          const f = nodeMap[c.fromId];
          const t = nodeMap[c.toId];
          if (!f || !t) return null;

          const startX = cx(f);
          const startY = cy2(f);
          const endX = cx(t);
          const endY = cy2(t);

          // Center coordinate for edge label (if any, e.g. "Yes", "No")
          const midX = (startX + endX) / 2;
          const midY = (startY + endY) / 2;

          return (
            <g key={c.id || `${c.fromId}-${c.toId}`}>
              <line
                x1={startX}
                y1={startY}
                x2={endX}
                y2={endY}
                stroke="#a5b4fc"
                strokeWidth={isFullView ? 2 : 1}
                markerEnd={`url(#arr_${version}_${isFullView ? 'full' : 'mini'})`}
              />
              {isFullView && c.label && (
                <g transform={`translate(${midX}, ${midY - 8})`}>
                  <rect
                    x={-16}
                    y={-8}
                    width={32}
                    height={15}
                    rx={3}
                    fill="#fff"
                    stroke="#cbd5e1"
                    strokeWidth={1}
                  />
                  <text
                    x={0}
                    y={3}
                    textAnchor="middle"
                    fontSize={9}
                    fontWeight="600"
                    fill="#475569"
                  >
                    {c.label}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Process Nodes */}
        {targetNodes.map((n) => {
          const col = typeColor(n.type);
          const w = nw(n);
          const h = nh(n);
          const x = tx(n.position?.x ?? 0);
          const y = ty(n.position?.y ?? 0);

          const rawLabel = n.data?.label || n.label || '';
          const label = isFullView
            ? rawLabel
            : rawLabel.length > 10
            ? rawLabel.slice(0, 9) + '…'
            : rawLabel;

          // Event Nodes (Start / End / Intermediate)
          if (n.type?.includes('event')) {
            const r = h / 2;
            const isStart = n.type.includes('start');
            const isEnd = n.type.includes('end');
            const isInter = n.type.includes('intermediate');
            const strokeColor = isStart ? '#16a34a' : isEnd ? '#dc2626' : '#d97706';
            const strokeW = isFullView ? (isEnd ? 3.5 : isStart ? 1.8 : 1.5) : 1.5;
            return (
              <g key={n.id}>
                <circle
                  cx={x + w / 2}
                  cy={y + r}
                  r={r - 1}
                  fill={col.fill}
                  stroke={strokeColor}
                  strokeWidth={strokeW}
                />
                {isInter && (
                  <circle
                    cx={x + w / 2}
                    cy={y + r}
                    r={r - 5}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={strokeW}
                  />
                )}
                <text
                  x={x + w / 2}
                  y={y + h + (isFullView ? 14 : 9)}
                  textAnchor="middle"
                  fontSize={isFullView ? 11 : 8 * scale}
                  fontWeight={isFullView ? '600' : 'normal'}
                  fill="#1f2937"
                >
                  {label}
                </text>
              </g>
            );
          }

          // Gateway Nodes (Exclusive / Parallel Split)
          if (n.type?.includes('gateway')) {
            const hw = w / 2;
            const hh = h / 2;
            const mx = x + hw;
            const my = y + hh;
            return (
              <g key={n.id}>
                <polygon
                  points={`${mx},${y} ${x + w},${my} ${mx},${y + h} ${x},${my}`}
                  fill={col.fill}
                  stroke={col.stroke}
                  strokeWidth={isFullView ? 2 : 1}
                />
                <text
                  x={mx}
                  y={y + h + (isFullView ? 14 : 9)}
                  textAnchor="middle"
                  fontSize={isFullView ? 11 : 8 * scale}
                  fontWeight={isFullView ? '600' : 'normal'}
                  fill="#1f2937"
                >
                  {label}
                </text>
              </g>
            );
          }

          // Task Nodes
          const isInferred =
            n.origin === 'inferred' || n.data?.origin === 'inferred';
          const strokeStyle = isInferred ? '#7c3aed' : col.stroke;
          const fillStyle = isInferred ? '#faf5ff' : col.fill;
          const strokeDash = isInferred
            ? isFullView
              ? '4 3'
              : `${4 * scale} ${2 * scale}`
            : undefined;

          return (
            <g key={n.id}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={isFullView ? 6 : 3 * scale}
                fill={fillStyle}
                stroke={strokeStyle}
                strokeWidth={isInferred ? (isFullView ? 2 : 1.5) : isFullView ? 1.5 : 1}
                strokeDasharray={strokeDash}
              />
              <text
                x={x + w / 2}
                y={y + h / 2 + (isFullView ? (isInferred ? -2 : 3) : isInferred ? 0 : 3 * scale)}
                textAnchor="middle"
                fontSize={isFullView ? 11 : 8 * scale}
                fontWeight={isFullView ? '600' : 'normal'}
                fill="#111827"
              >
                {label}
              </text>
              {isInferred && (
                <text
                  x={x + w / 2}
                  y={y + h / 2 + (isFullView ? 12 : 7.5 * scale)}
                  textAnchor="middle"
                  fontSize={isFullView ? 8.5 : 5.5 * scale}
                  fill="#7c3aed"
                  fontWeight="600"
                >
                  AI added · no time
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
