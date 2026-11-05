/**
 * lib/intake/interpolationSafety.test.js
 *
 * Verification of i18n interpolation safety and Results page summary rendering
 * across en, ur-roman, and ur.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { t } from './i18n.js';

describe('i18n Interpolation Safety', () => {
  it('objects, null, undefined, NaN, and Infinity never produce "[object Object]", "undefined", or "NaN" in output', () => {
    const BAD_OUTPUT_PATTERNS = ['[object Object]', 'undefined', 'NaN'];

    const testCases = [
      // 1. null / undefined
      { key: 'results_customerNeedsWork', lang: 'en', args: [null] },
      { key: 'results_customerNeedsWork', lang: 'ur-roman', args: [undefined] },
      { key: 'results_customerNeedsWork', lang: 'ur', args: [null] },

      // 2. NaN / Infinity
      { key: 'results_customerNeedsWork', lang: 'en', args: [NaN] },
      { key: 'results_customerNeedsWork', lang: 'ur-roman', args: [Infinity] },
      { key: 'results_customerNeedsWork', lang: 'ur', args: [NaN] },

      // 3. Plain objects
      { key: 'results_roleCanHandle', lang: 'en', args: [{ name: 'Chef' }] },
      { key: 'results_roleCanHandle', lang: 'ur-roman', args: [{ label: 'Barista' }] },
      { key: 'results_roleCanHandle', lang: 'ur', args: [{ title: 'Specialist' }] },
      { key: 'results_roleCanHandle', lang: 'ur-roman', args: [{}] },

      // 4. React elements (object with $$typeof and props)
      {
        key: 'results_roleCanHandle',
        lang: 'ur-roman',
        args: [React.createElement('bdi', { dir: 'auto' }, 'Cashier')],
      },
      {
        key: 'results_customerNeedsWork',
        lang: 'ur-roman',
        args: [React.createElement('strong', null, React.createElement('bdi', { dir: 'ltr' }, '4.5m'))],
      },

      // 5. Multi-param functions with mixed invalid values
      {
        key: 'results_calloutOverloadedWithArrival',
        lang: 'ur-roman',
        args: [{ name: 'Cook' }, NaN, null, undefined],
      },
      {
        key: 'results_calloutOverloadedNoArrival',
        lang: 'en',
        args: [{ label: 'Doctor' }, undefined, NaN],
      },
      {
        key: 'results_calloutTight',
        lang: 'ur',
        args: [{ name: 'نرس' }, NaN, null],
      },
      {
        key: 'results_calloutOk',
        lang: 'ur-roman',
        args: [React.createElement('span', null, 'Driver'), undefined, null],
      },
    ];

    for (const tc of testCases) {
      const output = t(tc.key, tc.lang, ...tc.args);
      assert.equal(typeof output, 'string', `Output for ${tc.key} must be a string`);
      for (const bad of BAD_OUTPUT_PATTERNS) {
        assert.ok(
          !output.includes(bad),
          `Output "${output}" for key "${tc.key}" in ${tc.lang} must not contain "${bad}"`
        );
      }
    }
  });

  it('normal strings and valid numbers are preserved without alteration', () => {
    // String argument
    const strEn = t('results_customerNeedsWork', 'en', '2.5m');
    assert.equal(strEn, 'A customer needs about 2.5m of actual work.');

    const strUrRoman = t('results_customerNeedsWork', 'ur-roman', '2.5m');
    assert.equal(strUrRoman, 'Ek customer ko taqreeban 2.5m ka haqeeqi kaam darpesh hota hai.');

    const strUr = t('results_customerNeedsWork', 'ur', '2.5 منٹ');
    assert.equal(strUr, 'ایک گاہک کے لیے تقریباً 2.5 منٹ کا حقیقی کام درکار ہوتا ہے۔');

    // Number argument
    const numEn = t('results_inADayHours', 'en', 8);
    assert.equal(numEn, 'in a 8-hour day');

    const roleUrRoman = t('results_roleCanHandle', 'ur-roman', 'Chef');
    assert.equal(roleUrRoman, 'Chef sambhal sakta hai');

    const roleUr = t('results_roleCanHandle', 'ur', 'شیف');
    assert.equal(roleUr, 'شیف سنبھال سکتا ہے');
  });
});

describe('Results Summary Render Test', () => {
  it('renders Results summary in en, ur-roman and ur without "[object Object]", "undefined", "NaN", or unreplaced {placeholder}', () => {
    const fixedSampleResult = {
      runs: 500,
      arrival_rate: 1.2,
      time_in_system: {
        avg: 18.5,
        min: 6.0,
        max: 35.0,
        count: 500,
      },
      activity_results: {
        task_order: { avg_processing_time: 2.0, avg_wait_time: 1.5 },
        task_bake: { avg_processing_time: 12.0, avg_wait_time: 3.0 },
      },
      resource_utilization: {
        Chef: {
          capacity: 1,
          utilization_pct: 92,
          avg_busy_time_per_item: 14.0,
        },
      },
    };

    const languages = ['en', 'ur-roman', 'ur'];

    for (const lang of languages) {
      // Replicate the Results summary text generation
      const workStr = '14.0m';
      const waitStr = '4.5m';
      const roleName = 'Chef';
      const arrivalRateStr = (fixedSampleResult.arrival_rate * 60).toFixed(1);
      const capacityStr = '4.3';
      const targetArrivalStr = '3.4';
      const utilStr = '92';

      // 1. Performance Overview text
      const sentence1 = t('results_customerNeedsWork', lang, workStr);
      const sentence2 = t('results_customersArriveFaster', lang, roleName);
      const sentence3 = t('results_averageWaitInLine', lang, waitStr);
      const sentence4 = t('results_workedOutFromCustomers', lang, fixedSampleResult.runs);

      // 2. Callout text
      const calloutOverloadedWithArrival = t(
        'results_calloutOverloadedWithArrival',
        lang,
        roleName,
        arrivalRateStr,
        capacityStr,
        targetArrivalStr
      );
      const calloutOverloadedNoArrival = t(
        'results_calloutOverloadedNoArrival',
        lang,
        roleName,
        utilStr,
        capacityStr
      );
      const calloutTight = t('results_calloutTight', lang, roleName, utilStr, capacityStr);
      const calloutOk = t('results_calloutOk', lang, roleName, capacityStr, arrivalRateStr);

      // 3. Role capacity bar
      const roleBarLabel = t('results_roleCanHandle', lang, roleName);

      // 4. Comparison string
      const compareString = t('results_comparingCurrentVsIdea', lang, 'Faster Oven');

      const allRenderedStrings = [
        sentence1,
        sentence2,
        sentence3,
        sentence4,
        calloutOverloadedWithArrival,
        calloutOverloadedNoArrival,
        calloutTight,
        calloutOk,
        roleBarLabel,
        compareString,
      ];

      for (const str of allRenderedStrings) {
        assert.ok(!str.includes('[object Object]'), `Language ${lang}: must not contain [object Object]: "${str}"`);
        assert.ok(!str.includes('undefined'), `Language ${lang}: must not contain undefined: "${str}"`);
        assert.ok(!str.includes('NaN'), `Language ${lang}: must not contain NaN: "${str}"`);
        assert.ok(!/\{[a-zA-Z0-9_]+\}/.test(str), `Language ${lang}: must not contain unreplaced placeholder: "${str}"`);
      }

      // Also render full JSX markup using ReactDOMServer
      const element = React.createElement(
        'div',
        { lang, dir: lang === 'ur' ? 'rtl' : 'ltr' },
        React.createElement('p', null, `${sentence1} ${sentence2} ${sentence3} ${sentence4}`),
        React.createElement('div', { className: 'callout' }, calloutOverloadedWithArrival),
        React.createElement('span', null, roleBarLabel)
      );

      const html = ReactDOMServer.renderToStaticMarkup(element);
      assert.ok(!html.includes('[object Object]'), `HTML for ${lang} must not contain [object Object]`);
      assert.ok(!html.includes('undefined'), `HTML for ${lang} must not contain undefined`);
      assert.ok(!html.includes('NaN'), `HTML for ${lang} must not contain NaN`);
    }
  });
});
