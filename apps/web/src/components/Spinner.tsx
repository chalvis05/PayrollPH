import { cn } from '../lib/cn';

interface SpinnerProps {
  className?: string | undefined;
  /** Accessible label; omit when the spinner is decorative (e.g. inside a labelled button). */
  label?: string | undefined;
}

export function Spinner({ className, label }: SpinnerProps) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-hidden={label ? undefined : true}
      className="inline-flex items-center"
    >
      <span
        className={cn(
          'inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent',
          className,
        )}
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
