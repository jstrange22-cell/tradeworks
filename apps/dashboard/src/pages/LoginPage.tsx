import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth-store';
import { apiClient, ApiError } from '@/lib/api-client';

type AuthTab = 'login' | 'register';

interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
}

export function LoginPage() {
  const [activeTab, setActiveTab] = useState<AuthTab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const endpoint = activeTab === 'login' ? '/auth/login' : '/auth/register';
      const payload = activeTab === 'login'
        ? { email, password }
        : { email, password, name };

      const response = await apiClient.post<AuthResponse>(endpoint, payload);
      login(response.token, response.user);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        try {
          const parsed = JSON.parse(err.body) as { error?: string };
          setError(parsed.error ?? `Request failed (${err.status})`);
        } catch {
          setError(`Request failed (${err.status})`);
        }
      } else {
        setError('Network error. Is the gateway running?');
      }
    } finally {
      setIsLoading(false);
    }
  }

  function switchTab(tab: AuthTab) {
    setActiveTab(tab);
    setError('');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 dark:bg-surface-900">
      <div className="w-full max-w-md">
        {/* Logo / Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-blue-600 text-xl font-bold text-white shadow-lg">
            TW
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            TradeWorks
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Algorithmic trading platform
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-surface-700 dark:bg-surface-800">
          {/* Tabs */}
          <div className="mb-6 flex rounded-lg bg-slate-100 p-1 dark:bg-surface-900">
            <button
              type="button"
              onClick={() => switchTab('login')}
              className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'login'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-surface-700 dark:text-white'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => switchTab('register')}
              className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'register'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-surface-700 dark:text-white'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Register
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 rounded-lg border border-loss-200 bg-loss-50 px-4 py-3 text-sm text-loss-700 dark:border-loss-700 dark:bg-loss-700/10 dark:text-loss-400">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {activeTab === 'register' && (
              <div>
                <label
                  htmlFor="auth-name"
                  className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Name
                </label>
                <input
                  id="auth-name"
                  type="text"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                  className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-surface-600 dark:bg-surface-900 dark:text-white dark:placeholder-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-surface-600 dark:bg-surface-900 dark:text-white dark:placeholder-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
              />
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={activeTab === 'register' ? 'Min. 6 characters' : 'Your password'}
                autoComplete={activeTab === 'login' ? 'current-password' : 'new-password'}
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-surface-600 dark:bg-surface-900 dark:text-white dark:placeholder-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-surface-800"
            >
              {isLoading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                activeTab === 'login' ? 'Sign In' : 'Create Account'
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-slate-400 dark:text-slate-500">
          TradeWorks v0.1.0
        </p>
      </div>
    </div>
  );
}
