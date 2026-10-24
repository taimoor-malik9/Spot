'use client';

import React, { useCallback, useState } from 'react';
import ReactFlow, {
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  MiniMap,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { StartNode } from './StartNode';
import { TaskNode } from './TaskNode';
import { EndNode } from './EndNode';

// Define nodeTypes outside component to ensure stable reference
const nodeTypes = {
  start: StartNode,
  task: TaskNode,
  end: EndNode,
};

/**
 * ModelCanvas component - BPMN diagram editor using ReactFlow
 * @param {Object} props
 * @param {any[]} [props.nodes] - Initial nodes
 * @param {any[]} [props.edges] - Initial edges
 * @param {Function} [props.onNodesChange] - Callback when nodes change
 * @param {Function} [props.onEdgesChange] - Callback when edges change
 * @param {Function} [props.onNodeSelect] - Callback when node is selected
 * @param {boolean} [props.showGrid] - Show grid background
 */
export function ModelCanvas({
  nodes: initialNodes = [],
  edges: initialEdges = [],
  onNodesChange,
  onEdgesChange,
  onNodeSelect,
  showGrid = true,
}) {
  const [nodes, setNodes, onNodesChange_] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange_] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState(null);

  // Sync external nodes state
  React.useEffect(() => {
    if (onNodesChange) {
      onNodesChange(nodes);
    }
  }, [nodes, onNodesChange]);

  React.useEffect(() => {
    if (onEdgesChange) {
      onEdgesChange(edges);
    }
  }, [edges, onEdgesChange]);

  // Handle connection validation
  const isValidConnection = useCallback((connection) => {
    const sourceNode = nodes.find(n => n.id === connection.source);
    const targetNode = nodes.find(n => n.id === connection.target);

    if (!sourceNode || !targetNode) return false;

    const sourceType = sourceNode.type;
    const targetType = targetNode.type;

    // Start can connect to Task or End
    if (sourceType === 'start') {
      return targetType === 'task' || targetType === 'end';
    }

    // Task can connect to Task or End
    if (sourceType === 'task') {
      return targetType === 'task' || targetType === 'end';
    }

    // End cannot have outgoing connections
    if (sourceType === 'end') {
      return false;
    }

    return false;
  }, [nodes]);

  const handleConnect = useCallback(
    (connection) => {
      if (isValidConnection(connection)) {
        setEdges(eds => addEdge(connection, eds));
      }
    },
    [setEdges, isValidConnection]
  );

  const handleNodeClick = useCallback(
    (event, node) => {
      setSelectedNode(node);
      onNodeSelect?.(node);
    },
    [onNodeSelect]
  );

  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
    onNodeSelect?.(null);
  }, [onNodeSelect]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange_}
        onEdgesChange={onEdgesChange_}
        onConnect={handleConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        isValidConnection={isValidConnection}
        defaultEdgeOptions={{ animated: true }}
      >
        {/* Grid Background - Conditional rendering for proper visibility */}
        {showGrid ? (
          <Background 
            variant="dots"
            gap={20}
            size={1.5}
            color="#b0b0b0"
            style={{
              backgroundColor: '#ffffff',
            }}
          />
        ) : (
          <Background 
            style={{
              backgroundColor: '#ffffff',
            }}
          />
        )}
        
        <Controls />
        <MiniMap />

        {/* Empty State Overlay */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 bg-transparent flex-col pb-20">
            <div className="text-center flex flex-col items-center">
              {/* Custom SVG Icon to match the design (Pointer with rays) */}
              <svg width="60" height="60" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg" className="mb-6 opacity-60">
                {/* Mouse Cursor */}
                <path d="M28 28L46 34L35.5 37.5L39.5 48L33 50.5L29.5 40L20 44L28 28Z" stroke="#94A3B8" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                {/* Rays (top left) */}
                <path d="M12 12L20 20" stroke="#94A3B8" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14 28L6 28" stroke="#94A3B8" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M28 14L28 6" stroke="#94A3B8" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <p className="text-[22px] text-[#A0AABF] font-medium tracking-wide mb-3">
                Drag and drop BPMN elements here
              </p>
              <p className="text-[15px] text-[#A0AABF] font-normal">
                Or use AI to model your process
              </p>
            </div>
          </div>
        )}
      </ReactFlow>
    </div>
  );
}
