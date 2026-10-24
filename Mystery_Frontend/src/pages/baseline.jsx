'use client';

import { useState } from 'react';
import { ArrowRight, Plus } from 'lucide-react';

// ─── Dotted canvas panel ───────────────────────────────────────────────────────
function CanvasPanel({ label, badge, badgeColor, isEmpty, emptyMsg, children, controls }) {
  const badgeStyles = {
    green:  'bg-green-600 text-white',
    blue:   'bg-blue-600 text-white',
    gray:   'bg-gray-500 text-white',
    orange: 'bg-orange-500 text-white',
  };

  return (
    <div className="flex flex-col flex-1 min-w-0 overflow-hidden border-r border-gray-200 last:border-r-0">
      {/* Panel header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-white shrink-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${badgeColor === 'green' ? 'bg-green-500' : badgeColor === 'blue' ? 'bg-blue-500' : badgeColor === 'orange' ? 'bg-orange-400' : 'bg-gray-400'}`} />
        <span className="text-[12.5px] font-bold text-gray-800 truncate">{label}</span>
        {badge && (
          <span className={`text-[9.5px] font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0 ${badgeStyles[badgeColor] || 'bg-gray-200 text-gray-600'}`}>
            {badge}
          </span>
        )}
        {controls && <div className="ml-auto flex items-center gap-1">{controls}</div>}
      </div>

      {/* Dotted canvas */}
      <div className="flex-1 relative overflow-hidden"
        style={{ backgroundImage:'radial-gradient(circle,#d1d5db 1px,transparent 1px)', backgroundSize:'24px 24px', backgroundColor:'#fafafa' }}>
        {children}
        {isEmpty && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
            <svg width="52" height="40" viewBox="0 0 52 40" fill="none" className="mb-2.5 opacity-15">
              <circle cx="16" cy="20" r="12" stroke="#9ca3af" strokeWidth="2.5" />
              <circle cx="38" cy="20" r="8"  stroke="#9ca3af" strokeWidth="2.5" />
              <line x1="28" y1="20" x2="30" y2="20" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <span className="text-[12.5px] text-gray-400">{emptyMsg}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Zoom/fit buttons ─────────────────────────────────────────────────────────
function ZoomControls() {
  return (
    <div className="flex items-center gap-0.5">
      {['Fit','+','−'].map(lbl => (
        <button key={lbl}
          className="px-2 py-0.5 text-[11px] font-medium text-gray-500 border border-gray-200 rounded hover:bg-gray-50 transition-colors">
          {lbl}
        </button>
      ))}
    </div>
  );
}

// ─── Metrics comparison footer ────────────────────────────────────────────────
function MetricsFooter({ scenarioCount }) {
  // 5 metric columns always visible
  const metrics = ['METRIC 1','METRIC 2','METRIC 3','METRIC 4','METRIC 5'];
  return (
    <div className="border-t border-gray-200 bg-white shrink-0">
      <div className="flex items-center justify-between px-5 py-2.5">
        <span className="text-[13px] font-bold text-gray-900">Metrics Comparison</span>
        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Baseline</span>
          <span>Run simulation to populate</span>
        </div>
      </div>
      <div className="px-5 pb-4">
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${metrics.length}, 1fr)` }}>
          {metrics.map(m => (
            <div key={m}>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">{m}</p>
              <div className="flex flex-col gap-1.5">
                {/* Baseline bar */}
                <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full w-0 bg-green-400 rounded-full" />
                </div>
                {/* Scenario bars */}
                {Array.from({ length: scenarioCount }).map((_, i) => (
                  <div key={i} className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full w-0 bg-blue-300 rounded-full" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── No model empty state ─────────────────────────────────────────────────────
function NoModelState({ onNavigateToModel }) {
  return (
    <div className="flex-1 flex items-center justify-center bg-gray-50 p-8">
      <div className="max-w-sm w-full text-center">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center mx-auto mb-5">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <circle cx="10" cy="14" r="7" stroke="#9ca3af" strokeWidth="2" />
            <circle cx="22" cy="14" r="4" stroke="#9ca3af" strokeWidth="2" />
            <line x1="17" y1="14" x2="18" y2="14" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <h2 className="text-[15px] font-bold text-gray-900 mb-2">No Base Model Found</h2>
        <p className="text-sm text-gray-500 mb-6 leading-relaxed">
          Build your process in the <strong>Model</strong> tab first. The baseline is drawn from your model — it's read-only here.
        </p>
        <button onClick={onNavigateToModel}
          className="inline-flex items-center gap-2 bg-gray-900 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-gray-800 transition-colors">
          Go to Model <ArrowRight size={15} />
        </button>

        {/* Step guide */}
        <div className="mt-8 text-left border border-gray-200 rounded-xl bg-white overflow-hidden divide-y divide-gray-100">
          {[
            { n:'01', name:'Model',     desc:'Draw your process with BPMN elements' },
            { n:'02', name:'Scenarios', desc:'Create what-if process variations' },
            { n:'03', name:'Baseline',  desc:'Compare baseline vs scenarios here', active: true },
            { n:'04', name:'Simulate',  desc:'Run & view simulation results' },
          ].map(({ n, name, desc, active }) => (
            <div key={n} className={`flex items-center gap-4 px-5 py-3.5 ${active ? 'bg-blue-50' : ''}`}>
              <span className={`text-[11px] font-bold tabular-nums shrink-0 ${active ? 'text-blue-600' : 'text-gray-400'}`}>{n}</span>
              <div>
                <p className={`text-sm font-semibold ${active ? 'text-blue-700' : 'text-gray-700'}`}>{name}</p>
                <p className="text-[11px] text-gray-500">{desc}</p>
              </div>
              {active && <span className="ml-auto text-[9px] font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0">You are here</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Baseline Page ───────────────────────────────────────────────────────
/**
 * Props:
 *   modelElements  – array from ModelPage state (passed via shared context/state)
 *   scenarios      – array of scenario objects from ScenariosPage
 *   onNavigateToModel – fn() → navigate to Model tab
 *   onNavigateToScenarios – fn() → navigate to Scenarios tab
 */
export default function BaselinePage({
  modelElements = [],
  scenarios = [],
  onNavigateToModel,
  onNavigateToScenarios,
}) {
  const hasModel = modelElements.length > 0;

  // Which scenario is selected for comparison (only 1 at a time in baseline)
  const [selectedScenarioId, setSelectedScenarioId] = useState(null);
  const [compareMode, setCompareMode] = useState('what-if'); // 'what-if' | 'draw-new'

  const selectedScenario = scenarios.find(s => s.id === selectedScenarioId);

  if (!hasModel) {
    return (
      <div className="flex flex-1 flex-col min-h-0 min-w-0 w-full overflow-hidden bg-white">
        {/* Header */}
        <div className="border-b border-gray-200 px-5 py-3 flex items-center justify-between bg-white shrink-0">
          <div>
            <span className="text-[15px] font-bold text-gray-900">Baseline vs —</span>
            <span className="text-[12px] text-gray-400 ml-2">Side-by-side view</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="text-[12px] text-gray-500 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">Export</button>
            <button className="text-[12px] font-semibold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg transition-colors">Re-run Simulation</button>
          </div>
        </div>
        <NoModelState onNavigateToModel={onNavigateToModel} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 min-w-0 w-full overflow-hidden bg-white">

      {/* ── Top header ───────────────────────────────────────────────────── */}
      <div className="border-b border-gray-200 px-5 py-3 flex items-center justify-between bg-white shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[15px] font-bold text-gray-900">Baseline vs</span>
          {selectedScenario
            ? <span className="text-[15px] font-bold text-gray-900">{selectedScenario.name}</span>
            : <span className="text-[15px] text-gray-400">—</span>}
          <span className="text-[12px] text-gray-400">Side-by-side view</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button className="text-[12px] text-gray-500 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">Export</button>
          <button className="text-[12px] font-semibold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg transition-colors">Re-run Simulation</button>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left sidebar */}

          <div className="flex flex-col w-1/3 min-w-0 overflow-y-auto">
          {/* Baseline section */}
          <div className="px-4 pt-4 pb-3 border-b border-gray-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Baseline</p>
            <div className="flex items-start gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-[12.5px] font-bold text-gray-900">Original Process</p>
                <span className="text-[10px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded uppercase tracking-wide inline-block mt-0.5">MODEL</span>
                <p className="text-[10px] text-gray-400 mt-1">Drawn in Model tab — read-only</p>
              </div>
            </div>
          </div>

          {/* Compare against toggle */}
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Compare Against</p>
            <div className="flex rounded-lg overflow-hidden border border-gray-200 text-[11.5px] font-semibold">
              <button onClick={() => setCompareMode('what-if')}
                className={`flex-1 px-2 py-1.5 transition-colors ${compareMode === 'what-if' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                What-If
              </button>
              <button onClick={() => setCompareMode('draw-new')}
                className={`flex-1 px-2 py-1.5 transition-colors ${compareMode === 'draw-new' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                Draw New
              </button>
            </div>
          </div>

          {/* Scenario list */}
          <div className="px-4 py-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Your Scenarios</p>
            {scenarios.length === 0 ? (
              <div>
                <p className="text-[11px] text-gray-400 mb-1">No scenarios yet.</p>
                <p className="text-[11px] text-gray-400 mb-2.5">Create them in the Scenarios tab.</p>
                <div className="text-[10px] text-gray-400 mb-2 text-center">— or —</div>
                <button onClick={onNavigateToScenarios}
                  className="w-full flex items-center justify-center gap-1 text-[11.5px] font-semibold text-gray-600 border border-gray-200 rounded-lg py-2 hover:bg-gray-50 transition-colors">
                  <Plus size={12} />Draw a new process
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {scenarios.map(s => (
                  <button key={s.id} onClick={() => setSelectedScenarioId(selectedScenarioId === s.id ? null : s.id)}
                    className={`text-left px-3 py-2 rounded-lg border transition-all ${
                      selectedScenarioId === s.id
                        ? 'border-blue-300 bg-blue-50'
                        : 'border-transparent hover:bg-gray-50'
                    }`}>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${selectedScenarioId === s.id ? 'bg-blue-500' : 'bg-gray-300'}`} />
                      <span className="text-[12px] font-semibold text-gray-900 truncate">{s.name}</span>
                    </div>
                    <p className="text-[10px] text-gray-400 pl-3 mt-0.5">
                      {selectedScenarioId === s.id ? 'Selected for comparison' : 'Click to compare'}
                    </p>
                  </button>
                ))}
                <div className="text-[10px] text-gray-400 my-1 text-center">— or —</div>
                <button onClick={onNavigateToScenarios}
                  className="w-full flex items-center justify-center gap-1 text-[11.5px] font-semibold text-gray-600 border border-gray-200 rounded-lg py-2 hover:bg-gray-50 transition-colors">
                  <Plus size={12} />Draw a new process
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Canvas area — dynamically split into 2 panels only */}
        <div className="flex flex-1 overflow-hidden min-w-0 flex-col">
          <div className="flex flex-1 overflow-hidden min-w-0">

            {/* Baseline canvas (always shown, read-only) */}
            <CanvasPanel
              label="Original Process"
              badge="BASELINE"
              badgeColor="green"
              isEmpty={true}
              emptyMsg="Build your process in the Model tab"
              controls={<ZoomControls />}
            >
              {/* Read-only model elements would render here */}
            </CanvasPanel>

            {/* What-If / comparison canvas */}
            <CanvasPanel
              label={selectedScenario ? selectedScenario.name : 'No scenario selected'}
              badge={selectedScenario ? 'WHAT-IF' : undefined}
              badgeColor="blue"
              isEmpty={true}
              emptyMsg={scenarios.length === 0
                ? 'Create scenarios in the Scenarios tab'
                : 'Select a scenario from the left panel'}
              controls={selectedScenario ? <ZoomControls /> : undefined}
            >
              {/* Scenario canvas elements would render here */}
              {selectedScenario && (
                <div className="absolute bottom-4 right-4 bg-white border border-gray-200 rounded-lg p-3 text-[11px] shadow-sm">
                  <div className="font-bold text-gray-600 mb-1.5 uppercase tracking-wider">Legend</div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2"><span className="w-8 h-4 border-2 border-blue-400 rounded inline-block bg-blue-50" /><span className="text-gray-600">Modified element</span></div>
                    <div className="flex items-center gap-2"><span className="w-8 h-4 border-2 border-dashed border-green-500 rounded inline-block bg-green-50" /><span className="text-gray-600">Added element</span></div>
                    <div className="flex items-center gap-2"><span className="w-8 h-4 border-2 border-dashed border-red-400 rounded inline-block bg-red-50" /><span className="text-gray-600">Removed element</span></div>
                  </div>
                </div>
              )}
            </CanvasPanel>
          </div>

          {/* Metrics footer */}
          <MetricsFooter scenarioCount={selectedScenario ? 1 : 0} />
        </div>
      </div>

      {/* Run Comparison */}
      <div className="border-t border-gray-200 px-5 py-3 bg-white shrink-0">
        <button
          disabled={!selectedScenario}
          className={`w-44 py-2 rounded-lg text-[13px] font-bold transition-all ${
            selectedScenario ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}>
          Run Comparison
        </button>
      </div>
    </div>
  );
}
