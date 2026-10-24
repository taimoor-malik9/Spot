import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Step S5: Scenario Loop Prevention & Lifecycle Rules', () => {

  it('1. One Implement Suggestion click gives exactly 1 new scenario; rapid duplicate and in-flight clicks are ignored', async () => {
    let createdCount = 0;
    let inFlight = false;
    let lastCall = { text: null, baseProcessId: null, timestamp: 0 };

    async function mockImplementSuggestion(suggestionText, id, baseProcessId) {
      if (inFlight) {
        return { status: 'ignored_in_flight' };
      }
      const now = Date.now();
      if (
        lastCall.text === suggestionText &&
        lastCall.baseProcessId === baseProcessId &&
        now - lastCall.timestamp < 10000
      ) {
        return { status: 'ignored_duplicate' };
      }

      inFlight = true;
      lastCall = { text: suggestionText, baseProcessId, timestamp: now };
      try {
        // Simulate async AI network call and scenario creation
        await new Promise(resolve => setTimeout(resolve, 50));
        createdCount++;
        return { status: 'created', scenarioId: `scen_${createdCount}` };
      } finally {
        inFlight = false;
      }
    }

    // Call 1: user clicks "Implement Suggestion"
    const call1Promise = mockImplementSuggestion('Optimize Order Wait', 1, 'process_123');

    // Call 2: user clicks again while call 1 is still in flight (e.g. double click)
    const call2Promise = mockImplementSuggestion('Optimize Order Wait', 1, 'process_123');

    const [res1, res2] = await Promise.all([call1Promise, call2Promise]);
    assert.equal(res1.status, 'created');
    assert.equal(res2.status, 'ignored_in_flight');
    assert.equal(createdCount, 1, 'In-flight click must not create a duplicate scenario');

    // Call 3: user clicks again 1 second later (within 10s deduplication window)
    const res3 = await mockImplementSuggestion('Optimize Order Wait', 1, 'process_123');
    assert.equal(res3.status, 'ignored_duplicate');
    assert.equal(createdCount, 1, 'Repeat click within 10s must not create a duplicate scenario');

    // Exactly 1 new scenario was created
    assert.equal(createdCount, 1);
  });

  it('2. Reloading the Scenarios page 3 times leaves scenario count unchanged (hydration only PUTs, never POSTs)', async () => {
    let dbScenarios = [
      { _id: 'scen_opt_1', title: 'Optimize Order Wait', nodes: [{ id: 'task1' }], edges: [], layoutElements: [] }
    ];
    let postCallCount = 0;
    let putCallCount = 0;

    const mockApi = {
      getScenarios: async (baseId) => [...dbScenarios],
      createScenario: async (baseId, title, nodes, edges, resources, layout) => {
        postCallCount++;
        const newDoc = { _id: `scen_${Date.now()}`, title, nodes, edges, layoutElements: layout };
        dbScenarios.push(newDoc);
        return { scenario: newDoc };
      },
      updateScenario: async (scenarioId, title, nodes, edges, resources, layout) => {
        putCallCount++;
        const target = dbScenarios.find(s => s._id === scenarioId);
        if (target) {
          target.layoutElements = layout;
        }
        return { scenario: target };
      }
    };

    // Simulate page load / reload logic in scenarios.jsx
    async function simulatePageLoad(baseProcessId) {
      const list = await mockApi.getScenarios(baseProcessId);
      for (const bs of list) {
        const poolLaneCount = (bs.layoutElements || []).filter(el => el.type === 'pool' || el.type === 'lane').length;
        // If scenario lacks pool/lane elements, hydration triggers
        if (poolLaneCount === 0) {
          const hydratedLayout = [{ id: 'pool_1', type: 'pool', label: 'Main Pool' }];
          // Rule: Hydration must UPDATE the existing scenario (PUT), NEVER create a new one (POST)
          await mockApi.updateScenario(bs._id, bs.title, bs.nodes, bs.edges, bs.resources, hydratedLayout);
        }
      }
      return list.length;
    }

    // Initial load: 1 scenario in DB
    const countAfterLoad1 = await simulatePageLoad('base_1');
    assert.equal(countAfterLoad1, 1);
    assert.equal(postCallCount, 0, 'Initial load must not call createScenario / POST');
    assert.equal(putCallCount, 1, 'Hydration must update the existing scenario via PUT');

    // Reload 1
    const countAfterLoad2 = await simulatePageLoad('base_1');
    assert.equal(countAfterLoad2, 1);
    assert.equal(postCallCount, 0, 'Reload 1 must not call createScenario / POST');

    // Reload 2
    const countAfterLoad3 = await simulatePageLoad('base_1');
    assert.equal(countAfterLoad3, 1);
    assert.equal(postCallCount, 0, 'Reload 2 must not call createScenario / POST');

    // Reload 3
    const countAfterLoad4 = await simulatePageLoad('base_1');
    assert.equal(countAfterLoad4, 1);
    assert.equal(postCallCount, 0, 'Reload 3 must not call createScenario / POST');

    assert.equal(dbScenarios.length, 1, 'Scenario count must remain exactly 1 after 3 reloads');
  });

  it('3. Single baseline edit gives exactly 1 new scenario; non-user events never auto-fork', async () => {
    let scenarios = [{ id: 'baseline', name: 'Baseline (Original)', _isBaseline: true }];
    let activeId = 'baseline';
    let baselineForkedThisSession = false;
    let createdScenariosCount = 0;

    function forkBaseline() {
      const localId = `whatif_${Date.now()}`;
      const newScenario = { id: localId, name: 'What-If Scenario', _isBaseline: false, _allowCreate: true };
      scenarios.push(newScenario);
      activeId = localId;
      createdScenariosCount++;
      return localId;
    }

    function onCanvasElementChange(newElement, isUserEvent = false) {
      if (activeId === 'baseline') {
        // Rule: Only a REAL user edit event (pointer/keyboard) may fork baseline
        // Never from useEffect, hydration, layout repair, position normalization, zoom/pan or focus sync
        if (!isUserEvent) {
          return { status: 'ignored_non_user_event' };
        }
        // Rule: Baseline auto-create fires at most once per edit session
        if (baselineForkedThisSession) {
          return { status: 'already_forked', activeId };
        }
        baselineForkedThisSession = true;
        const forkedId = forkBaseline();
        return { status: 'forked', activeId: forkedId };
      }
      return { status: 'applied_to_scenario', activeId };
    }

    // 1. Non-user events (e.g. position normalization, zoom/pan, focus sync, repair) while on baseline
    const nonUserRes1 = onCanvasElementChange({ id: 'task1', x: 100, y: 100 }, false);
    assert.equal(nonUserRes1.status, 'ignored_non_user_event');
    assert.equal(createdScenariosCount, 0, 'Non-user event must never fork baseline');
    assert.equal(activeId, 'baseline');

    const nonUserRes2 = onCanvasElementChange({ id: 'task1', width: 120 }, false);
    assert.equal(nonUserRes2.status, 'ignored_non_user_event');
    assert.equal(createdScenariosCount, 0);

    // 2. First REAL user edit (pointer drag / drop or keyboard edit) on baseline
    const userEdit1 = onCanvasElementChange({ id: 'task1', label: 'Updated User Step' }, true);
    assert.equal(userEdit1.status, 'forked');
    assert.equal(createdScenariosCount, 1, 'First real user edit on baseline must create exactly 1 scenario');
    assert.notEqual(activeId, 'baseline', 'Active scenario must switch away from read-only baseline');

    // 3. Subsequent user edits in the same session target the new scenario, not creating another
    const userEdit2 = onCanvasElementChange({ id: 'task2', label: 'Second Step' }, true);
    assert.equal(userEdit2.status, 'applied_to_scenario');
    assert.equal(createdScenariosCount, 1, 'Subsequent edits must not create additional scenarios');

    assert.equal(scenarios.length, 2); // 1 baseline + 1 what-if
  });

  it('4. Bulk delete removes all selected scenarios and leaves baseline intact', () => {
    let scenarios = [
      { id: 'baseline', name: 'Baseline' },
      { id: 's1', name: 'Scenario 1' },
      { id: 's2', name: 'Scenario 2' },
      { id: 's3', name: 'Scenario 3' },
    ];
    let compareIds = ['baseline', 's1', 's2']; // User selected baseline, s1, s2 with checkboxes

    // Bulk delete filter (baseline cannot be deleted)
    const toDelete = compareIds.filter(id => id !== 'baseline');
    assert.deepEqual(toDelete, ['s1', 's2']);
    assert.equal(toDelete.length, 2);

    // Delete selected
    scenarios = scenarios.filter(s => !toDelete.includes(s.id));
    compareIds = compareIds.filter(id => !toDelete.includes(id));

    assert.equal(scenarios.length, 2);
    assert.deepEqual(scenarios.map(s => s.id), ['baseline', 's3']);
    assert.deepEqual(compareIds, ['baseline']);
  });

});
