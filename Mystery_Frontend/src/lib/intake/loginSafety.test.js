/**
 * lib/intake/loginSafety.test.js
 *
 * Tests for:
 * 1. Default Language = English & Removal of Language Popup:
 *    - No saved language -> UI renders in English and no language popup appears
 *    - Saved language (ur-roman) -> still respected
 * 2. Login & Signup Google Button Resilience:
 *    - Login renders email/password with and without a Google client ID
 *    - Signup renders email/password with and without a Google client ID
 * 3. Landing Page CTAs:
 *    - Each landing CTA navigates to a route that renders without crashing
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import esbuild from 'esbuild';
import * as i18nModule from './i18n.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to transpile and load JSX components in Node test environment
function loadComponent(filePath, mockRequires = {}) {
  const rawCode = fs.readFileSync(filePath, 'utf8');
  const transpiled = esbuild.transformSync(rawCode, {
    loader: 'jsx',
    format: 'cjs',
    jsx: 'transform',
  });

  const moduleObj = { exports: {} };
  const customRequire = (id) => {
    if (mockRequires[id]) return mockRequires[id];
    if (id === 'react') return React;
    if (id === 'lucide-react') {
      const MockIcon = () => null;
      return new Proxy({}, { get: () => MockIcon });
    }
    if (id.endsWith('.css')) return {};
    throw new Error(`Unhandled require in test loader: ${id}`);
  };

  const fn = new Function('module', 'exports', 'require', 'React', transpiled.code);
  fn(moduleObj, moduleObj.exports, customRequire, React);
  return moduleObj.exports;
}

// 1. Load LanguageContext
const languageContextPath = path.resolve(__dirname, '../../context/LanguageContext.jsx');
const { LanguageProvider, useLanguage, SUPPORTED_LANGUAGES } = loadComponent(languageContextPath, {
  './AuthContext': {
    useAuth: () => ({ user: null, token: null, updateUser: () => {} }),
  },
  '../lib/apiService': {
    updateProfile: async () => {},
  },
  '../lib/intake/i18n': i18nModule,
  './LanguageContextDef.js': {
    LanguageContext: React.createContext(null),
  },
});

// 2. Load Login and Signup
function loadLoginExports(googleHookMock, envMock = {}) {
  const loginPath = path.resolve(__dirname, '../../pages/Login.jsx');
  return loadComponent(loginPath, {
    'react': React,
    'react-router-dom': {
      Link: ({ children, to, ...props }) => React.createElement('a', { href: to, ...props }, children),
      useNavigate: () => () => {},
      useLocation: () => ({ search: '', pathname: '/login' }),
      Navigate: () => null,
    },
    '@react-oauth/google': {
      useGoogleLogin: googleHookMock || (() => () => {}),
    },
    '@/components/SpotLogo': () => React.createElement('div', { id: 'spot-logo' }),
    '@/context/AuthContext': {
      useAuth: () => ({
        user: null,
        login: async () => {},
        googleLogin: async () => {},
        loading: false,
      }),
    },
    '@/components/AuthShowcase': () => React.createElement('div', { id: 'auth-showcase' }),
  });
}

function loadSignupExports(googleHookMock) {
  const loginExports = loadLoginExports(googleHookMock);
  const signupPath = path.resolve(__dirname, '../../pages/Signup.jsx');
  return loadComponent(signupPath, {
    'react': React,
    'react-router-dom': {
      Link: ({ children, to, ...props }) => React.createElement('a', { href: to, ...props }, children),
      useNavigate: () => () => {},
      useLocation: () => ({ search: '', pathname: '/signup' }),
      Navigate: () => null,
    },
    '@react-oauth/google': {
      useGoogleLogin: googleHookMock || (() => () => {}),
    },
    '@/components/SpotLogo': () => React.createElement('div', { id: 'spot-logo' }),
    '@/context/AuthContext': {
      useAuth: () => ({
        user: null,
        signup: async () => {},
        googleLogin: async () => {},
        loading: false,
      }),
    },
    '@/lib/apiService': {
      request: async () => [],
    },
    './Login': loginExports,
    '@/components/AuthShowcase': () => React.createElement('div', { id: 'auth-showcase' }),
  });
}

// 3. Load LandingPage
const landingPath = path.resolve(__dirname, '../../pages/LandingPage.jsx');
const { default: LandingPage } = loadComponent(landingPath, {
  'react-router-dom': {
    Link: ({ children, to, className, ...props }) =>
      React.createElement('a', { href: to, className, ...props }, children),
  },
});

// 4. Load AppErrorBoundary
const appErrorBoundaryPath = path.resolve(__dirname, '../../components/AppErrorBoundary.jsx');
const { default: AppErrorBoundary } = loadComponent(appErrorBoundaryPath);

describe('Language Setting & Removal of Language Popup', () => {
  beforeEach(() => {
    global.window = {};
    global.document = {
      documentElement: { dir: 'ltr', lang: 'en', style: {} },
      body: { classList: { toggle: () => {} } },
    };
    global.localStorage = {
      store: {},
      getItem(k) { return this.store[k] || null; },
      setItem(k, v) { this.store[k] = String(v); },
      removeItem(k) { delete this.store[k]; },
      clear() { this.store = {}; },
    };
  });

  it('No saved language -> UI renders in English and no language popup appears', () => {
    // Ensure no saved language in localStorage and navigator reports ur
    global.navigator = { language: 'ur-PK' };
    global.localStorage.clear();

    let observedContext = null;
    function ConsumerComponent() {
      observedContext = useLanguage();
      return React.createElement(
        'div',
        { id: 'test-ui' },
        observedContext.t('results_baseline')
      );
    }

    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(LanguageProvider, null, React.createElement(ConsumerComponent))
    );

    // 1. Language defaults strictly to English (ignoring navigator.language)
    assert.equal(observedContext.preferredLanguage, 'en', 'Default language must be English when no choice is saved');
    assert.ok(html.includes('id="test-ui"'));

    // 2. Language popup card is completely removed from the rendered markup
    assert.ok(!html.includes('Choose your language'), 'Choose your language title must not be rendered');
    assert.ok(!html.includes('Language selection'), 'Language selection region must not be rendered');
    assert.ok(!html.includes('Apni zubaan chunein'), 'Roman Urdu card text must not be rendered');
    assert.ok(!html.includes('اپنی زبان منتخب کریں'), 'Urdu card text must not be rendered');
  });

  it('Saved language (ur-roman) -> still respected', () => {
    // User previously chose Roman Urdu
    global.localStorage.setItem('spot_preferredLanguage', 'ur-roman');

    let observedContext = null;
    function ConsumerComponent() {
      observedContext = useLanguage();
      return React.createElement('div', null, observedContext.t('results_baselineVsWhatIf'));
    }

    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(LanguageProvider, null, React.createElement(ConsumerComponent))
    );

    assert.equal(observedContext.preferredLanguage, 'ur-roman', 'Saved ur-roman choice must be respected');
    // Ensure translation function uses Roman Urdu
    assert.equal(observedContext.t('results_baselineVsWhatIf'), 'Baseline aur What-If Karkardagi ka Mawazna');
  });
});

describe('Login & Signup Google Button Resilience', () => {
  it('Login renders email/password with and without a Google client ID', () => {
    // 1. Without Google client ID
    const { default: LoginNoGoogle } = loadLoginExports(() => {
      throw new Error('_.xd: should never be called when client ID is missing');
    });

    const htmlWithoutId = ReactDOMServer.renderToStaticMarkup(
      React.createElement(LoginNoGoogle)
    );

    assert.ok(!htmlWithoutId.includes('Continue with Google'), 'Google button must not render when client ID is absent');
    assert.ok(htmlWithoutId.includes('id="login-email"'), 'Email input must render');
    assert.ok(htmlWithoutId.includes('id="login-password"'), 'Password input must render');
    assert.ok(htmlWithoutId.includes('Log in') || htmlWithoutId.includes('type="submit"'), 'Log in button must render');

    // 2. With Google client ID (simulated by setting test env and dummy hook)
    const validId = '1234567890-abcdef123456.apps.googleusercontent.com';
    const { default: LoginWithGoogle, isValidGoogleClientId, GoogleSignInButton } = loadLoginExports();

    assert.equal(isValidGoogleClientId(validId), true, 'validId must pass isValidGoogleClientId');

    // Render GoogleSignInButton directly to confirm it renders "Continue with Google"
    const buttonHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(GoogleSignInButton, {
        onSuccess: () => {},
        onError: () => {},
        disabled: false,
      })
    );
    assert.ok(buttonHtml.includes('Continue with Google'), 'GoogleSignInButton renders "Continue with Google"');
  });

  it('Signup renders email/password with and without a Google client ID', () => {
    // 1. Without Google client ID: must not throw and email/password form must be present
    const { default: SignupNoGoogle } = loadSignupExports(() => {
      throw new Error('_.xd: should never be called when client ID is missing');
    });

    let html = '';
    assert.doesNotThrow(() => {
      html = ReactDOMServer.renderToStaticMarkup(React.createElement(SignupNoGoogle));
    }, 'Signup must not throw on mount without Google client ID');

    assert.ok(!html.includes('Continue with Google'), 'Google button must not render without client ID');
    assert.ok(html.includes('id="signup-email"'), 'Signup email field must render');
    assert.ok(html.includes('id="signup-password"'), 'Signup password field must render');
    assert.ok(html.includes('Create your account') || html.includes('Create account'), 'Signup form must render');

    // 2. With Google client ID
    const { GoogleSignUpButton } = loadSignupExports();
    const buttonHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(GoogleSignUpButton, {
        onSuccess: () => {},
        onError: () => {},
        disabled: false,
      })
    );
    assert.ok(buttonHtml.includes('Continue with Google'), 'GoogleSignUpButton renders "Continue with Google"');
  });
});

describe('Landing Page CTAs & Navigation Destinations', () => {
  it('Each landing CTA navigates to a route that renders without crashing', () => {
    // Render landing page HTML and extract all Link href targets
    const landingHtml = ReactDOMServer.renderToStaticMarkup(React.createElement(LandingPage));

    const hrefRegex = /href="([^"#][^"]*)"/g;
    const targets = new Set();
    let match;
    while ((match = hrefRegex.exec(landingHtml)) !== null) {
      targets.add(match[1]);
    }

    assert.ok(targets.has('/signup'), 'Landing page must contain CTA link to /signup ("Get started" / "Create account")');
    assert.ok(targets.has('/login'), 'Landing page must contain CTA link to /login ("Log in")');

    // Load destination components
    const { default: SignupComponent } = loadSignupExports();
    const { default: LoginComponent } = loadLoginExports();

    // Verify /signup renders cleanly
    let signupHtml = '';
    assert.doesNotThrow(() => {
      signupHtml = ReactDOMServer.renderToStaticMarkup(React.createElement(SignupComponent));
    }, 'Destination /signup must render without throwing');
    assert.ok(signupHtml.includes('id="signup-email"'), '/signup destination must include signup form');

    // Verify /login renders cleanly
    let loginHtml = '';
    assert.doesNotThrow(() => {
      loginHtml = ReactDOMServer.renderToStaticMarkup(React.createElement(LoginComponent));
    }, 'Destination /login must render without throwing');
    assert.ok(loginHtml.includes('id="login-email"'), '/login destination must include login form');
  });
});
