/**
 * scripts/repairScenarios.js
 *
 * MODULE S1: Repair script that rebuilds existing broken scenarios
 * from their baseProcessId.
 *
 * Usage:
 *   node scripts/repairScenarios.js            # Dry-run (default)
 *   node scripts/repairScenarios.js --dry-run  # Dry-run explicit
 *   node scripts/repairScenarios.js --apply    # Apply fixes to MongoDB
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const Process = require('../models/Process');
const Scenario = require('../models/Scenario');
const { cloneProcessToScenario, normalizeEdges } = require('../utils/cloneProcessToScenario');

function isBrokenScenario(scenario, baseProcess) {
  const issues = [];

  // 1. Missing layoutElements when base has layoutElements
  const baseLayoutCount = Array.isArray(baseProcess.layoutElements) ? baseProcess.layoutElements.length : 0;
  const scenLayoutCount = Array.isArray(scenario.layoutElements) ? scenario.layoutElements.length : 0;
  if (baseLayoutCount > 0 && scenLayoutCount === 0) {
    issues.push(`layoutElements missing (base has ${baseLayoutCount}, scenario has 0)`);
  }

  // 2. Nodes missing position when base nodes have position
  const scenNodes = Array.isArray(scenario.nodes) ? scenario.nodes : [];
  const baseNodes = Array.isArray(baseProcess.nodes) ? baseProcess.nodes : [];
  const baseHasPos = baseNodes.some(n => n && n.position && n.position.x != null);
  const scenMissingPos = scenNodes.filter(n => !n || !n.position || n.position.x == null).length;
  if (baseHasPos && scenMissingPos > 0) {
    issues.push(`nodes missing position (${scenMissingPos}/${scenNodes.length} nodes)`);
  }

  // 3. Edge data saved as JSON strings
  const scenEdges = Array.isArray(scenario.edges) ? scenario.edges : [];
  const stringifiedEdges = scenEdges.filter(e => e && typeof e.data === 'string').length;
  if (stringifiedEdges > 0) {
    issues.push(`edges with stringified data (${stringifiedEdges}/${scenEdges.length} edges)`);
  }

  // 4. Missing simulationConfig or goal when base process has them
  if (baseProcess.simulationConfig && !scenario.simulationConfig) {
    issues.push('missing simulationConfig');
  }
  if (baseProcess.goal && !scenario.goal) {
    issues.push('missing goal');
  }

  return issues;
}

function extractOverrides(scenario, baseProcess) {
  const resourceChanges = [];
  const nodeChanges = [];

  const baseResources = Array.isArray(baseProcess.resources) ? baseProcess.resources : [];
  const scenResources = Array.isArray(scenario.resources) ? scenario.resources : [];

  // Resource overrides (quantity changes matched case-insensitively by name)
  for (const sRes of scenResources) {
    const sName = String(sRes.name || '').trim().toLowerCase();
    const bRes = baseResources.find(r => String(r.name || '').trim().toLowerCase() === sName);
    if (bRes && Number(sRes.quantity) !== Number(bRes.quantity)) {
      resourceChanges.push({
        name: sRes.name,
        quantity: sRes.quantity,
      });
    }
  }

  // Node duration overrides
  const baseNodes = Array.isArray(baseProcess.nodes) ? baseProcess.nodes : [];
  const scenNodes = Array.isArray(scenario.nodes) ? scenario.nodes : [];

  for (const sNode of scenNodes) {
    const bNode = baseNodes.find(n => String(n.id) === String(sNode.id));
    if (!bNode) continue;

    const sData = sNode.data && typeof sNode.data === 'object' ? sNode.data : sNode;
    const bData = bNode.data && typeof bNode.data === 'object' ? bNode.data : bNode;

    const sDur = Number(sData.duration);
    const bDur = Number(bData.duration);

    if (Number.isFinite(sDur) && Number.isFinite(bDur) && sDur !== bDur && bDur > 0) {
      nodeChanges.push({
        id: sNode.id,
        duration_multiplier: Number((sDur / bDur).toFixed(4)),
      });
    }
  }

  return { resourceChanges, nodeChanges };
}

async function runRepair() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const isDryRun = !isApply || args.includes('--dry-run');

  console.log('='.repeat(70));
  console.log(`SPOT Scenario Repair Script — Mode: ${isApply ? 'APPLY (Live DB Changes)' : 'DRY RUN (Preview Only)'}`);
  console.log('='.repeat(70));

  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/spot';
  await mongoose.connect(mongoUri);
  console.log(`Connected to MongoDB: ${mongoUri}\n`);

  try {
    const rawScenarios = await Scenario.collection.find({}).toArray();
    console.log(`Found ${rawScenarios.length} scenarios in database.\n`);

    let healthyCount = 0;
    let brokenCount = 0;
    let repairedCount = 0;
    let skippedCount = 0;

    for (const scen of rawScenarios) {
      const scenId = String(scen._id);
      const title = scen.title || 'Untitled Scenario';
      const baseId = scen.baseProcessId;

      if (!baseId) {
        console.log(`⚠️  [SKIP] Scenario "${title}" (${scenId}): No baseProcessId.`);
        skippedCount++;
        continue;
      }

      // Load raw base process from collection to avoid Mongoose stripping
      const rawBase = await Process.collection.findOne({ _id: new mongoose.Types.ObjectId(String(baseId)) });
      if (!rawBase) {
        console.log(`⚠️  [SKIP] Scenario "${title}" (${scenId}): Base process ${baseId} not found.`);
        skippedCount++;
        continue;
      }

      const issues = isBrokenScenario(scen, rawBase);
      if (issues.length === 0) {
        healthyCount++;
        continue;
      }

      brokenCount++;
      console.log(`🔍 [BROKEN] Scenario "${title}" (${scenId}) from Base "${rawBase.title}" (${baseId}):`);
      issues.forEach(issue => console.log(`   - Issue: ${issue}`));

      const { resourceChanges, nodeChanges } = extractOverrides(scen, rawBase);
      if (resourceChanges.length > 0) {
        console.log(`   - Preserving Resource Overrides: ${JSON.stringify(resourceChanges)}`);
      }
      if (nodeChanges.length > 0) {
        console.log(`   - Preserving Node Duration Overrides: ${JSON.stringify(nodeChanges)}`);
      }

      try {
        const rebuiltPayload = await cloneProcessToScenario(rawBase, {
          title: scen.title,
          resourceChanges,
          nodeChanges,
          simulationConfig: scen.simulationConfig || rawBase.simulationConfig || null,
          goal: scen.goal || rawBase.goal || null,
        });

        // Retain original simulation results if already present
        if (scen.simulationResults) {
          rebuiltPayload.simulationResults = scen.simulationResults;
        }

        if (isApply) {
          await Scenario.collection.updateOne(
            { _id: scen._id },
            {
              $set: {
                nodes: rebuiltPayload.nodes,
                edges: rebuiltPayload.edges,
                layoutElements: rebuiltPayload.layoutElements,
                resources: rebuiltPayload.resources,
                simulationConfig: rebuiltPayload.simulationConfig,
                goal: rebuiltPayload.goal,
              },
            }
          );
          console.log(`   ✅ REPAIRED: Rebuilt from base, restored ${rebuiltPayload.layoutElements.length} layoutElements, ${rebuiltPayload.nodes.length} nodes with positions, normalized ${rebuiltPayload.edges.length} edges.\n`);
        } else {
          console.log(`   📋 DRY-RUN: Would restore ${rebuiltPayload.layoutElements.length} layoutElements, ${rebuiltPayload.nodes.length} nodes with positions, normalize ${rebuiltPayload.edges.length} edges.\n`);
        }
        repairedCount++;
      } catch (err) {
        console.warn(`   ⚠️  Full rebuild failed BPMN validation: ${err.message.split('\n')[0]}`);
        console.log(`   🛠️  Applying direct repair: normalizing edge data to objects and restoring layoutElements from base...`);
        const normalizedEdges = normalizeEdges(scen.edges);
        const restoredLayout = (Array.isArray(scen.layoutElements) && scen.layoutElements.length > 0)
          ? scen.layoutElements
          : (rawBase.layoutElements || []);

        if (isApply) {
          await Scenario.collection.updateOne(
            { _id: scen._id },
            {
              $set: {
                edges: normalizedEdges,
                layoutElements: restoredLayout,
                simulationConfig: scen.simulationConfig || rawBase.simulationConfig || null,
                goal: scen.goal || rawBase.goal || null,
              },
            }
          );
          console.log(`   ✅ REPAIRED: Normalized edge data to objects, restored ${restoredLayout.length} layoutElements.\n`);
        } else {
          console.log(`   📋 DRY-RUN: Would normalize edge data to objects, restore ${restoredLayout.length} layoutElements.\n`);
        }
        repairedCount++;
      }
    }

    console.log('='.repeat(70));
    console.log('Repair Summary:');
    console.log(`  Total Scenarios Checked: ${rawScenarios.length}`);
    console.log(`  Healthy Scenarios:        ${healthyCount}`);
    console.log(`  Broken Scenarios Found:   ${brokenCount}`);
    console.log(`  ${isApply ? 'Successfully Repaired:' : 'Would Repair (Dry-Run):'}  ${repairedCount}`);
    console.log(`  Skipped / Failed:         ${skippedCount}`);
    console.log('='.repeat(70));

    if (!isApply && brokenCount > 0) {
      console.log('\nTo apply these repairs to MongoDB, run:');
      console.log('  node scripts/repairScenarios.js --apply\n');
    }

  } finally {
    await mongoose.disconnect();
    console.log('MongoDB disconnected.');
  }
}

if (require.main === module) {
  runRepair().catch(err => {
    console.error('Fatal error running repair script:', err);
    process.exit(1);
  });
}

module.exports = { runRepair, isBrokenScenario, extractOverrides };
