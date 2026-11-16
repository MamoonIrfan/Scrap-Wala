import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PublicNavbar } from './components/layout/PublicNavbar';
import { LandingPage } from './pages/public/LandingPage';
import {
  AboutPage,
  ContactPage,
  HowItWorksPage,
  MaterialsPage,
} from './pages/public/PublicSubpages';
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
} from './pages/public/AuthPages';
import { SellerWorkspace } from './pages/seller/SellerWorkspace';
import { BuyerWorkspace } from './pages/buyer/BuyerWorkspace';
import { CollectorWorkspace } from './pages/collector/CollectorWorkspace';
import { AdminWorkspace } from './pages/admin/AdminWorkspace';

function AppRouter() {
  const { user, activeRole, loading } = useAuth();
  const [path, setPath] = useState<string>(() => window.location.pathname || '/');

  const navigate = (nextPath: string) => {
    if (nextPath !== path) {
      window.history.pushState({}, '', nextPath);
      setPath(nextPath);
      window.scrollTo({ top: 0 });
    }
  };

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname || '/');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const isWorkspaceRoute =
    path.startsWith('/seller') ||
    path.startsWith('/buyer') ||
    path.startsWith('/collector') ||
    path.startsWith('/admin');

  if (loading && isWorkspaceRoute) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAF9] text-sm text-slate-600">
        Verifying session...
      </div>
    );
  }

  // Protected role routing
  if (isWorkspaceRoute) {
    if (!user) {
      return (
        <>
          <PublicNavbar currentPath="/login" onNavigate={navigate} />
          <LoginPage onNavigate={navigate} />
        </>
      );
    }

    if (path.startsWith('/admin') && user.roles.includes('ADMIN')) {
      return <AdminWorkspace onNavigate={navigate} />;
    }
    if (path.startsWith('/buyer') && user.roles.includes('BUYER')) {
      return <BuyerWorkspace onNavigate={navigate} />;
    }
    if (path.startsWith('/collector') && user.roles.includes('COLLECTOR')) {
      return <CollectorWorkspace onNavigate={navigate} />;
    }
    if (path.startsWith('/seller') && user.roles.includes('SELLER')) {
      return <SellerWorkspace onNavigate={navigate} />;
    }

    // Fallback to user's actual authorized workspace if trying to access another role route
    if (activeRole === 'ADMIN') return <AdminWorkspace onNavigate={navigate} />;
    if (activeRole === 'BUYER') return <BuyerWorkspace onNavigate={navigate} />;
    if (activeRole === 'COLLECTOR') return <CollectorWorkspace onNavigate={navigate} />;
    return <SellerWorkspace onNavigate={navigate} />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAF9]">
      <PublicNavbar currentPath={path} onNavigate={navigate} />
      <main className="flex-1">
        {path === '/about' && <AboutPage onNavigate={navigate} />}
        {path === '/how-it-works' && <HowItWorksPage onNavigate={navigate} />}
        {path === '/materials' && <MaterialsPage />}
        {path === '/contact' && <ContactPage />}
        {path === '/login' && <LoginPage onNavigate={navigate} />}
        {path === '/register' && <RegisterPage onNavigate={navigate} />}
        {path === '/forgot-password' && <ForgotPasswordPage onNavigate={navigate} />}
        {(path === '/' ||
          ![
            '/about',
            '/how-it-works',
            '/materials',
            '/contact',
            '/login',
            '/register',
            '/forgot-password',
          ].includes(path)) && <LandingPage onNavigate={navigate} />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
