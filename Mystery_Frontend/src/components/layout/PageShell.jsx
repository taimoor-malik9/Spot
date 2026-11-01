import React from 'react';
import '../../styles/account-pages.css';

/**
 * Standard page shell container for Profile and Dashboard pages.
 * Conforms to Module UI1 & UI2 requirements:
 * - max-width 1200px
 * - centered (mx-auto)
 * - horizontal padding 24px (32px at >=1280px)
 * - vertical padding 24px
 * - uses explicit .spot-page class from account-pages.css
 */
export function PageShell({ children, className = '' }) {
  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 w-full min-h-0">
      <div className={`spot-page ${className}`}>
        {children}
      </div>
    </div>
  );
}

export default PageShell;
