/**
 * RAG retrievals card — the K most-similar past decisions APEX could cite
 * for this signal. Each row links to its own detail page so you can drill
 * back into "what happened last time we saw this setup?"
 */
import { ExternalLink, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ExplorerRagRetrieval } from '@/types/explorer';
import { DetailCard } from './DetailCard';

interface RagRetrievalsCardProps {
  retrievals: ExplorerRagRetrieval[];
}

export function RagRetrievalsCard({ retrievals }: RagRetrievalsCardProps) {
  return (
    <DetailCard
      icon={<Sparkles className="h-4 w-4 text-violet-400" />}
      title="RAG retrievals"
      subtitle={
        retrievals.length > 0
          ? `${retrievals.length} similar past trades`
          : 'No similar trades indexed (or memory is empty)'
      }
    >
      {retrievals.length === 0 ? (
        <div className="py-2 text-sm italic text-slate-500">
          The reasoner had no historical comparables for this signal — either the embedding store is
          empty or no past trade scored above the similarity threshold.
        </div>
      ) : (
        <ul className="space-y-2">
          {retrievals.map((t) => (
            <li
              key={t.decisionId}
              className="rounded-md border border-slate-200/60 bg-slate-50/40 px-3 py-2 dark:border-slate-700/50 dark:bg-slate-800/30"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium text-slate-200">{t.signal.symbol}</span>
                    <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-300">
                      {t.signal.action}
                    </span>
                    <span className="rounded bg-slate-700/40 px-1.5 py-0.5 text-[10px] text-slate-400">
                      {t.signal.strategy}
                    </span>
                    {t.signal.regime && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
                        {t.signal.regime}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-500">
                      similarity {(t.similarity * 100).toFixed(1)}%
                    </span>
                  </div>
                  {t.contextSnippet && (
                    <div className="mt-1 truncate text-[11px] text-slate-500">
                      {t.contextSnippet}
                    </div>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px]">
                    {t.outcome ? (
                      <>
                        <span
                          className={
                            t.outcome.realizedPnlUsd > 0
                              ? 'text-green-400'
                              : t.outcome.realizedPnlUsd < 0
                                ? 'text-red-400'
                                : 'text-slate-500'
                          }
                        >
                          {t.outcome.realizedPnlUsd >= 0 ? '+' : ''}$
                          {t.outcome.realizedPnlUsd.toFixed(2)}
                        </span>
                        {t.outcome.rMultiple !== null && (
                          <span className="text-slate-400">
                            {t.outcome.rMultiple >= 0 ? '+' : ''}
                            {t.outcome.rMultiple.toFixed(2)}R
                          </span>
                        )}
                        <span className="text-slate-500">{t.outcome.exitReason}</span>
                        <span className="text-slate-500">
                          {t.outcome.holdingMinutes} min held
                        </span>
                      </>
                    ) : (
                      <span className="italic text-slate-500">still open</span>
                    )}
                    <span className="text-slate-600">·</span>
                    <span className="text-slate-500">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <Link
                  to={`/explorer/decisions/${t.decisionId}`}
                  className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-700/40 hover:text-slate-200"
                  title="Open this decision"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </DetailCard>
  );
}
