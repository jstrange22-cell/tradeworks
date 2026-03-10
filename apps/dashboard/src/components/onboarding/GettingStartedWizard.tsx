import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types & Constants
// ---------------------------------------------------------------------------

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
] as const;

const EXCHANGES = [
  {
    service: 'coinbase',
    name: 'Coinbase',
    description: 'Trade hundreds of cryptocurrencies -- BTC, ETH, SOL, and more',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10 border-blue-500/20',
    link: 'https://www.coinbase.com/settings/api',
  },
  {
    service: 'alpaca',
    name: 'Alpaca',
    description: 'Trade thousands of US stocks and ETFs -- AAPL, TSLA, SPY, and more',
    color: 'text-green-400',
    bgColor: 'bg-green-500/10 border-green-500/20',
    link: 'https://alpaca.markets',
  },
  {
    service: 'polymarket',
    name: 'Polymarket',
    description: 'Trade on real-world event outcomes -- elections, sports, crypto events',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10 border-purple-500/20',
    link: 'https://polymarket.com',
  },
] as const;

type RiskPreset = 'conservative' | 'moderate' | 'aggressive';

interface RiskPresetConfig {
  label: string;
  description: string;
  color: string;
  borderColor: string;
  values: {
    maxRiskPerTrade: string;
    dailyLossCap: string;
    weeklyLossCap: string;
    portfolioHeat: string;
    minRiskReward: string;
    maxCorrelation: string;
  };
}

const RISK_PRESETS: Record<RiskPreset, RiskPresetConfig> = {
  conservative: {
    label: 'Conservative',
    description: 'Lower risk, slower growth. Best for beginners or large accounts.',
    color: 'text-green-400',
    borderColor: 'border-green-500/30 bg-green-500/5',
    values: {
      maxRiskPerTrade: '0.5%',
      dailyLossCap: '1.5%',
      weeklyLossCap: '3%',
      portfolioHeat: '3%',
      minRiskReward: '1:4',
      maxCorrelation: '30%',
    },
  },
  moderate: {
    label: 'Moderate',
    description: 'Balanced risk and reward. Recommended for most traders.',
    color: 'text-blue-400',
    borderColor: 'border-blue-500/30 bg-blue-500/5',
    values: {
      maxRiskPerTrade: '1%',
      dailyLossCap: '3%',
      weeklyLossCap: '7%',
      portfolioHeat: '6%',
      minRiskReward: '1:3',
      maxCorrelation: '40%',
    },
  },
  aggressive: {
    label: 'Aggressive',
    description: 'Higher risk, higher potential returns. For experienced traders.',
    color: 'text-amber-400',
    borderColor: 'border-amber-500/30 bg-amber-500/5',
    values: {
      maxRiskPerTrade: '2%',
      dailyLossCap: '5%',
      weeklyLossCap: '12%',
      portfolioHeat: '10%',
      minRiskReward: '1:2',
      maxCorrelation: '60%',
    },
  },
} as const;

const RISK_LABELS: Record<keyof RiskPresetConfig['values'], string> = {
  maxRiskPerTrade: 'Max Risk per Trade',
  dailyLossCap: 'Daily Loss Cap',
  weeklyLossCap: 'Weekly Loss Cap',
  portfolioHeat: 'Portfolio Heat',
  minRiskReward: 'Min Risk/Reward',
  maxCorrelation: 'Max Correlation',
};

const STORAGE_KEY_STEPS = 'tradeworks_onboarding_steps';
const STORAGE_KEY_RISK = 'tradeworks_risk_preset';

// ---------------------------------------------------------------------------
// Helper: load/save completed step state
// ---------------------------------------------------------------------------

