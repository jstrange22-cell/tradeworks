import { Info, ExternalLink } from 'lucide-react';
import { SERVICE_INFO, EXCHANGE_SETUP_GUIDES } from '@/types/settings';

interface ExchangeSetupGuideProps {
  service: string;
  visible: boolean;
  onHide: () => void;
  onShow: () => void;
}

export function ExchangeSetupGuide({ service, visible, onHide, onShow }: ExchangeSetupGuideProps) {
  const guide = EXCHANGE_SETUP_GUIDES[service];

  if (!guide) return null;

  if (!visible) {
    return (
      <button type="button" onClick={onShow} className="text-xs text-blue-400 hover:text-blue-300">
        Show setup guide
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-400">
          <Info className="h-3.5 w-3.5" />
          How to get your {SERVICE_INFO[service]?.label} API keys
        </div>
        <button type="button" onClick={onHide} className="text-xs text-slate-500 hover:text-slate-300">
          Hide
        </button>
      </div>
      <ol className="mt-2 space-y-1.5">
        {guide.steps.map((step, idx) => (
          <li key={idx} className="flex gap-2 text-xs text-slate-300">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-[10px] font-bold text-blue-400">
              {idx + 1}
            </span>
            <span>
              {step.text}
              {step.link && (
                <a
                  href={step.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1 inline-flex items-center gap-0.5 text-blue-400 underline hover:text-blue-300"
                >
                  Open <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
