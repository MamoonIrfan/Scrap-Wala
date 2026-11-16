import React, { useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Panel } from '../../components/ui/Primitives';

const DEMO_ACCOUNTS = [
  { label: 'Seller (Priya Sharma)', email: 'seller@scrapwala.demo', pass: 'Seller@1234', role: 'SELLER' },
  { label: 'Buyer — Verified (Metro Recycle)', email: 'buyer1@scrapwala.demo', pass: 'Buyer@1234', role: 'BUYER' },
  { label: 'Buyer — Pending Verification', email: 'buyer3@scrapwala.demo', pass: 'Buyer@1234', role: 'BUYER' },
  { label: 'Collector (Deepak Kumar)', email: 'collector1@scrapwala.demo', pass: 'Collector@1234', role: 'COLLECTOR' },
  { label: 'Administrator', email: 'admin@scrapwala.demo', pass: 'Admin@1234', role: 'ADMIN' },
];

export function LoginPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const routeForRole = (roles: string[]) => {
    if (roles.includes('ADMIN')) return '/admin';
    if (roles.includes('BUYER')) return '/buyer';
    if (roles.includes('COLLECTOR')) return '/collector';
    return '/seller';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(email, password);
      onNavigate(routeForRole(user.roles));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-6 py-12 space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-slate-900">Sign In to Scrap Wala</h1>
        <p className="mt-1 text-sm text-slate-600">
          Access your Seller, Buyer, Collector, or Administrator workspace.
        </p>
      </div>

      <Panel>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}
          <div>
            <label htmlFor="login-email" className="block text-xs font-medium text-slate-700 mb-1">
              Email Address
            </label>
            <input
              id="login-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-xs font-medium text-slate-700 mb-1">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div className="flex items-center justify-between text-xs">
            <a
              href="/forgot-password"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('/forgot-password');
              }}
              className="text-teal-700 hover:underline"
            >
              Forgot password?
            </a>
            <a
              href="/register"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('/register');
              }}
              className="text-teal-700 hover:underline font-medium"
            >
              Create new account
            </a>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg"
          >
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </Panel>

      <Panel>
        <div className="text-xs font-semibold text-slate-900">
          Demo Seed Accounts (Populates Real Credentials)
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Clicking an account fills its seeded email and password for real JWT authentication.
        </p>
        <div className="mt-3 grid gap-2">
          {DEMO_ACCOUNTS.map((acc) => (
            <button
              key={acc.email}
              type="button"
              onClick={() => {
                setEmail(acc.email);
                setPassword(acc.pass);
              }}
              className="w-full px-3 py-2 text-left text-xs border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center justify-between gap-2"
            >
              <span className="font-medium text-slate-800">{acc.label}</span>
              <span className="font-mono text-slate-500">{acc.email}</span>
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
}

export function RegisterPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { register } = useAuth();
  const [role, setRole] = useState<'SELLER' | 'BUYER'>('SELLER');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [sellerType, setSellerType] = useState<'HOUSEHOLD' | 'SMALL_BUSINESS'>('HOUSEHOLD');
  const [organizationName, setOrganizationName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [warehouseArea, setWarehouseArea] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [gstOrTaxId, setGstOrTaxId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await register({
        role,
        fullName,
        email,
        phone,
        password,
        sellerType,
        organizationName,
        businessName,
        warehouseArea,
        registrationNumber,
        gstOrTaxId,
      });
      onNavigate(user.roles.includes('BUYER') ? '/buyer' : '/seller');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-6 py-12 space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-slate-900">Create Scrap Wala Account</h1>
        <p className="mt-1 text-sm text-slate-600">
          Register as a Seller (household/business) or independent Scrap Buyer. Collector accounts are created by verified Buyers.
        </p>
      </div>

      <Panel>
        <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg mb-5">
          <button
            type="button"
            onClick={() => setRole('SELLER')}
            className={`py-2 text-xs font-semibold rounded-md transition-colors ${
              role === 'SELLER' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Register as Seller
          </button>
          <button
            type="button"
            onClick={() => setRole('BUYER')}
            className={`py-2 text-xs font-semibold rounded-md transition-colors ${
              role === 'BUYER' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Register as Buyer
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="reg-name" className="block text-xs font-medium text-slate-700 mb-1">
              Full Name
            </label>
            <input
              id="reg-name"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="reg-email" className="block text-xs font-medium text-slate-700 mb-1">
                Email
              </label>
              <input
                id="reg-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="reg-phone" className="block text-xs font-medium text-slate-700 mb-1">
                Phone Number
              </label>
              <input
                id="reg-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+9198..."
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label htmlFor="reg-pass" className="block text-xs font-medium text-slate-700 mb-1">
              Password (minimum 8 characters)
            </label>
            <input
              id="reg-pass"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>

          {role === 'SELLER' ? (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div>
                <label htmlFor="seller-type" className="block text-xs font-medium text-slate-700 mb-1">
                  Seller Type
                </label>
                <select
                  id="seller-type"
                  value={sellerType}
                  onChange={(e) => setSellerType(e.target.value as 'HOUSEHOLD' | 'SMALL_BUSINESS')}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="HOUSEHOLD">Household</option>
                  <option value="SMALL_BUSINESS">Small Business / Office</option>
                </select>
              </div>
              {sellerType === 'SMALL_BUSINESS' && (
                <div>
                  <label htmlFor="org-name" className="block text-xs font-medium text-slate-700 mb-1">
                    Business / Organization Name
                  </label>
                  <input
                    id="org-name"
                    type="text"
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div>
                <label htmlFor="biz-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Dealer Business Name
                </label>
                <input
                  id="biz-name"
                  type="text"
                  required
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="warehouse-area" className="block text-xs font-medium text-slate-700 mb-1">
                  Depot / Warehouse Area
                </label>
                <input
                  id="warehouse-area"
                  type="text"
                  required
                  value={warehouseArea}
                  onChange={(e) => setWarehouseArea(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="reg-num" className="block text-xs font-medium text-slate-700 mb-1">
                    Registration / License No.
                  </label>
                  <input
                    id="reg-num"
                    type="text"
                    value={registrationNumber}
                    onChange={(e) => setRegistrationNumber(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="gst-num" className="block text-xs font-medium text-slate-700 mb-1">
                    Tax / GST ID
                  </label>
                  <input
                    id="gst-num"
                    type="text"
                    value={gstOrTaxId}
                    onChange={(e) => setGstOrTaxId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg"
          >
            {submitting ? 'Creating Account...' : 'Create Account'}
          </button>

          <p className="text-xs text-center text-slate-500">
            Already registered?{' '}
            <a
              href="/login"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('/login');
              }}
              className="text-teal-700 hover:underline font-medium"
            >
              Sign in here
            </a>
          </p>
        </form>
      </Panel>
    </div>
  );
}

export function ForgotPasswordPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [stage, setStage] = useState<'REQUEST' | 'RESET'>('REQUEST');
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch<{ message: string; devResetToken?: string }>(
        '/api/v1/auth/forgot-password',
        { method: 'POST', body: { email }, skipAuth: true }
      );
      setInfo(
        res.devResetToken
          ? `${res.message} Development adapter token: ${res.devResetToken}`
          : res.message
      );
      if (res.devResetToken) setToken(res.devResetToken);
      setStage('RESET');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to initiate reset.');
    }
  };

  const completeReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiFetch<{ message: string }>('/api/v1/auth/reset-password', {
        method: 'POST',
        body: { token, newPassword },
        skipAuth: true,
      });
      setInfo(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed.');
    }
  };

  return (
    <div className="max-w-md mx-auto px-6 py-12 space-y-6">
      <h1 className="text-2xl font-display font-bold text-slate-900">Reset Password</h1>
      <Panel>
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 break-all">
            {info}
          </div>
        )}

        {stage === 'REQUEST' ? (
          <form onSubmit={requestReset} className="space-y-4">
            <div>
              <label htmlFor="fp-email" className="block text-xs font-medium text-slate-700 mb-1">
                Account Email
              </label>
              <input
                id="fp-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
            >
              Request Password Reset
            </button>
          </form>
        ) : (
          <form onSubmit={completeReset} className="space-y-4">
            <div>
              <label htmlFor="rp-token" className="block text-xs font-medium text-slate-700 mb-1">
                Reset Token
              </label>
              <input
                id="rp-token"
                type="text"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="rp-pass" className="block text-xs font-medium text-slate-700 mb-1">
                New Password (min 8 chars)
              </label>
              <input
                id="rp-pass"
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
            >
              Update Password
            </button>
          </form>
        )}

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => onNavigate('/login')}
            className="text-xs text-teal-700 hover:underline"
          >
            Back to Sign In
          </button>
        </div>
      </Panel>
    </div>
  );
}
