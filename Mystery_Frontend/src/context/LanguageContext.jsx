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
    } catch {
      // ignore
    }

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

  const value = {
    preferredLanguage,
    setLanguage,
    isRTL: preferredLanguage === 'ur',
    t: (key, ...args) => t(key, preferredLanguage, ...args),
    supportedLanguages: SUPPORTED_LANGUAGES,
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
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
