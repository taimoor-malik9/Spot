const path = require('path');

let diffFn = null;
let taskDiffFn = null;
let allDiffFn = null;

async function getModule() {
  const filePath = path.resolve(__dirname, '../shared/resourceDiff.js');
  return await import(require('url').pathToFileURL(path.resolve(filePath)).href);
}

async function getComputeResourceChanges() {
  if (!diffFn) {
    const mod = await getModule();
    diffFn = mod.computeResourceChanges;
  }
  return diffFn;
}

async function getComputeTaskChanges() {
  if (!taskDiffFn) {
    const mod = await getModule();
    taskDiffFn = mod.computeTaskChanges;
  }
  return taskDiffFn;
}

async function getComputeAllChanges() {
  if (!allDiffFn) {
    const mod = await getModule();
    allDiffFn = mod.computeAllChanges;
  }
  return allDiffFn;
}

module.exports = {
  getComputeResourceChanges,
  getComputeTaskChanges,
  getComputeAllChanges,
};
