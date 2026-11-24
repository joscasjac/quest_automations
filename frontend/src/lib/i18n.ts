// UI strings are plain English in code; Spanish comes from quest_automations/locale/es.po through
// Frappe's translations. Usage: __('Apply'), __('Applied ({0})', [3]).
// /automations puts the messages in window.automationFrappe.messages before any module runs, so
// __() also works in module-level constants (option lists, catalogs).
const boot = typeof window === 'undefined' ? undefined : (window as any).automationFrappe;
let messages: Record<string, string> = boot?.messages || {};

export const lang: string = String(boot?.lang || (typeof document === 'undefined' ? '' : document.documentElement.lang) || 'en');

export function __(message: string, replace?: Array<string | number> | null, context?: string): string {
  let text = (context && messages[message + ':' + context]) || messages[message] || message;
  if (replace) text = text.replace(/\{(\d+)\}/g, (m, i) => String(replace[Number(i)] ?? m));
  return text;
}

export async function loadTranslations(): Promise<void> {
  document.documentElement.lang = lang;
  if (!lang || lang.startsWith('en') || !boot || boot.messages) return;
  try {
    const response = await fetch('/api/method/quest_automations.copilot.translations?lang=' + encodeURIComponent(lang), { credentials: 'same-origin' });
    messages = (await response.json()).message || {};
  } catch {
    messages = {};
  }
}
