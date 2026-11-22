import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRINGS, t } from './i18n.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('i18n audit: all referenced keys in intake UI must exist in all languages', () => {
  it('updatingProcess exists and translates in en, ur-roman, and ur', () => {
    assert.ok(STRINGS.en.updatingProcess, 'updatingProcess must exist in en');
    assert.ok(STRINGS['ur-roman'].updatingProcess, 'updatingProcess must exist in ur-roman');
    assert.ok(STRINGS.ur.updatingProcess, 'updatingProcess must exist in ur');

    assert.strictEqual(t('updatingProcess', 'en'), 'Updating your process…');
    assert.ok(t('updatingProcess', 'ur-roman').includes('update'));
    assert.match(t('updatingProcess', 'ur'), /[\u0600-\u06FF]/);
  });

  it('confirmError exists and translates in en, ur-roman, and ur', () => {
    assert.ok(STRINGS.en.confirmError, 'confirmError must exist in en');
    assert.ok(STRINGS['ur-roman'].confirmError, 'confirmError must exist in ur-roman');
    assert.ok(STRINGS.ur.confirmError, 'confirmError must exist in ur');

    assert.strictEqual(t('confirmError', 'en'), "We couldn't open your process, tap to try again");
  });

  it('every t(...) key referenced in IntakeFlow.jsx, IntakeScreens.jsx, DiagramPreview.jsx, ConfirmationCard.jsx, and friendlyErrors.js exists across all languages', () => {
    const filesToAudit = [
      path.resolve(__dirname, '../../pages/IntakeFlow.jsx'),
      path.resolve(__dirname, '../../pages/IntakeScreens.jsx'),
      path.resolve(__dirname, '../../pages/ConfirmationCard.jsx'),
      path.resolve(__dirname, '../../components/model/DiagramPreview.jsx'),
      path.resolve(__dirname, 'friendlyErrors.js'),
    ];

    const referencedKeys = new Set();

    for (const filePath of filesToAudit) {
      assert.ok(fs.existsSync(filePath), `File to audit must exist: ${filePath}`);
      const content = fs.readFileSync(filePath, 'utf8');

      // Match literal keys: t('key', ...) or t("key", ...)
      const literalMatches = content.matchAll(/\bt\(\s*['"]([a-zA-Z0-9_]+)['"]/g);
      for (const m of literalMatches) {
        if (m[1] !== 'busyness_') {
          referencedKeys.add(m[1]);
        }
      }

      // Match dynamic expressions: t('busyness_' + ...)
      if (content.includes("t('busyness_'")) {
        referencedKeys.add('busyness_steady');
        referencedKeys.add('busyness_quiet');
        referencedKeys.add('busyness_packed');
      }
    }

    assert.ok(referencedKeys.size >= 50, `Expected at least 50 referenced keys, found ${referencedKeys.size}`);

    const languages = ['en', 'ur-roman', 'ur'];
    for (const lang of languages) {
      const missingKeys = [];
      for (const key of referencedKeys) {
        const val = STRINGS[lang]?.[key];
        const isDefined = typeof val === 'string' || typeof val === 'function';
        if (!isDefined) {
          missingKeys.push(key);
        }
      }

      assert.deepStrictEqual(
        missingKeys,
        [],
        `The following keys referenced in intake files are missing in language "${lang}": ${missingKeys.join(', ')}`
      );
    }
  });
});
