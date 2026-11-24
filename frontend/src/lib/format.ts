// Formatting helpers shared across the app.
import {__, lang} from './i18n';

// the user's language, or en-US when the browser does not know it
export const locale = (() => { try { new Intl.NumberFormat(lang); return lang; } catch { return "en-US"; } })();

export function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return __("just now");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return __("{0}m ago", [minutes]);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return __("{0}h ago", [hours]);
  const days = Math.floor(hours / 24);
  return __("{0}d ago", [days]);
}

// "Aug 15", with the year added only when it differs from the current one.
export function shortDate(timestamp: number): string {
  const date = new Date(timestamp);
  const label = date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
  return date.getFullYear() === new Date().getFullYear()
    ? label
    : `${label}, ${date.getFullYear()}`;
}

const STAGE_LABELS: Record<string, string> = {
  QUALIFIED: __("Qualified"),
  MEETING: __("Meeting"),
  PROPOSAL: __("Proposal"),
  NEGOTIATION: __("Negotiation"),
  CLOSED_WON: __("Closed won"),
  CLOSED_LOST: __("Closed lost"),
};

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
