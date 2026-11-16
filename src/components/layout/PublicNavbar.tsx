import React, { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export function PublicNavbar({
  currentPath,
  onNavigate,
}: {
  currentPath: string;
  onNavigate: (path: string) => void;
}) {
  const { user, activeRole } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navLinks = [
    { label: 'How It Works', path: '/how-it-works' },
    { label: 'Materials', path: '/materials' },
    { label: 'About', path: '/about' },
    { label: 'Contact', path: '/contact' },
  ];

  const workspacePath = user
    ? activeRole === 'ADMIN'
      ? '/admin'
      : activeRole === 'BUYER'
      ? '/buyer'
      : activeRole === 'COLLECTOR'
      ? '/collector'
      : '/seller'
    : '/login';

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onNavigate('/');
          }}
          className="text-xl font-display font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          Scrap Wala
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600" aria-label="Main navigation">
          {navLinks.map((item) => (
            <a
              key={item.path}
              href={item.path}
              onClick={(e) => {
                e.preventDefault();
                onNavigate(item.path);
              }}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-slate-900 ${
                currentPath === item.path ? 'text-teal-700 font-semibold' : ''
              }`}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="hidden md:flex items-center shrink-0">
          <button
            type="button"
            onClick={() => onNavigate(workspacePath)}
            className="px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {user ? 'Open Workspace' : 'Sign In'}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle navigation menu"
          className="md:hidden p-2 text-slate-700 hover:text-slate-900 rounded-lg"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white px-6 py-4 space-y-3">
          {navLinks.map((item) => (
            <a
              key={item.path}
              href={item.path}
              onClick={(e) => {
                e.preventDefault();
                setMobileOpen(false);
                onNavigate(item.path);
              }}
              className="block py-2 text-sm font-medium text-slate-700 hover:text-teal-700"
            >
              {item.label}
            </a>
          ))}
          <button
            type="button"
            onClick={() => {
              setMobileOpen(false);
              onNavigate(workspacePath);
            }}
            className="w-full py-2.5 px-4 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
          >
            {user ? 'Open Workspace' : 'Sign In'}
          </button>
        </div>
      )}
    </header>
  );
}
