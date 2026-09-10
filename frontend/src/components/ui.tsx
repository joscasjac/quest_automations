import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { initials } from "../lib/format";

// Small shared primitives so every screen reads the same.

// Inline text link with the two treatments used across the app, so the class
// strings live in one place and cannot drift per call site. "underline" is
// the docs style: always underlined, edge-colored bar that turns accent on
// hover. "hover" underlines only on hover. Both keep the 2px offset so the
// bar clears descenders. Pass `to` for an in-app route or `href` for an
// external or same-page anchor.
const TEXT_LINK_VARIANTS = {
  underline:
    "text-accent underline decoration-edge underline-offset-2 hover:decoration-accent",
  hover: "text-accent underline-offset-2 hover:underline",
};

export function TextLink({
  to,
  href,
  variant = "underline",
  className = "",
  children,
}: {
  to?: string;
  href?: string;
  variant?: "underline" | "hover";
  className?: string;
  children: ReactNode;
}) {
  const cls = `${TEXT_LINK_VARIANTS[variant]} ${className}`.trim();
  if (to !== undefined) {
    return (
      <Link to={to} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={cls}>
      {children}
    </a>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-edge bg-panel ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-white">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  type = "button",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const styles = {
    primary:
      "bg-primary text-primary-ink hover:bg-primary-hover border border-transparent",
    secondary:
      "bg-white/10 text-white hover:bg-white/15 border border-transparent",
    ghost: "text-neutral-400 hover:text-white border border-transparent",
    danger:
      "border border-red-400 text-red-400 hover:border-red-500 hover:bg-red-500/10 bg-transparent cursor-pointer disabled:cursor-not-allowed",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors disabled:opacity-40 ${styles}`}
    >
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-md border border-edge bg-ink px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-accent focus:outline-none ${props.className ?? ""}`}
    />
  );
}

