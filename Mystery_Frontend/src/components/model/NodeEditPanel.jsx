'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * PropertiesPanel component - Edit properties for a selected BPMN element
 * Implements the Properties Panel (Right Contextual Panel) from the Design System
 * @param {Object} props
 * @param {any} props.node - The selected node
 * @param {Function} [props.onUpdate] - Callback when element is updated
 * @param {Function} [props.onClose] - Callback when panel is closed
 */
export function NodeEditPanel({ node, onUpdate, onClose }) {
  const [label, setLabel] = useState('');
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [documentation, setDocumentation] = useState('');

  useEffect(() => {
    if (node) {
      setLabel(node.data?.label || '');
      setX(String(node.position?.x || 0));
      setY(String(node.position?.y || 0));
      setDocumentation(node.data?.documentation || '');
    }
  }, [node]);

  if (!node) return null;

  const handleSave = () => {
    const updatedNode = {
      ...node,
      position: {
        x: parseInt(x) || 0,
        y: parseInt(y) || 0,
      },
      data: {
        ...node.data,
        label: label || node.data.label,
        documentation,
      },
    };
    onUpdate?.(updatedNode);
  };

  const getElementTypeDisplay = (type) => {
    return type
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <div className="w-64 border-l border-gray-200 bg-white overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-800">Properties</h3>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 transition-colors text-gray-600"
          title="Close panel"
        >
          <X size={16} />
        </button>
      </div>

      {/* Form Content */}
      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        {/* Element ID Field (Read-only) */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Element ID
          </label>
          <input
            type="text"
            disabled
            value={node.id}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm bg-gray-50 text-gray-600 cursor-not-allowed"
          />
        </div>

        {/* Label Field (Editable) */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Label
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Enter element name"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Type Field (Read-only) */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Type
          </label>
          <input
            type="text"
            disabled
            value={getElementTypeDisplay(node.type)}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm bg-gray-50 text-gray-600 cursor-not-allowed"
          />
        </div>

        {/* Position Fields Grid */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              X Position
            </label>
            <input
              type="number"
              value={x}
              onChange={(e) => setX(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Y Position
            </label>
            <input
              type="number"
              value={y}
              onChange={(e) => setY(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Documentation Section */}
        <div className="pt-4 border-t border-gray-200">
          <label className="block text-xs font-medium text-gray-700 mb-2">
            Documentation
          </label>
          <textarea
            value={documentation}
            onChange={(e) => setDocumentation(e.target.value)}
            placeholder="Add documentation..."
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
          />
        </div>
      </div>

      {/* Footer - Save Button */}
      <div className="px-4 py-3 border-t border-gray-200 flex-shrink-0 bg-gray-50">
        <button
          onClick={handleSave}
          className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          Save Changes
        </button>
      </div>
    </div>
  );
}
