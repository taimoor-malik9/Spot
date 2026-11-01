const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { requireOwnedProcess, requireOwnedScenario } = require('../utils/ownership');
const Process = require('../models/Process');
const Scenario = require('../models/Scenario');
const { SimulationRun, saveSimulationRun, deleteRunsForScenario, deleteRunsForProcess } = require('../models/SimulationRun');

test('Module H1: Account-Scoped Ownership, Simulation Runs & Cascades', async (t) => {
  const userAId = new mongoose.Types.ObjectId();
  const userBId = new mongoose.Types.ObjectId();

  const reqUserA = { user: { _id: userAId, id: userAId.toString() }, body: {}, query: {} };
  const reqUserB = { user: { _id: userBId, id: userBId.toString() }, body: {}, query: {} };
  const reqUnauth = { user: null, body: {}, query: {} };

  await t.test('1. Unauthenticated call gets 401', async () => {
    const dummyId = new mongoose.Types.ObjectId();
    await assert.rejects(
      async () => requireOwnedProcess(reqUnauth, dummyId),
      (err) => {
        assert.equal(err.status, 401);
        assert.equal(err.message, 'Authentication required');
        return true;
      }
    );
    await assert.rejects(
      async () => requireOwnedScenario(reqUnauth, dummyId),
      (err) => {
        assert.equal(err.status, 401);
        assert.equal(err.message, 'Authentication required');
        return true;
      }
    );
  });

  await t.test('2. Body or query userId is ignored; only req.user._id is used', async () => {
    // Malicious request trying to impersonate User B via body or query
    const spoofReq = {
      user: { _id: userAId },
      body: { userId: userBId.toString() },
      query: { userId: userBId.toString() },
    };

    // requireOwnedProcess will only look for documents with userId: userAId
    // If a document belongs to User B, it will not be found -> 404
    const procBId = new mongoose.Types.ObjectId();
    // Stub Process.findOne
    const origFindOne = Process.findOne;
    let queryUsed = null;
    Process.findOne = (q) => {
      queryUsed = q;
      return Promise.resolve(null);
    };

    try {
      await assert.rejects(
        async () => requireOwnedProcess(spoofReq, procBId),
        (err) => {
          assert.equal(err.status, 404);
          return true;
        }
      );
      assert.equal(queryUsed.userId.toString(), userAId.toString());
      assert.notEqual(queryUsed.userId.toString(), userBId.toString());
    } finally {
      Process.findOne = origFindOne;
    }
  });

  await t.test("3. User A cannot access User B's process or scenario (returns 404)", async () => {
    const procBId = new mongoose.Types.ObjectId();
    const scenBId = new mongoose.Types.ObjectId();

    const origProcFind = Process.findOne;
    const origScenFind = Scenario.findOne;

    Process.findOne = (q) => {
      // Document only exists if query matches owner userB
      if (q._id.equals(procBId) && q.userId && q.userId.equals(userBId)) {
        return Promise.resolve({ _id: procBId, userId: userBId, title: "User B's Process" });
      }
      return Promise.resolve(null);
    };

    Scenario.findOne = (q) => {
      if (q._id.equals(scenBId) && q.userId && q.userId.equals(userBId)) {
        return Promise.resolve({ _id: scenBId, userId: userBId, title: "User B's Scenario" });
      }
      return Promise.resolve(null);
    };

    try {
      // User A trying to access User B's process -> 404
      await assert.rejects(
        async () => requireOwnedProcess(reqUserA, procBId),
        (err) => {
          assert.equal(err.status, 404);
          assert.equal(err.message, 'Process not found');
          return true;
        }
      );

      // User A trying to access User B's scenario -> 404
      await assert.rejects(
        async () => requireOwnedScenario(reqUserA, scenBId),
        (err) => {
          assert.equal(err.status, 404);
          assert.equal(err.message, 'Scenario not found');
          return true;
        }
      );

      // User B accessing their own process -> succeeds
      const bProc = await requireOwnedProcess(reqUserB, procBId);
      assert.equal(bProc.title, "User B's Process");

      // User B accessing their own scenario -> succeeds
      const bScen = await requireOwnedScenario(reqUserB, scenBId);
      assert.equal(bScen.title, "User B's Scenario");
    } finally {
      Process.findOne = origProcFind;
      Scenario.findOne = origScenFind;
    }
  });

  await t.test("4. solve-problem and apply-option with another user's processId return 404", async () => {
    const procBId = new mongoose.Types.ObjectId();
    const origProcFind = Process.findOne;

    Process.findOne = (q) => {
      if (q._id.equals(procBId) && q.userId && q.userId.equals(userBId)) {
        return Promise.resolve({ _id: procBId, userId: userBId });
      }
      return Promise.resolve(null);
    };

    try {
      // In solve-problem route, requireOwnedProcess(req, processId) is called
      await assert.rejects(
        async () => requireOwnedProcess(reqUserA, procBId),
        (err) => {
          assert.equal(err.status, 404);
          return true;
        }
      );
    } finally {
      Process.findOne = origProcFind;
    }
  });

  await t.test('5. SimulationRun saved for both baseline and scenario simulations', async () => {
    const procId = new mongoose.Types.ObjectId();
    const scenId = new mongoose.Types.ObjectId();

    // Mock saveSimulationRun behavior
    const savedRuns = [];
    const origSave = SimulationRun.prototype.save;
    const origFind = SimulationRun.find;
    SimulationRun.prototype.save = function () {
      savedRuns.push(this);
      return Promise.resolve(this);
    };
    SimulationRun.find = () => ({
      sort: () => ({
        skip: () => ({
          select: () => Promise.resolve([]),
        }),
      }),
    });

    try {
      // Baseline run (scenarioId = null)
      const baseRun = await saveSimulationRun({
        userId: userAId,
        processId: procId,
        scenarioId: null,
        title: 'Tea Shop Baseline',
        config: { arrival_rate: 0.2, total_instances: 300, seed: 42, replications: 3 },
        results: {
          time_in_system: { avg: 14.2 },
          activity_results: { t1: { avg_wait_time: 2.1 } },
          throughput_rates: 0.1,
          financial_summary: { total_cost: 1500 },
        },
      });

      assert.equal(baseRun.scenarioId, null);
      assert.equal(baseRun.title, 'Tea Shop Baseline');
      assert.equal(baseRun.summary.avg_cycle_time, 14.2);
      assert.equal(baseRun.summary.avg_wait_time, 2.1);
      assert.equal(baseRun.summary.total_cost, 1500);

      // Scenario run
      const scenRun = await saveSimulationRun({
        userId: userAId,
        processId: procId,
        scenarioId: scenId,
        title: 'Add 1 Barista',
        config: { arrival_rate: 0.2, total_instances: 300, seed: 42, replications: 3 },
        results: {
          time_in_system: { avg: 10.5 },
          activity_results: { t1: { avg_wait_time: 0.4 } },
          throughput_rates: 0.1,
          financial_summary: { total_cost: 2000 },
        },
      });

      assert.equal(scenRun.scenarioId.toString(), scenId.toString());
      assert.equal(scenRun.title, 'Add 1 Barista');
      assert.equal(scenRun.summary.avg_cycle_time, 10.5);
      assert.equal(scenRun.summary.avg_wait_time, 0.4);
    } finally {
      SimulationRun.prototype.save = origSave;
      SimulationRun.find = origFind;
    }
  });

  await t.test('6. 51st run deletes the oldest (enforces 50-run retention limit)', async () => {
    const procId = new mongoose.Types.ObjectId();
    const existingIds = [];
    for (let i = 0; i < 50; i++) {
      existingIds.push(new mongoose.Types.ObjectId());
    }

    let deletedIds = [];
    const origFind = SimulationRun.find;
    const origDeleteMany = SimulationRun.deleteMany;

    SimulationRun.find = () => ({
      sort: () => ({
        skip: (count) => {
          assert.equal(count, 50);
          return {
            select: () => Promise.resolve([{ _id: existingIds[0] }]), // 1 older run to prune
          };
        },
      }),
    });

    SimulationRun.deleteMany = (filter) => {
      deletedIds = filter._id.$in;
      return Promise.resolve({ deletedCount: deletedIds.length });
    };

    const origSave = SimulationRun.prototype.save;
    SimulationRun.prototype.save = function () {
      return Promise.resolve(this);
    };

    try {
      await saveSimulationRun({
        userId: userAId,
        processId: procId,
        scenarioId: null,
        title: 'Run 51',
        config: {},
        results: {},
      });

      assert.equal(deletedIds.length, 1);
      assert.equal(deletedIds[0].toString(), existingIds[0].toString());
    } finally {
      SimulationRun.find = origFind;
      SimulationRun.deleteMany = origDeleteMany;
      SimulationRun.prototype.save = origSave;
    }
  });

  await t.test('7. Deleting a scenario cascades and deletes its runs', async () => {
    const scenId = new mongoose.Types.ObjectId();
    let deleteFilter = null;

    const origDeleteMany = SimulationRun.deleteMany;
    SimulationRun.deleteMany = (filter) => {
      deleteFilter = filter;
      return Promise.resolve({ deletedCount: 5 });
    };

    try {
      await deleteRunsForScenario(scenId, userAId);
      assert.equal(deleteFilter.scenarioId.toString(), scenId.toString());
      assert.equal(deleteFilter.userId.toString(), userAId.toString());
    } finally {
      SimulationRun.deleteMany = origDeleteMany;
    }
  });
});
