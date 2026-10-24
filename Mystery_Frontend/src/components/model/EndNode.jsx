'use client';

import { memo } from 'react';
import { Handle, Position } from 'reactflow';

/**
 * EndNode component
 * @param {Object} props
 * @param {any} props.data - Node data
 * @param {boolean} props.isConnecting - Is currently connecting
 * @param {boolean} props.selected - Is selected
 */
function EndNodeComponent({ data, isConnecting, selected }) {
  return (
    <div
      className={`flex h-16 w-16 items-center justify-center rounded-full border-2 transition-all ${
        selected
          ? 'border-blue-500 bg-blue-50 shadow-lg'
          : 'border-slate-300 bg-white shadow'
      } ${isConnecting ? 'cursor-copy' : ''}`}
    >
      <Handle type="input" position={Position.Left} />
      <span className="text-xs font-semibold text-slate-700">{data.label}</span>
    </div>
  );
}

export const EndNode = memo(EndNodeComponent);
