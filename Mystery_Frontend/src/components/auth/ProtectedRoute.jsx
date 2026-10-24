import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

export function ProtectedRoute({ children }) {
  const { user, isGuest, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;

  if (!user && !isGuest) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
