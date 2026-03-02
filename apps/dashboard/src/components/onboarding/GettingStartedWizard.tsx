import { useState } from 'react';
import {
  Sparkles,
  Link2,
  Shield,
  Rocket,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
  Bot,
  BarChart3,
  Globe,
  CheckCircle,
} from 'lucide-react';

interface GettingStartedWizardProps {
  onComplete: () => void;
  onOpenAddKey: (service: string) => void;
  connectedExchanges: string[];
}

const STEPS = [
  { id: 'welcome', label: 'Welcome', icon: Sparkles },
  { id: 'connect', label: 'Connect', icon: Link2 },
  { id: 'risk', label: 'Risk', icon: Shield },
  { id: 'start', label: 'Start', icon: Rocket },
];

const EXCHANGES = [
  {
    service: 'coinbase',
    name: 'Coinbase',
    description: 'Trade hundreds of cryptocurrencies — BTC, ETH, SOL, and more',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10 border-blue-500/20',
    link: 'https://www.coinbase.com/settings/api',
  },
  {
    service: 'alpaca',
    name: 'Alpaca',
    description: 'Trade thousands of US stocks and ETFs — AAPL, TSLA, SPY, and more',
    color: 'text-green-400',
    bgColor: 'bg-green-500/10 border-green-500/20',
    link: 'https://alpaca.markets',
  },
  {
    service: 'polymarket',
    name: 'Polymarket',
    description: 'Trade on real-world event outcomes — elections, sports, crypto events',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10 border-purple-500/20',
    link: 'https://polymarket.com',
  },
];

