import React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

const FALLBACK_STRINGS = {
  en: {
    title: 'Something went wrong',
    message: 'An unexpected error occurred. Please try reloading the page.',
    reload: 'Reload page',
  },
  'ur-roman': {
    title: 'Kuch ghalat ho gaya',
    message: 'Ghair mutawaqqe khata pesh aayi hai. Barah-e-karam page reload karein.',
    reload: 'Page reload karein',
  },
  ur: {
    title: 'کچھ غلط ہو گیا',
    message: 'غیر متوقع خرابی پیش آئی ہے۔ براہ کرم صفحہ دوبارہ لوڈ کریں۔',
    reload: 'صفحہ دوبارہ لوڈ کریں',
  },
};

function getActiveLanguage() {
  try {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('spot_preferredLanguage') : null;
    if (stored && ['en', 'ur-roman', 'ur'].includes(stored)) return stored;
    const docLang = typeof document !== 'undefined' ? document.documentElement.lang : '';
    if (docLang && docLang.startsWith('ur')) return 'ur';
  } catch {}
  return 'en';
}

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[AppErrorBoundary caught fatal render error]:', error, errorInfo);
  }

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      const lang = getActiveLanguage();
      const text = FALLBACK_STRINGS[lang] || FALLBACK_STRINGS.en;
      const isRtl = lang === 'ur';

      return (
        <div
          role="alert"
          dir={isRtl ? 'rtl' : 'ltr'}
          style={{
            minHeight: '100vh',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f8fafc',
            fontFamily: "'Inter', sans-serif",
            padding: '24px',
          }}
        >
          <div
            style={{
              maxWidth: 440,
              width: '100%',
              background: '#fff',
              borderRadius: 16,
              border: '1px solid #e2e8f0',
              boxShadow: '0 4px 16px rgba(15, 23, 42, 0.08)',
              padding: '32px 28px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: '#fee2e2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AlertCircle size={28} color="#ef4444" />
            </div>

            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: 0 }}>
              {text.title}
            </h1>

            <p style={{ fontSize: 14, color: '#64748b', margin: 0, lineHeight: 1.5 }}>
              {text.message}
            </p>

            <button
              type="button"
              onClick={this.handleReload}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 8,
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                background: '#6366f1',
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(99, 102, 241, 0.25)',
              }}
            >
              <RotateCcw size={16} />
              <span>{text.reload}</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
