import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { Shuffle, Play, BarChart2, Grid2X2, Lock, LayoutDashboard, User, LogOut, ChevronDown, Sliders } from 'lucide-react';
import { SpotLogo } from '../SpotLogo';
import { useAuth } from '@/context/AuthContext';
import { GuestLockModal } from '../auth/GuestLockModal';
import { useAnalystView } from '@/lib/labels';
import '../../styles/account-pages.css';

/**
 * App layout component with navigation
 * @param {Object} props
 * @param {React.ReactNode} props.children - Child components
 */
const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/model', label: 'Model', icon: Grid2X2 },
  { href: '/scenarios', label: 'Scenarios', icon: Shuffle },
  { href: '/simulate', label: 'Simulate', icon: Play },
  { href: '/results', label: 'Results', icon: BarChart2 },
];

export function AppLayout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;
  const { user, isGuest, logout } = useAuth();
  const [isAnalystView, toggleAnalystView] = useAnalystView(user?.id || user?._id);

  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [lockMessage, setLockMessage] = useState(undefined);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const avatarButtonRef = useRef(null);
  const menuDropdownRef = useRef(null);
  const [menuCoords, setMenuCoords] = useState({ top: 0, right: 0 });

  const updateMenuPosition = useCallback(() => {
    if (avatarButtonRef.current) {
      const rect = avatarButtonRef.current.getBoundingClientRect();
      const top = rect.bottom + 8;
      const right = Math.max(8, window.innerWidth - rect.right);
      setMenuCoords({ top, right });
    }
  }, []);

  useEffect(() => {
    if (!avatarMenuOpen) return;

    updateMenuPosition();

    function handleClickOutside(event) {
      if (
        avatarButtonRef.current &&
        !avatarButtonRef.current.contains(event.target) &&
        menuDropdownRef.current &&
        !menuDropdownRef.current.contains(event.target)
      ) {
        setAvatarMenuOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setAvatarMenuOpen(false);
      }
    }

    function handleResizeOrScroll() {
      updateMenuPosition();
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResizeOrScroll);
    window.addEventListener('scroll', handleResizeOrScroll, true);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResizeOrScroll);
      window.removeEventListener('scroll', handleResizeOrScroll, true);
    };
  }, [avatarMenuOpen, updateMenuPosition]);

  return (
    <div className="flex h-screen flex-col bg-slate-50 overflow-hidden w-full">
      {/* Top Header - Unified branding and navigation shell */}
      <header style={{ padding: '0 24px' }} className="bg-white flex items-center justify-between border-b border-slate-200 z-10 flex-shrink-0 h-[56px]">
        <Link to="/model" className="flex items-center hover:opacity-90 transition-opacity min-w-[200px]">
          <SpotLogo size="md" />
        </Link>
        
        {/* Center: Tabs */}
        <nav className="flex items-center h-full gap-8">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href) || (pathname === '/' && item.href === '/model');
            const Icon = item.icon;
            const isLocked = isGuest && item.href !== '/model';
            
            return (
              <Link
                key={item.href}
                to={item.href}
                title={isLocked ? "Sign up to use this" : undefined}
                onClick={(e) => {
                  if (isLocked) {
                    e.preventDefault();
                    setLockMessage("Create a free account to unlock AI, simulation and saving.");
                    setLockModalOpen(true);
                  }
                }}
                className={`relative flex items-center gap-2 h-full px-2 text-[15px] font-medium transition-all group ${
                  isActive
                    ? 'text-[#5E43F3]'
                    : isLocked
                    ? 'text-slate-400 opacity-60 hover:opacity-80'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon size={16} className={isActive ? "text-[#5E43F3]" : "text-slate-400 group-hover:text-slate-500"} />
                <span>{item.label}</span>
                {isLocked && <Lock size={12} className="text-slate-400 ml-0.5" />}
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#5E43F3] rounded-t-full" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Right: User area & Analyst View Switch */}
        <div className="flex items-center justify-end min-w-[200px] gap-4">
          {/* Analyst View Switch (stored per user in localStorage, default off) */}
          <div className="flex items-center gap-2" title="Toggle technical simulation analyst terms versus plain business language">
            <span className="text-xs font-semibold text-slate-500 hidden sm:inline select-none">
              Analyst view
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={isAnalystView}
              aria-label="Toggle Analyst view"
              onClick={() => toggleAnalystView()}
              style={{
                width: 36,
                height: 20,
                borderRadius: 10,
                background: isAnalystView ? '#5E43F3' : '#cbd5e1',
                position: 'relative',
                transition: 'background 0.2s',
                border: 'none',
                cursor: 'pointer',
                padding: 2,
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: '#ffffff',
                  transform: isAnalystView ? 'translateX(16px)' : 'translateX(0)',
                  transition: 'transform 0.2s',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                }}
              />
            </button>
          </div>

          {user ? (
            <div className="relative">
              <button
                ref={avatarButtonRef}
                type="button"
                onClick={() => setAvatarMenuOpen((prev) => !prev)}
                className="flex items-center gap-2 p-1 pl-1.5 pr-2.5 rounded-full hover:bg-slate-100 transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
                title="Account menu"
              >
                <div className="w-8 h-8 rounded-full bg-violet-100 text-[#5E43F3] font-bold text-sm flex items-center justify-center border border-violet-200 flex-shrink-0">
                  {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                </div>
                <span className="text-sm font-semibold text-slate-700 max-w-[120px] truncate">
                  {user.name}
                </span>
                <ChevronDown size={14} className="text-slate-400" />
              </button>

              {/* Avatar Dropdown Menu - rendered via Portal */}
              {avatarMenuOpen &&
                createPortal(
                  <div
                    ref={menuDropdownRef}
                    style={{
                      position: 'fixed',
                      top: `${menuCoords.top}px`,
                      right: `${menuCoords.right}px`,
                      zIndex: 99999,
                    }}
                    className="spot-menu bg-white rounded-2xl shadow-xl border border-slate-200/90 animate-in fade-in zoom-in-95 duration-100"
                  >
                    <div className="spot-menu-header">
                      <p className="text-xs font-semibold text-slate-900 truncate">{user.name}</p>
                      <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
                    </div>

                    <div className="py-1 flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setAvatarMenuOpen(false);
                          navigate('/profile');
                        }}
                        className="spot-menu-item text-slate-700 hover:bg-violet-50 hover:text-[#5E43F3] transition-colors"
                      >
                        <User size={15} />
                        <span>Profile Settings</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setAvatarMenuOpen(false);
                          navigate('/dashboard');
                        }}
                        className="spot-menu-item text-slate-700 hover:bg-violet-50 hover:text-[#5E43F3] transition-colors"
                      >
                        <LayoutDashboard size={15} />
                        <span>Dashboard</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleAnalystView()}
                        className="spot-menu-item text-slate-700 hover:bg-violet-50 hover:text-[#5E43F3] transition-colors flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <Sliders size={15} />
                          <span>Analyst View</span>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isAnalystView ? 'bg-violet-100 text-[#5E43F3]' : 'bg-slate-100 text-slate-500'}`}>
                          {isAnalystView ? 'ON' : 'OFF'}
                        </span>
                      </button>
                    </div>

                    <div className="spot-menu-footer">
                      <button
                        type="button"
                        onClick={() => {
                          setAvatarMenuOpen(false);
                          logout();
                          navigate('/');
                        }}
                        className="spot-menu-item text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors"
                      >
                        <LogOut size={15} />
                        <span>Log out</span>
                      </button>
                    </div>
                  </div>,
                  document.body
                )}
            </div>
          ) : isGuest ? (
            <div className="flex items-center gap-2.5">
              <span className="bg-slate-100 text-slate-600 text-xs px-2.5 py-1 rounded-full font-semibold border border-slate-200">
                Guest
              </span>
              <button
                onClick={() => navigate('/signup')}
                className="bg-[#5E43F3] text-white text-xs px-3.5 py-1.5 rounded-lg font-bold hover:bg-[#4d34dc] transition-colors shadow-xs cursor-pointer"
              >
                Sign up
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {/* Main: column so each route fills width (stretch) + can use flex-1 for height */}
      <div className="layout-app-main flex flex-1 flex-col min-h-0 min-w-0 w-full overflow-hidden">
        {children}
      </div>

      <GuestLockModal
        isOpen={lockModalOpen}
        onClose={() => setLockModalOpen(false)}
        message={lockMessage}
      />
    </div>
  );
}
