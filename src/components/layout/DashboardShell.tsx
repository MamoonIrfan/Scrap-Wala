import React, { useState } from 'react';
import { Bell, HelpCircle, LogOut, Menu, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { GuidanceDrawer } from '../ui/Primitives';

export interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

export function DashboardShell({
  roleTitle,
  breadcrumb,
  navItems,
  activeTab,
  onSelectTab,
  guidanceTopic,
  onNavigate,
  children,
}: {
  roleTitle: string;
  breadcrumb: string;
  navItems: NavItem[];
  activeTab: string;
  onSelectTab: (id: string) => void;
  guidanceTopic: string;
  onNavigate: (path: string) => void;
  children: React.ReactNode;
}) {
  const {
    user,
    activeRole,
    setActiveRole,
    notifications,
    unreadCount,
    markNotificationRead,
    markAllNotificationsRead,
    logout,
  } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [guidanceOpen, setGuidanceOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    onNavigate('/login');
  };

  return (
    <div className="min-h-screen bg-[#F8FAF9] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:sticky lg:top-0 lg:h-screen w-64 shrink-0 bg-white border-r border-slate-200">
        <div className="h-16 px-6 flex items-center justify-between border-b border-slate-200">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('/');
            }}
            className="text-lg font-display font-bold text-slate-900 whitespace-nowrap"
          >
            Scrap Wala
          </a>
          <span className="text-xs font-medium text-teal-700">{roleTitle}</span>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto" aria-label={`${roleTitle} navigation`}>
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors text-left ${
                  active
                    ? 'bg-teal-50 text-teal-800'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="shrink-0">{item.icon}</span>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          {user && user.roles.length > 1 && (
            <div>
              <label htmlFor="role-switch" className="block text-xs text-slate-500 mb-1">
                Switch Role
              </label>
              <select
                id="role-switch"
                value={activeRole || ''}
                onChange={(e) => setActiveRole(e.target.value as typeof activeRole & string)}
                className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-2 bg-white text-slate-800"
              >
                {user.roles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="text-xs text-slate-600 truncate">
            <div className="font-medium text-slate-900 truncate">{user?.fullName}</div>
            <div className="truncate">{user?.email}</div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex bg-slate-900/30">
          <div className="w-72 bg-white h-full border-r border-slate-200 flex flex-col">
            <div className="h-14 px-5 flex items-center justify-between border-b border-slate-200">
              <span className="font-display font-bold text-slate-900">Scrap Wala · {roleTitle}</span>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close sidebar"
                className="p-2 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectTab(item.id);
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg text-left ${
                    activeTab === item.id ? 'bg-teal-50 text-teal-800' : 'text-slate-700'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
            <div className="p-4 border-t border-slate-200">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm font-medium text-slate-500 truncate">
              <span>{roleTitle}</span>
              <span className="mx-2 text-slate-300">/</span>
              <span className="text-slate-900 font-semibold">{breadcrumb}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 relative">
            <button
              type="button"
              onClick={() => setGuidanceOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap"
            >
              <HelpCircle className="w-4 h-4 text-teal-700" aria-hidden="true" />
              <span className="hidden sm:inline">Guidance</span>
            </button>

            <button
              type="button"
              onClick={() => setNotifOpen((v) => !v)}
              aria-label={`Notifications (${unreadCount} unread)`}
              className="relative inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap"
            >
              <Bell className="w-4 h-4" aria-hidden="true" />
              <span className="font-mono tabular-nums">{unreadCount}</span>
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-12 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900">
                    In-App Notifications ({unreadCount} unread)
                  </span>
                  <button
                    type="button"
                    onClick={() => void markAllNotificationsRead()}
                    className="text-xs text-teal-700 hover:underline"
                  >
                    Mark all read
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                  {notifications.length === 0 ? (
                    <div className="p-4 text-xs text-slate-500">No notifications yet.</div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        className={`p-3.5 text-xs space-y-1 ${n.is_read === 0 ? 'bg-teal-50/40' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-slate-900">{n.title}</span>
                          {n.is_read === 0 && (
                            <button
                              type="button"
                              onClick={() => void markNotificationRead(n.id)}
                              className="text-teal-700 hover:underline shrink-0"
                            >
                              Read
                            </button>
                          )}
                        </div>
                        <p className="text-slate-600">{n.body}</p>
                        <div className="text-[11px] text-slate-400">
                          {n.delivery_channel} · {new Date(n.created_at).toLocaleString()}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8 max-w-6xl w-full mx-auto">
          {user?.isDemoSeed && (
            <div className="mb-6 px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-700 flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>Demo Seed Account:</strong> You are signed into a pre-seeded demonstration profile. All records shown come from the live SQLite database.
              </span>
            </div>
          )}
          {children}
        </main>
      </div>

      <GuidanceDrawer
        open={guidanceOpen}
        topic={guidanceTopic}
        onClose={() => setGuidanceOpen(false)}
      />
    </div>
  );
}
