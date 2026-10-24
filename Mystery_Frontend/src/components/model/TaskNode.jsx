'use client';

import { memo } from 'react';
import { Handle, Position } from 'reactflow';

/**
 * TaskNode component
 * @param {Object} props
 * @param {any} props.data - Node data
 * @param {boolean} props.isConnecting - Is currently connecting
 * @param {boolean} props.selected - Is selected
 */
function TaskNodeComponent({ data, isConnecting, selected }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-1 rounded border-2 px-4 py-3 transition-all ${
        selected
          ? 'border-blue-500 bg-blue-50 shadow-lg'
          : 'border-slate-300 bg-white shadow'
      } ${isConnecting ? 'cursor-copy' : 'cursor-pointer'}`}
    >
      <Handle type="input" position={Position.Left} />
      <div className="text-center">
        <p className="text-xs font-semibold text-slate-700">{data.label}</p>
        {data.duration && (
          <p className="text-xs text-slate-500">{Math.round(data.duration / 60)}m</p>
        )}
      </div>
      <Handle type="output" position={Position.Right} />
    </div>
  );
}

export const TaskNode = memo(TaskNodeComponent);
