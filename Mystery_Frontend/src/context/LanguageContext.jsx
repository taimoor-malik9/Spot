import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { updateProfile } from '../lib/apiService';
import { t } from '../lib/intake/i18n';
import { LanguageContext } from './LanguageContextDef.js';

export { LanguageContext };

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN', dir: 'ltr' },
  { code: 'ur-roman', label: 'Roman Urdu', short: 'RU', dir: 'ltr' },
  { code: 'ur', label: 'اردو', short: 'اردو', dir: 'rtl' },
];

function getInitialLanguage() {
  try {
    const stored = localStorage.getItem('spot_preferredLanguage');
    if (stored && ['en', 'ur-roman', 'ur'].includes(stored)) {
      return stored;
    }
    const nav = typeof navigator !== 'undefined' ? (navigator.language || '').toLowerCase() : '';
    if (nav.startsWith('ur')) {
      return 'ur';
    }
  } catch (err) {
    // Non-blocking
  }
  return 'en';
}

export function LanguageProvider({ children }) {
  const { user, token, updateUser } = useAuth();
  const [preferredLanguage, setPreferredLanguageState] = useState(() => {
    if (user?.preferredLanguage && ['en', 'ur-roman', 'ur'].includes(user.preferredLanguage)) {
      return user.preferredLanguage;
    }
    return getInitialLanguage();
  });

  const [showLanguageCard, setShowLanguageCard] = useState(() => {
    try {
      const chosen = localStorage.getItem('spot_has_chosen_language');
      return !chosen;
    } catch {
      return false;
    }
  });

  // Apply DOM attributes (RTL, lang, font-urdu) whenever preferredLanguage changes
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const isUr = preferredLanguage === 'ur';
      document.documentElement.dir = isUr ? 'rtl' : 'ltr';
      document.documentElement.lang = isUr ? 'ur' : (preferredLanguage === 'ur-roman' ? 'ur-Latn' : 'en');
      if (document.body) {
        document.body.classList.toggle('font-urdu', isUr);
      }
    }
  }, [preferredLanguage]);

  // Sync with user document if user updates
  useEffect(() => {
    if (user?.preferredLanguage && ['en', 'ur-roman', 'ur'].includes(user.preferredLanguage)) {
      if (user.preferredLanguage !== preferredLanguage) {
        setPreferredLanguageState(user.preferredLanguage);
        try {
          localStorage.setItem('spot_preferredLanguage', user.preferredLanguage);
        } catch {
          // ignore
        }
      }
    }
  }, [user?.preferredLanguage]);

  const setLanguage = useCallback(async (newLang) => {
    if (!['en', 'ur-roman', 'ur'].includes(newLang)) return;

    setPreferredLanguageState(newLang);
    try {
      localStorage.setItem('spot_preferredLanguage', newLang);
      localStorage.setItem('spot_has_chosen_language', 'true');
    } catch {
      // ignore
    }
    setShowLanguageCard(false);

    if (token) {
      try {
        await updateProfile({ preferredLanguage: newLang });
        if (updateUser) {
          updateUser({ preferredLanguage: newLang });
        }
      } catch (err) {
        console.warn('Failed to persist preferredLanguage to user document:', err.message);
      }
    }
  }, [token, updateUser]);

  const dismissLanguageCard = useCallback(() => {
    try {
      localStorage.setItem('spot_has_chosen_language', 'true');
    } catch {
      // ignore
    }
    setShowLanguageCard(false);
  }, []);

  const value = {
    preferredLanguage,
    setLanguage,
    isRTL: preferredLanguage === 'ur',
    t: (key, ...args) => t(key, preferredLanguage, ...args),
    supportedLanguages: SUPPORTED_LANGUAGES,
  };

  const navUr = typeof navigator !== 'undefined' && (navigator.language || '').toLowerCase().startsWith('ur');

  return (
    <LanguageContext.Provider value={value}>
      {children}

      {/* One-time Choose your language card (Never blocks the app) */}
      {showLanguageCard && (
        <aside
          role="region"
          aria-label="Language selection"
          className="fixed bottom-5 right-5 z-[9999] bg-white border border-slate-200 rounded-2xl p-4 shadow-2xl max-w-sm w-full animate-in slide-in-from-bottom duration-200 text-left"
          style={{ direction: preferredLanguage === 'ur' ? 'rtl' : 'ltr' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-bold text-slate-900">
                {preferredLanguage === 'ur'
                  ? 'اپنی زبان منتخب کریں'
                  : (preferredLanguage === 'ur-roman' ? 'Apni zubaan chunein' : 'Choose your language')}
              </h4>
              <p className="text-xs text-slate-500 mt-1">
                {navUr
                  ? 'Would you prefer Urdu script (اردو) or Roman Urdu?'
                  : (preferredLanguage === 'ur'
                    ? 'آپ ایپ کو اردو، رومن اردو یا انگریزی میں استعمال کر سکتے ہیں۔'
                    : (preferredLanguage === 'ur-roman'
                      ? 'Aap app ko Roman Urdu, English ya Urdu script mein istemal kar sakte hain.'
                      : 'You can switch between English, Roman Urdu, and Urdu anytime.'))}
              </p>
            </div>
            <button
              type="button"
              onClick={dismissLanguageCard}
              className="text-slate-400 hover:text-slate-600 text-xs p-1 rounded-md cursor-pointer"
              title="Dismiss"
            >
              ✕
            </button>
          </div>

          <div className="mt-3 flex items-center gap-2">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => setLanguage(lang.code)}
                className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                  preferredLanguage === lang.code
                    ? 'bg-[#5E43F3] text-white border-[#5E43F3] shadow-xs'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </aside>
      )}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
