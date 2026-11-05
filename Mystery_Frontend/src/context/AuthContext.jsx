import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { request } from '@/lib/apiService';

export const AuthContext = createContext(null);

const WORKSPACE_KEYS = [
  'spot:processId',
  'spot:processTitle',
  'spot:model:nodes',
  'spot:model:viewport',
  'spot:globalResources',
  'spot:activeScenarioId',
  'spot:simulationConfig',
  'spot:simulationResults',
  'spot:baselineResults',
  'spot:hasWhatIfResults',
];

function userIdOf(user) {
  return user?.id || user?._id || null;
}

function namespacedKey(userId, key) {
  return `spot:workspace:${String(userId)}:${key.replace(/^spot:/, '')}`;
}

function clearActiveWorkspace() {
  WORKSPACE_KEYS.forEach((key) => localStorage.removeItem(key));
  Object.keys(localStorage)
    .filter((key) => key.startsWith('spot:solveProblemThread:'))
    .forEach((key) => localStorage.removeItem(key));
}

function saveWorkspaceForUser(userId) {
  if (!userId) return;
  WORKSPACE_KEYS.forEach((key) => {
    const value = localStorage.getItem(key);
    const target = namespacedKey(userId, key);
    if (value === null) localStorage.removeItem(target);
    else localStorage.setItem(target, value);
  });
}

function restoreWorkspaceForUser(userId) {
  clearActiveWorkspace();
  if (!userId) return;

  WORKSPACE_KEYS.forEach((key) => {
    const value = localStorage.getItem(namespacedKey(userId, key));
    if (value !== null) localStorage.setItem(key, value);
  });
}

function switchWorkspace(user) {
  const nextUserId = userIdOf(user);
  const previousUserId = localStorage.getItem('spot:workspaceUserId');
  if (previousUserId && previousUserId !== String(nextUserId)) {
    saveWorkspaceForUser(previousUserId);
  }
  restoreWorkspaceForUser(nextUserId);
  if (nextUserId) localStorage.setItem('spot:workspaceUserId', String(nextUserId));
  else localStorage.removeItem('spot:workspaceUserId');
}

export const getStoredToken = () => {
  return localStorage.getItem('spot_token') || sessionStorage.getItem('spot_token') || null;
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(getStoredToken());
  const [isGuest, setIsGuest] = useState(() => sessionStorage.getItem('spot_guest') === 'true');
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    const activeUserId = localStorage.getItem('spot:workspaceUserId');
    saveWorkspaceForUser(activeUserId);
    clearActiveWorkspace();
    localStorage.removeItem('spot:workspaceUserId');
    localStorage.removeItem('spot_token');
    sessionStorage.removeItem('spot_token');
    sessionStorage.removeItem('spot_guest');
    setUser(null);
    setToken(null);
    setIsGuest(false);
  }, []);

  // Validate token on mount
  useEffect(() => {
    let isMounted = true;

    async function checkAuth() {
      const currentToken = getStoredToken();
      if (!currentToken) {
        if (isMounted) setLoading(false);
        return;
      }

      try {
        const data = await request('/api/auth/me', {
          headers: {
            Authorization: `Bearer ${currentToken}`
          }
        });

        if (isMounted) {
          switchWorkspace(data.user);
          setUser(data.user);
          setToken(currentToken);
          setIsGuest(false);
        }
      } catch (err) {
        console.error('Failed to verify session:', err);
        localStorage.removeItem('spot_token');
        sessionStorage.removeItem('spot_token');
        if (isMounted) {
          setUser(null);
          setToken(null);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    checkAuth();

    const handleUnauthorized = () => {
      logout();
    };

    window.addEventListener('spot:unauthorized', handleUnauthorized);
    return () => {
      isMounted = false;
      window.removeEventListener('spot:unauthorized', handleUnauthorized);
    };
  }, [logout]);

  const saveAuthSuccess = (newToken, newUser, rememberMe = true) => {
    switchWorkspace(newUser);
    sessionStorage.removeItem('spot_guest');
    if (rememberMe) {
      localStorage.setItem('spot_token', newToken);
      sessionStorage.removeItem('spot_token');
    } else {
      sessionStorage.setItem('spot_token', newToken);
      localStorage.removeItem('spot_token');
    }
    setToken(newToken);
    setUser(newUser);
    setIsGuest(false);
  };

  const login = async (email, password, rememberMe = true) => {
    const data = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    saveAuthSuccess(data.token, data.user, rememberMe);
    return data.user;
  };

  const signup = async (name, email, password, securityQuestions) => {
    const data = await request('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, securityQuestions })
    });

    // Auto-login on signup
    saveAuthSuccess(data.token, data.user, true);
    return data.user;
  };

  const googleLogin = async (codeOrPayload) => {
    const body = typeof codeOrPayload === 'string'
      ? { code: codeOrPayload }
      : codeOrPayload;
    const data = await request('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    if (data.requireSecurityQuestions) {
      return data;
    }

    saveAuthSuccess(data.token, data.user, true);
    return data.user;
  };

  const continueAsGuest = () => {
    const activeUserId = localStorage.getItem('spot:workspaceUserId');
    saveWorkspaceForUser(activeUserId);
    clearActiveWorkspace();
    localStorage.removeItem('spot:workspaceUserId');
    localStorage.removeItem('spot_token');
    sessionStorage.removeItem('spot_token');
    sessionStorage.setItem('spot_guest', 'true');
    setUser(null);
    setToken(null);
    setIsGuest(true);
  };

  const updateUser = useCallback((updatedUserData) => {
    setUser((prev) => (prev ? { ...prev, ...updatedUserData } : updatedUserData));
  }, []);

  const value = {
    user,
    token,
    isGuest,
    loading,
    login,
    signup,
    googleLogin,
    continueAsGuest,
    logout,
    updateUser
  };

  return (
    <AuthContext.Provider value={value}>
      {loading ? (
        <div style={{ display: 'flex', height: '100vh', width: '100vw', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC' }}>
          <div style={{ width: 32, height: 32, border: '3px solid #E2E8F0', borderTopColor: '#5E43F3', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
