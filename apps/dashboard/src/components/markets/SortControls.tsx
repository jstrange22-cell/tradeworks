import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

export type SortField = 'volume' | 'change' | 'price' | 'name';
export type SortDirection = 'asc' | 'desc';

interface SortControlsProps {
  sortField: SortField;
  sortDirection: SortDirection;
  onSortFieldChange: (field: SortField) => void;
  onSortDirectionToggle: () => void;
}

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'volume', label: '24h Volume' },
  { value: 'change', label: '24h Change' },
  { value: 'price', label: 'Price' },
  { value: 'name', label: 'Name' },
];

export function SortControls({
  sortField,
  sortDirection,
  onSortFieldChange,
  onSortDirectionToggle,
}: SortControlsProps) {
  const DirectionIcon = sortDirection === 'asc' ? ArrowUp : ArrowDown;

  return (
    <div className="flex items-center gap-2" role="group" aria-label="Sort controls">
      <ArrowUpDown className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
      <label htmlFor="sort-field" className="sr-only">Sort by</label>
      <select
        id="sort-field"
        value={sortField}
        onChange={(event) => onSortFieldChange(event.target.value as SortField)}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onSortDirectionToggle}
        aria-label={`Sort ${sortDirection === 'asc' ? 'ascending' : 'descending'}, click to toggle`}
        className="rounded-md border border-slate-300 p-1.5 text-slate-600 transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-700"
      >
        <DirectionIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
