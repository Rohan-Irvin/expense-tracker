import { useState, useRef, useEffect, useCallback, CSSProperties } from 'react';

export interface ComboboxItem {
  id: number;
  name: string;
  secondaryLabel?: string; // e.g. parent category name shown in dropdown only
}

interface CategoryComboboxProps {
  items: ComboboxItem[];
  value: number; // 0 = none selected
  onChange: (id: number) => void;
  placeholder?: string;
  disabled?: boolean;
  onCreateNew?: (name: string) => Promise<{ id: number; name: string }>;
}

export default function CategoryCombobox({
  items,
  value,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  onCreateNew,
}: CategoryComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [highlighted, setHighlighted] = useState<number>(-1);
  // Fixed-position style for the dropdown — computed from the input's bounding rect
  // so the list escapes any overflow:hidden/auto ancestor (e.g. the scrollable <main>).
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({});

  const selectedItem = items.find((i) => i.id === value);

  const computeDropdownStyle = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      minWidth: 180,
      zIndex: 50,
    });
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // While open, keep the dropdown position in sync as the page scrolls or resizes
  useEffect(() => {
    if (!open) return;
    const update = () => computeDropdownStyle();
    window.addEventListener('scroll', update, true); // capture to catch scroll on any element
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, computeDropdownStyle]);

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setQuery('');
    setHighlighted(-1);
  }, []);

  const openDropdown = () => {
    if (disabled) return;
    computeDropdownStyle();
    setOpen(true);
    setQuery('');
    setHighlighted(-1);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // Filtered items
  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.secondaryLabel && i.secondaryLabel.toLowerCase().includes(q))
      )
    : items;

  // "Add new" row is shown when there's a query, onCreateNew is provided, and it's not an exact match
  const showAddNew =
    !!onCreateNew &&
    q.length > 0 &&
    !items.some((i) => i.name.toLowerCase() === q);

  const totalOptions = filtered.length + (showAddNew ? 1 : 0);

  const selectItem = (id: number) => {
    onChange(id);
    closeDropdown();
  };

  const handleAddNew = async () => {
    if (!onCreateNew || !q || creating) return;
    setCreating(true);
    try {
      const created = await onCreateNew(query.trim());
      onChange(created.id);
      closeDropdown();
    } finally {
      setCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === 'ArrowDown') openDropdown();
      return;
    }

    if (e.key === 'Escape') {
      closeDropdown();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, totalOptions - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted >= 0 && highlighted < filtered.length) {
        selectItem(filtered[highlighted].id);
      } else if (highlighted === filtered.length && showAddNew) {
        handleAddNew();
      } else if (filtered.length === 1) {
        selectItem(filtered[0].id);
      }
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlighted >= 0 && listRef.current) {
      const el = listRef.current.children[highlighted] as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlighted]);

  // Reset highlight when query changes
  useEffect(() => {
    setHighlighted(-1);
  }, [query]);

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Input / trigger */}
      {open ? (
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full px-2 py-1.5 text-sm border border-ring rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          autoComplete="off"
          spellCheck={false}
        />
      ) : (
        <button
          type="button"
          onClick={openDropdown}
          disabled={disabled}
          className={`w-full px-2 py-1.5 text-sm border border-input rounded-md bg-background text-left transition-colors
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-ring cursor-pointer'}
            ${value === 0 ? 'text-muted-foreground' : 'text-foreground'}`}
        >
          {value !== 0 && selectedItem ? selectedItem.name : placeholder}
        </button>
      )}

      {/* Dropdown — rendered with fixed positioning to escape overflow:auto ancestors */}
      {open && (
        <div
          style={dropdownStyle}
          className="max-h-[224px] overflow-y-auto rounded-md border border-border bg-popover shadow-md"
        >
          {filtered.length === 0 && !showAddNew && (
            <div className="px-3 py-2 text-xs text-muted-foreground">No matches</div>
          )}
          <ul ref={listRef}>
            {filtered.map((item, idx) => (
              <li
                key={item.id}
                onMouseDown={(e) => { e.preventDefault(); selectItem(item.id); }}
                onMouseEnter={() => setHighlighted(idx)}
                className={`flex items-baseline justify-between gap-2 px-3 py-1.5 text-sm cursor-pointer select-none
                  ${highlighted === idx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}`}
              >
                <span>{item.name}</span>
                {item.secondaryLabel && (
                  <span className="text-xs text-muted-foreground shrink-0">{item.secondaryLabel}</span>
                )}
              </li>
            ))}

            {showAddNew && (
              <li
                onMouseDown={(e) => { e.preventDefault(); handleAddNew(); }}
                onMouseEnter={() => setHighlighted(filtered.length)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm cursor-pointer select-none border-t border-border
                  ${highlighted === filtered.length ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}`}
              >
                {creating ? (
                  <span className="text-muted-foreground">Creating…</span>
                ) : (
                  <>
                    <span className="text-primary font-medium">+</span>
                    <span>Add: <strong>{query.trim()}</strong></span>
                  </>
                )}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
