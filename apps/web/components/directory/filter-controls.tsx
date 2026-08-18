'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface FilterControlSpec {
  /** URL search-param key. */
  key: string;
  label: string;
  /** Field type drives the input rendered. */
  type: 'multi' | 'single' | 'number' | 'text' | 'range';
  options?: SelectOption[];      // for multi/single
  placeholder?: string;          // text/number
  /** Suffix shown after the input, e.g. "USD" or "%". */
  suffix?: string;
  /** For type=range, render two number inputs and store as "min-max". */
  rangeMin?: number;
  rangeMax?: number;
}

interface Props {
  specs: FilterControlSpec[];
}

// Renders a horizontal form of filter inputs. Submit pushes filter state into
// URL search params (server-rendered pages re-read params on the next request).
// Multi-select stores comma-separated values; range stores "min-max".
export function FilterControls({ specs }: Props) {
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, start] = useTransition();

  // Local state mirrors the current URL params so the form is controlled.
  const [state, setState] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of specs) init[s.key] = search.get(s.key) ?? '';
    return init;
  });

  const apply = () => {
    const next = new URLSearchParams(search.toString());
    for (const s of specs) {
      const v = state[s.key]?.trim() ?? '';
      if (v === '' || v === '-') next.delete(s.key);
      else next.set(s.key, v);
    }
    next.delete('page');
    const qs = next.toString();
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      apply();
    }
  };

  const toggleMulti = (key: string, value: string) => {
    setState((prev) => {
      const cur = prev[key]?.split(',').filter(Boolean) ?? [];
      const has = cur.includes(value);
      const nextVals = has ? cur.filter((x) => x !== value) : [...cur, value];
      return { ...prev, [key]: nextVals.join(',') };
    });
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-tiny uppercase tracking-header-wide text-accent">Filters</span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {specs.map((s) => (
          <div key={s.key}>
            <label className="block text-tiny uppercase tracking-header-medium text-text-muted">
              {s.label}
            </label>
            <div className="mt-1.5">
              {s.type === 'multi' && (
                <div className={`flex flex-wrap gap-1 ${(s.options ?? []).length > 12 ? 'max-h-28 overflow-y-auto pr-1' : ''}`}>
                  {(s.options ?? []).map((opt) => {
                    const cur = state[s.key]?.split(',').filter(Boolean) ?? [];
                    const sel = cur.includes(opt.value);
                    return (
                      <button
                        type="button"
                        key={opt.value}
                        onClick={() => toggleMulti(s.key, opt.value)}
                        className={`rounded-md border px-2 py-0.5 text-tiny uppercase tracking-header-medium ${
                          sel
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-border bg-background text-text-muted hover:text-text-primary'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {s.type === 'single' && (
                <select
                  value={state[s.key] ?? ''}
                  onChange={(e) => setState((p) => ({ ...p, [s.key]: e.target.value }))}
                  className="w-full rounded-md border border-border bg-background px-2 py-1 text-small text-text-primary"
                >
                  <option value="">All</option>
                  {(s.options ?? []).map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}
              {(s.type === 'number' || s.type === 'text') && (
                <div className="flex items-center gap-1">
                  <input
                    type={s.type === 'number' ? 'number' : 'text'}
                    value={state[s.key] ?? ''}
                    onChange={(e) => setState((p) => ({ ...p, [s.key]: e.target.value }))}
                    onKeyDown={onKey}
                    placeholder={s.placeholder}
                    className="w-full rounded-md border border-border bg-background px-2 py-1 text-small text-text-primary placeholder:text-text-muted/60"
                  />
                  {s.suffix && (
                    <span className="text-tiny uppercase tracking-header-medium text-text-muted">{s.suffix}</span>
                  )}
                </div>
              )}
              {s.type === 'range' && (
                <RangeInputs
                  value={state[s.key] ?? ''}
                  onChange={(v) => setState((p) => ({ ...p, [s.key]: v }))}
                  onSubmit={apply}
                  min={s.rangeMin}
                  max={s.rangeMax}
                  suffix={s.suffix}
                />
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={apply}
          disabled={pending}
          className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1 text-tiny uppercase tracking-header-medium text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          {pending ? 'Applying…' : 'Apply filters'}
        </button>
        <button
          type="button"
          onClick={() => {
            setState(Object.fromEntries(specs.map((s) => [s.key, ''])));
            start(() => router.push(pathname));
          }}
          className="rounded-md border border-border bg-background px-3 py-1 text-tiny uppercase tracking-header-medium text-text-muted hover:text-text-primary"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

interface RangeProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  min?: number;
  max?: number;
  suffix?: string;
}

function RangeInputs({ value, onChange, onSubmit, min, max, suffix }: RangeProps) {
  const [lo, hi] = value.split('-');
  const update = (lo2: string, hi2: string) => {
    if (!lo2 && !hi2) onChange('');
    else onChange(`${lo2 ?? ''}-${hi2 ?? ''}`);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onSubmit(); }
  };
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        value={lo ?? ''}
        onChange={(e) => update(e.target.value, hi ?? '')}
        onKeyDown={onKey}
        min={min}
        max={max}
        placeholder="min"
        className="w-full rounded-md border border-border bg-background px-2 py-1 text-small text-text-primary placeholder:text-text-muted/60"
      />
      <span className="text-tiny lowercase text-text-muted">to</span>
      <input
        type="number"
        value={hi ?? ''}
        onChange={(e) => update(lo ?? '', e.target.value)}
        onKeyDown={onKey}
        min={min}
        max={max}
        placeholder="max"
        className="w-full rounded-md border border-border bg-background px-2 py-1 text-small text-text-primary placeholder:text-text-muted/60"
      />
      {suffix && (
        <span className="text-tiny uppercase tracking-header-medium text-text-muted">{suffix}</span>
      )}
    </div>
  );
}
