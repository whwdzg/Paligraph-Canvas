import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  /** Tooltip placement, defaults to below the control. */
  tip?: 'top' | 'bottom' | 'left' | 'right';
  variant?: 'ghost' | 'soft' | 'accent';
}

/**
 * Small Fluent-style icon button. The label is both the accessible name and
 * the tooltip, so every toolbar control remains usable without icon knowledge.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, tip = 'bottom', variant = 'ghost', className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`icon-button ${variant === 'ghost' ? '' : `is-${variant}`} ${className ?? ''}`.trim()}
      aria-label={label}
      data-tooltip={label}
      data-tip={tip}
      {...props}
    >
      {children}
    </button>
  );
});
