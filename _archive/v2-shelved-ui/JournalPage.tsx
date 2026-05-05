import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from 'sonner';
import { JournalEntryForm } from '@/components/journal/JournalEntryForm';
import {
  Plus,
  Search,
  Star,
  Tag,
  Calendar,
  Trash2,
  Pencil,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';

interface JournalEntry {
  id: string;
  tradeId: string | null;
  instrument: string | null;
  market: string | null;
  side: string | null;
  entryPrice: string | null;
  exitPrice: string | null;
  pnl: string | null;
  notes: string | null;
  tags: string[];
  emotionalState: string | null;
  lessonsLearned: string | null;
  strategyUsed: string | null;
  rating: number | null;
  screenshots: string[];
  createdAt: string;
  updatedAt: string;
}

interface JournalResponse {
  data: JournalEntry[];
  total: number;
}

interface TagStat {
  tag: string;
  count: number;
}

export function JournalPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const { data: journalData, isLoading } = useQuery<JournalResponse>({
    queryKey: ['journal', selectedTag],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '200' });
      if (selectedTag) params.set('tag', selectedTag);
      return apiClient.get<JournalResponse>(`/journal?${params.toString()}`);
    },
  });

  const { data: tagStats } = useQuery<{ data: TagStat[] }>({
    queryKey: ['journal-tags'],
    queryFn: () => apiClient.get('/journal/tags'),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiClient.post('/journal', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal'] });
      queryClient.invalidateQueries({ queryKey: ['journal-tags'] });
      toast.success('Journal entry created');
      setShowForm(false);
    },
    onError: () => toast.error('Failed to create journal entry'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiClient.patch(`/journal/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal'] });
      queryClient.invalidateQueries({ queryKey: ['journal-tags'] });
      toast.success('Journal entry updated');
      setEditingEntry(null);
    },
    onError: () => toast.error('Failed to update journal entry'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/journal/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal'] });
      queryClient.invalidateQueries({ queryKey: ['journal-tags'] });
      toast.success('Journal entry deleted');
    },
    onError: () => toast.error('Failed to delete journal entry'),
  });

  const entries = journalData?.data ?? [];
  const tags = tagStats?.data ?? [];

  const filtered = useMemo(() => {
    if (!searchQuery) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter(
      (e) =>
        e.instrument?.toLowerCase().includes(q) ||
        e.notes?.toLowerCase().includes(q) ||
        e.lessonsLearned?.toLowerCase().includes(q) ||
        e.strategyUsed?.toLowerCase().includes(q),
    );
  }, [entries, searchQuery]);

  // Stats
  const totalEntries = entries.length;
  const avgRating = entries.filter((e) => e.rating).reduce((sum, e) => sum + (e.rating ?? 0), 0) / (entries.filter((e) => e.rating).length || 1);
  const winCount = entries.filter((e) => e.pnl && parseFloat(e.pnl) > 0).length;
  const lossCount = entries.filter((e) => e.pnl && parseFloat(e.pnl) < 0).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Trading Journal</h1>
          <p className="text-sm text-slate-400">Track, reflect, and improve your trading</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          <Plus className="h-4 w-4" />
          New Entry
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Entries" value={totalEntries.toString()} />
        <StatCard label="Avg Rating" value={avgRating.toFixed(1)} suffix="/5" />
        <StatCard label="Winning Trades" value={winCount.toString()} color="text-emerald-400" />
        <StatCard label="Losing Trades" value={lossCount.toString()} color="text-red-400" />
      </div>

      {/* Tags filter */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedTag(null)}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              !selectedTag ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            <Tag className="h-3 w-3" />
            All
          </button>
          {tags.map(({ tag, count }) => (
            <button
              key={tag}
              onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                selectedTag === tag ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {tag} ({count})
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search journal entries..."
          className="w-full rounded-md border border-slate-700 bg-slate-800 py-2 pl-10 pr-4 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Entries list */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-slate-800" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-slate-700/50 bg-slate-800/50 py-16 text-center">
          <Calendar className="mb-3 h-10 w-10 text-slate-600" />
          <p className="text-sm text-slate-400">No journal entries yet</p>
          <p className="mt-1 text-xs text-slate-500">Start documenting your trades to improve over time</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry) => (
            <JournalCard
              key={entry.id}
              entry={entry}
              onEdit={() => setEditingEntry(entry)}
              onDelete={() => deleteMutation.mutate(entry.id)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showForm && (
        <JournalEntryForm
          onSubmit={(data) => createMutation.mutate(data as unknown as Record<string, unknown>)}
          onClose={() => setShowForm(false)}
        />
      )}
      {editingEntry && (
        <JournalEntryForm
          isEditing
          initialData={{
            instrument: editingEntry.instrument ?? '',
            market: editingEntry.market ?? 'crypto',
            side: editingEntry.side ?? 'buy',
            entryPrice: editingEntry.entryPrice ?? '',
            exitPrice: editingEntry.exitPrice ?? '',
            pnl: editingEntry.pnl ?? '',
            notes: editingEntry.notes ?? '',
            tags: editingEntry.tags ?? [],
            emotionalState: editingEntry.emotionalState ?? '',
            lessonsLearned: editingEntry.lessonsLearned ?? '',
            strategyUsed: editingEntry.strategyUsed ?? '',
            rating: editingEntry.rating ?? 0,
            tradeId: editingEntry.tradeId ?? undefined,
          }}
          onSubmit={(data) => updateMutation.mutate({ id: editingEntry.id, data: data as unknown as Record<string, unknown> })}
          onClose={() => setEditingEntry(null)}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, suffix, color }: { label: string; value: string; suffix?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800 p-4">
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color ?? 'text-slate-100'}`}>
        {value}
        {suffix && <span className="text-sm font-normal text-slate-400">{suffix}</span>}
      </p>
    </div>
  );
}

function JournalCard({ entry, onEdit, onDelete }: { entry: JournalEntry; onEdit: () => void; onDelete: () => void }) {
  const pnl = entry.pnl ? parseFloat(entry.pnl) : null;
  const isWin = pnl !== null && pnl > 0;

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800 p-4 transition-colors hover:border-slate-600">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {/* Title row */}
          <div className="flex items-center gap-3">
            {entry.instrument && (
              <span className="font-semibold text-slate-100">{entry.instrument}</span>
            )}
            {entry.side && (
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                entry.side === 'buy' ? 'bg-emerald-600/20 text-emerald-400' : 'bg-red-600/20 text-red-400'
              }`}>
                {entry.side.toUpperCase()}
              </span>
            )}
            {entry.market && (
              <span className="text-xs text-slate-500">{entry.market}</span>
            )}
            {pnl !== null && (
              <span className={`inline-flex items-center gap-1 text-sm font-medium ${
                isWin ? 'text-emerald-400' : 'text-red-400'
              }`}>
                {isWin ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                ${Math.abs(pnl).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            )}
          </div>

          {/* Notes */}
          {entry.notes && (
            <p className="mt-2 line-clamp-2 text-sm text-slate-300">{entry.notes}</p>
          )}

          {/* Lessons */}
          {entry.lessonsLearned && (
            <p className="mt-1 text-xs italic text-slate-400">Lesson: {entry.lessonsLearned}</p>
          )}

          {/* Meta row */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {entry.emotionalState && (
              <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                {entry.emotionalState}
              </span>
            )}
            {entry.strategyUsed && (
              <span className="text-xs text-slate-500">Strategy: {entry.strategyUsed}</span>
            )}
            {entry.rating !== null && entry.rating > 0 && (
              <span className="inline-flex items-center gap-0.5">
                {Array.from({ length: entry.rating }).map((_, i) => (
                  <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                ))}
              </span>
            )}
            {entry.tags.length > 0 && (
              <div className="flex gap-1">
                {entry.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-blue-600/20 px-2 py-0.5 text-xs text-blue-300">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <span className="text-xs text-slate-500">
              {new Date(entry.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-1">
          <button
            onClick={onEdit}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={onDelete}
            className="rounded-md p-1.5 text-slate-400 hover:bg-red-900/50 hover:text-red-400"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
