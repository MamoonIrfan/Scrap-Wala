import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  apiFetch,
  clearStoredTokens,
  getStoredTokens,
  setStoredTokens,
} from '../lib/api';
import type {
  AuthUser,
  MaterialCategory,
  MaterialUnit,
  NotificationItem,
  ServiceArea,
  UserRole,
} from '../types/domain';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  activeRole: UserRole | null;
  setActiveRole: (role: UserRole) => void;
  materials: MaterialCategory[];
  units: MaterialUnit[];
  serviceAreas: ServiceArea[];
  notifications: NotificationItem[];
  unreadCount: number;
  refreshNotifications: () => Promise<void>;
  markNotificationRead: (id: number) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (payload: Record<string, unknown>) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  refreshTaxonomy: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeRole, setActiveRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [materials, setMaterials] = useState<MaterialCategory[]>([]);
  const [units, setUnits] = useState<MaterialUnit[]>([]);
  const [serviceAreas, setServiceAreas] = useState<ServiceArea[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshTaxonomy = useCallback(async () => {
    try {
      const res = await apiFetch<{
        materials: MaterialCategory[];
        units: MaterialUnit[];
        serviceAreas: ServiceArea[];
      }>('/api/v1/public/taxonomy', { skipAuth: true });
      setMaterials(res.materials || []);
      setUnits(res.units || []);
      setServiceAreas(res.serviceAreas || []);
    } catch {
      // ignore initial taxonomy error
    }
  }, []);

  const refreshNotifications = useCallback(async () => {
    const { accessToken } = getStoredTokens();
    if (!accessToken) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    try {
      const res = await apiFetch<{ notifications: NotificationItem[]; unreadCount: number }>(
        '/api/v1/notifications'
      );
      setNotifications(res.notifications || []);
      setUnreadCount(res.unreadCount || 0);
    } catch {
      // ignore if token invalid
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const { accessToken } = getStoredTokens();
    if (!accessToken) {
      setUser(null);
      setActiveRole(null);
      setLoading(false);
      return;
    }
    try {
      const res = await apiFetch<{ user: AuthUser }>('/api/v1/auth/me');
      setUser(res.user);
      setActiveRole((prev) =>
        prev && res.user.roles.includes(prev) ? prev : res.user.roles[0] || null
      );
      await refreshNotifications();
    } catch {
      clearStoredTokens();
      setUser(null);
      setActiveRole(null);
    } finally {
      setLoading(false);
    }
  }, [refreshNotifications]);

  useEffect(() => {
    void refreshTaxonomy();
    void refreshUser();
  }, [refreshTaxonomy, refreshUser]);

  const login = async (email: string, password: string): Promise<AuthUser> => {
    const res = await apiFetch<{ user: AuthUser; accessToken: string; refreshToken: string }>(
      '/api/v1/auth/login',
      { method: 'POST', body: { email, password }, skipAuth: true }
    );
    setStoredTokens(res.accessToken, res.refreshToken);
    setUser(res.user);
    setActiveRole(res.user.roles[0] || null);
    await refreshNotifications();
    return res.user;
  };

  const register = async (payload: Record<string, unknown>): Promise<AuthUser> => {
    const res = await apiFetch<{ user: AuthUser; accessToken: string; refreshToken: string }>(
      '/api/v1/auth/register',
      { method: 'POST', body: payload, skipAuth: true }
    );
    setStoredTokens(res.accessToken, res.refreshToken);
    setUser(res.user);
    setActiveRole(res.user.roles[0] || null);
    await refreshNotifications();
    return res.user;
  };

  const logout = async () => {
    const { refreshToken } = getStoredTokens();
    try {
      await apiFetch('/api/v1/auth/logout', { method: 'POST', body: { refreshToken } });
    } catch {
      // always clear local session
    }
    clearStoredTokens();
    setUser(null);
    setActiveRole(null);
    setNotifications([]);
    setUnreadCount(0);
  };

  const markNotificationRead = async (id: number) => {
    await apiFetch(`/api/v1/notifications/${id}/read`, { method: 'POST' });
    await refreshNotifications();
  };

  const markAllNotificationsRead = async () => {
    await apiFetch('/api/v1/notifications/read-all', { method: 'POST' });
    await refreshNotifications();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        activeRole,
        setActiveRole,
        materials,
        units,
        serviceAreas,
        notifications,
        unreadCount,
        refreshNotifications,
        markNotificationRead,
        markAllNotificationsRead,
        login,
        register,
        logout,
        refreshUser,
        refreshTaxonomy,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
