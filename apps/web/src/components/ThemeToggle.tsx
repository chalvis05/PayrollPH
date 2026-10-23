import { useId } from 'react';
import { cn } from '../lib/cn';
import { useTheme } from '../lib/theme';
import type { ThemePreference } from '../lib/theme';

const options: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

/** Three-way segmented control (radio group) for light / dark / system theme. */
export function ThemeToggle({ className }: { className?: string | undefined }) {
  const { preference, setPreference } = useTheme();
  const name = useId();

  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className="sr-only">Colour theme</legend>
      <div className="flex rounded-md border border-slate-300 p-0.5 text-xs dark:border-slate-700">
        {options.map((opt) => (
          <label
            key={opt.value}
            className={cn(
              'flex-1 cursor-pointer rounded px-2 py-1 text-center font-medium select-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-emerald-600',
              preference === opt.value
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={preference === opt.value}
              onChange={() => setPreference(opt.value)}
              className="sr-only"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
