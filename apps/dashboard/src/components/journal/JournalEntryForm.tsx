import { useState, type FormEvent } from 'react';
import { X, Star, Plus } from 'lucide-react';

const EMOTIONAL_STATES = [
  'confident', 'anxious', 'neutral', 'fomo',
  'fearful', 'greedy', 'disciplined', 'impulsive',
] as const;

const MARKETS = ['crypto', 'equities', 'forex', 'futures', 'options'] as const;

interface JournalFormData {
  instrument: string;
  market: string;
  side: string;
  entryPrice: string;
  exitPrice: string;
  pnl: string;
  notes: string;
  tags: string[];
  emotionalState: string;
  lessonsLearned: string;
  strategyUsed: string;
  rating: number;
  tradeId?: string;
}

interface JournalEntryFormProps {
  onSubmit: (data: JournalFormData) => void;
  onClose: () => void;
  initialData?: Partial<JournalFormData>;
  isEditing?: boolean;
}

export function JournalEntryForm({ onSubmit, onClose, initialData, isEditing }: JournalEntryFormProps) {
  const [form, setForm] = useState<JournalFormData>({
    instrument: initialData?.instrument ?? '',
    market: initialData?.market ?? 'crypto',
    side: initialData?.side ?? 'buy',
    entryPrice: initialData?.entryPrice ?? '',
    exitPrice: initialData?.exitPrice ?? '',
    pnl: initialData?.pnl ?? '',
    notes: initialData?.notes ?? '',
    tags: initialData?.tags ?? [],
    emotionalState: initialData?.emotionalState ?? '',
    lessonsLearned: initialData?.lessonsLearned ?? '',
    strategyUsed: initialData?.strategyUsed ?? '',
    rating: initialData?.rating ?? 0,
    tradeId: initialData?.tradeId,
  });
  const [tagInput, setTagInput] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !form.tags.includes(tag)) {
      setForm((prev) => ({ ...prev, tags: [...prev.tags, tag] }));
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => {
    setForm((prev) => ({ ...prev, tags: prev.tags.filter((t) => t !== tag) }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative mx-4 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-700/50 bg-slate-800 p-6 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="mb-6 text-xl font-bold text-slate-100">
          {isEditing ? 'Edit Journal Entry' : 'New Journal Entry'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Trade details row */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Instrument</label>
              <input
                value={form.instrument}
                onChange={(e) => setForm((p) => ({ ...p, instrument: e.target.value }))}
                placeholder="BTC-USD"
                className="w-full rounded-md border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Market</label>
              <select
                value={form.market}
                onChange={(e) => setForm((p) => ({ ...p, market: e.target.value }))}
                className="w-full rounded-md border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              >
                {MARKETS.map((m) => (
                  <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Side</label>
              <select
                value={form.side}
                onChange={(e) => setForm((p) => ({ ...p, side: e.target.value }))}
                className="w-full rounded-md border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Strategy</label>
              <input
                value={form.strategyUsed}
                onChange={(e) => setForm((p) => ({ ...p, strategyUsed: e.target.value }))}
                placeholder="Momentum"
                className="w-full rounded-md border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Price row */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Entry Price</label>
              <input
                type="number"
                step="any"
                value={form.entryPrice}
                onChange={(e) => setForm((p) => ({ ...p, entryPrice: e.target.value }))}
                placeholder="0.00"
                className="w-full rounded-md border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Exit Price</label>
              <input
                type="number"
                step="any"
                value={form.exitPrice}
                onChange={(e) => setForm((p) => ({ ...p, exitPrice: e.target.value }))}
                placeholder="0.00"
                className="w-full rounded-md border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">P&L</label>
              <input
                type="number"
                step="any"
                value={form.pnl}
                onChange={(e) => setForm((p) => ({ ...p, pnl: e.target.value }))}
                placeholder="0.00"
                className="w-full rounded-md border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Emotional state */}
          <div>
            <label className="mb-2 block text-xs font-medium text-slate-400">Emotional State</label>
            <div className="flex flex-wrap gap-2">
              {EMOTIONAL_STATES.map((state) => (
                <button
                  key={state}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, emotionalState: p.emotionalState === state ? '' : state }))}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    form.emotionalState === state
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {state.charAt(0).toUpperCase() + state.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Rating */}
          <div>
            <label className="mb-2 block text-xs font-medium text-slate-400">Trade Rating</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, rating: p.rating === star ? 0 : star }))}
                  className="p-0.5"
                >
                  <Star
                    className={`h-6 w-6 ${
                      star <= form.rating
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'text-slate-600'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="What was your reasoning? What happened during the trade?"
              rows={3}
              className="w-full resize-none rounded-md border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Lessons Learned */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Lessons Learned</label>
            <textarea
              value={form.lessonsLearned}
              onChange={(e) => setForm((p) => ({ ...p, lessonsLearned: e.target.value }))}
              placeholder="What would you do differently?"
              rows={2}
              className="w-full resize-none rounded-md border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Tags</label>
            <div className="flex gap-2">
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                placeholder="Add a tag..."
                className="flex-1 rounded-md border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={addTag}
                className="rounded-md bg-slate-700 px-3 py-2 text-slate-300 hover:bg-slate-600"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {form.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {form.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-blue-600/20 px-2 py-0.5 text-xs text-blue-300"
                  >
                    {tag}
                    <button type="button" onClick={() => removeTag(tag)} className="hover:text-red-400">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              {isEditing ? 'Update Entry' : 'Save Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
