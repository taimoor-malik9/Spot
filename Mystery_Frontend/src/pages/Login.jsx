import React, { useState } from 'react';
import { Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useGoogleLogin } from '@react-oauth/google';
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import SpotLogo from '@/components/SpotLogo';
import { useAuth } from '@/context/AuthContext';
import AuthShowcase from '@/components/AuthShowcase';
import '@/styles/auth.css';

export default function Login() {
  const { user, login, googleLogin, continueAsGuest } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [notice, setNotice] = useState(() => location.state?.notice || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  // Redirect to /model ONLY for real authenticated users; guests can view login page
  if (user) {
    return <Navigate to="/model" replace />;
  }

  const validateField = (field, value) => {
    let err = '';
    if (field === 'email') {
      if (!value.trim()) {
        err = 'Email is required';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
        err = 'Enter a valid email';
      }
    } else if (field === 'password') {
      if (!value) {
        err = 'Password is required';
      }
    }
    setErrors(prev => ({ ...prev, [field]: err }));
    return !err;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError('');
    setNotice('');

    const validEmail = validateField('email', email);
    const validPassword = validateField('password', password);

    if (!validEmail || !validPassword) return;

    setIsSubmitting(true);
    try {
      await login(email, password, rememberMe);
      const target = location.state?.from?.pathname || '/model';
      navigate(target, { replace: true });
    } catch (err) {
      setServerError(err.message || 'Invalid email or password');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSuccess = async (codeResponse) => {
    setServerError('');
    setIsGoogleLoading(true);
    try {
      await googleLogin(codeResponse.code);
      const target = location.state?.from?.pathname || '/model';
      navigate(target, { replace: true });
    } catch (err) {
      setServerError(err.message || 'Google sign-in failed');
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const triggerGoogleLogin = useGoogleLogin({
    flow: 'auth-code',
    onSuccess: handleGoogleSuccess,
    onError: (err) => {
      console.warn('[Google Auth] Popup closed or failed:', err);
      setIsGoogleLoading(false);
      setServerError('Google sign-in cancelled');
    }
  });

  const handleGoogleClick = () => {
    setServerError('');
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      console.error('❌ Missing environment variable: VITE_GOOGLE_CLIENT_ID in Mystery_Frontend/.env');
      setServerError('Google sign-in unavailable');
      return;
    }
    setIsGoogleLoading(true);
    triggerGoogleLogin();
  };

  const handleGuestClick = () => {
    continueAsGuest();
    navigate('/model', { replace: true });
  };

  return (
    <div className="spot-auth">
      <div className="spot-auth-left">
        {/* Header */}
        <header className="spot-auth-header">
          <Link to="/" aria-label="SPOT Home">
            <SpotLogo size={36} showText={true} />
          </Link>
          <div className="spot-auth-header-link">
            New to SPOT? <Link to="/signup">Create an account</Link>
          </div>
        </header>

        {/* Form container */}
        <main className="spot-auth-form-shell">
          <h2 className="spot-auth-heading">Welcome back</h2>

          {notice && (
            <div className="spot-auth-success-alert" role="status">
              <CheckCircle2 size={16} />
              <span>{notice}</span>
            </div>
          )}

          {serverError && (
            <div className="spot-auth-alert" role="alert">
              <AlertCircle size={16} />
              <span>{serverError}</span>
            </div>
          )}

          {/* Google Button */}
          <button
            type="button"
            className="spot-auth-google-btn"
            onClick={handleGoogleClick}
            disabled={isGoogleLoading || isSubmitting}
          >
            {isGoogleLoading ? (
              <Loader2 size={18} className="animate-spin text-slate-500" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path fill="#4285F4" d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.83.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.95v2.33C2.43 15.98 5.48 18 9 18z"/>
                <path fill="#FBBC05" d="M3.96 10.71A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.28-1.71V4.96H.95A8.996 8.996 0 0 0 0 9c0 1.45.35 2.82.95 4.04l3.01-2.33z"/>
                <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0 5.48 0 2.43 2.02.95 4.96l3.01 2.33c.71-2.13 2.7-3.71 5.04-3.71z"/>
              </svg>
            )}
            <span>{isGoogleLoading ? 'Connecting…' : 'Continue with Google'}</span>
          </button>

          <div className="spot-auth-divider">
            <span>or</span>
          </div>

          <form onSubmit={handleSubmit} noValidate>
            {/* Email Field */}
            <div className="spot-auth-field">
              <label htmlFor="login-email" className="spot-auth-label">
                Email
              </label>
              <div className="spot-auth-input-wrapper">
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  className={`spot-auth-input ${errors.email ? 'has-error' : ''}`}
                  placeholder="name@example.com"
                  value={email}
                  onChange={e => {
                    setEmail(e.target.value);
                    if (errors.email) validateField('email', e.target.value);
                  }}
                  onBlur={e => validateField('email', e.target.value)}
                  aria-describedby={errors.email ? "login-email-error" : undefined}
                  autoComplete="username"
                  required
                />
              </div>
              {errors.email && (
                <div id="login-email-error" className="spot-auth-error-msg">
                  {errors.email}
                </div>
              )}
            </div>

            {/* Password Field */}
            <div className="spot-auth-field">
              <label htmlFor="login-password" className="spot-auth-label">
                Password
              </label>
              <div className="spot-auth-input-wrapper">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  className={`spot-auth-input ${errors.password ? 'has-error' : ''}`}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => {
                    setPassword(e.target.value);
                    if (errors.password) validateField('password', e.target.value);
                  }}
                  onBlur={e => validateField('password', e.target.value)}
                  aria-describedby={errors.password ? "login-password-error" : undefined}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="spot-auth-toggle-pwd"
                  onClick={() => setShowPassword(p => !p)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.password && (
                <div id="login-password-error" className="spot-auth-error-msg">
                  {errors.password}
                </div>
              )}
            </div>

            {/* Remember me & Forgot password */}
            <div className="spot-auth-row-options">
              <label className="spot-auth-checkbox-label">
                <input
                  type="checkbox"
                  className="spot-auth-checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                />
                Remember me
              </label>
              <Link to="/forgot-password" className="spot-auth-forgot-link">
                Forgot password?
              </Link>
            </div>

            {/* Primary Submit */}
            <button
              type="submit"
              className="spot-auth-primary-btn"
              disabled={isSubmitting || isGoogleLoading}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>Logging in…</span>
                </>
              ) : (
                'Log in'
              )}
            </button>
          </form>

          {/* Guest option - small centered text link */}
          <div className="spot-auth-guest-link-box">
            <button
              type="button"
              className="spot-auth-guest-link"
              onClick={handleGuestClick}
            >
              Continue as guest
            </button>
          </div>
        </main>

        {/* Footer */}
        <footer className="spot-auth-footer">
          <div>© 2026 SPOT</div>
          <div className="spot-auth-footer-links">
            <a href="#" onClick={e => e.preventDefault()}>Privacy</a>
            <a href="#" onClick={e => e.preventDefault()}>Terms</a>
          </div>
        </footer>
      </div>

      {/* Right Hero Panel */}
      <div className="spot-auth-right">
        <AuthShowcase />
      </div>
    </div>
  );
}
