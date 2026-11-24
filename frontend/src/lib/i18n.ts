// UI strings are plain English in code; Spanish comes from quest_automations/locale/es.po through
// Frappe's translations. Usage: __('Apply'), __('Applied ({0})', [3]).
let messages: Record<string, string> = {};

export const lang: string = String((window as any).automationFrappe?.lang || document.documentElement.lang || 'en');

export function __(message: string, replace?: Array<string | number>): string {
  let text = messages[message] || message;
  if (replace) text = text.replace(/\{(\d+)\}/g, (m, i) => String(replace[Number(i)] ?? m));
  return text;
}

export async function loadTranslations(): Promise<void> {
  document.documentElement.lang = lang;
  if (!lang || lang.startsWith('en') || !(window as any).automationFrappe) return;
  try {
    const response = await fetch('/api/method/quest_automations.copilot.translations?lang=' + encodeURIComponent(lang), { credentials: 'same-origin' });
    messages = (await response.json()).message || {};
  } catch {
    messages = {};
  }
}
