'use client';

import { useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import {
  BPMN_CATEGORIES,
  BPMN_ELEMENTS_BY_CATEGORY,
  getCategoryDisplayName,
  getBasicElements,
  getAdvancedElements,
} from '@/data/bpmnElements';

/**
 * BPMNPalette component - Draggable BPMN element palette
 * Implements the BPMN Sidebar (Left Panel) from the Design System
 */
export function BPMNPalette() {
  const [expandedCategories, setExpandedCategories] = useState(
    new Set(['events', 'activities', 'gateways', 'flows'])
  );
  const [showAdvancedPerCategory, setShowAdvancedPerCategory] = useState(
    new Map(BPMN_CATEGORIES.map(cat => [cat, false]))
  );

  const toggleCategory = (categoryId) => {
    setExpandedCategories(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(categoryId)) {
        newExpanded.delete(categoryId);
      } else {
        newExpanded.add(categoryId);
      }
      return newExpanded;
    });
  };

  const toggleAdvanced = (categoryId) => {
    setShowAdvancedPerCategory(prev => {
      const newMap = new Map(prev);
      newMap.set(categoryId, !newMap.get(categoryId));
      return newMap;
    });
  };

  const handleDragStart = (e, element) => {
    const data = {
      type: element.type,
      label: element.label,
    };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/reactflow', JSON.stringify(data));
  };

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden" style={{ scrollbarWidth: 'thin' }}>
      {/* Header */}
      <div className="px-3 py-3 border-b border-gray-100 sticky top-0 bg-white z-10">
        <h2 className="text-sm font-semibold text-gray-900">BPMN Elements</h2>
      </div>

      {/* Categories */}
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-2 p-2">
          {BPMN_CATEGORIES.map((categoryId) => {
            const isExpanded = expandedCategories.has(categoryId);
            const showAdvanced = showAdvancedPerCategory.get(categoryId);
            const basicElements = getBasicElements(categoryId);
            const advancedElements = getAdvancedElements(categoryId);
            const categoryName = getCategoryDisplayName(categoryId);

            return (
              <div key={categoryId} className="border-b border-gray-200 pb-2">
                {/* Category Header Button */}
                <button
                  onClick={() => toggleCategory(categoryId)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors text-left group rounded-lg"
                >
                  <ChevronDown
                    size={16}
                    strokeWidth={2}
                    className={`flex-shrink-0 text-gray-500 transition-transform duration-200 ${
                      isExpanded ? 'rotate-0' : '-rotate-90'
                    }`}
                  />
                  <span className="text-xs font-semibold text-gray-800 flex-1">
                    {categoryName}
                  </span>
                </button>

                {/* Category Items */}
                {isExpanded && (
                  <div className="ml-2 mt-1.5 space-y-1.5">
                    {/* Basic Elements */}
                    {basicElements.length > 0 && (
                      <div className="space-y-1.5">
                        {basicElements.map(element => {
                          const IconComponent = element.icon;
                          return (
                            <div
                              key={element.id}
                              draggable
                              onDragStart={(e) => handleDragStart(e, element)}
                              className="flex items-center gap-2 w-full px-3 py-2 cursor-move hover:bg-sky-100 transition-colors group rounded-md border border-transparent hover:border-sky-200 text-xs"
                              title={element.description}
                            >
                              <IconComponent
                                size={14}
                                strokeWidth={1.5}
                                className="flex-shrink-0 text-gray-500 group-hover:text-sky-500"
                              />
                              <span className="text-xs text-gray-700 group-hover:text-gray-900 truncate">
                                {element.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* More Elements Button / Advanced Elements */}
                    {advancedElements.length > 0 && (
                      <div className="mt-1.5">
                        {/* Advanced Elements */}
                        {showAdvanced && (
                          <div className="space-y-1.5 mb-1.5 pb-1.5 border-b border-gray-200">
                            {advancedElements.map(element => {
                              const IconComponent = element.icon;
                              return (
                                <div
                                  key={element.id}
                                  draggable
                                  onDragStart={(e) => handleDragStart(e, element)}
                                  className="flex items-center gap-2 w-full px-3 py-2 cursor-move hover:bg-sky-50 transition-colors group rounded-md border border-transparent hover:border-sky-150 opacity-75 text-xs"
                                  title={element.description}
                                >
                                  <IconComponent
                                    size={14}
                                    strokeWidth={1.5}
                                    className="flex-shrink-0 text-gray-400 group-hover:text-sky-400"
                                  />
                                  <span className="text-xs text-gray-600 group-hover:text-gray-800 truncate">
                                    {element.label}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Toggle Button */}
                        <button
                          onClick={() => toggleAdvanced(categoryId)}
                          className="w-full flex items-center justify-center gap-1.5 px-2 py-1 hover:bg-sky-100 transition-colors text-xs font-semibold text-sky-500 hover:text-sky-600 rounded-md border border-sky-200 hover:border-sky-300"
                        >
                          <Plus size={12} />
                          <span className="truncate">More</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          
          {/* Bottom padding for breathing room */}
          <div className="h-4" />
        </div>
      </div>
    </div>
  );
}
