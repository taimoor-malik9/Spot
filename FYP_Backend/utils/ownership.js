const mongoose = require('mongoose');
const Process = require('../models/Process');
const Scenario = require('../models/Scenario');

/**
 * Loads a process owned by the authenticated user (req.user._id).
 * Throws 401 if unauthenticated, 404 if not found or not owned.
 * Never trusts a userId passed in body or query.
 */
async function requireOwnedProcess(req, processId) {
  if (!req.user || (!req.user._id && !req.user.id)) {
    const err = new Error('Authentication required');
    err.status = 401;
    throw err;
  }
  if (!processId || !mongoose.Types.ObjectId.isValid(processId)) {
    const err = new Error('Process not found');
    err.status = 404;
    throw err;
  }
  const userId = req.user._id || req.user.id;
  const doc = await Process.findOne({ _id: processId, userId });
  if (!doc) {
    const err = new Error('Process not found');
    err.status = 404;
    throw err;
  }
  return doc;
}

/**
 * Loads a scenario owned by the authenticated user (req.user._id).
 * Throws 401 if unauthenticated, 404 if not found or not owned.
 * Never trusts a userId passed in body or query.
 */
async function requireOwnedScenario(req, scenarioId) {
  if (!req.user || (!req.user._id && !req.user.id)) {
    const err = new Error('Authentication required');
    err.status = 401;
    throw err;
  }
  if (!scenarioId || !mongoose.Types.ObjectId.isValid(scenarioId)) {
    const err = new Error('Scenario not found');
    err.status = 404;
    throw err;
  }
  const userId = req.user._id || req.user.id;
  const doc = await Scenario.findOne({ _id: scenarioId, userId });
  if (!doc) {
    const err = new Error('Scenario not found');
    err.status = 404;
    throw err;
  }
  return doc;
}

module.exports = {
  requireOwnedProcess,
  requireOwnedScenario,
};