// A themed replacement for the native select, so option lists render in the
// app's palette instead of the OS popover. Click to open, Escape or an
// outside click to close, check mark on the current value.
export function Select({
  value,
  onChange,
  options,
  className = "",
  size = "md",
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updateMenuRect = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const width = Math.max(rect.width, 144);
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const menuHeight = Math.min(256, Math.max(44, options.length * 36 + 8));
    const openAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.min(
      256,
      Math.max(132, (openAbove ? spaceAbove : spaceBelow) - gap),
    );
    const actualHeight = Math.min(menuHeight, maxHeight);
    const left = Math.min(
      Math.max(margin, rect.left),
      Math.max(margin, window.innerWidth - width - margin),
    );
    setMenuRect({
      top: openAbove ? rect.top - actualHeight - gap : rect.bottom + gap,
      left,
      width,
      maxHeight,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        rootRef.current &&
        !rootRef.current.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", updateMenuRect);
    window.addEventListener("scroll", updateMenuRect, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", updateMenuRect);
      window.removeEventListener("scroll", updateMenuRect, true);
    };
  }, [open, updateMenuRect]);

  useLayoutEffect(() => {
    if (open) updateMenuRect();
  }, [open, options.length, updateMenuRect, value]);

  const selected = options.find((option) => option.value === value);
  const pad = size === "sm" ? "h-8 px-2 text-sm" : "h-9 px-3 text-sm";

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-md border border-edge bg-ink text-left text-neutral-300 transition-colors hover:border-edge-strong focus:border-accent focus:outline-none ${pad}`}
      >
        <span className="truncate">{selected?.label ?? "Select"}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-neutral-500 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-9" transform="translate(0 -1.5)" />
        </svg>
      </button>
      {open && menuRect
        ? createPortal(
            <div
              ref={menuRef}
              data-select-menu
              style={{
                position: "fixed",
                top: menuRect.top,
                left: menuRect.left,
                width: menuRect.width,
                maxHeight: menuRect.maxHeight,
              }}
              className="z-50 overflow-y-auto rounded-md border border-edge bg-panel p-1 shadow-xl"
            >
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                    size === "sm" ? "text-xs" : "text-sm"
                  } ${
                    option.value === value
                      ? "bg-raised text-white"
                      : "text-neutral-400 hover:bg-raised hover:text-white"
                  }`}
                >
                  <span className="truncate">{option.label}</span>
                  {option.value === value ? (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0"
                    >
                      <path d="m4 12 5 5L20 6" />
                    </svg>
                  ) : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

// A number field with themed stepper arrows. The native spinner is hidden
// globally in index.css.
export function NumberInput({
  value,
  onChange,
  min,
  className = "",
  placeholder,
  size = "md",
}: {
  value: string;
  onChange: (value: string) => void;
  min?: number;
  className?: string;
  placeholder?: string;
  size?: "sm" | "md";
}) {
  const step = (delta: number) => {
    const current = Number(value);
    const next = (Number.isFinite(current) ? current : 0) + delta;
    onChange(String(min !== undefined ? Math.max(min, next) : next));
  };
  const arrow = (up: boolean) => (
    <svg
      width="9"
      height="9"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {up ? <path d="m5 15 7-7 7 7" /> : <path d="m5 9 7 7 7-7" />}
    </svg>
  );
  return (
    <div
      className={`flex items-stretch overflow-hidden rounded-md border border-edge bg-ink focus-within:border-accent ${
        size === "sm" ? "h-8" : ""
      } ${className}`}
    >
      <input
        type="number"
        value={value}
        min={min}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full min-w-0 bg-transparent text-sm text-white placeholder:text-neutral-500 focus:outline-none ${
          size === "sm" ? "px-2 py-0" : "px-3 py-2"
        }`}
      />
      <div className="flex shrink-0 flex-col border-l border-edge">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => step(1)}
          className="flex flex-1 items-center px-1.5 text-neutral-500 transition-colors hover:bg-raised hover:text-white"
        >
          {arrow(true)}
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => step(-1)}
          className="flex flex-1 items-center border-t border-edge px-1.5 text-neutral-500 transition-colors hover:bg-raised hover:text-white"
        >
          {arrow(false)}
        </button>
      </div>
    </div>
  );
}

// A themed calendar popover so date picks stay in the app palette instead of
// the OS date control. Value is a local YYYY-MM-DD string; empty means unset.
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const toDateString = (year: number, month: number, day: number) =>
  `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

export function DateInput({
  value,
  onChange,
  className = "",
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuRect, setMenuRect] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const today = new Date();
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? {
        year: Number(value.slice(0, 4)),
        month: Number(value.slice(5, 7)) - 1,
        day: Number(value.slice(8, 10)),
      }
    : null;

  // The month shown in the grid; starts at the selection or today.
  const [view, setView] = useState({
    year: selected?.year ?? today.getFullYear(),
    month: selected?.month ?? today.getMonth(),
  });

  const updateMenuRect = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const width = 224;
    const menuHeight = 276;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const openAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.min(
      menuHeight,
      Math.max(180, (openAbove ? spaceAbove : spaceBelow) - gap),
    );
    const actualHeight = Math.min(menuHeight, maxHeight);
    const left = Math.min(
      Math.max(margin, rect.left),
      Math.max(margin, window.innerWidth - width - margin),
    );
    setMenuRect({
      top: openAbove ? rect.top - actualHeight - gap : rect.bottom + gap,
      left,
      width,
      maxHeight,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        rootRef.current &&
        !rootRef.current.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
        setMenuRect(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setMenuRect(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", updateMenuRect);
    window.addEventListener("scroll", updateMenuRect, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", updateMenuRect);
      window.removeEventListener("scroll", updateMenuRect, true);
    };
  }, [open, updateMenuRect]);

  useLayoutEffect(() => {
    if (open) updateMenuRect();
  }, [open, updateMenuRect, value, view.month, view.year]);

  const shiftMonth = (delta: number) => {
    setView((v) => {
      const next = new Date(v.year, v.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  };

  const firstWeekday = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const label = selected
    ? `${MONTH_NAMES[selected.month].slice(0, 3)} ${selected.day}${
        selected.year !== today.getFullYear() ? `, ${selected.year}` : ""
      }`
    : "Pick a date";

  const chevron = (left: boolean) => (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {left ? <path d="m15 6-6 6 6 6" /> : <path d="m9 6 6 6-6 6" />}
    </svg>
  );

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-8 w-full items-center justify-between gap-2 rounded-md border border-edge bg-ink px-2 text-left text-sm transition-colors hover:border-edge-strong focus:border-accent focus:outline-none ${
          selected ? "text-neutral-300" : "text-neutral-500"
        }`}
      >
        <span className="truncate">{label}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-neutral-500"
        >
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M8 3v4M16 3v4M3 10h18" />
        </svg>
      </button>
      {open && menuRect ? createPortal(
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            top: menuRect.top,
            left: menuRect.left,
            width: menuRect.width,
            maxHeight: menuRect.maxHeight,
          }}
          className="z-50 overflow-y-auto rounded-md border border-edge bg-panel p-2 shadow-xl"
        >
          <div className="mb-1 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="rounded p-1 text-neutral-500 transition-colors hover:bg-raised hover:text-white"
            >
              {chevron(true)}
            </button>
            <span className="text-xs font-medium text-white">
              {MONTH_NAMES[view.month]} {view.year}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
              className="rounded p-1 text-neutral-500 transition-colors hover:bg-raised hover:text-white"
            >
              {chevron(false)}
            </button>
          </div>
          <div className="grid grid-cols-7 text-center">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <span key={i} className="py-1 text-[10px] text-neutral-600">
                {d}
              </span>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <span key={i} />;
              const isSelected =
                selected !== null &&
                selected.year === view.year &&
                selected.month === view.month &&
                selected.day === day;
              const isToday =
                view.year === today.getFullYear() &&
                view.month === today.getMonth() &&
                day === today.getDate();
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    onChange(toDateString(view.year, view.month, day));
                    setOpen(false);
                    setMenuRect(null);
                  }}
                  className={`rounded py-1 text-[11px] transition-colors ${
                    isSelected
                      ? "bg-primary text-primary-ink"
                      : isToday
                        ? "text-accent hover:bg-raised"
                        : "text-neutral-400 hover:bg-raised hover:text-white"
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

// A themed checkbox drawn from scratch. appearance-none removes the native
// control; the box is an inset well that fills with the accent color and a
// check that scales in. It stays a real input so wrapping labels keep working.
export function Checkbox({
  checked,
  onChange,
  ariaLabel,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-edge-strong bg-ink transition-colors duration-150 hover:border-neutral-500 checked:border-accent checked:bg-accent checked:hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-40"
      />
      <svg
        viewBox="0 0 12 12"
        aria-hidden="true"
        className="pointer-events-none absolute h-3 w-3 scale-50 opacity-0 transition-all duration-150 peer-checked:scale-100 peer-checked:opacity-100"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2.5 6.5 5 9l4.5-5.5" />
      </svg>
    </span>
  );
}

export function Avatar({
  name,
  src,
  size = 24,
}: {
  name: string;
  src?: string | null;
  size?: number;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="flex items-center justify-center rounded-full bg-edge text-[10px] font-medium text-neutral-300"
      style={{ width: size, height: size }}
    >
      {initials(name)}
    </span>
  );
}

export function CompanyLogo({
  name,
  logoUrl,
  size = 24,
}: {
  name: string;
  logoUrl?: string | null;
  size?: number;
}) {
  if (logoUrl) {
    return (
      <span
        className="flex shrink-0 items-center justify-center overflow-hidden rounded bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)]"
        style={{ width: size, height: size }}
      >
        <img
          src={logoUrl}
          alt={name}
          width={size}
          height={size}
          className="block h-full w-full object-contain p-0.5"
        />
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded bg-edge text-[10px] font-medium text-neutral-300"
      style={{ width: size, height: size }}
    >
      {initials(name)}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "yellow" | "red";
  className?: string;
}) {
  const tones = {
    neutral: "border-edge text-neutral-400",
    green: "border-emerald-800 text-emerald-400",
    yellow: "border-yellow-800 text-yellow-400",
    red: "border-red-900 text-red-400",
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${className ?? tones}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-edge py-12 text-sm text-neutral-500">
      {message}
    </div>
  );
}
