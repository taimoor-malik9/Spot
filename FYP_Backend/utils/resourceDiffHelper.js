const path = require('path');

let diffFn = null;

async function getComputeResourceChanges() {
  if (!diffFn) {
    const filePath = path.resolve(__dirname, '../shared/resourceDiff.js');
    const mod = await import(require('url').pathToFileURL(path.resolve(filePath)).href);
    diffFn = mod.computeResourceChanges;
  }
  return diffFn;
}

module.exports = {
  getComputeResourceChanges,
};
