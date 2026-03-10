import { Key } from 'lucide-react';

interface ConnectExchangeCardProps {
  exchange: string;
  description: string;
}

export function ConnectExchangeCard({ exchange, description }: ConnectExchangeCardProps) {
  return (
    <div className="col-span-full rounded-lg border border-dashed border-slate-300 bg-slate-50/50 px-4 py-6 text-center dark:border-slate-700 dark:bg-slate-900/20">
      <Key className="mx-auto h-8 w-8 text-slate-400 dark:text-slate-600" />
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Connect your {exchange} account to trade live {description}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Add your API keys in{' '}
        <a
          href="/settings"
          className="text-blue-600 underline hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
        >
          Settings
        </a>{' '}
        to get started.
      </p>
    </div>
  );
}
