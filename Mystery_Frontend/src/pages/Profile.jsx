import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User,
  Mail,
  Lock,
  Building,
  Briefcase,
  DollarSign,
  Clock,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowLeft,
  KeyRound,
  Globe
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import PageShell from '@/components/layout/PageShell';
import '../styles/account-pages.css';
import { updateProfile, changePassword } from '../lib/apiService';

const BUSINESS_TYPES = [
  { value: 'retail', label: 'Retail & E-Commerce' },
  { value: 'food_beverage', label: 'Food & Beverage / Restaurant' },
  { value: 'healthcare', label: 'Healthcare & Clinical' },
  { value: 'manufacturing', label: 'Manufacturing & Production' },
  { value: 'logistics', label: 'Logistics & Supply Chain' },
  { value: 'it_services', label: 'IT Services & Software' },
  { value: 'banking_finance', label: 'Banking & Financial Services' },
  { value: 'education', label: 'Education & Training' },
  { value: 'hospitality', label: 'Hospitality & Tourism' },
  { value: 'other', label: 'Other' },
];

const CURRENCIES = [
  { value: 'Rs', label: 'Rs (Pakistani Rupee)' },
  { value: '$', label: '$ (US Dollar)' },
  { value: '€', label: '€ (Euro)' },
  { value: '£', label: '£ (British Pound)' },
  { value: '₹', label: '₹ (Indian Rupee)' },
  { value: 'A$', label: 'A$ (Australian Dollar)' },
  { value: 'C$', label: 'C$ (Canadian Dollar)' },
  { value: 'AED', label: 'AED (UAE Dirham)' },
];

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, updateUser, logout } = useAuth();
  const { preferredLanguage, setLanguage } = useLanguage();

  // Profile form state
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [businessName, setBusinessName] = useState(user?.businessName || '');
  const [businessType, setBusinessType] = useState(user?.businessType || 'retail');
  const [currency, setCurrency] = useState(user?.currency || 'Rs');
  const [workingHoursPerDay, setWorkingHoursPerDay] = useState(user?.workingHoursPerDay || 8);

  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(null);
  const [profileError, setProfileError] = useState(null);

  // Password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(null);
  const [passwordError, setPasswordError] = useState(null);

  // Sync state if user loads later
  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setEmail(user.email || '');
      setBusinessName(user.businessName || '');
      setBusinessType(user.businessType || 'retail');
      setCurrency(user.currency || 'Rs');
      setWorkingHoursPerDay(user.workingHoursPerDay || 8);
    }
  }, [user]);

  // Handle Profile Update (Name, Email, Business defaults)
  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);

    if (!name.trim()) {
      setProfileError('Name cannot be empty.');
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setProfileError('Please enter a valid email address.');
      return;
    }

    setProfileSaving(true);
    try {
      const res = await updateProfile({
        name: name.trim(),
        email: email.trim(),
        businessName: businessName.trim(),
        businessType,
        currency,
        workingHoursPerDay: Number(workingHoursPerDay) || 8,
        preferredLanguage,
      });

      const updatedUser = res.user || {
        name: name.trim(),
        email: email.trim(),
        businessName: businessName.trim(),
        businessType,
        currency,
        workingHoursPerDay: Number(workingHoursPerDay) || 8,
        preferredLanguage,
      };

      updateUser(updatedUser);
      setProfileSuccess('Profile updated successfully.');
      setTimeout(() => setProfileSuccess(null), 4000);
    } catch (err) {
      setProfileError(err.message || 'Failed to update profile.');
    } finally {
      setProfileSaving(false);
    }
  };

  // Handle Password Change
  const handleSavePassword = async (e) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (!currentPassword) {
      setPasswordError('Please enter your current password.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError('New password must be different from current password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    setPasswordSaving(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setPasswordSuccess('Password changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(null), 4000);
    } catch (err) {
      setPasswordError(err.message || 'Failed to change password.');
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <PageShell className="space-y-6">
        {/* Navigation & Header */}
        <div className="flex items-center gap-3 border-b border-slate-200 pb-5">
          <button
            onClick={() => navigate(-1)}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer"
            title="Go back"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Account Profile</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Manage your personal information, credentials, and simulation business preferences.
            </p>
          </div>
        </div>

        {/* User Card Summary */}
        <div className="spot-card bg-white rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-[#5E43F3] text-white font-bold text-2xl flex items-center justify-center shadow-sm">
              {user?.name ? user.name.charAt(0).toUpperCase() : 'U'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900">{user?.name || 'User'}</h2>
                <span className="spot-badge bg-emerald-50 text-emerald-700 border border-emerald-100">
                  <ShieldCheck size={12} />
                  <span>Active</span>
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{user?.email}</p>
              <div className="flex items-center gap-2 mt-2 text-[11px] text-slate-400">
                <span className="capitalize">{user?.provider || 'local'} Account</span>
                {user?.createdAt && (
                  <>
                    <span>·</span>
                    <span>Joined {new Date(user.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={() => {
              logout();
              navigate('/');
            }}
            className="text-xs font-semibold text-slate-500 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors self-start sm:self-center cursor-pointer"
          >
            Log out
          </button>
        </div>

        {/* Section 1: Profile & Business Defaults Form */}
        <div className="spot-card bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="spot-card-header">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <User size={17} className="text-[#5E43F3]" />
              <span>Personal Information</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Update your account profile and business defaults used by AI simulation intake.
            </p>
          </div>

          {profileSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2">
              <CheckCircle2 size={15} />
              <span>{profileSuccess}</span>
            </div>
          )}

          {profileError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2">
              <AlertTriangle size={15} />
              <span>{profileError}</span>
            </div>
          )}

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="spot-grid-2">
              {/* Full Name */}
              <div className="spot-field">
                <label>Full Name</label>
                <div className="spot-input-wrap">
                  <User size={16} className="spot-input-icon" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="spot-input bg-slate-50 border border-slate-200 text-slate-900 focus:bg-white focus:outline-none focus:border-[#5E43F3] focus:ring-1 focus:ring-[#5E43F3]"
                  />
                </div>
              </div>

              {/* Email Address */}
              <div className="spot-field">
                <label>Email Address</label>
                <div className="spot-input-wrap">
                  <Mail size={16} className="spot-input-icon" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="spot-input bg-slate-50 border border-slate-200 text-slate-900 focus:bg-white focus:outline-none focus:border-[#5E43F3] focus:ring-1 focus:ring-[#5E43F3]"
                  />
                </div>
              </div>
            </div>

            {/* Language Preferences */}
            <div className="p-6 pt-3 border-t border-slate-100">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">
                Language Preferences
              </h4>
              <div className="spot-field">
                <label>Preferred Application Language</label>
                <div className="spot-input-wrap">
                  <Globe size={16} className="spot-input-icon" />
                  <select
                    value={preferredLanguage}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="spot-input bg-slate-50 border border-slate-200 text-slate-900 focus:bg-white focus:outline-none focus:border-[#5E43F3] focus:ring-1 focus:ring-[#5E43F3] cursor-pointer"
                  >
                    <option value="en">English (en)</option>
                    <option value="ur-roman">Roman Urdu (ur-roman)</option>
                    <option value="ur">اردو (ur)</option>
                  </select>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Controls the language across all pages, AI intake, charts, and messages. Changes apply instantly.
                </p>
              </div>
            </div>

            {/* Business Defaults (Used by AI intake as defaults) */}
            <div className="pt-3 border-t border-slate-100">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">
                Business & Simulation Defaults
              </h4>
              <div className="spot-grid-2">
                {/* Business Name */}
                <div className="spot-field">
                  <label>Business / Company Name</label>
                  <div className="spot-input-wrap">
                    <Building size={16} className="spot-input-icon" />
                    <input
                      type="text"
                      placeholder="e.g. Acme Coffee Co."
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      className="spot-input bg-slate-50 border border-slate-200 text-slate-900 focus:bg-white focus:outline-none focus:border-[#5E43F3] focus:ring-1 focus:ring-[#5E43F3]"
                    />
                  </div>
                </div>

                {/* Business Type */}
                <div className="spot-field">
                  <label>Business Type / Industry</label>
                  <div className="spot-input-wrap">
                    <Briefcase size={16} className="spot-input-icon" />
                    <select
                      value={businessType}
                      onChange={(e) => setBusinessType(e.target.value)}
                      className="spot-input bg-slate-50 border border-slate-200 text-slate-900 focus:bg-white focus:outline-none focus:border-[#5E43F3] focus:ring-1 focus:ring-[#5E43F3] cursor-pointer"
                    >
                      {BUSINESS_TYPES.map((bt) => (
                        <option key={bt.value} value={bt.value}>
                          {bt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Currency */}
                <div className="spot-field">
                  <label>Default Currency (Used in AI intake)</label>
                  <div className="spot-input-wrap">
                    <DollarSign size={16} className="spot-input-icon" />
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="spot-input bg-slate-50 border border-slate-200 text-slate-900 focus:bg-white focus:outline-none focus:border-[#5E43F3] focus:ring-1 focus:ring-[#5E43F3] cursor-pointer"
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Working Hours Per Day */}
                <div className="spot-field">
                  <label>Working Hours Per Day</label>
                  <div className="spot-input-wrap">
                    <Clock size={16} className="spot-input-icon" />
                    <input
                      type="number"
                      min={1}
                      max={24}
                      value={workingHoursPerDay}
                      onChange={(e) => setWorkingHoursPerDay(e.target.value)}
                      className="spot-input bg-slate-50 border border-slate-200 text-slate-900 focus:bg-white focus:outline-none focus:border-[#5E43F3] focus:ring-1 focus:ring-[#5E43F3]"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="spot-card-footer">
              <button
                type="submit"
                disabled={profileSaving}
                className="spot-btn bg-[#5E43F3] hover:bg-[#4d35db] text-white shadow-xs transition-colors disabled:opacity-50"
              >
                {profileSaving ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Saving Changes...</span>
                  </>
                ) : (
                  <span>Save Profile Changes</span>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Section 2: Security & Password */}
        <div className="spot-card bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="spot-card-header">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Lock size={17} className="text-[#5E43F3]" />
              <span>Password & Security</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Change your password to keep your business workflows and simulation models secure.
            </p>
          </div>

          {passwordSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2">
              <CheckCircle2 size={15} />
              <span>{passwordSuccess}</span>
            </div>
          )}

          {passwordError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2">
              <AlertTriangle size={15} />
              <span>{passwordError}</span>
            </div>
          )}

          <form onSubmit={handleSavePassword} className="space-y-4">
            {/* Current Password */}
            <div className="spot-field max-w-[420px]">
              <label>Current Password</label>
              <div className="spot-input-wrap">
                <KeyRound size={16} className="spot-input-icon" />
                <input
                  type="password"
                  required
                  placeholder="Enter current password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="spot-input bg-slate-50 border border-slate-200 text-slate-900 focus:bg-white focus:outline-none focus:border-[#5E43F3] focus:ring-1 focus:ring-[#5E43F3]"
                />
              </div>
            </div>

            {/* New Password */}
            <div className="spot-field max-w-[420px]">
              <label>New Password</label>
              <div className="spot-input-wrap">
                <Lock size={16} className="spot-input-icon" />
                <input
                  type="password"
                  required
                  placeholder="8+ characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="spot-input bg-slate-50 border border-slate-200 text-slate-900 focus:bg-white focus:outline-none focus:border-[#5E43F3] focus:ring-1 focus:ring-[#5E43F3]"
                />
              </div>
            </div>

            {/* Confirm New Password */}
            <div className="spot-field max-w-[420px]">
              <label>Confirm New Password</label>
              <div className="spot-input-wrap">
                <Lock size={16} className="spot-input-icon" />
                <input
                  type="password"
                  required
                  placeholder="Repeat new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="spot-input bg-slate-50 border border-slate-200 text-slate-900 focus:bg-white focus:outline-none focus:border-[#5E43F3] focus:ring-1 focus:ring-[#5E43F3]"
                />
              </div>
            </div>

            <div className="spot-card-footer">
              <button
                type="submit"
                disabled={passwordSaving}
                className="spot-btn bg-[#5E43F3] hover:bg-[#4d35db] text-white shadow-xs transition-colors disabled:opacity-50"
              >
                {passwordSaving ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Updating Password...</span>
                  </>
                ) : (
                  <span>Update Password</span>
                )}
              </button>
            </div>
          </form>
        </div>
    </PageShell>
  );
}
