// The link to Frappe Flow (the app qf_flow), which replaces the AI sidebar where it is installed.
//
// While the editor is open, the workflow as it is right now (unsaved edits included), whether it has
// unsaved changes and the selected trigger or step go to qf_flow (qf_flow.editor.push), so Flow can
// read "this workflow" and "this step". Flow's proposals come back through the side panel, which
// applies them with window.qfFlowEditor: AI steps are prepared first (quest_automations.copilot.prepare),
// then the editor's own apply, like the sidebar did; Undo puts the workflow back as it was.
import { useEffect, useRef } from "react";
import type { CopilotContext, CopilotWorkflow } from "./Copilot";

export const flowAvailable = () => !!document.querySelector('script[src*="flow_launcher"]');

const REFRESH_MS = 60000;
const csrf = () => (window as any).automationFrappe?.csrfToken ?? (window as any).csrf_token ?? "";

function post(method: string, args: Record<string, unknown>) {
  return fetch(`/api/method/${method}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Frappe-CSRF-Token": csrf() },
    body: JSON.stringify(args),
  });
}

/** Keep Flow linked to the editor while it is mounted. `ctx` changes every render; the latest is used. */
export function useFlowLink(ctx: CopilotContext, dirty: boolean) {
  const latest = useRef({ ctx, dirty });
  latest.current = { ctx, dirty };
  useEffect(() => {
    if (!flowAvailable()) return;
    let last: string | null = null;
    let lastAt = 0;
    let missing = false;
    const before = new Map<string, CopilotWorkflow>();
    const push = () => {
      if (missing) return;
      const { ctx, dirty } = latest.current;
      const body = JSON.stringify({ key: ctx.key, unsaved: dirty, selected: ctx.selected, selected_label: ctx.selectedLabel, workflow: ctx.get() });
      if (body === last && Date.now() - lastAt < REFRESH_MS) return;
      last = body;
      lastAt = Date.now();
      post("qf_flow.editor.push", { app: "automations", state: body })
        .then((r) => {
          if (r.status === 404) missing = true;
        })
        .catch(() => {});
    };
    (window as any).qfFlowEditor = {
      app: "automations",
      target: () => latest.current.ctx.key,
      apply: async (proposal: CopilotWorkflow, card: { id: string; token?: string }) => {
        const r = await post("quest_automations.copilot.prepare", { token: card.token ?? null });
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data?._error_message || "The AI steps could not be prepared. Ask again.");
        }
        before.set(card.id, JSON.parse(JSON.stringify(latest.current.ctx.get())));
        latest.current.ctx.apply(proposal);
      },
      undo: async (card: { id: string }) => {
        const was = before.get(card.id);
        if (was) latest.current.ctx.apply(was);
      },
    };
    push();
    const timer = window.setInterval(push, 1500);
    return () => {
      window.clearInterval(timer);
      if ((window as any).qfFlowEditor?.app === "automations") (window as any).qfFlowEditor = null;
      if (!missing) post("qf_flow.editor.leave", { app: "automations" }).catch(() => {});
    };
  }, []);
}
