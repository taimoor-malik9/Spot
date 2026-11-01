#!/usr/bin/env node
/**
 * migrateLegacyOwnership.js
 *
 * Dry-run-first migration script that assigns legacy unowned documents (Process, Scenario, SimulationRun)
 * to a user specified by email.
 *
 * Usage:
 *   node migrateLegacyOwnership.js --email <user-email>
 *   node migrateLegacyOwnership.js --email <user-email> --apply
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const User = require('../models/User');
const Process = require('../models/Process');
const Scenario = require('../models/Scenario');
const { SimulationRun } = require('../models/SimulationRun');

async function main() {
  const args = process.argv.slice(2);
  let email = null;
  let apply = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) {
      email = args[i + 1];
      i++;
    } else if (args[i].startsWith('--email=')) {
      email = args[i].split('=')[1];
    } else if (args[i] === '--apply') {
      apply = true;
    }
  }

  if (!email) {
    console.error('❌ Error: --email <user-email> is required.');
    console.error('Usage: node migrateLegacyOwnership.js --email <email> [--apply]');
    process.exit(1);
  }

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('❌ Error: MONGO_URI is not set in environment.');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB');

  const normalizedEmail = email.trim().toLowerCase();
  const targetUser = await User.findOne({ email: normalizedEmail });

  if (!targetUser) {
    console.error(`❌ Error: User with email "${normalizedEmail}" not found in database.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`👤 Target user found: ${targetUser.name} (${targetUser.email}) [ID: ${targetUser._id}]`);

  const unownedFilter = {
    $or: [
      { userId: { $exists: false } },
      { userId: null },
    ],
  };

  const processCount = await Process.countDocuments(unownedFilter);
  const scenarioCount = await Scenario.countDocuments(unownedFilter);
  const runCount = await SimulationRun.countDocuments(unownedFilter);

  console.log('\n--- Legacy Unowned Documents Audit ---');
  console.log(`  Processes without owner:     ${processCount}`);
  console.log(`  Scenarios without owner:     ${scenarioCount}`);
  console.log(`  Simulation runs without owner: ${runCount}`);
  console.log('--------------------------------------\n');

  if (!apply) {
    console.log('🔍 [DRY RUN] No changes were made to the database.');
    console.log(`To assign these ${processCount + scenarioCount + runCount} document(s) to "${normalizedEmail}", re-run with --apply:`);
    console.log(`  node ${path.basename(__filename)} --email ${email} --apply\n`);
  } else {
    console.log(`⚙️  Applying ownership migration to user: ${normalizedEmail}...`);

    const pRes = await Process.updateMany(unownedFilter, { $set: { userId: targetUser._id } });
    const sRes = await Scenario.updateMany(unownedFilter, { $set: { userId: targetUser._id } });
    const rRes = await SimulationRun.updateMany(unownedFilter, { $set: { userId: targetUser._id } });

    console.log('✅ [APPLIED] Migration completed successfully:');
    console.log(`  Processes updated:     ${pRes.modifiedCount}`);
    console.log(`  Scenarios updated:     ${sRes.modifiedCount}`);
    console.log(`  Simulation runs updated: ${rRes.modifiedCount}\n`);
  }

  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal migration error:', err);
    process.exit(1);
  });
}

module.exports = { main };
