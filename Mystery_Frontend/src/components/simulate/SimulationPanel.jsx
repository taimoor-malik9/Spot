'use client';

import { useState } from 'react';
import { Button } from '../ui/button';
import { Clock, Users, Settings2 } from 'lucide-react';

/**
 * SimulationPanel component - Configure and run simulations
 * @param {Object} props
 * @param {Function} [props.onSimulate] - Callback to start simulation
 * @param {boolean} [props.isLoading] - Is simulation running
 */
export function SimulationPanel({ onSimulate, isLoading = false }) {
  const [duration, setDuration] = useState('hour');
  const [instances, setInstances] = useState(100);
  const [task1Resources, setTask1Resources] = useState(5);
  const [task2Resources, setTask2Resources] = useState(3);
  const [captureMetrics, setCaptureMetrics] = useState(true);
  const [enableCost, setEnableCost] = useState(false);
  const [identifyBottlenecks, setIdentifyBottlenecks] = useState(true);

  const handleSimulate = () => {
    onSimulate?.({
      duration,
      instances,
      captureDetailedMetrics: captureMetrics,
      enableCostAnalysis: enableCost,
      identifyBottlenecks,
    });
  };

  return (
    <div className="flex flex-col gap-6 p-6 h-full overflow-y-auto">
      <h3 className="text-lg font-semibold text-slate-900">Simulation Settings</h3>

      {/* Simulation Duration */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clock size={18} className="text-slate-600" />
          <label className="text-sm font-medium text-slate-900">Simulation Duration</label>
        </div>
        <select
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm bg-white"
        >
          <option value="hour">1 hour</option>
          <option value="day">1 day</option>
          <option value="week">1 week</option>
          <option value="month">1 month</option>
        </select>
      </div>

      {/* Number of Instances */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Users size={18} className="text-slate-600" />
          <label className="text-sm font-medium text-slate-900">Number of Instances</label>
        </div>
        <input
          type="number"
          value={instances}
          onChange={(e) => setInstances(Math.max(1, parseInt(e.target.value) || 1))}
          min="1"
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      {/* Resource Allocation */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Settings2 size={18} className="text-slate-600" />
          <label className="text-sm font-medium text-slate-900">Resource Allocation</label>
        </div>

        <div className="space-y-4">
          {/* Task 1 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-700">Task 1</span>
              <span className="text-sm text-slate-600">{task1Resources} resources</span>
            </div>
            <input
              type="range"
              min="1"
              max="10"
              value={task1Resources}
              onChange={(e) => setTask1Resources(parseInt(e.target.value))}
              className="w-full h-2 bg-slate-300 rounded-lg appearance-none cursor-pointer accent-slate-600"
            />
          </div>

          {/* Task 2 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-700">Task 2</span>
              <span className="text-sm text-slate-600">{task2Resources} resources</span>
            </div>
            <input
              type="range"
              min="1"
              max="10"
              value={task2Resources}
              onChange={(e) => setTask2Resources(parseInt(e.target.value))}
              className="w-full h-2 bg-slate-300 rounded-lg appearance-none cursor-pointer accent-slate-600"
            />
          </div>
        </div>
      </div>

      {/* Checkboxes */}
      <div className="space-y-3 border-t border-slate-200 pt-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={captureMetrics}
            onChange={(e) => setCaptureMetrics(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300"
          />
          <span className="text-sm text-slate-700">Capture detailed metrics</span>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enableCost}
            onChange={(e) => setEnableCost(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300"
          />
          <span className="text-sm text-slate-700">Enable cost analysis</span>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={identifyBottlenecks}
            onChange={(e) => setIdentifyBottlenecks(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300"
          />
          <span className="text-sm text-slate-700">Identify bottlenecks</span>
        </label>
      </div>

      {/* Start Button */}
      <Button
        onClick={handleSimulate}
        disabled={isLoading}
        className="w-full bg-blue-600 text-white hover:bg-blue-700 py-2 rounded-lg font-medium mt-auto"
      >
        {isLoading ? 'Simulating...' : 'Start Simulation'}
      </Button>
    </div>
  );
}
