// Formatting helpers shared across the app.

export function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// "Aug 15", with the year added only when it differs from the current one.
export function shortDate(timestamp: number): string {
  const date = new Date(timestamp);
  const label = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return date.getFullYear() === new Date().getFullYear()
    ? label
    : `${label}, ${date.getFullYear()}`;
}

const STAGE_LABELS: Record<string, string> = {
  QUALIFIED: "Qualified",
  MEETING: "Meeting",
  PROPOSAL: "Proposal",
  NEGOTIATION: "Negotiation",
  CLOSED_WON: "Closed won",
  CLOSED_LOST: "Closed lost",
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
