import { useState } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { Shuffle, Play, BarChart2, Grid2X2, Lock } from 'lucide-react';
import { SpotLogo } from '../SpotLogo';
import { useAuth } from '@/context/AuthContext';
import { GuestLockModal } from '../auth/GuestLockModal';

/**
 * App layout component with navigation
 * @param {Object} props
 * @param {React.ReactNode} props.children - Child components
 */
const navItems = [
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

  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [lockMessage, setLockMessage] = useState(undefined);

  return (
    <div className="flex h-screen flex-col bg-slate-50 overflow-hidden w-full">
      {/* Top Header - Unified branding and navigation shell */}
      <header className="bg-white px-6 py-0 flex items-center justify-between border-b border-slate-200 z-10 flex-shrink-0 h-[56px]">
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

        {/* Right: User area */}
        <div className="flex items-center justify-end min-w-[200px] gap-3">
          {user ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-violet-100 text-[#5E43F3] font-bold text-sm flex items-center justify-center border border-violet-200">
                  {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                </div>
                <span className="text-sm font-semibold text-slate-700 max-w-[120px] truncate" title={user.name}>
                  {user.name}
                </span>
              </div>
              <button
                onClick={() => {
                  logout();
                  navigate('/');
                }}
                className="text-xs font-semibold text-slate-500 hover:text-red-600 transition-colors ml-1 cursor-pointer"
              >
                Log out
              </button>
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
