import { createServer } from 'vite';
import React from 'react';
import ReactDOM from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';

// Mock Browser Environment for SSR
class LocalStorageMock {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return this.store[key] !== undefined ? this.store[key] : null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

const mockStorage = new LocalStorageMock();
const mockSession = new LocalStorageMock();
globalThis.__SSR__ = true;
process.env.TEST_SSR = 'true';

const mockElement = {
  style: {},
  appendChild: () => {},
  removeChild: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  getBoundingClientRect: () => ({ top: 0, left: 0, width: 1000, height: 800 }),
};

global.window = {
  __SSR__: true,
  localStorage: mockStorage,
  sessionStorage: mockSession,
  location: { search: '', pathname: '/', hash: '' },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {},
  confirm: () => true,
  alert: () => {},
  innerWidth: 1920,
  innerHeight: 1080,
};
global.localStorage = mockStorage;
global.sessionStorage = mockSession;
global.document = {
  createElement: () => mockElement,
  getElementById: () => mockElement,
  querySelector: () => mockElement,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  body: mockElement,
};

const FORBIDDEN_WORDS = [
  'gateway',
  'swimlane',
  'pool',
  'bpmn',
  'replication',
  'seed',
  'utilization',
  'iteration',
  'baseline'
];

const RAW_ID_REGEX = /\b[a-z]+(_[a-z0-9]+)+\b/gi;

function extractVisibleText(html) {
  // 1. Remove script and style tags
  let cleaned = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  // 2. Remove collapsed <details> contents if any (details without open attribute)
  cleaned = cleaned.replace(/<details(?!\s+open\b)[^>]*>([\s\S]*?)<\/details>/gi, (match) => {
    // Keep summary tag visible, strip rest
    const summaryMatch = match.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    return summaryMatch ? summaryMatch[1] : '';
  });
  // 3. Remove all HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');
  // 4. Decode HTML entities
  cleaned = cleaned
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–');
  // 5. Normalize whitespace
  return cleaned.replace(/\s+/g, ' ').trim();
}

function checkVisibleText(viewName, visibleText) {
  console.log(`\n========================================`);
  console.log(`Testing View: [${viewName}]`);
  console.log(`Visible text length: ${visibleText.length} chars`);
  console.log(`Sample: "${visibleText.slice(0, 160)}..."`);
  console.log(`----------------------------------------`);

  const errors = [];

  // 1. Check forbidden words
  for (const word of FORBIDDEN_WORDS) {
    const re = new RegExp(`\\b${word}(?:s|es)?\\b`, 'i');
    const match = visibleText.match(re);
    if (match) {
      // Find context around match
      const idx = visibleText.indexOf(match[0]);
      const snippet = visibleText.slice(Math.max(0, idx - 30), Math.min(visibleText.length, idx + 40));
      errors.push(`Forbidden word "${match[0]}" found in visible text: "...${snippet}..."`);
    }
  }

  // 2. Check raw ID pattern /^[a-z]+(_[a-z0-9]+)+$/
  const rawIdMatches = visibleText.match(RAW_ID_REGEX) || [];
  for (const idMatch of rawIdMatches) {
    // Skip legitimate words or abbreviations that happen to have no underscores
    if (!idMatch.includes('_')) continue;
    const idx = visibleText.indexOf(idMatch);
    const snippet = visibleText.slice(Math.max(0, idx - 30), Math.min(visibleText.length, idx + 40));
    errors.push(`Raw snake_case ID "${idMatch}" found in visible text: "...${snippet}..."`);
  }

  if (errors.length > 0) {
    console.error(`FAIL: ${viewName} had ${errors.length} violations:`);
    errors.forEach(e => console.error(`  - ${e}`));
    return false;
  } else {
    console.log(`PASS: ${viewName} passed plain-language check with 0 violations!`);
    return true;
  }
}

async function run() {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom'
  });

  // Mock react-dom createPortal so portal contents are rendered directly in static markup
  ReactDOM.createPortal = (node) => node;

  const { MemoryRouter } = await vite.ssrLoadModule('react-router-dom');
  const { AuthContext } = await vite.ssrLoadModule('/src/context/AuthContext.jsx');

  const MockAuthProvider = ({ children }) => {
    return React.createElement(AuthContext.Provider, {
      value: {
        user: { id: 'u1', name: 'Dr. Test', email: 'test@clinic.com' },
        token: 'fake-token',
        isGuest: false,
        loading: false,
        login: () => {},
        logout: () => {},
        updateUser: () => {}
      }
    }, children);
  };

  // Ensure simple view is active (Analyst view is OFF)
  mockStorage.setItem('spot:analyst_view:default', 'false');

  // Setup common mock model data
  const mockNodes = [
    { id: 'start_1', type: 'start-event', label: 'Patient Enters', position: { x: 50, y: 100 } },
    { id: 'task_1', type: 'task', label: 'Receive Patient', data: { duration: 15, resource: 'Staff' }, position: { x: 200, y: 100 } },
    { id: 'task_2', type: 'task', label: 'Doctor Consultation', data: { duration: 30, resource: 'Doctor' }, position: { x: 400, y: 100 } },
    { id: 'end_1', type: 'end-event', label: 'Patient Leaves', position: { x: 600, y: 100 } },
  ];
  const mockConnections = [
    { id: 'conn_1', from: 'start_1', to: 'task_1' },
    { id: 'conn_2', from: 'task_1', to: 'task_2' },
    { id: 'conn_3', from: 'task_2', to: 'end_1' },
  ];
  mockStorage.setItem('spot:model:nodes', JSON.stringify({ nodes: mockNodes, connections: mockConnections }));
  mockStorage.setItem('spot:scenario_template', JSON.stringify({ nodes: mockNodes, connections: mockConnections }));
  mockStorage.setItem('spot:processTitle', 'Dental Clinic Process');
  mockStorage.setItem('spot:processId', 'proc_123');

  // Mock simulation results
  const mockResults = {
    average_cycle_time: 45.2,
    min_cycle_time: 25.0,
    max_cycle_time: 80.0,
    throughput_per_hour: 12.5,
    resource_utilization: {
      Staff: { utilization_pct: 72, busy_minutes: 240, idle_minutes: 80 },
      Doctor: { utilization_pct: 88, busy_minutes: 360, idle_minutes: 40 },
    },
    financial_summary: {
      active_cost: 12500,
      idle_cost: 2500,
      total_cost: 15000,
      currency: 'Rs',
    },
    bottleneck: 'task_2',
    processId: 'proc_123',
    time_in_system: { avg: 45.2, min: 25.0, max: 80.0 },
    summary: 'The Dental Clinic Process currently takes 45.2 minutes per customer.',
  };
  mockStorage.setItem('spot:simulationResults', JSON.stringify(mockResults));
  mockStorage.setItem('spot:baselineResults', JSON.stringify(mockResults));

  let allPassed = true;

  // ─────────────────────────────────────────────────────────────
  // 1. Results View
  // ─────────────────────────────────────────────────────────────
  try {
    const { default: ResultsPage } = await vite.ssrLoadModule('/src/pages/results.jsx');
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, { initialEntries: ['/results'] },
        React.createElement(MockAuthProvider, null,
          React.createElement(ResultsPage)
        )
      )
    );
    const visibleText = extractVisibleText(html);
    const pass = checkVisibleText('Results View', visibleText);
    if (!pass) allPassed = false;
  } catch (err) {
    console.error('Error rendering Results View:', err);
    allPassed = false;
  }

  // ─────────────────────────────────────────────────────────────
  // 2. Solve a problem (SpotAssistant)
  // ─────────────────────────────────────────────────────────────
  try {
    const { default: SpotAssistant } = await vite.ssrLoadModule('/src/components/SpotAssistant.jsx');
    const mockEvidenceMsg = {
      id: 'msg_1',
      type: 'evidence',
      evidenceData: {
        baseline: { avg_cycle_time: 45.2, avg_wait_time: 15.0, throughput_per_hour: 12.5, total_cost: 15000 },
        variants: [
          {
            label: 'Speed up Doctor Consultation',
            name: 'Speed up Doctor Consultation',
            action: 'Speed up Doctor Consultation by 20%',
            target_node_id: 'task_2',
            metrics: { avg_cycle_time: 36.1, avg_wait_time: 8.0, throughput_per_hour: 15.0, total_cost: 15000 },
            delta_vs_baseline: { cycle_time_pct: -20.1, wait_pct: -46.6, throughput_pct: 20.0, cost_abs: 0 },
            change: -20.1,
            is_best: true,
            status: 'success'
          }
        ],
        best: {
          label: 'Speed up Doctor Consultation',
          name: 'Speed up Doctor Consultation',
          action: 'Speed up Doctor Consultation by 20%',
          target_node_id: 'task_2',
          delta_vs_baseline: { cycle_time_pct: -20.1, wait_pct: -46.6, throughput_pct: 20.0, cost_abs: 0 },
          recommended: true,
        },
        summary: 'Speeding up Doctor Consultation reduces the completion time by 20.1% while serving 15.0 customers per hour.',
        target: { metric: 'cycle_time' },
      },
      scenarioState: {},
      timestamp: Date.now(),
    };

    mockStorage.setItem('spot:solveProblemThread:default', JSON.stringify({ messages: [mockEvidenceMsg] }));
    mockStorage.setItem('spot:solveProblemThread:proc_123', JSON.stringify({ messages: [mockEvidenceMsg] }));

    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, null,
        React.createElement(MockAuthProvider, null,
          React.createElement(SpotAssistant, {
            open: true,
            onClose: () => {}
          })
        )
      )
    );
    console.log("SpotAssistant raw html length:", html.length, "content preview:", html.slice(0, 100));
    const visibleText = extractVisibleText(html);
    const pass = checkVisibleText('Solve a Problem (SpotAssistant)', visibleText);
    if (!pass) allPassed = false;
  } catch (err) {
    console.error('Error rendering Solve a problem:', err);
    allPassed = false;
  }

  // ─────────────────────────────────────────────────────────────
  // 3. Scenarios View
  // ─────────────────────────────────────────────────────────────
  try {
    const { default: ScenariosPage } = await vite.ssrLoadModule('/src/pages/scenarios.jsx');
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, { initialEntries: ['/scenarios'] },
        React.createElement(MockAuthProvider, null,
          React.createElement(ScenariosPage)
        )
      )
    );
    const visibleText = extractVisibleText(html);
    const pass = checkVisibleText('Scenarios View', visibleText);
    if (!pass) allPassed = false;
  } catch (err) {
    console.error('Error rendering Scenarios View:', err);
    allPassed = false;
  }

  // ─────────────────────────────────────────────────────────────
  // 4. Dashboard View
  // ─────────────────────────────────────────────────────────────
  try {
    const { default: DashboardPage } = await vite.ssrLoadModule('/src/pages/dashboard.jsx');
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, { initialEntries: ['/dashboard'] },
        React.createElement(MockAuthProvider, null,
          React.createElement(DashboardPage)
        )
      )
    );
    const visibleText = extractVisibleText(html);
    const pass = checkVisibleText('Dashboard View', visibleText);
    if (!pass) allPassed = false;
  } catch (err) {
    console.error('Error rendering Dashboard View:', err);
    allPassed = false;
  }

  // ─────────────────────────────────────────────────────────────
  // 5. Setup (Simulate) View
  // ─────────────────────────────────────────────────────────────
  try {
    mockStorage.setItem('spot:simSetupOpen', 'true');
    const { default: SimulatePage } = await vite.ssrLoadModule('/src/pages/simulate.jsx');
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, { initialEntries: ['/simulate'] },
        React.createElement(MockAuthProvider, null,
          React.createElement(SimulatePage)
        )
      )
    );
    const visibleText = extractVisibleText(html);
    const pass = checkVisibleText('Setup (Simulate) View', visibleText);
    if (!pass) allPassed = false;
  } catch (err) {
    console.error('Error rendering Setup View:', err);
    allPassed = false;
  }

  // ─────────────────────────────────────────────────────────────
  // 6. Analyst View Verification (Technical labels active)
  // ─────────────────────────────────────────────────────────────
  try {
    mockStorage.setItem('spot:analyst_view', 'true');
    const { default: SimulatePage } = await vite.ssrLoadModule('/src/pages/simulate.jsx');
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, { initialEntries: ['/simulate'] },
        React.createElement(MockAuthProvider, null,
          React.createElement(SimulatePage)
        )
      )
    );
    const visibleText = extractVisibleText(html);
    const hasTechnicalLabels = visibleText.includes('Simulation Setup') || visibleText.includes('Total Cases') || visibleText.includes('Arrival Frequency');
    console.log(`\n========================================`);
    console.log(`Testing View: [Analyst View (Technical Mode)]`);
    console.log(`Sample: "${visibleText.slice(0, 160)}..."`);
    console.log(`Contains technical labels: ${hasTechnicalLabels ? 'YES' : 'NO'}`);
    if (hasTechnicalLabels) {
      console.log(`PASS: Analyst view accurately switches to technical labels.`);
    } else {
      console.error(`FAIL: Analyst view did not display technical labels.`);
      allPassed = false;
    }
  } catch (err) {
    console.error('Error rendering Analyst View:', err);
    allPassed = false;
  }

  await vite.close();

  console.log(`\n========================================`);
  if (allPassed) {
    console.log(`🎉 ALL 5 TARGET VIEWS PASSED PLAIN-LANGUAGE AUDIT!`);
    process.exit(0);
  } else {
    console.error(`❌ SOME VIEWS FAILED PLAIN-LANGUAGE AUDIT.`);
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error running test:', err);
  process.exit(1);
});