function loadCompletedSteps(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_STEPS);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function saveCompletedStep(stepId: string): void {
  const current = loadCompletedSteps();
  current[stepId] = true;
  localStorage.setItem(STORAGE_KEY_STEPS, JSON.stringify(current));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GettingStartedWizard({
  onComplete,
  onOpenAddKey,
  connectedExchanges,
}: GettingStartedWizardProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState(loadCompletedSteps);
  const [riskPreset, setRiskPreset] = useState<RiskPreset>(
    () => (localStorage.getItem(STORAGE_KEY_RISK) as RiskPreset | null) ?? 'moderate'
  );
  const [engineStarting, setEngineStarting] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [engineStarted, setEngineStarted] = useState(false);

  const canGoNext = step < STEPS.length - 1;
  const canGoBack = step > 0;

  const markStepComplete = useCallback((stepId: string) => {
    saveCompletedStep(stepId);
    setCompletedSteps((prev) => ({ ...prev, [stepId]: true }));
  }, []);

  // Step 1: Navigate to settings for API key connection
  const handleGoToSettings = useCallback(() => {
    markStepComplete('connect');
    navigate('/settings');
  }, [navigate, markStepComplete]);

  // Step 2: Select risk preset and save
  const handleSelectRiskPreset = useCallback(
    (preset: RiskPreset) => {
      setRiskPreset(preset);
      localStorage.setItem(STORAGE_KEY_RISK, preset);
      markStepComplete('risk');
    },
    [markStepComplete]
  );

  // Step 3: Start the engine
  const handleStartEngine = useCallback(async () => {
    setEngineStarting(true);
    setEngineError(null);
    try {
      await apiClient.post('/engine/start');
      setEngineStarted(true);
      markStepComplete('start');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start engine';
      setEngineError(message);
    } finally {
      setEngineStarting(false);
    }
  }, [markStepComplete]);

  // Advance step and mark current as complete
  const handleNext = useCallback(() => {
    const currentStepId = STEPS[step].id;
    markStepComplete(currentStepId);
    setStep((prev) => Math.min(prev + 1, STEPS.length - 1));
  }, [step, markStepComplete]);

  const selectedPreset = RISK_PRESETS[riskPreset];

  return (
    <div className="mx-auto max-w-2xl">
      {/* Step indicator */}
      <div className="mb-6 flex items-center justify-center gap-2">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isDone = completedSteps[s.id] === true;
          return (
            <button
              key={s.id}
              onClick={() => setStep(i)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                i === step
                  ? 'bg-blue-600 text-white'
                  : isDone
                    ? 'bg-green-500/20 text-green-400'
                    : i < step
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-slate-800 text-slate-500'
              }`}
            >
              {isDone && i !== step ? (
                <CheckCircle className="h-3.5 w-3.5" />
              ) : (
                <Icon className="h-3.5 w-3.5" />
              )}
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Step content */}
      <div className="card">
        {/* Step 0: Welcome */}
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
                    The Risk Guardian enforces hard limits -- max 1% risk per trade, 3% daily loss cap, and automatic circuit breakers. Start with paper trading (no real money).
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Connect Exchange */}
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

            <button
              onClick={handleGoToSettings}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700"
            >
              Go to Settings to manage API keys
            </button>

            <p className="text-center text-xs text-slate-500">
              You can connect more exchanges later in Settings. Your keys are encrypted at rest with AES-256-GCM.
            </p>
          </div>
        )}

        {/* Step 2: Risk Presets */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="text-center">
              <h2 className="text-xl font-bold text-slate-100">Choose Your Risk Profile</h2>
              <p className="mt-1 text-sm text-slate-400">
                Select a preset that matches your trading style. You can fine-tune in Settings anytime.
              </p>
            </div>

            {/* Preset selector */}
            <div className="grid grid-cols-3 gap-3">
              {(Object.entries(RISK_PRESETS) as Array<[RiskPreset, RiskPresetConfig]>).map(
                ([key, preset]) => (
                  <button
                    key={key}
                    onClick={() => handleSelectRiskPreset(key)}
                    className={`rounded-lg border p-3 text-center transition-colors ${
                      riskPreset === key
                        ? preset.borderColor
                        : 'border-slate-700 bg-slate-900/50 hover:bg-slate-800/50'
                    }`}
                  >
                    <div className={`text-sm font-bold ${riskPreset === key ? preset.color : 'text-slate-300'}`}>
                      {preset.label}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500">{preset.description}</div>
                  </button>
                )
              )}
            </div>

            {/* Show selected preset values */}
            <div className="grid grid-cols-2 gap-3">
              {(Object.entries(selectedPreset.values) as Array<[keyof RiskPresetConfig['values'], string]>).map(
                ([key, value]) => (
                  <div key={key} className="rounded-lg bg-slate-800/50 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-400">
                        {RISK_LABELS[key]}
                      </span>
                      <span className={`text-sm font-bold ${selectedPreset.color}`}>{value}</span>
                    </div>
                  </div>
                )
              )}
            </div>

            <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3 text-center">
              <CheckCircle className="mx-auto h-5 w-5 text-green-400" />
              <p className="mt-1 text-xs text-green-400">
                {selectedPreset.label} profile selected. Adjust in Settings anytime.
              </p>
            </div>
          </div>
        )}

        {/* Step 3: Start Engine */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="text-center">
              <h2 className="text-xl font-bold text-slate-100">
                {engineStarted ? 'Engine Running!' : "You're Ready!"}
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                {engineStarted
                  ? 'Your AI agents are now analyzing markets autonomously.'
                  : 'Start the engine or explore on your own:'}
              </p>
            </div>

            <div className="space-y-3">
              {/* Start Engine button */}
              <button
                onClick={engineStarted ? () => navigate('/agents') : handleStartEngine}
                disabled={engineStarting}
                className={`flex w-full items-center gap-4 rounded-lg border p-4 text-left transition-colors ${
                  engineStarted
                    ? 'border-green-500/30 bg-green-500/5 hover:bg-green-500/10'
                    : 'border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10'
                } disabled:opacity-50`}
              >
                <div
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
                    engineStarted ? 'bg-green-500/20' : 'bg-blue-500/20'
                  }`}
                >
                  {engineStarting ? (
                    <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
                  ) : engineStarted ? (
                    <CheckCircle className="h-6 w-6 text-green-400" />
                  ) : (
                    <Bot className="h-6 w-6 text-blue-400" />
                  )}
                </div>
                <div className="flex-1">
                  <div
                    className={`text-sm font-bold ${
                      engineStarted ? 'text-green-400' : 'text-blue-400'
                    }`}
                  >
                    {engineStarting
                      ? 'Starting Engine...'
                      : engineStarted
                        ? 'Engine Running -- View Agents'
                        : 'Start the AI Engine'}
                  </div>
                  <div className="text-xs text-slate-400">
                    {engineStarted
                      ? '5 AI agents are now researching markets and making trading decisions.'
                      : 'Let 5 AI agents research markets and trade autonomously. This is the core feature.'}
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-500" />
              </button>

              {engineError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                  <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                  <p className="text-xs text-red-400">{engineError}</p>
                </div>
              )}

              <button
                onClick={() => navigate('/charts')}
                className="flex w-full items-center gap-4 rounded-lg border border-slate-700/30 bg-slate-900/30 p-4 text-left transition-colors hover:bg-slate-800/50"
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
              </button>

              <button
                onClick={() => navigate('/markets')}
                className="flex w-full items-center gap-4 rounded-lg border border-slate-700/30 bg-slate-900/30 p-4 text-left transition-colors hover:bg-slate-800/50"
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
              </button>
            </div>

            <button
              onClick={onComplete}
              className="w-full rounded-lg bg-slate-700 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-600"
            >
              Skip -- Go to Dashboard
            </button>
          </div>
        )}

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between border-t border-slate-700/50 pt-4">
          <button
            onClick={() => setStep((prev) => prev - 1)}
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
              onClick={handleNext}
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
