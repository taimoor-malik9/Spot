import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, X } from 'lucide-react';

export function GuestLockModal({ isOpen, onClose }) {
  const navigate = useNavigate();

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-sm w-full p-6 text-center relative animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1 rounded-lg transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <div className="w-12 h-12 rounded-full bg-violet-50 text-[#5B3FE0] mx-auto flex items-center justify-center mb-4">
          <Lock size={22} />
        </div>

        <h3 className="text-lg font-bold text-slate-900 mb-5">Sign up to use this</h3>

        <div className="flex flex-col gap-2.5">
          <button
            onClick={() => {
              onClose();
              navigate('/signup');
            }}
            className="w-full h-11 rounded-xl bg-gradient-to-r from-[#5B3FE0] to-[#6D4DF0] text-white font-semibold text-sm shadow-sm hover:opacity-95 transition-opacity cursor-pointer"
          >
            Sign up
          </button>
          <button
            onClick={() => {
              onClose();
              navigate('/login');
            }}
            className="w-full h-11 rounded-xl border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors cursor-pointer"
          >
            Log in
          </button>
        </div>
      </div>
    </div>
  );
}
