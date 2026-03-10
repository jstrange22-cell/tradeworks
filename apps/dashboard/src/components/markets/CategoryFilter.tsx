export const CATEGORIES: Record<string, string[]> = {
  'Large Cap': ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK'],
  'Mid Cap': ['UNI', 'AAVE', 'MKR', 'SNX', 'COMP', 'CRV', 'LDO', 'ARB', 'OP'],
  'Meme': ['DOGE', 'SHIB', 'PEPE', 'FLOKI', 'BONK', 'WIF', 'BRETT'],
  'DeFi': ['UNI', 'AAVE', 'MKR', 'CRV', 'LDO', 'COMP', 'SNX', 'SUSHI', 'YFI'],
  'AI': ['FET', 'RNDR', 'AGIX', 'OCEAN', 'TAO', 'AKT', 'NEAR'],
  'L1/L2': ['ETH', 'SOL', 'AVAX', 'DOT', 'NEAR', 'SUI', 'APT', 'ARB', 'OP', 'MATIC', 'BASE'],
};

export type CategoryName = 'All' | keyof typeof CATEGORIES;

const CATEGORY_NAMES: CategoryName[] = [
  'All',
  'Large Cap',
  'Mid Cap',
  'Meme',
  'DeFi',
  'AI',
  'L1/L2',
];

interface CategoryFilterProps {
  activeCategory: CategoryName;
  onCategoryChange: (category: CategoryName) => void;
}

export function CategoryFilter({ activeCategory, onCategoryChange }: CategoryFilterProps) {
  return (
    <nav aria-label="Market categories" className="flex flex-wrap gap-2">
      {CATEGORY_NAMES.map((name) => {
        const isActive = activeCategory === name;
        return (
          <button
            key={name}
            type="button"
            onClick={() => onCategoryChange(name)}
            aria-pressed={isActive}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-1 focus:ring-offset-white dark:focus:ring-offset-slate-900 ${
              isActive
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
            }`}
          >
            {name}
          </button>
        );
      })}
    </nav>
  );
}
