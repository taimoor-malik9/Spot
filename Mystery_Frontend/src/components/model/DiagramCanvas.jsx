'use client';

import React from 'react';
import { NW, NH, POOL_LANE_HDR, LANE_HDR, poolLanes } from './bpmnGeometry';
import { Shape } from './BpmnShape';
import { DiagramEdge as Edge } from './DiagramEdge';

export { poolLanes };

/**
 * Shared BPMN diagram canvas component for Model and Simulate pages.
 * Renders pools, lanes, edges, shapes, and annotations identically across both views.
 */
export function DiagramCanvas({
  elements = [],
  connections = [],
  zoom = 1,
  pan = { x: 0, y: 0 },
  readOnly = false,
  selectedId = null,
  selectedConnId = null,
  onNodeClick = null,
  onNodeDoubleClick = null,
  onEdgeClick = null,
  onCanvasClick = null,
  renderNodeOverlay = null,
  renderCanvasOverlay = null,
  activeEdgeSet = null,

  // Edit-mode specific props (used when !readOnly)
  onNodeDown = null,
  hoveredId = null,
  setHoveredId = null,
  padTargetId = null,
  drawConn = null,
  tempLine = null,
  connMode = 'sequence-flow',
  allSelected = false,
  multiSel = null,
  editId = null,
  editText = '',
  setEditText = null,
  saveEdit = null,
  setEditId = null,
  startEdit = null,
  setCtxMenu = null,
  beginResize = null,
  RectResizeHandles = null,
  ContextPad = null,
  SwimlaneContextPad = null,
  GatewayPopover = null,
  showPadOn = null,
  openGatewayId = null,
  setOpenGatewayId = null,
  updateConnectionProbability = null,
  addLaneToPoolEnd = null,
  addDividePoolLanes = null,
  addLaneAdjacentToLane = null,
  setElements = null,
  setConnections = null,
  setSelId = null,
  handleDeleteElements = null,
  showMsg = null,
  lasso = null,
  beginConnBendDrag = null,
  beginConnEndpointDrag = null,
  className = '',
  style = {},
}) {
  const multiSelSet = multiSel || new Set();

  return (
    <svg
      className={`absolute inset-0 w-full h-full ${className}`}
      style={{ overflow: 'visible', ...style }}
      onClick={e => {
        if (e.target === e.currentTarget || e.target.tagName === 'svg') {
          onCanvasClick?.(e);
        }
      }}
    >
      <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>

        {/* ── Swimlanes: Pools ── */}
        {[...elements.filter(e => e.type === 'pool')]
          .sort((a, b) => (a.id === padTargetId ? 1 : 0) - (b.id === padTargetId ? 1 : 0))
          .map(pool => {
            const px = pool.position.x, py = pool.position.y;
            const W = pool.width ?? 600, H = pool.height ?? 150;
            const rawLanes = poolLanes(elements, pool.id);
            const lanes = rawLanes.length >= 2 ? rawLanes : [];
            const isSel = allSelected || selectedId === pool.id || multiSelSet.has(pool.id);

            return (
              <g
                key={pool.id}
                onMouseEnter={() => setHoveredId?.(pool.id)}
                onMouseLeave={() => setHoveredId?.(null)}
              >
                <g
                  style={{ cursor: readOnly ? 'default' : 'move' }}
                  onMouseDown={e => {
                    if (!readOnly && onNodeDown) onNodeDown(e, pool.id);
                  }}
                  onClick={e => {
                    if (readOnly) onNodeClick?.(pool, e);
                  }}
                  onDoubleClick={e => {
                    e.stopPropagation();
                    if (!readOnly && startEdit) startEdit(pool.id);
                    else onNodeDoubleClick?.(pool, e);
                  }}
                  onContextMenu={e => {
                    if (!readOnly && setCtxMenu) {
                      e.preventDefault();
                      e.stopPropagation();
                      setCtxMenu({ x: e.clientX, y: e.clientY, id: pool.id });
                    }
                  }}
                >
                  <rect
                    x={px} y={py} width={W} height={H} rx="3"
                    fill="white"
                    stroke={isSel ? '#4b5563' : '#9ca3af'}
                    strokeWidth={isSel ? 2 : 1.5}
                  />
                  <rect
                    x={px + 1.5} y={py + 1.5} width={POOL_LANE_HDR - 1.5} height={H - 3}
                    fill="#e5e7eb" stroke="none" rx="2"
                  />
                  <line
                    x1={px + POOL_LANE_HDR} y1={py + 1}
                    x2={px + POOL_LANE_HDR} y2={py + H - 1}
                    stroke={isSel ? '#4b5563' : '#9ca3af'}
                    strokeWidth="1.5"
                  />
                  <foreignObject x={px} y={py} width={POOL_LANE_HDR} height={H}>
                    <div
                      style={{
                        width: H,
                        height: POOL_LANE_HDR,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transform: `rotate(-90deg) translateX(-${H}px)`,
                        transformOrigin: '0 0',
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#374151',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        pointerEvents: 'none',
                        userSelect: 'none',
                      }}
                    >
                      {pool.label.length > 14 ? pool.label.slice(0, 13) + '…' : pool.label}
                    </div>
                  </foreignObject>
                </g>

                {lanes.map((lane, laneIdx) => {
                  const n = lanes.length;
                  const lH = Math.round(H / n);
                  const lW = Math.max(48, W - POOL_LANE_HDR - LANE_HDR);
                  const lx = px + POOL_LANE_HDR + LANE_HDR;
                  const ly = py + laneIdx * lH;
                  const lSel = allSelected || selectedId === lane.id || multiSelSet.has(lane.id);
                  const lhx = px + POOL_LANE_HDR;

                  return (
                    <g
                      key={lane.id}
                      onMouseEnter={() => setHoveredId?.(lane.id)}
                      onMouseLeave={() => setHoveredId?.(null)}
                      style={{ cursor: 'default' }}
                      onMouseDown={e => {
                        if (!readOnly && onNodeDown) onNodeDown(e, lane.id);
                      }}
                      onClick={e => {
                        if (readOnly) onNodeClick?.(lane, e);
                      }}
                      onDoubleClick={e => {
                        e.stopPropagation();
                        if (!readOnly && startEdit) startEdit(lane.id);
                        else onNodeDoubleClick?.(lane, e);
                      }}
                      onContextMenu={e => {
                        if (!readOnly && setCtxMenu) {
                          e.preventDefault();
                          e.stopPropagation();
                          setCtxMenu({ x: e.clientX, y: e.clientY, id: lane.id });
                        }
                      }}
                    >
                      {laneIdx > 0 && (
                        <line
                          x1={px + POOL_LANE_HDR} y1={ly}
                          x2={px + W} y2={ly}
                          stroke={isSel ? '#4b5563' : '#9ca3af'}
                          strokeWidth={isSel ? 2 : 1.5}
                        />
                      )}
                      <rect
                        x={lhx + 1} y={ly} width={LANE_HDR - 1} height={lH}
                        fill={lSel ? '#dbeafe' : '#f3f4f6'} stroke="none"
                      />
                      <line
                        x1={lhx + LANE_HDR} y1={ly}
                        x2={lhx + LANE_HDR} y2={ly + lH}
                        stroke="#9ca3af" strokeWidth="1"
                      />
                      <rect
                        x={lx} y={ly} width={lW} height={lH}
                        fill={lSel ? '#f0f9ff' : 'transparent'} stroke="none"
                      />
                      <foreignObject x={lhx} y={ly} width={LANE_HDR} height={lH}>
                        <div
                          style={{
                            width: lH,
                            height: LANE_HDR,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transform: `rotate(-90deg) translateX(-${lH}px)`,
                            transformOrigin: '0 0',
                            fontSize: 11,
                            fontWeight: 500,
                            color: '#374151',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            pointerEvents: 'none',
                            userSelect: 'none',
                          }}
                        >
                          {lane.label.length > 14 ? lane.label.slice(0, 13) + '…' : lane.label}
                        </div>
                      </foreignObject>

                      {!readOnly && editId === lane.id && (
                        <foreignObject x={lx + 4} y={ly + 6} width={Math.max(60, lW - 8)} height="26">
                          <input
                            autoFocus
                            value={editText}
                            onChange={e => setEditText?.(e.target.value)}
                            onBlur={() => saveEdit?.(lane.id)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveEdit?.(lane.id);
                              if (e.key === 'Escape') {
                                setEditId?.(null);
                                setEditText?.('');
                              }
                            }}
                            onClick={e => e.stopPropagation()}
                            style={{
                              width: '100%',
                              fontSize: 11,
                              border: '1.5px solid #0284c7',
                              borderRadius: 4,
                              padding: '2px 4px',
                              background: 'white',
                              outline: 'none',
                            }}
                          />
                        </foreignObject>
                      )}
                    </g>
                  );
                })}

                {!readOnly && editId === pool.id && (
                  <foreignObject x={px + 38} y={py + 10} width={Math.max(80, W - 48)} height="26">
                    <input
                      autoFocus
                      value={editText}
                      onChange={e => setEditText?.(e.target.value)}
                      onBlur={() => saveEdit?.(pool.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveEdit?.(pool.id);
                        if (e.key === 'Escape') {
                          setEditId?.(null);
                          setEditText?.('');
                        }
                      }}
                      onClick={e => e.stopPropagation()}
                      style={{
                        width: '100%',
                        fontSize: 11,
                        border: '1.5px solid #0284c7',
                        borderRadius: 4,
                        padding: '2px 4px',
                        background: 'white',
                        outline: 'none',
                      }}
                    />
                  </foreignObject>
                )}

                <rect
                  x={px} y={py} width={W} height={H} rx="3" fill="none"
                  stroke={isSel ? '#4b5563' : '#9ca3af'} strokeWidth={isSel ? 2 : 1.5}
                  pointerEvents="none"
                />
              </g>
            );
          })}

        {/* ── Standalone Lanes ── */}
        {[...elements.filter(e => e.type === 'lane' && !e.poolId)]
          .sort((a, b) => (a.id === padTargetId ? 1 : 0) - (b.id === padTargetId ? 1 : 0))
          .map(lane => {
            const lx = lane.position.x, ly = lane.position.y, lW = lane.width ?? 500, lH = lane.height ?? 100;
            const lSel = allSelected || selectedId === lane.id || multiSelSet.has(lane.id);

            return (
              <g
                key={lane.id}
                onMouseEnter={() => setHoveredId?.(lane.id)}
                onMouseLeave={() => setHoveredId?.(null)}
                style={{ cursor: readOnly ? 'default' : 'move' }}
                onMouseDown={e => {
                  if (!readOnly && onNodeDown) onNodeDown(e, lane.id);
                }}
                onClick={e => {
                  if (readOnly) onNodeClick?.(lane, e);
                }}
                onDoubleClick={e => {
                  e.stopPropagation();
                  if (!readOnly && startEdit) startEdit(lane.id);
                  else onNodeDoubleClick?.(lane, e);
                }}
                onContextMenu={e => {
                  if (!readOnly && setCtxMenu) {
                    e.preventDefault();
                    e.stopPropagation();
                    setCtxMenu({ x: e.clientX, y: e.clientY, id: lane.id });
                  }
                }}
              >
                <rect
                  x={lx} y={ly} width={lW} height={lH} rx="3"
                  fill="#f3f4f6" stroke={lSel ? '#6b7280' : '#9ca3af'} strokeWidth={lSel ? 2.5 : 1.5}
                />
                <rect
                  x={lx} y={ly} width={POOL_LANE_HDR} height={lH}
                  fill="#e5e7eb" stroke="none"
                />
                <line
                  x1={lx + POOL_LANE_HDR} y1={ly}
                  x2={lx + POOL_LANE_HDR} y2={ly + lH}
                  stroke={lSel ? '#6b7280' : '#9ca3af'} strokeWidth={lSel ? 2.5 : 1.5}
                />
                <foreignObject x={lx} y={ly} width={POOL_LANE_HDR} height={lH}>
                  <div
                    style={{
                      width: lH,
                      height: POOL_LANE_HDR,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transform: `rotate(-90deg) translateX(-${lH}px)`,
                      transformOrigin: '0 0',
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#374151',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      pointerEvents: 'none',
                      userSelect: 'none',
                    }}
                  >
                    {lane.label.length > 14 ? lane.label.slice(0, 13) + '…' : lane.label}
                  </div>
                </foreignObject>

                {!readOnly && editId === lane.id && (
                  <foreignObject x={lx + 38} y={ly + 10} width={Math.max(80, lW - 48)} height="26">
                    <input
                      autoFocus
                      value={editText}
                      onChange={e => setEditText?.(e.target.value)}
                      onBlur={() => saveEdit?.(lane.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveEdit?.(lane.id);
                        if (e.key === 'Escape') {
                          setEditId?.(null);
                          setEditText?.('');
                        }
                      }}
                      onClick={e => e.stopPropagation()}
                      style={{
                        width: '100%',
                        fontSize: 11,
                        border: '1.5px solid #0284c7',
                        borderRadius: 4,
                        padding: '2px 4px',
                        background: 'white',
                        outline: 'none',
                      }}
                    />
                  </foreignObject>
                )}

                {!readOnly && lSel && RectResizeHandles && (
                  <RectResizeHandles
                    x={lx} y={ly} w={lW} h={lH} visible
                    onResizeStart={(e, h) => beginResize?.(e, lane.id, h)}
                  />
                )}
              </g>
            );
          })}

        {/* ── Edges ── */}
        {connections.map(conn => {
          const fromKey = conn.fromId ?? conn.from;
          const toKey = conn.toId ?? conn.to;
          const isAct = activeEdgeSet ? activeEdgeSet.has(`${fromKey}__${toKey}`) : false;
          const isSel = allSelected || selectedConnId === conn.id;

          return (
            <Edge
              key={conn.id || `${fromKey}-${toKey}`}
              conn={conn}
              elements={elements}
              connections={connections}
              selected={isSel}
              active={isAct}
              interactive={!readOnly}
              onBendStart={beginConnBendDrag}
              onEndpointDrag={beginConnEndpointDrag}
              onClick={id => {
                if (onEdgeClick) onEdgeClick(id);
              }}
            />
          );
        })}

        {/* ── Temp Connection Line (Model page only) ── */}
        {!readOnly && tempLine && (
          <g style={{ pointerEvents: 'none' }}>
            <line
              x1={tempLine.x1} y1={tempLine.y1}
              x2={tempLine.x2} y2={tempLine.y2}
              stroke={connMode === 'message-flow' ? '#7c3aed' : '#0284c7'}
              strokeWidth="2"
              strokeDasharray="7 4"
              opacity="0.85"
            />
            <circle
              cx={tempLine.x2} cy={tempLine.y2} r="5"
              fill={connMode === 'message-flow' ? '#7c3aed' : '#0284c7'}
              opacity="0.7"
            />
          </g>
        )}

        {/* ── BPMN Nodes & Shapes ── */}
        {[...elements.filter(e => e.type !== 'pool' && e.type !== 'lane')]
          .sort((a, b) => (a.id === padTargetId ? 1 : 0) - (b.id === padTargetId ? 1 : 0))
          .map(el => {
            const isSel = allSelected || selectedId === el.id || multiSelSet.has(el.id);
            const isTarget = !readOnly && drawConn && !drawConn.pendingFromPalette && drawConn.fromId !== el.id;
            const nodeW = el.width || NW;
            const nodeH = el.height || NH;
            const isTask = el.type === 'task' || el.type === 'subprocess';
            const isGateway = el.type.includes('gateway');
            const isSelectable = readOnly ? (isTask || isGateway) : true;

            return (
              <g
                key={el.id}
                transform={`translate(${el.position.x},${el.position.y})`}
                style={{
                  cursor: readOnly
                    ? (isSelectable ? 'pointer' : 'default')
                    : (drawConn ? 'crosshair' : 'move')
                }}
                onMouseDown={e => {
                  if (!readOnly && onNodeDown) onNodeDown(e, el.id);
                }}
                onClick={e => {
                  if (readOnly && onNodeClick) {
                    e.stopPropagation();
                    onNodeClick(el, e);
                  }
                }}
                onMouseEnter={() => setHoveredId?.(el.id)}
                onMouseLeave={() => setHoveredId?.(null)}
                onDoubleClick={e => {
                  e.stopPropagation();
                  if (!readOnly && startEdit) startEdit(el.id);
                  else onNodeDoubleClick?.(el, e);
                }}
                onContextMenu={e => {
                  if (!readOnly && setCtxMenu) {
                    e.preventDefault();
                    e.stopPropagation();
                    setCtxMenu({ x: e.clientX, y: e.clientY, id: el.id });
                  }
                }}
              >
                {/* Target connect highlight */}
                {isTarget && (
                  <rect
                    x="-5" y="-5" width={nodeW + 10} height={nodeH + 10} rx="8"
                    fill="none" stroke="#22c55e" strokeWidth="2" strokeDasharray="5 3" opacity="0.9"
                  />
                )}

                {/* Text Annotation or BPMN Shape */}
                {el.type === 'annotation' ? (
                  <g>
                    <line x1="0" y1="0" x2="0" y2={nodeH} stroke={isSel ? '#0284c7' : '#4b5563'} strokeWidth={isSel ? 2.4 : 2} />
                    <line x1="0" y1="0" x2="14" y2="0" stroke={isSel ? '#0284c7' : '#4b5563'} strokeWidth={isSel ? 2.4 : 2} />
                    <line x1="0" y1={nodeH} x2="14" y2={nodeH} stroke={isSel ? '#0284c7' : '#4b5563'} strokeWidth={isSel ? 2.4 : 2} />
                    {!readOnly && editId === el.id ? (
                      <foreignObject x="18" y="2" width={Math.max(80, nodeW - 22)} height={Math.max(50, nodeH - 4)}>
                        <textarea
                          autoFocus
                          value={editText}
                          onChange={e => setEditText?.(e.target.value)}
                          onBlur={() => saveEdit?.(el.id)}
                          onKeyDown={e => {
                            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') saveEdit?.(el.id);
                            if (e.key === 'Escape') {
                              setEditId?.(null);
                              setEditText?.('');
                            }
                          }}
                          onClick={e => e.stopPropagation()}
                          style={{
                            width: '100%',
                            height: '100%',
                            resize: 'none',
                            fontSize: 11,
                            lineHeight: 1.35,
                            border: '1.5px solid #0284c7',
                            borderRadius: 4,
                            padding: '4px 6px',
                            background: 'white',
                            outline: 'none',
                            fontFamily: 'Inter, system-ui, sans-serif',
                          }}
                        />
                      </foreignObject>
                    ) : (
                      <foreignObject x="18" y="2" width={Math.max(80, nodeW - 22)} height={Math.max(50, nodeH - 4)}>
                        <div
                          style={{
                            width: '100%',
                            height: '100%',
                            overflow: 'hidden',
                            color: '#374151',
                            fontSize: 11,
                            lineHeight: 1.35,
                            fontFamily: 'Inter, system-ui, sans-serif',
                            userSelect: 'none',
                            pointerEvents: 'none',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {el.label || 'Text Annotation'}
                        </div>
                      </foreignObject>
                    )}
                  </g>
                ) : (
                  <Shape type={el.type} sel={isSel} w={nodeW} h={nodeH} />
                )}

                {/* Resize handles in Model page */}
                {!readOnly && isSel && RectResizeHandles && (
                  <RectResizeHandles
                    x={0} y={0} w={nodeW} h={nodeH} visible
                    onResizeStart={(e, h) => beginResize?.(e, el.id, h)}
                  />
                )}

                {/* Inline Label or Text Editing */}
                {!readOnly && editId === el.id ? (
                  el.type === 'annotation' ? null : (
                    <foreignObject
                      x={nodeW / 2 - 64}
                      y={isTask ? nodeH / 2 - 14 : nodeH + 3}
                      width={128}
                      height="28"
                    >
                      <input
                        autoFocus
                        value={editText}
                        onChange={e => setEditText?.(e.target.value)}
                        onBlur={() => saveEdit?.(el.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveEdit?.(el.id);
                          if (e.key === 'Escape') {
                            setEditId?.(null);
                            setEditText?.('');
                          }
                        }}
                        onClick={e => e.stopPropagation()}
                        style={{
                          width: '100%',
                          fontSize: 11,
                          textAlign: 'center',
                          border: '1.5px solid #0284c7',
                          borderRadius: 4,
                          padding: '2px 4px',
                          background: 'white',
                          outline: 'none',
                        }}
                      />
                    </foreignObject>
                  )
                ) : (
                  el.type === 'annotation' ? null : isTask ? (
                    <foreignObject x={8} y={18} width={Math.max(1, nodeW - 16)} height={Math.max(1, nodeH - 32)}>
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 9,
                          fontWeight: isSel ? 700 : 600,
                          color: isSel ? '#0284c7' : '#374151',
                          textAlign: 'center',
                          lineHeight: 1.1,
                          pointerEvents: 'none',
                          userSelect: 'none',
                          overflow: 'hidden',
                        }}
                      >
                        <span
                          style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {el.label}
                        </span>
                      </div>
                    </foreignObject>
                  ) : (
                    <text
                      x={nodeW / 2}
                      y={nodeH + 13}
                      textAnchor="middle"
                      fontSize="11"
                      fill={isSel ? '#0284c7' : '#374151'}
                      fontWeight={isSel ? '600' : '500'}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {(el.label || '').length > 15 ? el.label.slice(0, 14) + '…' : el.label}
                    </text>
                  )
                )}

                {/* Warning dot on gateway if outgoing probs not configured */}
                {(el.type === 'exclusive-gateway' || el.type === 'inclusive-gateway' || el.type === 'gateway') && (() => {
                  const outgoing = connections.filter(c => (c.fromId === el.id || c.from === el.id));
                  const needsSetup = outgoing.length >= 2 && outgoing.every(c => c.probability == null);
                  if (!needsSetup) return null;
                  return (
                    <g style={{ pointerEvents: 'none' }}>
                      <circle cx={nodeW - 6} cy={6} r={7} fill="#f59e0b" stroke="white" strokeWidth="1.5" />
                      <text x={nodeW - 6} y={10} textAnchor="middle" fontSize="9" fill="white" fontWeight="bold">!</text>
                    </g>
                  );
                })()}

                {/* "click to configure paths" hint below gateway in edit mode */}
                {!readOnly && (el.type === 'exclusive-gateway' || el.type === 'inclusive-gateway' || el.type === 'gateway') && !editId && (
                  <text
                    x={nodeW / 2}
                    y={nodeH + 26}
                    textAnchor="middle"
                    fontSize="9"
                    fill="#94a3b8"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    click to configure paths
                  </text>
                )}

                {/* Context pad if enabled */}
                {!readOnly && showPadOn && showPadOn(el) && ContextPad && (
                  <ContextPad
                    el={el}
                    elements={elements}
                    connections={connections}
                    setElements={setElements}
                    setConnections={setConnections}
                    setSelId={setSelId}
                    coords="local"
                    connMode={connMode}
                    onDelete={() => handleDeleteElements?.([el.id])}
                    onRename={() => startEdit?.(el.id)}
                    showMsg={showMsg}
                  />
                )}

                {/* Custom node overlay slot (Simulate token count, status badges, bottleneck rings, etc.) */}
                {renderNodeOverlay && renderNodeOverlay(el, { isSel, nodeW, nodeH })}
              </g>
            );
          })}

        {/* ── Gateway Popover ── */}
        {!readOnly && openGatewayId && GatewayPopover && (() => {
          const gw = elements.find(e => e.id === openGatewayId);
          const outgoing = connections.filter(c => (c.fromId === openGatewayId || c.from === openGatewayId));
          if (!gw || outgoing.length < 2) return null;
          return (
            <GatewayPopover
              key={openGatewayId}
              gateway={gw}
              connections={outgoing}
              onUpdateProbability={updateConnectionProbability}
              onClose={() => setOpenGatewayId?.(null)}
            />
          );
        })()}

        {/* ── Swimlane Overlays: Resize Handles + Context Pads ── */}
        {!readOnly && elements.filter(e => e.type === 'pool').map(pool => {
          const px = pool.position.x, py = pool.position.y;
          const W = pool.width ?? 600, H = pool.height ?? 150;
          const isSel = allSelected || selectedId === pool.id;
          const showPoolPad = !allSelected && padTargetId === pool.id && !drawConn && !editId;
          if (!isSel && !showPoolPad) return null;
          return (
            <g key={`overlay-pool-${pool.id}`} style={{ pointerEvents: 'none' }}>
              {isSel && RectResizeHandles && (
                <g style={{ pointerEvents: 'all' }}>
                  <RectResizeHandles
                    x={px} y={py} w={W} h={H} visible
                    onResizeStart={(e, h) => beginResize?.(e, pool.id, h)}
                  />
                </g>
              )}
              {showPoolPad && SwimlaneContextPad && (
                <g style={{ pointerEvents: 'all' }}>
                  <SwimlaneContextPad
                    ox={px + W + 8}
                    oy={py + 4}
                    variant="pool"
                    onAddAbove={() => {
                      if (addLaneToPoolEnd) {
                        const [next, nid] = addLaneToPoolEnd(elements, pool.id, true);
                        setElements?.(next);
                        if (nid) setSelId?.(nid);
                      }
                    }}
                    onDivide={() => {
                      if (addDividePoolLanes) {
                        const [next, nid] = addDividePoolLanes(elements, pool.id);
                        setElements?.(next);
                        if (nid) setSelId?.(nid);
                      }
                    }}
                    onAddBelow={() => {
                      if (addLaneToPoolEnd) {
                        const [next, nid] = addLaneToPoolEnd(elements, pool.id, false);
                        setElements?.(next);
                        if (nid) setSelId?.(nid);
                      }
                    }}
                    onRename={() => startEdit?.(pool.id)}
                    onDelete={() => handleDeleteElements?.([pool.id])}
                  />
                </g>
              )}
            </g>
          );
        })}

        {!readOnly && elements.filter(e => e.type === 'lane').map(lane => {
          const parentPool = lane.poolId ? elements.find(e => e.id === lane.poolId) : null;
          let lx, ly, lW, lH;
          if (parentPool) {
            const siblings = poolLanes(elements, parentPool.id);
            const n = siblings.length;
            const idx = siblings.findIndex(l => l.id === lane.id);
            const pH = parentPool.height ?? 220, pW = parentPool.width ?? 600;
            lH = Math.round(pH / n);
            lW = Math.max(48, pW - POOL_LANE_HDR - LANE_HDR);
            lx = parentPool.position.x + POOL_LANE_HDR + LANE_HDR;
            ly = parentPool.position.y + idx * lH;
          } else {
            lx = lane.position.x;
            ly = lane.position.y;
            lW = lane.width ?? 500;
            lH = lane.height ?? 100;
          }
          const lSel = allSelected || selectedId === lane.id;
          const showLanePad = !allSelected && padTargetId === lane.id && !drawConn && !editId;
          if (!lSel && !showLanePad) return null;

          return (
            <g key={`overlay-lane-${lane.id}`} style={{ pointerEvents: 'none' }}>
              {lSel && RectResizeHandles && (
                <g style={{ pointerEvents: 'all' }}>
                  <RectResizeHandles
                    x={lx} y={ly} w={lW} h={lH} visible
                    onResizeStart={(e, h) => beginResize?.(e, lane.id, h)}
                  />
                </g>
              )}
              {showLanePad && SwimlaneContextPad && (
                <g style={{ pointerEvents: 'all' }}>
                  <SwimlaneContextPad
                    ox={lx + lW + 8}
                    oy={ly + 4}
                    variant={lane.poolId ? 'lane-in-pool' : 'lane-standalone'}
                    onAddAbove={() => {
                      if (lane.poolId && addLaneAdjacentToLane) {
                        const [next, nid] = addLaneAdjacentToLane(elements, lane.id, true);
                        setElements?.(next);
                        if (nid) setSelId?.(nid);
                      }
                    }}
                    onAddBelow={() => {
                      if (lane.poolId && addLaneAdjacentToLane) {
                        const [next, nid] = addLaneAdjacentToLane(elements, lane.id, false);
                        setElements?.(next);
                        if (nid) setSelId?.(nid);
                      }
                    }}
                    onDivide={() => {}}
                    onRename={() => startEdit?.(lane.id)}
                    onDelete={() => handleDeleteElements?.([lane.id])}
                  />
                </g>
              )}
            </g>
          );
        })}

        {/* ── Custom Canvas Overlay (Moving tokens, etc.) ── */}
        {renderCanvasOverlay?.()}

        {/* ── Selection Lasso ── */}
        {!readOnly && lasso && (
          <rect
            x={Math.min(lasso.start.x, lasso.end.x)}
            y={Math.min(lasso.start.y, lasso.end.y)}
            width={Math.abs(lasso.end.x - lasso.start.x)}
            height={Math.abs(lasso.end.y - lasso.start.y)}
            fill="rgba(2, 132, 199, 0.1)"
            stroke="#0284c7"
            strokeWidth="1.5"
            strokeDasharray="4 4"
            pointerEvents="none"
          />
        )}
      </g>
    </svg>
  );
}

export default DiagramCanvas;
