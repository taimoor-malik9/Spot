// Mystery_Frontend/src/lib/intake/sharedSync.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Shared BPMN Module Sync Verification', () => {
  const sharedDir = path.resolve(__dirname, '../../../../FYP_Backend/shared');

  const filesToSync = [
    {
      frontendPath: path.resolve(__dirname, 'compileBpmn.js'),
      sharedPath: path.resolve(sharedDir, 'compileBpmn.js'),
      name: 'compileBpmn.js',
    },
    {
      frontendPath: path.resolve(__dirname, 'validateBpmn.js'),
      sharedPath: path.resolve(sharedDir, 'validateBpmn.js'),
      name: 'validateBpmn.js',
    },
    {
      frontendPath: path.resolve(__dirname, 'deterministicNormalizer.js'),
      sharedPath: path.resolve(sharedDir, 'deterministicNormalizer.js'),
      name: 'deterministicNormalizer.js',
    },
    {
      frontendPath: path.resolve(__dirname, 'stepListHelper.js'),
      sharedPath: path.resolve(sharedDir, 'stepListHelper.js'),
      name: 'stepListHelper.js',
    },
    {
      frontendPath: path.resolve(__dirname, '../aiDiagramLayout.js'),
      sharedPath: path.resolve(sharedDir, 'aiDiagramLayout.js'),
      name: 'aiDiagramLayout.js',
    },
    {
      frontendPath: path.resolve(__dirname, '../whatIfComparison.js'),
      sharedPath: path.resolve(sharedDir, 'whatIfComparison.js'),
      name: 'whatIfComparison.js',
    },
  ];

  for (const { frontendPath, sharedPath, name } of filesToSync) {
    it(`Shared module "${name}" must match frontend copy byte-for-byte`, () => {
      assert(fs.existsSync(sharedPath), `Shared file missing: ${sharedPath}`);
      assert(fs.existsSync(frontendPath), `Frontend file missing: ${frontendPath}`);

      const sharedContent = fs.readFileSync(sharedPath, 'utf8');
      const frontendContent = fs.readFileSync(frontendPath, 'utf8');

      const normalizeLineEndings = (content) => content.replace(/\r\n/g, '\n');
      assert.strictEqual(
        normalizeLineEndings(frontendContent),
        normalizeLineEndings(sharedContent),
        `Frontend copy of ${name} must match FYP_Backend/shared/${name}. Keep them in sync!`
      );
    });
  }
});
