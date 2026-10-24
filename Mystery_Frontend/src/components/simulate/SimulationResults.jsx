'use client';

import { CheckCircle2, Clock, TrendingUp, DollarSign, Zap, Activity } from 'lucide-react';

/**
 * SimulationResults component - Display simulation results and metrics
 * @param {Object} props
 * @param {any} props.result - The simulation results
 * @param {boolean} [props.isLoading] - Is still loading
 * @param {Function} [props.onReset] - Callback to reset results
 */
export function SimulationResults({ result, isLoading = false, onReset }) {
  const metrics = [
    {
      label: 'Completion Rate',
      value: `${result.completionRate}%`,
      icon: CheckCircle2,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      label: 'Avg. Cycle Time',
      value: result.avgCycleTime,
      icon: Clock,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      label: 'Throughput',
      value: String(result.throughput),
      icon: TrendingUp,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
    {
      label: 'Cost per Instance',
      value: `$${result.costPerInstance}`,
      icon: DollarSign,
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
    },
    {
      label: 'Overall Efficiency',
      value: `${result.efficiency}%`,
      icon: Zap,
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-50',
    },
    {
      label: 'Resource Utilization',
      value: `${result.resourceUtilization}%`,
      icon: Activity,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Progress Bar */}
      {isLoading && (
        <div className="flex flex-col gap-2">
          <div className="flex justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Simulation Progress</h3>
            <span className="text-sm font-semibold text-slate-600">{result.progress}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-300"
              style={{ width: `${result.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Status */}
      {!isLoading && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-semibold text-green-900">
            ✓ Simulation Complete!
          </p>
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {metrics.map((metric, idx) => {
          const Icon = metric.icon;
          return (
            <div
              key={idx}
              className={`rounded-lg border border-slate-200 ${metric.bgColor} p-4`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-slate-600">{metric.label}</p>
                  <p className={`text-2xl font-bold ${metric.color} mt-1`}>
                    {metric.value}
                  </p>
                </div>
                <Icon size={24} className={metric.color} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Day-wise Breakdown */}
      {result.dayWiseBreakdown && result.dayWiseBreakdown.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="text-sm font-semibold text-slate-900 mb-3">
            Day-wise Work Breakdown
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 px-3 font-semibold text-slate-700">Day</th>
                  <th className="text-left py-2 px-3 font-semibold text-slate-700">Tasks Completed</th>
                  <th className="text-left py-2 px-3 font-semibold text-slate-700">Avg Duration</th>
                  <th className="text-left py-2 px-3 font-semibold text-slate-700">Resource Usage</th>
                </tr>
              </thead>
              <tbody>
                {result.dayWiseBreakdown.map((day, idx) => (
                  <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-3 text-slate-900">{day.day}</td>
                    <td className="py-2 px-3 text-slate-700">{day.tasksCompleted}</td>
                    <td className="py-2 px-3 text-slate-700">{day.avgDuration}</td>
                    <td className="py-2 px-3 text-slate-700">{day.resourceUsage}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
