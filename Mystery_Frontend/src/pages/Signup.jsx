import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useGoogleLogin } from '@react-oauth/google';
import { Eye, EyeOff, Check, X, Loader2, AlertCircle } from 'lucide-react';
import SpotLogo from '@/components/SpotLogo';
import { useAuth } from '@/context/AuthContext';
import AuthShowcase from '@/components/AuthShowcase';
import '@/styles/auth.css';

const DEFAULT_QUESTIONS = [
  { id: 'q1', text: "What is your first pet's name?" },
  { id: 'q2', text: 'In what city were you born?' },
  { id: 'q3', text: 'What was your childhood nickname?' },
  { id: 'q4', text: 'What was the name of your first school?' },
  { id: 'q5', text: 'What street did you grow up on?' },
  { id: 'q6', text: "What is your best childhood friend's name?" },
  { id: 'q7', text: "What was your favorite teacher's name?" },
  { id: 'q8', text: 'What was your first mobile phone model?' },
  { id: 'q9', text: 'What is the first book you remember reading?' },
  { id: 'q10', text: 'What was your favorite childhood food?' },
];

export default function Signup() {
  const { user, signup, googleLogin, continueAsGuest } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [googleSignupData, setGoogleSignupData] = useState(() => location.state?.googleSignupData || null);
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);

  const [availableQuestions, setAvailableQuestions] = useState(DEFAULT_QUESTIONS);
  const [q1, setQ1] = useState('');
  const [a1, setA1] = useState('');
  const [q2, setQ2] = useState('');
  const [a2, setA2] = useState('');

  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  useEffect(() => {
    fetch('/api/auth/security-questions')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setAvailableQuestions(data);
        }
      })
      .catch(() => {});
  }, []);

  // Redirect to /model ONLY for real authenticated users; guests can view signup page
  if (user) {
    return <Navigate to="/model" replace />;
  }

  // Password checklist rules
  const rules = {
    length: password.length >= 8,
    cases: /[a-z]/.test(password) && /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };

  const isPasswordValid = rules.length && rules.cases && rules.number && rules.symbol;

  const validateField = (field, value) => {
    let err = '';
    if (field === 'name') {
      if (!value.trim()) err = 'Full name is required';
    } else if (field === 'email') {
      if (!value.trim()) {
        err = 'Email is required';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
        err = 'Enter a valid email';
      }
    } else if (field === 'password') {
      if (!value) {
        err = 'Password is required';
      } else if (!isPasswordValid) {
        err = 'Use 8+ characters';
      }
    } else if (field === 'agreeTerms') {
      if (!value) err = 'Please accept the terms';
    }
    setErrors(prev => ({ ...prev, [field]: err }));
    return !err;
  };

  const validateSecurity = () => {
    let err = '';
    if (!q1 || !q2) {
      err = 'Choose two different questions';
    } else if (q1 === q2) {
      err = 'Choose two different questions';
    } else if (a1.trim().replace(/\s+/g, ' ').length < 3 || a2.trim().replace(/\s+/g, ' ').length < 3) {
      err = 'Answer is too short';
    }
    setErrors(prev => ({ ...prev, security: err }));
    return !err;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError('');

    if (!isStep2) {
      const validName = validateField('name', name);
      const validEmail = validateField('email', email);
      const validPassword = validateField('password', password);
      const validTerms = validateField('agreeTerms', agreeTerms);

      if (!validName || !validEmail || !validPassword || !validTerms) return;
      setStep(2);
      return;
    }

    const validSecurity = validateSecurity();
    if (!validSecurity) return;

    setIsSubmitting(true);
    try {
      if (googleSignupData) {
        await googleLogin({
          googleSignupToken: googleSignupData.googleSignupToken,
          securityQuestions: [
            { questionId: q1, answer: a1 },
            { questionId: q2, answer: a2 }
          ]
        });
      } else {
        await signup(name, email, password, [
          { questionId: q1, answer: a1 },
          { questionId: q2, answer: a2 }
        ]);
      }
      navigate('/model', { replace: true });
    } catch (err) {
      if (err.status === 409 || err.message === 'Email already in use' || err.code === 'EMAIL_EXISTS' || (err.message && err.message.toLowerCase().includes('already in use'))) {
        setStep(1);
        setErrors(prev => ({ ...prev, email: 'Email already in use' }));
        document.getElementById('signup-email')?.focus();
      } else {
        setServerError(err.message || 'Failed to create account');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSuccess = async (codeResponse) => {
    setServerError('');
    setIsGoogleLoading(true);
    try {
      const res = await googleLogin({ code: codeResponse.code, mode: 'signup' });
      if (res?.requireSecurityQuestions) {
        setGoogleSignupData(res);
        return;
      }
      navigate('/model', { replace: true });
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
    },
    onNonOAuthError: () => {
      setIsGoogleLoading(false);
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

  const isStep2 = step === 2 || !!googleSignupData;

  return (
    <div className="spot-auth">
      <div className="spot-auth-left">
        {/* Header */}
        <header className="spot-auth-header">
          <Link to="/" aria-label="SPOT Home">
            <SpotLogo size={36} showText={true} />
          </Link>
          <div className="spot-auth-header-link">
            Already have an account? <Link to="/login">Log in</Link>
          </div>
        </header>

        {/* Form Container */}
        <main className="spot-auth-form-shell">
          <h2 className="spot-auth-heading">{isStep2 ? 'Security questions' : 'Create your account'}</h2>
          {isStep2 && (
            <p style={{ fontSize: 14, color: '#6B6B85', marginTop: -8, marginBottom: 20 }}>
              {googleSignupData
                ? `Finish setting up your account for ${googleSignupData.email}`
                : "Set up security questions to protect your account."}
            </p>
          )}

          {serverError && (
            <div className="spot-auth-alert" role="alert">
              <AlertCircle size={16} />
              <span>
                {serverError}
                {serverError.includes('already have an account') && (
                  <> <Link to="/login" style={{ color: '#5B3FE0', textDecoration: 'underline', fontWeight: 600 }}>Log in</Link></>
                )}
              </span>
            </div>
          )}

          {!isStep2 && (
            <>
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
                <span>{isGoogleLoading ? 'Connecting…' : 'Sign up with Google'}</span>
              </button>

              <div className="spot-auth-divider">
                <span>or</span>
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} noValidate>
            {!isStep2 && (
              <>
                {/* Full Name */}
                <div className="spot-auth-field">
                  <label htmlFor="signup-name" className="spot-auth-label">
                    Full name
                  </label>
                  <div className="spot-auth-input-wrapper">
                    <input
                      id="signup-name"
                      name="name"
                      type="text"
                      className={`spot-auth-input ${errors.name ? 'has-error' : ''}`}
                      placeholder="Jane Doe"
                      value={name}
                      onChange={e => {
                        setName(e.target.value);
                        if (errors.name) validateField('name', e.target.value);
                      }}
                      onBlur={e => validateField('name', e.target.value)}
                      aria-describedby={errors.name ? "signup-name-error" : undefined}
                      autoComplete="name"
                      required
                    />
                  </div>
                  {errors.name && (
                    <div id="signup-name-error" className="spot-auth-error-msg">
                      {errors.name}
                    </div>
                  )}
                </div>

                {/* Email Field */}
                <div className="spot-auth-field">
                  <label htmlFor="signup-email" className="spot-auth-label">
                    Email
                  </label>
                  <div className="spot-auth-input-wrapper">
                    <input
                      id="signup-email"
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
                      aria-describedby={errors.email ? "signup-email-error" : undefined}
                      autoComplete="username"
                      required
                    />
                  </div>
                  {errors.email && (
                    <div id="signup-email-error" className="spot-auth-error-msg">
                      {errors.email}
                    </div>
                  )}
                </div>

                {/* Password Field */}
                <div className="spot-auth-field">
                  <label htmlFor="signup-password" className="spot-auth-label">
                    Password
                  </label>
                  <div className="spot-auth-input-wrapper">
                    <input
                      id="signup-password"
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
                      aria-describedby="signup-pwd-rules"
                      autoComplete="new-password"
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

                  {/* Live 2x2 requirements checklist */}
                  <div id="signup-pwd-rules" className="spot-auth-pwd-checklist">
                    <div className={`spot-auth-pwd-item ${rules.length ? 'met' : ''}`}>
                      {rules.length ? <Check size={14} /> : <X size={14} />}
                      <span>8+ characters</span>
                    </div>
                    <div className={`spot-auth-pwd-item ${rules.cases ? 'met' : ''}`}>
                      {rules.cases ? <Check size={14} /> : <X size={14} />}
                      <span>Upper &amp; lowercase</span>
                    </div>
                    <div className={`spot-auth-pwd-item ${rules.number ? 'met' : ''}`}>
                      {rules.number ? <Check size={14} /> : <X size={14} />}
                      <span>A number</span>
                    </div>
                    <div className={`spot-auth-pwd-item ${rules.symbol ? 'met' : ''}`}>
                      {rules.symbol ? <Check size={14} /> : <X size={14} />}
                      <span>A symbol</span>
                    </div>
                  </div>

                  {errors.password && (
                    <div className="spot-auth-error-msg">
                      {errors.password}
                    </div>
                  )}
                </div>

                {/* Terms checkbox */}
                <div className="spot-auth-field" style={{ marginTop: 20 }}>
                  <label className="spot-auth-checkbox-label">
                    <input
                      type="checkbox"
                      className="spot-auth-checkbox"
                      checked={agreeTerms}
                      onChange={e => {
                        setAgreeTerms(e.target.checked);
                        if (errors.agreeTerms) validateField('agreeTerms', e.target.checked);
                      }}
                      required
                    />
                    <span>
                      I agree to the <a href="#" onClick={e => e.preventDefault()} style={{ color: '#5B3FE0' }}>Terms &amp; Privacy</a>
                    </span>
                  </label>
                  {errors.agreeTerms && (
                    <div className="spot-auth-error-msg">
                      {errors.agreeTerms}
                    </div>
                  )}
                </div>
              </>
            )}

            {isStep2 && (
              <>
                {/* Security Questions */}
            <div className="spot-auth-field" style={{ marginTop: 18 }}>
              <label htmlFor="signup-q1" className="spot-auth-label">
                Security question 1
              </label>
              <div className="spot-auth-input-wrapper">
                <select
                  id="signup-q1"
                  name="securityQuestion1"
                  className={`spot-auth-input ${errors.security ? 'has-error' : ''}`}
                  value={q1}
                  onChange={e => {
                    const val = e.target.value;
                    setQ1(val);
                    if (val === q2) setQ2('');
                    if (errors.security) setErrors(prev => ({ ...prev, security: '' }));
                  }}
                  required
                >
                  <option value="">Select a security question</option>
                  {availableQuestions.map(q => (
                    <option key={q.id} value={q.id}>{q.text}</option>
                  ))}
                </select>
              </div>
              <div className="spot-auth-input-wrapper" style={{ marginTop: 8 }}>
                <input
                  id="signup-a1"
                  name="securityAnswer1"
                  type="text"
                  className={`spot-auth-input ${errors.security ? 'has-error' : ''}`}
                  placeholder="Your answer"
                  value={a1}
                  onChange={e => {
                    setA1(e.target.value);
                    if (errors.security) setErrors(prev => ({ ...prev, security: '' }));
                  }}
                  autoComplete="off"
                  required
                />
              </div>
            </div>

            <div className="spot-auth-field" style={{ marginTop: 14 }}>
              <label htmlFor="signup-q2" className="spot-auth-label">
                Security question 2
              </label>
              <div className="spot-auth-input-wrapper">
                <select
                  id="signup-q2"
                  name="securityQuestion2"
                  className={`spot-auth-input ${errors.security ? 'has-error' : ''}`}
                  value={q2}
                  onChange={e => {
                    setQ2(e.target.value);
                    if (errors.security) setErrors(prev => ({ ...prev, security: '' }));
                  }}
                  required
                >
                  <option value="">Select a security question</option>
                  {availableQuestions.filter(q => q.id !== q1).map(q => (
                    <option key={q.id} value={q.id}>{q.text}</option>
                  ))}
                </select>
              </div>
              <div className="spot-auth-input-wrapper" style={{ marginTop: 8 }}>
                <input
                  id="signup-a2"
                  name="securityAnswer2"
                  type="text"
                  className={`spot-auth-input ${errors.security ? 'has-error' : ''}`}
                  placeholder="Your answer"
                  value={a2}
                  onChange={e => {
                    setA2(e.target.value);
                    if (errors.security) setErrors(prev => ({ ...prev, security: '' }));
                  }}
                  autoComplete="off"
                  required
                />
              </div>
              <p style={{ fontSize: 13, color: '#6B6B85', margin: '6px 0 0 0' }}>
                You'll need these to recover your account.
              </p>
              {errors.security && (
                <div className="spot-auth-error-msg">
                  {errors.security}
                </div>
              )}
            </div>
          </>
        )}

            {/* Primary Submit */}
            <button
              type="submit"
              className="spot-auth-primary-btn"
              disabled={isSubmitting || isGoogleLoading}
              style={{ marginTop: isStep2 ? 24 : 10 }}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>{isStep2 ? 'Creating account…' : 'Validating…'}</span>
                </>
              ) : (
                isStep2 ? 'Complete sign up' : 'Create account'
              )}
            </button>
          </form>

          {isStep2 ? (
            /* Back button to return to Step 1 */
            <div className="spot-auth-guest-link-box">
              <button
                type="button"
                className="spot-auth-guest-link"
                onClick={() => {
                  setServerError('');
                  if (googleSignupData) {
                    setGoogleSignupData(null);
                  }
                  setStep(1);
                }}
              >
                ← Back
              </button>
            </div>
          ) : (
            /* Guest option - small centered text link */
            <div className="spot-auth-guest-link-box">
              <button
                type="button"
                className="spot-auth-guest-link"
                onClick={handleGuestClick}
              >
                Continue as guest
              </button>
            </div>
          )}
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
