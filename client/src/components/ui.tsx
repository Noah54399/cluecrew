import {
  forwardRef,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { CheckIcon, CopyIcon, XIcon } from './Icons';

/* ---------- Input ---------- */

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...rest }, ref) {
    return <input ref={ref} className={`input ${className}`} {...rest} />;
  },
);

/* ---------- Button ---------- */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'mint' | 'amber' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  block?: boolean;
  icon?: ReactNode;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  icon,
  loading = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    variant !== 'primary' || size !== 'md' ? `btn-${variant}` : 'btn-primary',
    size === 'md' && variant === 'primary' ? '' : `btn-${size === 'md' ? 'sm' : size}`,
    block ? 'btn-block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> : icon}
      {children}
    </button>
  );
}

/* ---------- Card ---------- */

export function Card({
  children,
  className = '',
  title,
  subtitle,
  actions,
}: {
  children?: ReactNode;
  className?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="row-between" style={{ marginBottom: subtitle ? 4 : 16 }}>
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

/* ---------- Badge / Chip ---------- */

export function Badge({
  children,
  variant = 'default',
  className = '',
}: {
  children: ReactNode;
  variant?: 'default' | 'primary' | 'pink' | 'mint' | 'amber' | 'danger' | 'success';
  className?: string;
}) {
  return (
    <span className={`badge ${variant === 'default' ? '' : `badge-${variant}`} ${className}`}>
      {children}
    </span>
  );
}

/* ---------- Toggle ---------- */

export function Toggle({
  checked,
  onChange,
  title,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="toggle" style={disabled ? { opacity: 0.55 } : undefined}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-text">
        <span className="toggle-title">{title}</span>
        {description && <span className="toggle-desc">{description}</span>}
      </span>
    </label>
  );
}

/* ---------- Stepper ---------- */

export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  disabled?: boolean;
}) {
  return (
    <div className="stepper">
      <button
        type="button"
        aria-label="Decrease"
        disabled={disabled || value - step < min}
        onClick={() => onChange(Math.max(min, value - step))}
      >
        &minus;
      </button>
      <span className="stepper-value">{format ? format(value) : value}</span>
      <button
        type="button"
        aria-label="Increase"
        disabled={disabled || value + step > max}
        onClick={() => onChange(Math.min(max, value + step))}
      >
        +
      </button>
    </div>
  );
}

/* ---------- Spinner / states ---------- */

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="fullscreen-state">
      <span className="spinner" />
      {label && <p className="muted">{label}</p>}
    </div>
  );
}

export function ErrorState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="fullscreen-state">
      <h2>{title}</h2>
      {message && <p className="muted" style={{ maxWidth: 420 }}>{message}</p>}
      {action}
    </div>
  );
}

export function Banner({
  kind = 'info',
  icon,
  children,
}: {
  kind?: 'info' | 'warn' | 'error';
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`banner ${kind === 'info' ? 'banner-info' : `banner-${kind}`}`}>
      {icon}
      <span>{children}</span>
    </div>
  );
}

/* ---------- Modal ---------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  dismissable?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissable) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, dismissable]);

  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (dismissable && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal">
        {(title || dismissable) && (
          <header className="modal-head">
            {title && <h2 className="modal-title">{title}</h2>}
            {dismissable && (
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                aria-label="Close"
                onClick={onClose}
              >
                <XIcon size={18} />
              </button>
            )}
          </header>
        )}
        {children}
      </div>
    </div>
  );
}

/* ---------- Copy field ---------- */

export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-field">
      <span>{label ? `${label}: ${value}` : value}</span>
      <button
        type="button"
        className="btn btn-outline btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