export function GettingStartedWizard({ onComplete, onOpenAddKey, connectedExchanges }: GettingStartedWizardProps) {
  const [step, setStep] = useState(0);

  const canGoNext = step < STEPS.length - 1;
  const canGoBack = step > 0;

  return (
    <div className="mx-auto max-w-2xl">
      {/* Step indicator */}
      <div className="mb-6 flex items-center justify-center gap-2">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              onClick={() => setStep(i)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                i === step
                  ? 'bg-blue-600 text-white'
                  : i < step
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-slate-800 text-slate-500'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Step content */}
      <div className="card">
        {step === 0 && (
          <div className="space-y-6 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20">
              <Sparkles className="h-8 w-8 text-blue-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-100">Welcome to TradeWorks</h2>
              <p className="mt-2 text-sm text-slate-400">
                Your AI-powered autonomous trading system
              </p>
            </div>

            <div className="mx-auto max-w-md space-y-3 text-left">
              <div className="flex gap-3 rounded-lg bg-slate-800/50 p-3">
                <Bot className="mt-0.5 h-5 w-5 shrink-0 text-blue-400" />
                <div>
                  <div className="text-sm font-medium text-slate-200">5 AI Agents Work Together</div>
                  <div className="text-xs text-slate-400">
                    A Quant Analyst, Sentiment Analyst, Macro Analyst, Risk Guardian, and Execution Specialist research markets and make trading decisions autonomously.
                  </div>
                </div>
              </div>
              <div className="flex gap-3 rounded-lg bg-slate-800/50 p-3">
                <BarChart3 className="mt-0.5 h-5 w-5 shrink-0 text-green-400" />
                <div>
                  <div className="text-sm font-medium text-slate-200">Research-Driven Trading</div>
                  <div className="text-xs text-slate-400">
                    Agents analyze technical patterns, market sentiment, and macroeconomic data to identify opportunities and develop strategies.
                  </div>
                </div>
              </div>
              <div className="flex gap-3 rounded-lg bg-slate-800/50 p-3">
                <Shield className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                <div>
                  <div className="text-sm font-medium text-slate-200">Built-In Safety</div>
                  <div className="text-xs text-slate-400">
                    The Risk Guardian enforces hard limits — max 1% risk per trade, 3% daily loss cap, and automatic circuit breakers. Start with paper trading (no real money).
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="text-center">
              <h2 className="text-xl font-bold text-slate-100">Connect an Exchange</h2>
              <p className="mt-1 text-sm text-slate-400">
                Add your API keys to start trading. We recommend starting with Sandbox (paper trading) mode.
              </p>
            </div>

            <div className="space-y-3">
              {EXCHANGES.map((ex) => {
                const isConnected = connectedExchanges.includes(ex.service);
                return (
                  <div
                    key={ex.service}
                    className={`rounded-lg border p-4 ${
                      isConnected ? 'border-green-500/30 bg-green-500/5' : ex.bgColor
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-bold ${isConnected ? 'text-green-400' : ex.color}`}>
                            {ex.name}
                          </span>
                          {isConnected && <CheckCircle className="h-4 w-4 text-green-400" />}
                        </div>
                        <p className="mt-1 text-xs text-slate-400">{ex.description}</p>
                      </div>
                      {isConnected ? (
                        <span className="rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-400">
                          Connected
                        </span>
                      ) : (
                        <button
                          onClick={() => onOpenAddKey(ex.service)}
                          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
                        >
                          Connect
                        </button>
                      )}
                    </div>
                    {!isConnected && (
                      <a
                        href={ex.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300"
                      >
                        Get API keys <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-center text-xs text-slate-500">
              You can connect more exchanges later in Settings. Your keys are encrypted at rest with AES-256-GCM.
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="text-center">
              <h2 className="text-xl font-bold text-slate-100">Risk Limits</h2>
              <p className="mt-1 text-sm text-slate-400">
                These defaults protect your capital. You can adjust them anytime in Settings.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Max Risk per Trade', value: '1%', desc: 'Never risk more than 1% of capital on a single trade' },
                { label: 'Daily Loss Cap', value: '3%', desc: 'Trading halts if daily losses exceed 3%' },
                { label: 'Weekly Loss Cap', value: '7%', desc: 'Weekly cumulative loss limit' },
                { label: 'Portfolio Heat', value: '6%', desc: 'Maximum total open risk across all positions' },
                { label: 'Min Risk/Reward', value: '1:3', desc: 'Only take trades with 3x potential reward vs risk' },
                { label: 'Max Correlation', value: '40%', desc: 'Limit exposure to correlated assets' },
              ].map((item) => (
                <div key={item.label} className="rounded-lg bg-slate-800/50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-400">{item.label}</span>
                    <span className="text-sm font-bold text-blue-400">{item.value}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">{item.desc}</p>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3 text-center">
              <CheckCircle className="mx-auto h-5 w-5 text-green-400" />
              <p className="mt-1 text-xs text-green-400">
                These safe defaults are pre-configured. Adjust in Settings anytime.
              </p>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="text-center">
              <h2 className="text-xl font-bold text-slate-100">You're Ready!</h2>
              <p className="mt-1 text-sm text-slate-400">
                Choose how you want to get started:
              </p>
            </div>

            <div className="space-y-3">
              <a
                href="/agents"
                className="flex items-center gap-4 rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 transition-colors hover:bg-blue-500/10"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-500/20">
                  <Bot className="h-6 w-6 text-blue-400" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-blue-400">Start the AI Engine</div>
                  <div className="text-xs text-slate-400">
                    Let 5 AI agents research markets and trade autonomously. This is the core feature.
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-500" />
              </a>

              <a
                href="/charts"
                className="flex items-center gap-4 rounded-lg border border-slate-700/30 bg-slate-900/30 p-4 transition-colors hover:bg-slate-800/50"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-green-500/20">
                  <BarChart3 className="h-6 w-6 text-green-400" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-slate-200">Place a Manual Trade</div>
                  <div className="text-xs text-slate-400">
                    View charts with indicators and place trades yourself.
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-500" />
              </a>

              <a
                href="/markets"
                className="flex items-center gap-4 rounded-lg border border-slate-700/30 bg-slate-900/30 p-4 transition-colors hover:bg-slate-800/50"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-500/20">
                  <Globe className="h-6 w-6 text-purple-400" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-slate-200">Explore Markets</div>
                  <div className="text-xs text-slate-400">
                    Browse live crypto, stocks, and prediction market data.
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-500" />
              </a>
            </div>

            <button
              onClick={onComplete}
              className="w-full rounded-lg bg-slate-700 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-600"
            >
              Skip — Go to Dashboard
            </button>
          </div>
        )}

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between border-t border-slate-700/50 pt-4">
          <button
            onClick={() => setStep((s) => s - 1)}
            disabled={!canGoBack}
            className="btn-ghost flex items-center gap-1 text-sm disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
          <span className="text-xs text-slate-500">
            Step {step + 1} of {STEPS.length}
          </span>
          {canGoNext ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              className="btn-primary flex items-center gap-1 text-sm"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={onComplete}
              className="btn-primary flex items-center gap-1 text-sm"
            >
              Get Started
              <Rocket className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
