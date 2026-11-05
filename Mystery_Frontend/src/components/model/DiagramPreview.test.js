// Mystery_Frontend/src/components/model/DiagramPreview.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import esbuild from 'esbuild';
import * as aiDiagramLayout from '../../lib/aiDiagramLayout.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to load and transpile DiagramPreview.jsx for Node test environment
function loadDiagramPreviewComponent() {
  const compPath = path.resolve(__dirname, './DiagramPreview.jsx');
  const rawCode = fs.readFileSync(compPath, 'utf8');
  const transpiled = esbuild.transformSync(rawCode, {
    loader: 'jsx',
    format: 'cjs',
  });

  const moduleObj = { exports: {} };
  const customRequire = (id) => {
    if (id === 'react') return React;
    if (id === '../../lib/aiDiagramLayout') return aiDiagramLayout;
    if (id.endsWith('aiDiagramLayout')) return aiDiagramLayout;
    throw new Error(`Unhandled mock require in test: ${id}`);
  };

  const fn = new Function('module', 'exports', 'require', 'React', transpiled.code);
  fn(moduleObj, moduleObj.exports, customRequire, React);

  return moduleObj.exports.default || moduleObj.exports;
}

const DiagramPreview = loadDiagramPreviewComponent();

describe('DiagramPreview: Render & Regression Tests (Bug: label is not defined)', () => {
  it('1. Regression: does not throw "ReferenceError: label is not defined" when rendering task nodes in compact view', () => {
    const nodes = [
      { id: 'start_1', type: 'start-event', label: 'Start', position: { x: 50, y: 50 } },
      { id: 'task_1', type: 'task', label: 'Take Customer Order', position: { x: 180, y: 50 } },
      { id: 'end_1', type: 'end-event', label: 'End', position: { x: 350, y: 50 } },
    ];
    const connections = [
      { id: 'c1', from: 'start_1', to: 'task_1' },
      { id: 'c2', from: 'task_1', to: 'end_1' },
    ];

    assert.doesNotThrow(() => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(DiagramPreview, {
          nodes,
          connections,
          isFullView: false,
        })
      );
      assert.ok(html.includes('<svg'), 'Rendered output should contain SVG element');
      // Compact view truncates label > 10 chars to 9 + '…' ("Take Cust…")
      assert.ok(html.includes('Take Cust…'), 'Compact view should display truncated task label');
    });
  });

  it('2. Regression: does not throw when rendering task nodes in full view (isFullView: true)', () => {
    const nodes = [
      { id: 'start_1', type: 'start-event', label: 'Start', position: { x: 50, y: 50 } },
      { id: 'task_1', type: 'task', label: 'Take Customer Order', position: { x: 180, y: 50 } },
      { id: 'end_1', type: 'end-event', label: 'End', position: { x: 350, y: 50 } },
    ];
    const connections = [
      { id: 'c1', from: 'start_1', to: 'task_1' },
      { id: 'c2', from: 'task_1', to: 'end_1' },
    ];

    assert.doesNotThrow(() => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(DiagramPreview, {
          nodes,
          connections,
          isFullView: true,
        })
      );
      assert.ok(html.includes('Take Customer Order'), 'Full view should display full task label');
    });
  });

  it('3. Renders Roman Urdu labels without throwing', () => {
    const nodes = [
      { id: 'start_1', type: 'start-event', label: 'Shuru', position: { x: 50, y: 50 } },
      { id: 'task_1', type: 'task', label: 'Order lena', position: { x: 180, y: 50 } },
      { id: 'gw_1', type: 'exclusive-gateway', label: 'Faisla point', position: { x: 320, y: 50 } },
      { id: 'end_1', type: 'end-event', label: 'Khatam', position: { x: 450, y: 50 } },
    ];
    const connections = [
      { id: 'c1', from: 'start_1', to: 'task_1' },
      { id: 'c2', from: 'task_1', to: 'gw_1' },
      { id: 'c3', from: 'gw_1', to: 'end_1' },
    ];

    assert.doesNotThrow(() => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(DiagramPreview, {
          nodes,
          connections,
          isFullView: true,
        })
      );
      assert.ok(html.includes('Order lena'), 'Output should contain Roman Urdu step name');
      assert.ok(html.includes('Shuru'), 'Output should contain Shuru');
      assert.ok(html.includes('Khatam'), 'Output should contain Khatam');
    });
  });

  it('4. Renders Urdu script labels without throwing', () => {
    const nodes = [
      { id: 'start_1', type: 'start-event', label: 'شروع', position: { x: 50, y: 50 } },
      { id: 'task_1', type: 'task', label: 'کھانا آرڈر کریں', position: { x: 180, y: 50 } },
      { id: 'gw_1', type: 'exclusive-gateway', label: 'فیصلہ پوائنٹ', position: { x: 320, y: 50 } },
      { id: 'end_1', type: 'end-event', label: 'ختم', position: { x: 450, y: 50 } },
    ];
    const connections = [
      { id: 'c1', from: 'start_1', to: 'task_1' },
      { id: 'c2', from: 'task_1', to: 'gw_1' },
      { id: 'c3', from: 'gw_1', to: 'end_1' },
    ];

    assert.doesNotThrow(() => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(DiagramPreview, {
          nodes,
          connections,
          isFullView: true,
        })
      );
      assert.ok(html.includes('کھانا آرڈر کریں'), 'Output should contain Urdu step name');
      assert.ok(html.includes('شروع'), 'Output should contain شروع');
      assert.ok(html.includes('ختم'), 'Output should contain ختم');
    });
  });

  it('5. Inferred task node: renders "AI added · no time" badge without error', () => {
    const nodes = [
      {
        id: 'task_inferred',
        type: 'task',
        label: 'Auto notify chef',
        origin: 'inferred',
        position: { x: 100, y: 100 },
      },
    ];

    assert.doesNotThrow(() => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(DiagramPreview, {
          nodes,
          connections: [],
          isFullView: true,
        })
      );
      assert.ok(html.includes('AI added · no time'), 'Inferred node should render badge');
    });
  });

  it('6. Empty nodes: renders fallback empty state without error', () => {
    assert.doesNotThrow(() => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(DiagramPreview, {
          nodes: [],
          connections: [],
        })
      );
      assert.ok(html.includes('No diagram nodes to display'));
    });
  });
});
