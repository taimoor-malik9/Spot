import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Check, X, Loader2, AlertCircle } from 'lucide-react';
import SpotLogo from '@/components/SpotLogo';
import AuthShowcase from '@/components/AuthShowcase';
import '@/styles/auth.css';

export default function ForgotPassword() {
  const navigate = useNavigate();

  // Multi-step: 1 = Email, 2 = Answers, 3 = New Password
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [questions, setQuestions] = useState([]);
  const [a1, setA1] = useState('');
  const [a2, setA2] = useState('');
  const [recoveryToken, setRecoveryToken] = useState(null);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [fieldErrors, setFieldErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Live password checklist rules
  const rules = {
    length: password.length >= 8,
    cases: /[a-z]/.test(password) && /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
  const isPasswordValid = rules.length && rules.cases && rules.number && rules.symbol;

  // Step 1: Submit Email
  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setServerError('');
    setFieldErrors({});

    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      setFieldErrors({ email: 'Email is required' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setFieldErrors({ email: 'Enter a valid email' });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/recovery/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setServerError(data.error || 'Recovery failed');
        return;
      }

      if (Array.isArray(data.questions) && data.questions.length === 2) {
        setQuestions(data.questions);
        setStep(2);
      } else {
        setServerError('Recovery failed');
      }
    } catch {
      setServerError('Recovery failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step 2: Submit Answers
  const handleAnswersSubmit = async (e) => {
    e.preventDefault();
    setServerError('');
    setFieldErrors({});

    if (!a1.trim() || !a2.trim()) {
      setServerError('Please answer both questions');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/recovery/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          answers: [a1, a2],
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setServerError(data.error || "Answers don't match");
        return;
      }

      if (data.token) {
        setRecoveryToken(data.token);
        setStep(3);
      } else {
        setServerError("Answers don't match");
      }
    } catch {
      setServerError("Answers don't match");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step 3: Submit New Password
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setServerError('');
    setFieldErrors({});

    if (!password) {
      setFieldErrors({ password: 'Password is required' });
      return;
    }
    if (!isPasswordValid) {
      setFieldErrors({ password: 'Use 8+ characters' });
      return;
    }
    if (password !== confirmPassword) {
      setFieldErrors({ confirmPassword: 'Passwords do not match' });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/recovery/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: recoveryToken,
          password,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setServerError(data.error || 'Session expired. Start again.');
        return;
      }

      // Success: redirect to /login with state notice
      navigate('/login', { replace: true, state: { notice: 'Password updated' } });
    } catch {
      setServerError('Session expired. Start again.');
    } finally {
      setIsSubmitting(false);
    }
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
            Remember your password? <Link to="/login">Log in</Link>
          </div>
        </header>

        {/* Form container */}
        <main className="spot-auth-form-shell">
          {step === 1 && (
            <>
              <h2 className="spot-auth-heading">Recover your account</h2>
              <p style={{ fontSize: 14, color: '#5A5A72', lineHeight: 1.5, marginTop: -14, marginBottom: 24 }}>
                Enter your account email to answer your security questions.
              </p>

              {serverError && (
                <div className="spot-auth-alert" role="alert">
                  <AlertCircle size={16} />
                  <span>{serverError}</span>
                </div>
              )}

              <form onSubmit={handleEmailSubmit} noValidate>
                <div className="spot-auth-field">
                  <label htmlFor="recovery-email" className="spot-auth-label">
                    Email
                  </label>
                  <div className="spot-auth-input-wrapper">
                    <input
                      id="recovery-email"
                      name="email"
                      type="email"
                      className={`spot-auth-input ${fieldErrors.email ? 'has-error' : ''}`}
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: '' }));
                      }}
                      autoComplete="username"
                      required
                    />
                  </div>
                  {fieldErrors.email && (
                    <div className="spot-auth-error-msg">
                      {fieldErrors.email}
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  className="spot-auth-primary-btn"
                  disabled={isSubmitting}
                  style={{ marginTop: 8 }}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      <span>Checking email…</span>
                    </>
                  ) : (
                    'Continue'
                  )}
                </button>
              </form>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="spot-auth-heading">Security questions</h2>
              <p style={{ fontSize: 14, color: '#5A5A72', lineHeight: 1.5, marginTop: -14, marginBottom: 24 }}>
                Answer the questions you set at signup.
              </p>

              {serverError && (
                <div className="spot-auth-alert" role="alert">
                  <AlertCircle size={16} />
                  <span>{serverError}</span>
                </div>
              )}

              <form onSubmit={handleAnswersSubmit} noValidate>
                {/* Question 1 */}
                <div className="spot-auth-field">
                  <label htmlFor="recovery-a1" className="spot-auth-label">
                    {questions[0]?.text || 'Security question 1'}
                  </label>
                  <div className="spot-auth-input-wrapper">
                    <input
                      id="recovery-a1"
                      name="answer1"
                      type="text"
                      className="spot-auth-input"
                      placeholder="Your answer"
                      value={a1}
                      onChange={(e) => setA1(e.target.value)}
                      autoComplete="off"
                      required
                    />
                  </div>
                </div>

                {/* Question 2 */}
                <div className="spot-auth-field" style={{ marginTop: 16 }}>
                  <label htmlFor="recovery-a2" className="spot-auth-label">
                    {questions[1]?.text || 'Security question 2'}
                  </label>
                  <div className="spot-auth-input-wrapper">
                    <input
                      id="recovery-a2"
                      name="answer2"
                      type="text"
                      className="spot-auth-input"
                      placeholder="Your answer"
                      value={a2}
                      onChange={(e) => setA2(e.target.value)}
                      autoComplete="off"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="spot-auth-primary-btn"
                  disabled={isSubmitting}
                  style={{ marginTop: 24 }}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      <span>Verifying…</span>
                    </>
                  ) : (
                    'Verify answers'
                  )}
                </button>
              </form>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="spot-auth-heading">Set new password</h2>
              <p style={{ fontSize: 14, color: '#5A5A72', lineHeight: 1.5, marginTop: -14, marginBottom: 24 }}>
                Enter your new password below.
              </p>

              {serverError && (
                <div className="spot-auth-alert" role="alert">
                  <AlertCircle size={16} />
                  <span>{serverError}</span>
                </div>
              )}

              <form onSubmit={handlePasswordSubmit} noValidate>
                {/* New Password */}
                <div className="spot-auth-field">
                  <label htmlFor="recovery-password" className="spot-auth-label">
                    New password
                  </label>
                  <div className="spot-auth-input-wrapper">
                    <input
                      id="recovery-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      className={`spot-auth-input ${fieldErrors.password ? 'has-error' : ''}`}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-describedby="recovery-pwd-rules"
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      className="spot-auth-toggle-pwd"
                      onClick={() => setShowPassword((p) => !p)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>

                  {/* Requirements checklist */}
                  <div id="recovery-pwd-rules" className="spot-auth-pwd-checklist">
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

                  {fieldErrors.password && (
                    <div className="spot-auth-error-msg">
                      {fieldErrors.password}
                    </div>
                  )}
                </div>

                {/* Confirm Password */}
                <div className="spot-auth-field" style={{ marginTop: 16 }}>
                  <label htmlFor="recovery-confirm-password" className="spot-auth-label">
                    Confirm password
                  </label>
                  <div className="spot-auth-input-wrapper">
                    <input
                      id="recovery-confirm-password"
                      name="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      className={`spot-auth-input ${fieldErrors.confirmPassword ? 'has-error' : ''}`}
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      className="spot-auth-toggle-pwd"
                      onClick={() => setShowConfirmPassword((p) => !p)}
                      aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                    >
                      {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {fieldErrors.confirmPassword && (
                    <div className="spot-auth-error-msg">
                      {fieldErrors.confirmPassword}
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  className="spot-auth-primary-btn"
                  disabled={isSubmitting}
                  style={{ marginTop: 24 }}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      <span>Updating password…</span>
                    </>
                  ) : (
                    'Reset password'
                  )}
                </button>
              </form>
            </>
          )}

          <div className="spot-auth-guest-link-box" style={{ marginTop: 24 }}>
            <Link to="/login" className="spot-auth-guest-link">
              ← Back to log in
            </Link>
          </div>
        </main>

        {/* Footer */}
        <footer className="spot-auth-footer">
          <div>© 2026 SPOT</div>
          <div className="spot-auth-footer-links">
            <a href="#" onClick={(e) => e.preventDefault()}>Privacy</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Terms</a>
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
