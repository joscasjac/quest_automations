import {PULSE_ACTION_LIBRARY,createPulseStep,isPulseOperation} from '../adapter/pulseCatalog';
import {CopilotPanel} from './Copilot';
import type {CopilotContext} from './Copilot';
import {__} from '../lib/i18n';
import {RESERVAS_ACTION_LIBRARY,RESERVAS_TRIGGER_LIBRARY,createReservasStep,isReservasOperation,isReservasTrigger,reservasTriggerTitle,reservasTriggerLabel} from '../adapter/ReservasFields';
import type {ReservasOperation} from '../adapter/ReservasFields';
import {CRM_ACTION_LIBRARY,CRM_TRIGGER_LIBRARY,createCrmStep,isCrmOperation,crmTriggerTitle,crmTriggerLabel} from '../adapter/CrmFields';
import type {CrmOperation} from '../adapter/CrmFields';
// CRM steps (crm_campaigns) are ERPNext actions with an operation, like Pulse actions.
const isCatalogOperation=(value:string):value is PulseOperation|CrmOperation|ReservasOperation=>isPulseOperation(value)||isCrmOperation(value)||isReservasOperation(value);
import type {PulseOperation} from '../adapter/pulseCatalog';
import {WorkflowDraftContext} from '../adapter/WorkflowDraft';
import {EmailFields} from "../adapter/EmailFields";
import {FieldSourcesProvider} from '../adapter/FieldSources';
import {CodeFields} from '../adapter/CodeFields';
import { useMutation, useQuery, api } from "../adapter/api";
import { ErpConditionFields, ErpStepFields, ErpTriggerFields, WorkflowConnections } from "../adapter/ErpFields";
import type { Workflow, Run as WorkflowRun, Version as WorkflowVersionRow, Id } from "../adapter/types";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  NumberInput,
  PageHeader,
  Panel,
  Select,
} from "../components/ui";
import { MergeFieldTextInput, MergeFieldTextarea } from "../components/MergeFieldText";
import { shortDate, timeAgo } from "../lib/format";
import { hasMergeField } from "../lib/mergeFields";

type WorkflowVersion = NonNullable<Workflow["currentVersion"]>;
type WorkflowStatus = Workflow["status"];
type DraftTrigger = Workflow["trigger"];
type DraftTriggerState = DraftTrigger | null;
type DraftTriggerList = Array<DraftTrigger>;
type RecordTrigger = Extract<DraftTrigger, { kind: "record" }>;
type TriggerFilter = NonNullable<RecordTrigger["filters"]>[number];
type DraftStep = WorkflowVersion["steps"][number];
type StepKind = DraftStep["kind"];
type ActionKind = StepKind | PulseOperation | CrmOperation | ReservasOperation;
type IfElseStep = Extract<DraftStep, { kind: "if_else" }>;
type BranchActionStep = Exclude<DraftStep, IfElseStep>;
type BranchActionKind = BranchActionStep["kind"];
type EntityType = Extract<DraftTrigger, { kind: "record" }>["entityType"];
type RecordEvent = Extract<DraftTrigger, { kind: "record" }>["event"];
type UpdateEntityType = Extract<DraftStep, { kind: "update_record" }>["entityType"];
type SelectedNode =
  | { type: "none" }
  | { type: "trigger"; index: number }
  | { type: "step"; index: number }
  | {
      type: "branchStep";
      stepIndex: number;
      branch: BranchPath;
      actionIndex: number;
    };
type BranchPath =
  | { type: "branch"; index: number }
  | { type: "else" };
type BranchInsertTarget = {
  stepIndex: number;
  branch: BranchPath;
  afterIndex: number;
} | null;
type GotoPickerSource =
  | { type: "step"; index: number }
  | {
      type: "branchStep";
      stepIndex: number;
      branch: BranchPath;
      actionIndex: number;
    }
  | null;
type WorkflowClipboard = { type: "steps"; steps: Array<DraftStep> } | null;
type WorkflowMove =
  | { type: "step"; index: number }
  | { type: "stepsFrom"; index: number }
  | null;
type BuilderTab = "builder" | "settings" | "enrollment" | "logs";
type WorkflowNodeData = {
  active: boolean;
  canDelete: boolean;
  canMove: boolean;
  canPasteBelow: boolean;
  canSetGoto: boolean;
  eyebrow: string;
  gotoCandidate: boolean;
  gotoConnectionActive: boolean;
  gotoConnectionHighlighted: boolean;
  gotoSource: boolean;
  gotoTargetLabel: string;
  menuOpen: boolean;
  title: string;
  subtitle: string;
  tone: "trigger" | "action";
  variant?: "normal" | "add-trigger";
  icon?: WorkflowCatalogIcon;
  onClick: () => void;
  onCloseMenu: () => void;
  onCopy: () => void;
  onCopyFromHere: () => void;
  onDelete: () => void;
  onMenuToggle: () => void;
  onMove: () => void;
  onMoveFromHere: () => void;
  onPasteBelow: () => void;
  onSetGotoDestination: () => void;
  onDisconnectGoto: () => void;
} & Record<string, unknown>;
type ConnectorNodeData = {
  afterIndex: number;
  moveActive: boolean;
  open: boolean;
  onMoveHere: () => void;
  onOpen: () => void;
  onPasteHere: () => void;
  pasteActive: boolean;
} & Record<string, unknown>;
type BranchNodeData = {
  description: string;
  label: string;
  tone: "branch" | "none";
} & Record<string, unknown>;
type WorkflowCanvasNode =
  | Node<WorkflowNodeData, "workflow-node">
  | Node<ConnectorNodeData, "connector-node">
  | Node<BranchNodeData, "branch-node">;
type WorkflowCatalogIcon =
  | "bell"
  | "branch"
  | "calendar"
  | "check"
  | "clipboard"
  | "contact"
  | "deal"
  | "email"
  | "go_to"
  | "log"
  | "manual"
  | "noop"
  | "note"
  | "record"
  | "task"
  | "wait";
type CatalogOption<T extends string> = {
  value: T;
  title: string;
  description: string;
  group: string;
  disabled?: boolean;
};
type TriggerCatalogOption = CatalogOption<string> & {
  icon: WorkflowCatalogIcon;
  trigger: DraftTrigger;
};
type ActionCatalogOption = CatalogOption<ActionKind> & {
  icon: WorkflowCatalogIcon;
};

const ENTITY_OPTIONS = [
  { value: "deal", label: __("Deal") },
  { value: "project", label: __("Project") },
  { value: "task", label: __("Task") },
  { value: "company", label: __("Company") },
  { value: "contact", label: __("Contact") },
  { value: "note", label: __("Note") },
];

const EVENT_OPTIONS = [
  { value: "created", label: __("Created") },
  { value: "updated", label: __("Updated") },
  { value: "stage_changed", label: __("Stage changed") },
  { value: "status_changed", label: __("Status changed") },
];

const UPDATE_ENTITY_OPTIONS = [
  { value: "deal", label: __("Deal") },
  { value: "project", label: __("Project") },
  { value: "task", label: __("Task") },
  { value: "company", label: __("Company") },
  { value: "contact", label: __("Contact") },
];

const DEAL_STAGE_OPTIONS = [
  { value: "QUALIFIED", label: __("Qualified") },
  { value: "MEETING", label: __("Meeting") },
  { value: "PROPOSAL", label: __("Proposal") },
  { value: "NEGOTIATION", label: __("Negotiation") },
  { value: "CLOSED_WON", label: __("Closed won") },
  { value: "CLOSED_LOST", label: __("Closed lost") },
];

const PROJECT_STATUS_OPTIONS = [
  { value: "planned", label: __("Planned") },
  { value: "active", label: __("Active") },
  { value: "on_hold", label: __("On hold") },
  { value: "completed", label: __("Completed") },
  { value: "archived", label: __("Archived") },
];

const TASK_STATUS_OPTIONS = [
  { value: "backlog", label: __("Backlog") },
  { value: "todo", label: __("To do") },
  { value: "in_progress", label: __("In progress") },
  { value: "blocked", label: __("Blocked") },
  { value: "done", label: __("Done") },
  { value: "canceled", label: __("Canceled") },
];

const WAIT_UNIT_OPTIONS = [
  { value: "minutes", label: __("Minutes") },
  { value: "hours", label: __("Hours") },
  { value: "days", label: __("Days") },
];

const TRIGGER_FILTER_FIELDS: Record<EntityType, Array<{ value: string; label: string }>> = {
  company: [
    { value: "name", label: __("Company name") },
    { value: "industry", label: __("Industry") },
    { value: "description", label: __("Description") },
    { value: "domain", label: __("Domain") },
  ],
  contact: [
    { value: "name", label: __("Contact name") },
    { value: "email", label: __("Email") },
    { value: "title", label: __("Title") },
    { value: "status", label: __("Status") },
    { value: "tags", label: __("Tags") },
  ],
  deal: [
    { value: "name", label: __("Deal name") },
    { value: "stage", label: __("Stage") },
    { value: "amountMinor", label: __("Amount") },
    { value: "currency", label: __("Currency") },
  ],
  project: [
    { value: "name", label: __("Project name") },
    { value: "status", label: __("Status") },
    { value: "description", label: __("Description") },
  ],
  task: [
    { value: "title", label: __("Task title") },
    { value: "status", label: __("Status") },
    { value: "priority", label: __("Priority") },
    { value: "description", label: __("Description") },
  ],
  note: [
    { value: "title", label: __("Note title") },
    { value: "body", label: __("Body") },
  ],
};

const IF_ELSE_FIELD_OPTIONS = [
  {value:"trigger.status",label:__("ERPNext / Webhook Status")},
  {value:"trigger.customer",label:__("ERPNext / Webhook Customer")},
  {value:"trigger.doctype",label:__("ERPNext DocType")},
  { value: "current_day_of_week", label: __("Current Day of Week") },
  { value: "contact.name", label: __("Contact Name") },
  { value: "contact.email", label: __("Contact Email") },
  { value: "contact.title", label: __("Contact Title") },
  { value: "company.name", label: __("Company Name") },
  { value: "deal.stage", label: __("Opportunity Stage") },
  { value: "task.status", label: __("Task Status") },
];

const IF_ELSE_OPERATOR_OPTIONS = [
  { value: "is", label: __("Is") },
  { value: "is_not", label: __("Is not") },
  { value: "contains", label: __("Contains") },
  { value: "does_not_contain", label: __("Does not contain") },
  { value: "is_empty", label: __("Is empty") },
  { value: "is_not_empty", label: __("Is not empty") },
];

const ACTION_LIBRARY: Array<{
  kind: ActionKind;
  title: string;
  description: string;
  group: string;
  icon: WorkflowCatalogIcon;
}> = [
  ...CRM_ACTION_LIBRARY,
  ...RESERVAS_ACTION_LIBRARY,
  ...PULSE_ACTION_LIBRARY,
  {kind:"run_ai_capability",title:__("Run AI Capability"),description:__("Run a published AI capability with mapped inputs and a structured result."),group:__("AI"),icon:"log"},
  {kind:"api_request",title:__("API request"),description:__("Call an API with a URL, method, headers, and body."),group:"Webhooks",icon:"go_to"},
  {kind:"get_document",title:__("Get document"),description:__("Fetch any ERPNext document and use its fields in later actions."),group:"ERPNext",icon:"record"},
  {kind:"custom_code",title:__("Run Code"),description:__("Transform incoming data and return a result."),group:__("Flow"),icon:"log"},
  {kind:"erpnext",title:__("ERPNext document"),description:__("Read, create, update, or approve a document."),group:"ERPNext",icon:"record"},

  {
    kind: "create_note",
    title: __("Create note"),
    description: __("Write a CRM note linked to a record."),
    group: __("Records"),
    icon: "note",
  },
  {
    kind: "create_task",
    title: __("Create task"),
    description: __("Open a follow-up task with an optional due offset."),
    group: __("Records"),
    icon: "task",
  },
  {
    kind: "update_record",
    title: __("Update record"),
    description: __("Change a safe whitelisted field on a CRM record."),
    group: __("Records"),
    icon: "record",
  },
  {
    kind: "send_email",
    title: __("Send email"),
    description: __("Send a one-recipient notification email."),
    group: __("Communication"),
    icon: "email",
  },
  {
    kind: "send_notification",
    title: __("Send notification"),
    description: __("Record an activity or queue a Slack alert."),
    group: __("Communication"),
    icon: "bell",
  },
  {
    kind: "log",
    title: __("Log event"),
    description: __("Write an audit entry when the workflow runs."),
    group: __("Flow"),
    icon: "log",
  },
  {
    kind: "if_else",
    title: __("Condition (If / Else)"),
    description: __("Route documents through named branches."),
    group: __("Flow"),
    icon: "branch",
  },
  {
    kind: "wait",
    title: __("Wait"),
    description: __("Pause before continuing to the next action."),
    group: __("Flow"),
    icon: "wait",
  },
  {
    kind: "go_to",
    title: __("Go To"),
    description: __("Jump to another action in this workflow."),
    group: __("Flow"),
    icon: "go_to",
  },
  {
    kind: "noop",
    title: __("No operation"),
    description: __("Keep a placeholder step in the version."),
    group: __("Flow"),
    icon: "noop",
  },
];

const BRANCH_ACTION_KINDS: ReadonlyArray<BranchActionKind> = [
  "erpnext",
  "run_ai_capability",
  "get_document",
  "api_request",
  "custom_code",
  "outgoing_webhook",
  "create_note",
  "create_task",
  "update_record",
  "send_email",
  "send_notification",
  "log",
  "wait",
  "go_to",
  "noop",
];

// Pulse event presets mirror quest_automations/core/pulse_events.py line for line (tests/pulse-triggers.test.mjs);
// their titles are translated here, at display time.
const PULSE_EVENT_TRIGGERS = [
{"value": "pulse_event_task_created", "title": "Pulse task created", "description": "Start from a permission-checked Task event.", "group": "Pulse", "icon": "record", "trigger": {"kind": "document_event", "doctype": "Task", "event": "after_insert"}},
{"value": "pulse_event_task_updated", "title": "Pulse task updated", "description": "Start from a permission-checked Task event.", "group": "Pulse", "icon": "record", "trigger": {"kind": "document_event", "doctype": "Task", "event": "on_update"}},
{"value": "pulse_event_task_completed", "title": "Pulse task completed", "description": "Start from a permission-checked Task event.", "group": "Pulse", "icon": "record", "trigger": {"kind": "document_event", "doctype": "Task", "event": "on_update", "condition": {"field": "status", "operator": "is", "value": "Completed", "match": "all", "conditions": [{"field": "trigger.previous.status", "operator": "is_not", "value": "Completed"}]}}},
{"value": "pulse_event_project_created", "title": "Pulse project created", "description": "Start from a permission-checked Project event.", "group": "Pulse", "icon": "record", "trigger": {"kind": "document_event", "doctype": "Project", "event": "after_insert"}},
{"value": "pulse_event_project_updated", "title": "Pulse project updated", "description": "Start from a permission-checked Project event.", "group": "Pulse", "icon": "record", "trigger": {"kind": "document_event", "doctype": "Project", "event": "on_update"}},
{"value": "pulse_event_assigned", "title": "Pulse task assigned", "description": "Start from a permission-checked ToDo event.", "group": "Pulse", "icon": "record", "trigger": {"kind": "document_event", "doctype": "ToDo", "event": "after_insert", "condition": {"field": "reference_type", "operator": "is", "value": "Task"}}},
{"value": "pulse_event_reminder", "title": "Pulse due or overdue reminder", "description": "Start from a permission-checked Pulse Notification event.", "group": "Pulse", "icon": "record", "trigger": {"kind": "document_event", "doctype": "Pulse Notification", "event": "after_insert", "condition": {"field": "notification_type", "operator": "is", "value": "Due Reminder"}}},
{"value": "pulse_event_mention", "title": "Pulse mention", "description": "Start from a permission-checked Pulse Notification event.", "group": "Pulse", "icon": "record", "trigger": {"kind": "document_event", "doctype": "Pulse Notification", "event": "after_insert", "condition": {"field": "notification_type", "operator": "is", "value": "Mention"}}},
{"value": "pulse_event_comment", "title": "Pulse task comment", "description": "Start from a permission-checked Pulse Comment event.", "group": "Pulse", "icon": "record", "trigger": {"kind": "document_event", "doctype": "Pulse Comment", "event": "after_insert"}},
{"value": "pulse_event_module", "title": "Pulse module updated", "description": "Start from a permission-checked Pulse Module event.", "group": "Pulse", "icon": "record", "trigger": {"kind": "document_event", "doctype": "Pulse Module", "event": "on_update"}},
{"value": "pulse_event_module_membership", "title": "Pulse module membership changed", "description": "Start from a permission-checked Pulse Activity Log event.", "group": "Pulse", "icon": "record", "trigger": {"kind": "document_event", "doctype": "Pulse Activity Log", "event": "after_insert", "condition": {"field": "activity_type", "operator": "is", "value": "Module Membership Changed"}}},
{"value": "pulse_event_page", "title": "Pulse page updated", "description": "Start from a permission-checked Pulse Document event.", "group": "Pulse", "icon": "record", "trigger": {"kind": "document_event", "doctype": "Pulse Document", "event": "on_update"}},
{"value": "pulse_event_request", "title": "Pulse request submitted", "description": "Start from a permission-checked Pulse Request event.", "group": "Pulse", "icon": "record", "trigger": {"kind": "document_event", "doctype": "Pulse Request", "event": "after_insert"}},
{"value": "pulse_event_request_review", "title": "Pulse request reviewed", "description": "Start from a permission-checked Pulse Request event.", "group": "Pulse", "icon": "record", "trigger": {"kind": "document_event", "doctype": "Pulse Request", "event": "on_update", "changedFields": ["status", "reviewer", "duplicate_of", "review_note", "accepted_task"]}},
{"value": "pulse_event_approval", "title": "Pulse approval decision", "description": "Start from a permission-checked Pulse Task Approval event.", "group": "Pulse", "icon": "record", "trigger": {"kind": "document_event", "doctype": "Pulse Task Approval", "event": "on_update", "changedFields": ["decision"], "condition": {"field": "decision", "operator": "is", "value": "Approved", "match": "any", "conditions": [{"field": "decision", "operator": "is", "value": "Rejected"}]}}},
{"value": "pulse_event_handoff", "title": "Pulse delivery handoff", "description": "Start from a permission-checked Pulse Business Handoff event.", "group": "Pulse", "icon": "record", "trigger": {"kind": "document_event", "doctype": "Pulse Business Handoff", "event": "after_insert"}},
{"value": "pulse_event_external_discussion", "title": "Pulse external discussion", "description": "Start from a permission-checked Pulse External Comment event.", "group": "Pulse", "icon": "record", "trigger": {"kind": "document_event", "doctype": "Pulse External Comment", "event": "after_insert"}},
{"value": "pulse_event_order", "title": "Sales order submitted", "description": "Start from a permission-checked Sales Order event.", "group": "Pulse", "icon": "record", "trigger": {"kind": "document_event", "doctype": "Sales Order", "event": "on_submit"}},
{"value": "pulse_event_crm_deal", "title": "CRM deal updated", "description": "Start from a permission-checked CRM Deal event.", "group": "Pulse", "icon": "record", "trigger": {"kind": "document_event", "doctype": "CRM Deal", "event": "on_update"}},
].map(row => ({ ...row, title: __(row.title), description: __(row.description) }));

const TRIGGER_LIBRARY: Array<TriggerCatalogOption> = [
  ...(CRM_TRIGGER_LIBRARY as Array<TriggerCatalogOption>),
  ...(RESERVAS_TRIGGER_LIBRARY as unknown as Array<TriggerCatalogOption>),
  ...(PULSE_EVENT_TRIGGERS as Array<TriggerCatalogOption>),
  {value:"incoming_webhook",title:__("Incoming webhook"),description:__("Receive JSON from another app."),group:"Webhooks",icon:"go_to",trigger:{kind:"incoming_webhook"}},
  {value:"document_event",title:__("ERPNext document event"),description:__("Start on an ERPNext document event."),group:"ERPNext",icon:"record",trigger:{kind:"document_event",doctype:"Sales Order",event:"on_submit"}},
  {
    value: "contact_changed",
    title: __("Contact Changed"),
    description: __("Runs when a contact record is updated."),
    group: __("Contact"),
    icon: "contact",
    trigger: { kind: "record", entityType: "contact", event: "updated" },
  },
  {
    value: "contact_created",
    title: __("Contact Created"),
    description: __("Runs when a new contact is added."),
    group: __("Contact"),
    icon: "contact",
    trigger: { kind: "record", entityType: "contact", event: "created" },
  },
  {
    value: "note_added",
    title: __("Note Added"),
    description: __("Runs when a note is added."),
    group: __("Contact"),
    icon: "note",
    trigger: { kind: "record", entityType: "note", event: "created" },
  },
  {
    value: "note_changed",
    title: __("Note Changed"),
    description: __("Runs when a note is updated."),
    group: __("Contact"),
    icon: "note",
    trigger: { kind: "record", entityType: "note", event: "updated" },
  },
  {
    value: "task_added",
    title: __("Task Added"),
    description: __("Runs when a task is added."),
    group: __("Contact"),
    icon: "task",
    trigger: { kind: "record", entityType: "task", event: "created" },
  },
  {
    value: "task_completed",
    title: __("Task Completed"),
    description: __("Runs when a task status changes."),
    group: __("Contact"),
    icon: "check",
    trigger: { kind: "record", entityType: "task", event: "status_changed" },
  },
  {
    value: "schedule",
    title: __("Custom Date Reminder"),
    description: __("Run it on a recurring interval."),
    group: __("Date & time"),
    icon: "calendar",
    trigger: { kind: "schedule", intervalMinutes: 1440 },
  },
  {
    value: "manual",
    title: __("Launch manually"),
    description: __("Run it intentionally from the workflow page."),
    group: __("Automation"),
    icon: "manual",
    trigger: { kind: "manual" },
  },
  {
    value: "deal_created",
    title: __("Opportunity Created"),
    description: __("Runs when an opportunity is created for a contact."),
    group: __("Opportunities"),
    icon: "deal",
    trigger: { kind: "record", entityType: "deal", event: "created" },
  },
  {
    value: "deal_stage_changed",
    title: __("Opportunity Stage Changed"),
    description: __("Runs when a deal moves to another stage."),
    group: __("Opportunities"),
    icon: "deal",
    trigger: { kind: "record", entityType: "deal", event: "stage_changed" },
  },
];

const DEFAULT_TRIGGER: DraftTrigger = { kind: "manual" };

export function Workflows() {
  const navigate = useNavigate();
  const workflows = useQuery(api.workflows.list);
  const deleteWorkflow = useMutation(api.workflows.deleteWorkflow);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const rows = (workflows ?? []).filter((w) => !hidden.includes(w._id));
  const remove = async (workflow: { _id: string; name: string }) => {
    if (!window.confirm(__("Delete the workflow «{0}» with its webhook endpoints, captured samples, schedules, versions and run history? This cannot be undone.", [workflow.name]))) return;
    setDeleting(workflow._id);
    try {
      await deleteWorkflow({ definitionId: workflow._id });
      setHidden((ids) => [...ids, workflow._id]);
    } catch (error) {
      window.dispatchEvent(new CustomEvent("automation-error", { detail: (error as Error).message }));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="-mx-6 -my-6 flex min-h-[calc(100vh-48px)] flex-col bg-ink">
      <div className="border-b border-edge px-6 py-4">
        <PageHeader
          title={__("Workflows")}
          subtitle={__("Automations sorted by the last change.")}
          action={
            <div className="flex gap-2">
              <Button onClick={() => navigate("/app/workflows/new")}>
                + {__("New Workflow")}
              </Button>
              <Button
                variant="primary"
                onClick={() => navigate("/app/workflows/describe")}
              >
                ✦ {__("Build with AI")}
              </Button>
            </div>
          }
        />
      </div>

      <main className="min-h-0 flex-1 overflow-auto p-6">
        <Panel className="overflow-hidden">
          <div className="flex items-center border-b border-edge pr-4 text-xs font-medium text-neutral-500 max-lg:hidden">
            <div className="grid flex-1 grid-cols-[minmax(220px,1.3fr)_130px_180px_110px_150px] gap-3 px-4 py-2">
              <span>{__("Name")}</span>
              <span>{__("Status")}</span>
              <span>{__("Trigger")}</span>
              <span>{__("Runs")}</span>
              <span>{__("Last update")}</span>
            </div>
            <span className="w-16" aria-hidden="true" />
          </div>
          {workflows === undefined ? (
            <div className="p-4 text-sm text-neutral-500">{__("Loading...")}</div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState message={__("No workflows yet")} />
              <div className="mt-4 flex justify-center gap-2">
                <Button onClick={() => navigate("/app/workflows/new")}>
                  + {__("New Workflow")}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => navigate("/app/workflows/describe")}
                >
                  ✦ {__("Build with AI")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-edge">
              {rows.map((workflow) => (
                <div key={workflow._id} className="flex items-center pr-4 transition-colors hover:bg-raised/50">
                <button
                  type="button"
                  onClick={() => navigate(`/app/workflows/${workflow._id}`)}
                  className="grid min-w-0 flex-1 grid-cols-[minmax(220px,1.3fr)_130px_180px_110px_150px] items-center gap-3 px-4 py-3 text-left max-lg:grid-cols-1 max-lg:gap-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-white">
                      {workflow.name}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-neutral-500">
                      {workflow.description ?? __("No description")}
                    </span>
                  </span>
                  <span>
                    <StatusBadge status={workflow.status} />
                  </span>
                  <span className="truncate text-sm text-neutral-400">
                    {triggerLabel(workflow.trigger)}
                  </span>
                  <span className="text-sm text-neutral-400">
                    {workflow.recentRuns.length}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {shortDate(workflow.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={deleting !== null}
                  onClick={() => remove(workflow)}
                  aria-label={__("Delete the workflow «{0}»", [workflow.name])}
                  title={__("Delete workflow")}
                  className="w-16 shrink-0 rounded-md px-2 py-1.5 text-sm text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-40"
                >
                  {deleting === workflow._id ? "…" : __("Delete")}
                </button>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </main>
    </div>
  );
}

export function WorkflowBuilderPage({ mode }: { mode: "new" | "detail" }) {
  const navigate = useNavigate();
  const params = useParams<{ workflowId: string }>();
  const createDraft = useMutation(api.workflows.createDraft);
  const deleteWorkflow = useMutation(api.workflows.deleteWorkflow);
  const deleteSavedTrigger = useMutation(api.workflows.deleteTrigger);
  const updateDefinition = useMutation(api.workflows.updateDefinition);
  const publishVersion = useMutation(api.workflows.publishVersion);
  const setStatus = useMutation(api.workflows.setStatus);
  const runManual = useMutation(api.workflows.runManual);
  const routeWorkflowId = mode === "detail" ? params.workflowId : undefined;
  const workflow = useQuery(
    api.workflows.get,
    routeWorkflowId
      ? {
          definitionId: routeWorkflowId as Id<"workflowDefinitions">,
        }
      : "skip",
  );
  const creating = mode === "new";
  const [selectedNode, setSelectedNode] = useState<SelectedNode>({
    type: "trigger",
    index: 0,
  });
  const [activeTab, setActiveTab] = useState<BuilderTab>("builder");
  const [draftName, setDraftName] = useState(() =>
    mode === "new" ? createInitialWorkflowName() : "",
  );
  const [draftDescription, setDraftDescription] = useState("");
  const [draftTriggers, setDraftTriggers] = useState<DraftTriggerList>(
    mode === "new" ? [] : [DEFAULT_TRIGGER],
  );
  const [draftSteps, setDraftSteps] = useState<Array<DraftStep>>(
    mode === "new" ? [] : [createDefaultStep("log")],
  );
  const [stepPickerAfter, setStepPickerAfter] = useState<number | null>(null);
  const [branchStepPicker, setBranchStepPicker] =
    useState<BranchInsertTarget>(null);
  const [triggerPickerOpen, setTriggerPickerOpen] = useState(false);
  const [openNodeMenu, setOpenNodeMenu] = useState<SelectedNode>({
    type: "none",
  });
  const [workflowClipboard, setWorkflowClipboard] =
    useState<WorkflowClipboard>(null);
  const [workflowMove, setWorkflowMove] = useState<WorkflowMove>(null);
  const [gotoPickerFor, setGotoPickerFor] = useState<GotoPickerSource>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [copilotOpen, setCopilotOpen] = useState(() => {
    // reopened on wide screens only; on a phone it would cover the canvas on every visit
    try { return localStorage.getItem("quest-automations-copilot-open") === "1" && window.matchMedia("(min-width: 1280px)").matches; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("quest-automations-copilot-open", copilotOpen ? "1" : "0"); } catch { /* still works without storage */ }
  }, [copilotOpen]);
  const selected = creating ? undefined : workflow ?? undefined;
  const runs = useQuery(
    api.workflows.runsForDefinition,
    selected ? { definitionId: selected._id } : "skip",
  );
  const versions = useQuery(
    api.workflows.versionsForDefinition,
    selected ? { definitionId: selected._id } : "skip",
  );
  const validationErrors = selected?.currentVersion?.validationErrors ?? [];
  const draftValidationErrors = useMemo(
    () => validateDraft(draftName, draftTriggers, draftSteps),
    [draftName, draftTriggers, draftSteps],
  );
  const canTestDraft = draftName.trim().length > 0 && draftValidationErrors.length === 0;
  const dirty =
    creating ||
    draftName.trim() !== (selected?.name ?? "") ||
    (draftDescription.trim() || undefined) !== selected?.description ||
    JSON.stringify(draftTriggers) !==
      JSON.stringify(workflowTriggerList(selected)) ||
    JSON.stringify(draftSteps) !==
      JSON.stringify(selected?.currentVersion?.steps ?? []);
  const runDisabledReason = testDisabledReason({
    creating,
    workflow: selected,
    dirty,
    draftValidationErrors,
    validationErrors,
  });
  const statusDisabledReason =
    draftValidationErrors.length > 0
      ? draftValidationErrors[0]
      : selected?.currentVersion?.validationErrors[0] ?? "";

  useEffect(() => {
    if (creating || !selected) return;
    setDraftName(selected.name);
    setDraftDescription(selected.description ?? "");
    setDraftTriggers(workflowTriggerList(selected));
    setDraftSteps(
      selected.currentVersion?.steps ?? [],
    );
    setSelectedNode(previous=>previous.type==="trigger" && previous.index<workflowTriggerList(selected).length?previous:{type:"trigger",index:0});
    setStepPickerAfter(null);
    setBranchStepPicker(null);
    setTriggerPickerOpen(false);
    setOpenNodeMenu({ type: "none" });
    setWorkflowMove(null);
    setGotoPickerFor(null);
    setFormError("");
  }, [creating, selected?._id, selected?.currentVersion?._id]);

  useEffect(() => {
    if (!creating) return;
    setDraftName(createInitialWorkflowName());
    setDraftDescription("");
    setDraftTriggers([]);
    setDraftSteps([]);
    setSelectedNode({ type: "none" });
    setStepPickerAfter(null);
    setBranchStepPicker(null);
    setTriggerPickerOpen(false);
    setOpenNodeMenu({ type: "none" });
    setWorkflowMove(null);
    setGotoPickerFor(null);
    setActiveTab("builder");
    setFormError("");
  }, [creating]);

  const insertStep = (afterIndex: number, kind: ActionKind) => {
    const nextStep = createDefaultStep(kind);
    const insertedIndex = afterIndex + 1;
    setDraftSteps((steps) => {
      const next = [...steps];
      next.splice(insertedIndex, 0, nextStep);
      return next;
    });
    setSelectedNode({ type: "step", index: insertedIndex });
    setStepPickerAfter(null);
    setBranchStepPicker(null);
    setOpenNodeMenu({ type: "none" });
    setWorkflowMove(null);
    setGotoPickerFor(kind === "go_to" ? { type: "step", index: insertedIndex } : null);
  };

  const insertBranchStep = (target: NonNullable<BranchInsertTarget>, kind: ActionKind) => {
    const nextStep = createDefaultStep(kind);
    if (!isBranchActionStep(nextStep)) return;
    const insertedIndex = target.afterIndex + 1;
    setDraftSteps((steps) =>
      updateIfElseBranchSteps(steps, target.stepIndex, target.branch, (branchSteps) => {
        const next = [...branchSteps];
        next.splice(insertedIndex, 0, nextStep);
        return next;
      }),
    );
    setSelectedNode({
      type: "branchStep",
      stepIndex: target.stepIndex,
      branch: target.branch,
      actionIndex: insertedIndex,
    });
    setBranchStepPicker(null);
    setStepPickerAfter(null);
    setOpenNodeMenu({ type: "none" });
    setWorkflowMove(null);
    setGotoPickerFor(
      kind === "go_to"
        ? {
            type: "branchStep",
            stepIndex: target.stepIndex,
            branch: target.branch,
            actionIndex: insertedIndex,
          }
        : null,
    );
  };

  const updateStepAt = (index: number, step: DraftStep) => {
    setDraftSteps((steps) =>
      steps.map((item, itemIndex) => (itemIndex === index ? step : item)),
    );
  };

  const updateBranchStepAt = (
    stepIndex: number,
    branch: BranchPath,
    actionIndex: number,
    step: BranchActionStep,
  ) => {
    setDraftSteps((steps) =>
      updateIfElseBranchSteps(steps, stepIndex, branch, (branchSteps) =>
        branchSteps.map((item, itemIndex) =>
          itemIndex === actionIndex ? step : item,
        ),
      ),
    );
  };

  const removeBranchStep = (
    stepIndex: number,
    branch: BranchPath,
    actionIndex: number,
  ) => {
    setDraftSteps((steps) =>
      updateIfElseBranchSteps(steps, stepIndex, branch, (branchSteps) =>
        branchSteps.filter((_, itemIndex) => itemIndex !== actionIndex),
      ),
    );
    setSelectedNode({ type: "step", index: stepIndex });
    setOpenNodeMenu({ type: "none" });
    setBranchStepPicker(null);
  };

  const moveBranchStep = (
    stepIndex: number,
    branch: BranchPath,
    actionIndex: number,
    direction: -1 | 1,
  ) => {
    setDraftSteps((steps) =>
      updateIfElseBranchSteps(steps, stepIndex, branch, (branchSteps) => {
        const target = actionIndex + direction;
        if (target < 0 || target >= branchSteps.length) return branchSteps;
        const next = [...branchSteps];
        const [item] = next.splice(actionIndex, 1);
        next.splice(target, 0, item);
        return next;
      }),
    );
    setSelectedNode({
      type: "branchStep",
      stepIndex,
      branch,
      actionIndex: actionIndex + direction,
    });
  };

  const removeStep = (index: number) => {
    setDraftSteps((steps) => retargetStepsAfterDelete(steps, index));
    setSelectedNode(draftTriggers.length ? { type: "trigger", index: 0 } : { type: "none" });
    setOpenNodeMenu({ type: "none" });
    setWorkflowMove(null);
    setBranchStepPicker(null);
    setGotoPickerFor(null);
  };

  const removeTrigger = async (index: number) => {
    const target=draftTriggers[index];
    const saved=Boolean(selected && target?.id && workflowTriggerList(selected).some(t=>t.id===target.id));
    if(target&&!window.confirm(saved
      ?__("Remove the trigger «{0}»? Its webhook address, captured samples and schedule are deleted too. This cannot be undone.",[triggerLabel(target)])
      :__("Remove the trigger «{0}»?",[triggerLabel(target)])))return;
    if(selected && saved){
      setBusy('delete-trigger');
      try{await deleteSavedTrigger({definitionId:selected._id,triggerId:target.id})}
      catch(error){setFormError((error as Error).message);return}
      finally{setBusy(null)}
    }
    setDraftTriggers((triggers) =>
      triggers.filter((_, itemIndex) => itemIndex !== index),
    );
    setSelectedNode(
      draftTriggers.length > 1
        ? { type: "trigger", index: Math.max(0, index - 1) }
        : { type: "none" },
    );
    setStepPickerAfter(null);
    setBranchStepPicker(null);
    setTriggerPickerOpen(draftTriggers.length <= 1);
    setOpenNodeMenu({ type: "none" });
    setWorkflowMove(null);
    setGotoPickerFor(null);
  };

  const openStepPicker = (afterIndex: number | null) => {
    setStepPickerAfter(afterIndex);
    setBranchStepPicker(null);
    setTriggerPickerOpen(false);
    setOpenNodeMenu({ type: "none" });
    setWorkflowMove(null);
    setGotoPickerFor(null);
    if (afterIndex !== null) setSelectedNode({ type: "none" });
  };

  const openBranchStepPicker = (target: BranchInsertTarget) => {
    setBranchStepPicker(target);
    setStepPickerAfter(null);
    setTriggerPickerOpen(false);
    setOpenNodeMenu({ type: "none" });
    setWorkflowMove(null);
    setGotoPickerFor(null);
    if (target) setSelectedNode({ type: "none" });
  };

  const openTriggerPicker = (open: boolean) => {
    setTriggerPickerOpen(open);
    setStepPickerAfter(null);
    setBranchStepPicker(null);
    setOpenNodeMenu({ type: "none" });
    setWorkflowMove(null);
    setGotoPickerFor(null);
    if (open) setSelectedNode({ type: "none" });
  };

  const appendTrigger = (trigger: DraftTrigger) => {
    setDraftTriggers((triggers) => [...triggers, {...trigger,id:trigger.id??'trigger_'+crypto.randomUUID().slice(0,8)}]);
    setSelectedNode({ type: "trigger", index: draftTriggers.length });
    setTriggerPickerOpen(false);
    setStepPickerAfter(null);
    setBranchStepPicker(null);
    setOpenNodeMenu({ type: "none" });
    setWorkflowMove(null);
    setGotoPickerFor(null);
  };

  const updateTriggerAt = (index: number, trigger: DraftTriggerState) => {
    setDraftTriggers((triggers) => {
      if (!trigger) return triggers.filter((_, itemIndex) => itemIndex !== index);
      return triggers.map((item, itemIndex) =>
        itemIndex === index ? trigger : item,
      );
    });
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    setDraftSteps((steps) => {
      const target = index + direction;
      if (target < 0 || target >= steps.length) return steps;
      const next = [...steps];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
    setSelectedNode({ type: "step", index: index + direction });
    setOpenNodeMenu({ type: "none" });
    setWorkflowMove(null);
    setGotoPickerFor(null);
  };

  const copyStep = (index: number) => {
    const step = draftSteps[index];
    if (!step) return;
    setWorkflowClipboard({ type: "steps", steps: cloneSteps([step]) });
    setOpenNodeMenu({ type: "none" });
  };

  const copyStepsFrom = (index: number) => {
    const steps = draftSteps.slice(index);
    if (steps.length === 0) return;
    setWorkflowClipboard({ type: "steps", steps: cloneSteps(steps) });
    setOpenNodeMenu({ type: "none" });
  };

  const pasteStepsBelow = (index: number) => {
    if (!workflowClipboard || workflowClipboard.type !== "steps") return;
    const pastedSteps = cloneSteps(workflowClipboard.steps);
    setDraftSteps((steps) => {
      const next = [...steps];
      next.splice(index + 1, 0, ...pastedSteps);
      return next;
    });
    setSelectedNode({ type: "step", index: index + pastedSteps.length });
    setOpenNodeMenu({ type: "none" });
    setWorkflowMove(null);
  };

  const beginMoveStep = (index: number) => {
    if (!draftSteps[index]) return;
    setWorkflowMove({ type: "step", index });
    setGotoPickerFor(null);
    setSelectedNode({ type: "step", index });
    setOpenNodeMenu({ type: "none" });
    setStepPickerAfter(null);
    setBranchStepPicker(null);
    setTriggerPickerOpen(false);
  };

  const beginMoveStepsFrom = (index: number) => {
    if (draftSteps.length <= index) return;
    setWorkflowMove({ type: "stepsFrom", index });
    setGotoPickerFor(null);
    setSelectedNode({ type: "step", index });
    setOpenNodeMenu({ type: "none" });
    setStepPickerAfter(null);
    setBranchStepPicker(null);
    setTriggerPickerOpen(false);
  };

  const moveSelectionHere = (afterIndex: number) => {
    if (!workflowMove) return;
    const result = moveStepsToInsertionPoint(draftSteps, workflowMove, afterIndex);
    setDraftSteps(result.steps);
    setSelectedNode({ type: "step", index: result.selectedIndex });
    setWorkflowMove(null);
    setOpenNodeMenu({ type: "none" });
    setGotoPickerFor(null);
  };

  const beginGotoDestination = (index: number) => {
    const step = draftSteps[index];
    if (!step || step.kind !== "go_to") return;
    setGotoPickerFor({ type: "step", index });
    setSelectedNode({ type: "step", index });
    setOpenNodeMenu({ type: "none" });
    setStepPickerAfter(null);
    setBranchStepPicker(null);
    setTriggerPickerOpen(false);
    setWorkflowMove(null);
  };

  const beginBranchGotoDestination = (
    stepIndex: number,
    branch: BranchPath,
    actionIndex: number,
  ) => {
    const step = branchStepsFor(draftSteps[stepIndex], branch)[actionIndex];
    if (!step || step.kind !== "go_to") return;
    setGotoPickerFor({ type: "branchStep", stepIndex, branch, actionIndex });
    setSelectedNode({ type: "branchStep", stepIndex, branch, actionIndex });
    setOpenNodeMenu({ type: "none" });
    setStepPickerAfter(null);
    setBranchStepPicker(null);
    setTriggerPickerOpen(false);
    setWorkflowMove(null);
  };

  const chooseGotoDestination = (
    source: NonNullable<GotoPickerSource>,
    targetIndex: number,
  ) => {
    if (source.type === "step" && source.index === targetIndex) return;
    if (source.type === "step") {
      setDraftSteps((steps) =>
        steps.map((step, index) =>
          index === source.index && step.kind === "go_to"
            ? { ...step, targetStepIndex: targetIndex }
            : step,
        ),
      );
    } else {
      setDraftSteps((steps) =>
        updateIfElseBranchSteps(
          steps,
          source.stepIndex,
          source.branch,
          (branchSteps) =>
            branchSteps.map((step, index) =>
              index === source.actionIndex && step.kind === "go_to"
                ? { ...step, targetStepIndex: targetIndex }
                : step,
            ),
        ),
      );
    }
    setSelectedNode(gotoSourceToSelectedNode(source));
    setGotoPickerFor(null);
    setOpenNodeMenu({ type: "none" });
  };

  const disconnectGoto = (index: number) => {
    setDraftSteps((steps) =>
      steps.map((step, itemIndex) =>
        itemIndex === index && step.kind === "go_to"
          ? { kind: "go_to", label: step.label }
          : step,
      ),
    );
    setGotoPickerFor({ type: "step", index });
    setSelectedNode({ type: "step", index });
    setOpenNodeMenu({ type: "none" });
  };

  const disconnectBranchGoto = (
    stepIndex: number,
    branch: BranchPath,
    actionIndex: number,
  ) => {
    setDraftSteps((steps) =>
      updateIfElseBranchSteps(steps, stepIndex, branch, (branchSteps) =>
        branchSteps.map((step, index) =>
          index === actionIndex && step.kind === "go_to"
            ? { kind: "go_to", label: step.label }
            : step,
        ),
      ),
    );
    setSelectedNode({ type: "branchStep", stepIndex, branch, actionIndex });
    setGotoPickerFor({ type: "branchStep", stepIndex, branch, actionIndex });
    setOpenNodeMenu({ type: "none" });
  };

  const saveBuilder = async (draftOnly = false): Promise<Id<"workflowDefinitions"> | null> => {
    const name = draftName.trim();
    if (!name) {
      setFormError(__("Workflow name is required."));
      return null;
    }
    const primaryTrigger = draftTriggers[0];
    const localErrors = validateDraft(name, draftTriggers, draftSteps, true);
    if (localErrors.length > 0) {
      setFormError(localErrors.join(" "));
      return null;
    }
    if (!primaryTrigger) {
      setFormError(__("Workflow trigger is required."));
      return null;
    }
    setBusy("save");
    setFormError("");
    try {
      if (creating) {
        const id = await createDraft({
          name,
          description: draftDescription.trim() || undefined,
          trigger: primaryTrigger,
          triggers: draftTriggers,
          steps: draftSteps,
        });
        navigate(`/app/workflows/${id}`);
        return id;
      }
      if (!selected) return null;
      await updateDefinition({
        definitionId: selected._id,
        name,
        description: draftDescription.trim() || undefined,
      });
      const result = await publishVersion({
        draftOnly,
        definitionId: selected._id,
        trigger: primaryTrigger,
        triggers: draftTriggers,
        steps: draftSteps,
      });
      if (result.validationErrors.length > 0) {
        setFormError(result.validationErrors.join(" "));
        return null;
      }
      return selected._id;
    } catch (err) {
      setFormError(err instanceof Error ? err.message : __("Workflow failed validation."));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const changeStatus = async (
    definitionId: Id<"workflowDefinitions">,
    status: WorkflowStatus,
  ) => {
    if (dirty) {
      const savedId = await saveBuilder();
      if (!savedId) return;
      definitionId = savedId;
    }
    setBusy(`${definitionId}:${status}`);
    setFormError("");
    try {
      await setStatus({ definitionId, status });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : __("Could not change workflow status."));
    } finally {
      setBusy(null);
    }
  };

  const startRun = async () => {
    if (!canTestDraft || busy) return;
    setFormError("");
    const definitionId = dirty || creating ? await saveBuilder() : selected?._id;
    if (!definitionId) return;
    setBusy(`${definitionId}:run`);
    try {
      await runManual({ definitionId });
      setActiveTab("enrollment");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : __("Could not start workflow run."));
      setActiveTab("builder");
    } finally {
      setBusy(null);
    }
  };

  const copilotSelection =
    selectedNode.type === "trigger" && draftTriggers[selectedNode.index]
      ? triggerTitle(draftTriggers[selectedNode.index])
      : selectedNode.type === "step" && draftSteps[selectedNode.index]
        ? draftSteps[selectedNode.index].label || stepTitle(draftSteps[selectedNode.index])
        : selectedNode.type === "branchStep"
          ? branchStepsFor(draftSteps[selectedNode.stepIndex], selectedNode.branch)[selectedNode.actionIndex]?.label ?? null
          : null;
  const copilotContext: CopilotContext = {
    key: creating ? "new" : String(routeWorkflowId ?? "new"),
    get: () => ({ name: draftName, description: draftDescription, triggers: draftTriggers, steps: draftSteps }),
    selected: selectedNode as CopilotContext["selected"],
    selectedLabel: copilotSelection ? String(copilotSelection) : null,
    apply: (proposal) => {
      setDraftName(proposal.name);
      setDraftDescription(proposal.description ?? "");
      setDraftTriggers(proposal.triggers as DraftTriggerList);
      setDraftSteps(proposal.steps as Array<DraftStep>);
      setSelectedNode(proposal.triggers.length ? { type: "trigger", index: 0 } : { type: "none" });
      setStepPickerAfter(null);
      setBranchStepPicker(null);
      setTriggerPickerOpen(false);
      setOpenNodeMenu({ type: "none" });
      setWorkflowMove(null);
      setGotoPickerFor(null);
      setActiveTab("builder");
    },
  };

  return (
    <WorkflowDraftContext.Provider value={{save:()=>saveBuilder(true),busy:busy!==null,savedTriggerIds:workflowTriggerList(selected).flatMap(t=>t.id?[t.id]:[])}}><FieldSourcesProvider triggers={draftTriggers} steps={draftSteps} selection={selectedNode}><div className="-mx-6 -my-6 flex min-h-[calc(100vh-48px)] bg-ink"><div className="flex min-w-0 flex-1 flex-col">
      {!creating && workflow === undefined ? (
        <main className="flex flex-1 items-center justify-center p-6">
          <Panel className="w-full max-w-md p-6 text-sm text-neutral-500">
            {__("Loading workflow...")}
          </Panel>
        </main>
      ) : !creating && workflow === null ? (
        <main className="flex flex-1 items-center justify-center p-6">
          <Panel className="w-full max-w-md p-6 text-center">
            <EmptyState message={__("Workflow not found")} />
            <div className="mt-4">
              <Button
                variant="primary"
                onClick={() => navigate("/app/workflows")}
              >
                {__("Back to Workflows")}
              </Button>
            </div>
          </Panel>
        </main>
      ) : (
        <main className="min-h-0 flex-1">
          <BuilderTopBar
            creating={creating}
            workflow={selected}
            dirty={dirty}
            busy={busy}
            name={draftName}
            canRun={canTestDraft && !runDisabledReason}
            statusDisabledReason={statusDisabledReason}
            activeTab={activeTab}
            onTab={setActiveTab}
            onRun={() => void startRun()}
            copilotOpen={copilotOpen}
            onCopilot={() => setCopilotOpen((open) => !open)}
            onSave={() => void saveBuilder()}
            onBack={() => navigate("/app/workflows")}
            onEditSettings={() => setActiveTab("settings")}
            onStatus={(status) =>
              selected ? void changeStatus(selected._id, status) : undefined
            }
          />

          {activeTab === "builder" ? (
            <div className="grid h-[calc(100vh-177px)] min-h-0 lg:grid-cols-[minmax(0,1fr)_360px]">
              <WorkflowCanvas
                triggers={draftTriggers}
                steps={draftSteps}
                selectedNode={selectedNode}
                openNodeMenu={openNodeMenu}
                stepPickerAfter={stepPickerAfter}
                branchStepPicker={branchStepPicker}
                triggerPickerOpen={triggerPickerOpen}
                workflowClipboard={workflowClipboard}
                workflowMove={workflowMove}
                gotoPickerFor={gotoPickerFor}
                onSelectNode={setSelectedNode}
                onOpenNodeMenu={setOpenNodeMenu}
                onOpenPicker={openStepPicker}
                onOpenBranchPicker={openBranchStepPicker}
                onDeleteTrigger={removeTrigger}
                onDeleteStep={removeStep}
                onCopyStep={copyStep}
                onCopyStepsFrom={copyStepsFrom}
                onBeginMoveStep={beginMoveStep}
                onBeginMoveStepsFrom={beginMoveStepsFrom}
                onMoveHere={moveSelectionHere}
                onPasteStepsBelow={pasteStepsBelow}
                onBeginGotoDestination={beginGotoDestination}
                onBeginBranchGotoDestination={beginBranchGotoDestination}
                onChooseGotoDestination={chooseGotoDestination}
                onDisconnectGoto={disconnectGoto}
                onDisconnectBranchGoto={disconnectBranchGoto}
                onDeleteBranchStep={removeBranchStep}
                onOpenTriggerPicker={openTriggerPicker}
              />
              <BuilderInspector
                selectedNode={selectedNode}
                triggers={draftTriggers}
                steps={draftSteps}
                stepPickerAfter={stepPickerAfter}
                branchStepPicker={branchStepPicker}
                triggerPickerOpen={triggerPickerOpen}
                formError={formError}
                onTrigger={updateTriggerAt}
                onChooseTrigger={appendTrigger}
                onChooseStep={insertStep}
                onChooseBranchStep={insertBranchStep}
                onStep={updateStepAt}
                onBranchStep={updateBranchStepAt}
                onRemoveStep={removeStep}
                onRemoveBranchStep={removeBranchStep}
                onMoveStep={moveStep}
                onMoveBranchStep={moveBranchStep}
              />
            </div>
          ) : activeTab === "settings" ? (
            <><WorkflowSettingsPanel
              name={draftName}
              description={draftDescription}
              formError={formError}
              onName={setDraftName}
              onDescription={setDraftDescription}
            />{selected&&<div className="border-t border-edge px-6 py-4"><p className="mb-3 text-sm text-neutral-500">{__("Deleting removes this workflow, its webhook endpoints, captured samples, schedules, versions, and run history.")}</p><Button variant="danger" disabled={busy!==null} onClick={async()=>{if(!window.confirm(__('Delete this workflow and all its stored automation records? This cannot be undone.')))return;setBusy('delete');try{await deleteWorkflow({definitionId:selected._id});navigate('/app/workflows')}catch(error){setFormError((error as Error).message)}finally{setBusy(null)}}}>{__("Delete workflow")}</Button></div>}</>
          ) : activeTab === "enrollment" ? (
            <RunHistory workflow={selected} runs={runs} title={__("Enrollment History")} />
          ) : (
            <VersionHistory
              workflow={selected}
              versions={versions}
              currentVersionId={selected?.currentVersionId}
              title={__("Execution Logs")}
            />
          )}
        </main>
      )}
    </div>
      {copilotOpen && (
        <>
          <div className="fixed inset-0 z-[999] bg-black/40 xl:hidden" aria-hidden="true" onClick={() => setCopilotOpen(false)} />
          <div className="fixed inset-y-0 right-0 z-[1000] w-full max-w-[420px] xl:sticky xl:top-0 xl:z-auto xl:h-[calc(100vh-48px)] xl:w-[380px] xl:max-w-none xl:shrink-0">
            <CopilotPanel ctx={copilotContext} onClose={() => setCopilotOpen(false)} />
          </div>
        </>
      )}
    </div></FieldSourcesProvider></WorkflowDraftContext.Provider>
  );
}

function BuilderTopBar({
  creating,
  workflow,
  dirty,
  busy,
  name,
  canRun,
  statusDisabledReason,
  activeTab,
  onTab,
  onRun,
  copilotOpen,
  onCopilot,
  onSave,
  onBack,
  onEditSettings,
  onStatus,
}: {
  creating: boolean;
  workflow: Workflow | undefined;
  dirty: boolean;
  busy: string | null;
  name: string;
  canRun: boolean;
  statusDisabledReason: string;
  activeTab: BuilderTab;
  onTab: (tab: BuilderTab) => void;
  onRun: () => void;
  copilotOpen: boolean;
  onCopilot: () => void;
  onSave: () => void;
  onBack: () => void;
  onEditSettings: () => void;
  onStatus: (status: WorkflowStatus) => void;
}) {
  const versionNumber = workflow?.currentVersion?.number ?? 0;
  const canChangeStatus = Boolean(workflow) && !statusDisabledReason && busy === null;
  const workflowTitle = name.trim() || workflow?.name || __("Untitled workflow");
  const published = workflow?.status === "active";
  return (
    <div className="border-b border-edge bg-ink">
      <div className="grid min-h-16 grid-cols-[minmax(220px,1fr)_minmax(0,auto)_minmax(220px,1fr)] items-center gap-3 px-4 py-3 max-lg:grid-cols-1">
        <div className="flex min-w-0 items-center gap-2 max-lg:justify-center">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium text-white transition-colors hover:bg-raised"
          >
            <span className="text-2xl leading-none">‹</span>
            {__("Back to Workflows")}
          </button>
        </div>

        <div className="flex min-w-0 items-center justify-center gap-2">
          <h1 className="truncate text-lg font-semibold text-white">
            {workflowTitle}
          </h1>
          <button
            type="button"
            onClick={onEditSettings}
            className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-raised hover:text-white"
            aria-label={__("Edit workflow settings")}
            title={__("Edit workflow settings")}
          >
            ✎
          </button>
        </div>

        <div className="flex items-center justify-end gap-1 max-lg:justify-center">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex h-9 w-9 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-raised hover:text-white"
            aria-label={__("Refresh workflow builder")}
            title={__("Refresh workflow builder")}
          >
            ↻
          </button>
          <button
            type="button"
            onClick={onCopilot}
            aria-pressed={copilotOpen}
            aria-controls="copilot-title"
            className={`flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors ${
              copilotOpen ? "border-accent text-accent" : "border-edge text-white hover:bg-raised"
            }`}
          >
            <span aria-hidden="true">✦</span>
            {__("AI assistant")}
          </button>
          <div className="relative">
            <Button variant="primary" onClick={onSave} disabled={busy !== null}>
              {__("Save")}
            </Button>
            {dirty ? (
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500" />
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-edge px-4 max-lg:grid-cols-1 max-lg:py-2">
        <div className="flex min-w-0 items-center justify-center gap-6 overflow-x-auto max-md:gap-4 max-md:justify-start">
          <TabButton active={activeTab === "builder"} onClick={() => onTab("builder")}>
            {__("Builder")}
          </TabButton>
          <TabButton active={activeTab === "settings"} onClick={() => onTab("settings")}>
            {__("Settings")}
          </TabButton>
          <TabButton
            active={activeTab === "enrollment"}
            onClick={() => onTab("enrollment")}
          >
            {__("Enrollment History")}
          </TabButton>
          <TabButton active={activeTab === "logs"} onClick={() => onTab("logs")}>
            {__("Execution Logs")}
          </TabButton>
        </div>

        <div className="flex items-center justify-end gap-2 max-lg:justify-center">
          <Button variant="secondary" onClick={onRun} disabled={!canRun || busy !== null}>
            {__("Test Workflow")}
          </Button>
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className={published ? "text-neutral-500" : "text-white"}>{__("Draft")}</span>
            <button
              type="button"
              role="switch"
              aria-checked={published}
              onClick={() => {
                if (creating || !workflow || !canChangeStatus) return;
                onStatus(published ? "paused" : "active");
              }}
              className={`relative h-6 w-11 shrink-0 overflow-hidden rounded-full border transition-colors ${
                published
                  ? "border-accent bg-accent"
                  : "border-edge-strong bg-raised"
              } ${
                creating || !workflow || !canChangeStatus
                  ? "cursor-not-allowed opacity-80"
                  : "hover:border-accent"
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                  published ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
            <span className={published ? "text-white" : "text-neutral-500"}>
              {__("Publish")}
            </span>
          </div>
          <span className="text-xs text-neutral-500">
            {workflow ? `v${versionNumber}` : __("draft")}
          </span>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative h-12 whitespace-nowrap px-1 text-sm font-medium transition-colors ${
        active ? "text-accent" : "text-neutral-400 hover:text-white"
      }`}
    >
      {children}
      {active ? (
        <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent" />
      ) : null}
    </button>
  );
}

function WorkflowCanvas({
  triggers,
  steps,
  selectedNode,
  openNodeMenu,
  stepPickerAfter,
  branchStepPicker,
  triggerPickerOpen,
  workflowClipboard,
  workflowMove,
  gotoPickerFor,
  onSelectNode,
  onOpenNodeMenu,
  onOpenPicker,
  onOpenBranchPicker,
  onDeleteTrigger,
  onDeleteStep,
  onCopyStep,
  onCopyStepsFrom,
  onBeginMoveStep,
  onBeginMoveStepsFrom,
  onMoveHere,
  onPasteStepsBelow,
  onBeginGotoDestination,
  onBeginBranchGotoDestination,
  onChooseGotoDestination,
  onDisconnectGoto,
  onDisconnectBranchGoto,
  onDeleteBranchStep,
  onOpenTriggerPicker,
}: {
  triggers: DraftTriggerList;
  steps: Array<DraftStep>;
  selectedNode: SelectedNode;
  openNodeMenu: SelectedNode;
  stepPickerAfter: number | null;
  branchStepPicker: BranchInsertTarget;
  triggerPickerOpen: boolean;
  workflowClipboard: WorkflowClipboard;
  workflowMove: WorkflowMove;
  gotoPickerFor: GotoPickerSource;
  onSelectNode: (node: SelectedNode) => void;
  onOpenNodeMenu: (node: SelectedNode) => void;
  onOpenPicker: (index: number | null) => void;
  onOpenBranchPicker: (target: BranchInsertTarget) => void;
  onDeleteTrigger: (index: number) => void;
  onDeleteStep: (index: number) => void;
  onCopyStep: (index: number) => void;
  onCopyStepsFrom: (index: number) => void;
  onBeginMoveStep: (index: number) => void;
  onBeginMoveStepsFrom: (index: number) => void;
  onMoveHere: (afterIndex: number) => void;
  onPasteStepsBelow: (index: number) => void;
  onBeginGotoDestination: (index: number) => void;
  onBeginBranchGotoDestination: (
    stepIndex: number,
    branch: BranchPath,
    actionIndex: number,
  ) => void;
  onChooseGotoDestination: (
    source: NonNullable<GotoPickerSource>,
    targetIndex: number,
  ) => void;
  onDisconnectGoto: (index: number) => void;
  onDisconnectBranchGoto: (
    stepIndex: number,
    branch: BranchPath,
    actionIndex: number,
  ) => void;
  onDeleteBranchStep: (
    stepIndex: number,
    branch: BranchPath,
    actionIndex: number,
  ) => void;
  onOpenTriggerPicker: (open: boolean) => void;
}) {
  const [hoveredGotoSource, setHoveredGotoSource] =
    useState<SelectedNode>({ type: "none" });
  const nodes = useMemo(
    () =>
      buildCanvasNodes({
        triggers,
        steps,
        selectedNode,
        openNodeMenu,
        stepPickerAfter,
        branchStepPicker,
        triggerPickerOpen,
        workflowClipboard,
        workflowMove,
        gotoPickerFor,
        hoveredGotoSource,
        onSelectNode,
        onOpenNodeMenu,
        onOpenPicker,
        onOpenBranchPicker,
        onDeleteTrigger,
        onDeleteStep,
        onCopyStep,
        onCopyStepsFrom,
        onBeginMoveStep,
        onBeginMoveStepsFrom,
        onMoveHere,
        onPasteStepsBelow,
        onBeginGotoDestination,
        onBeginBranchGotoDestination,
        onChooseGotoDestination,
        onDisconnectGoto,
        onDisconnectBranchGoto,
        onDeleteBranchStep,
        onOpenTriggerPicker,
      }),
    [
      onCopyStep,
      onCopyStepsFrom,
      onBeginMoveStep,
      onBeginMoveStepsFrom,
      onDeleteStep,
      onDeleteTrigger,
      onMoveHere,
      onOpenNodeMenu,
      onOpenPicker,
      onOpenTriggerPicker,
      onPasteStepsBelow,
      onSelectNode,
      openNodeMenu,
      selectedNode,
      hoveredGotoSource,
      branchStepPicker,
      stepPickerAfter,
      steps,
      triggers,
      triggerPickerOpen,
      workflowClipboard,
      workflowMove,
      gotoPickerFor,
      onBeginGotoDestination,
      onBeginBranchGotoDestination,
      onChooseGotoDestination,
      onDisconnectGoto,
      onDisconnectBranchGoto,
      onDeleteBranchStep,
    ],
  );
  const edges = useMemo(
    () => buildCanvasEdges(triggers, steps, selectedNode, openNodeMenu, hoveredGotoSource),
    [hoveredGotoSource, openNodeMenu, selectedNode, steps, triggers],
  );

  return (
    <section className="relative h-full min-h-[560px] overflow-hidden">
      <ReactFlowProvider>
        <ReactFlow
          key={`workflow-flow-${triggers.length}-${steps.length}`}
          nodes={nodes}
          edges={edges}
          nodeTypes={WORKFLOW_NODE_TYPES}
          proOptions={{ hideAttribution: true }}
          defaultViewport={{
            x: 230,
            y: 96,
            zoom: triggers.length > 1 ? 0.72 : 0.78,
          }}
          minZoom={0.34}
          maxZoom={1.05}
          fitView
          fitViewOptions={{
            padding: 0.12,
            minZoom: 0.36,
            maxZoom: triggers.length > 1 ? 0.78 : 0.82,
          }}
          panOnDrag
          panOnScroll
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          selectNodesOnDrag={false}
          multiSelectionKeyCode={null}
          onEdgeMouseEnter={(_, edge) => {
            const source = edge.data?.gotoSource;
            if (isGotoSourceData(source)) {
              setHoveredGotoSource(source);
            }
          }}
          onEdgeMouseLeave={() => setHoveredGotoSource({ type: "none" })}
          onNodeClick={(event, node) => {
            event.stopPropagation();
            if (node.type === "workflow-node") {
              (node.data as WorkflowNodeData).onClick();
            }
            if (node.type === "connector-node") {
              (node.data as ConnectorNodeData).onOpen();
            }
          }}
          onPaneClick={() => {
            onSelectNode({ type: "none" });
            onOpenNodeMenu({ type: "none" });
            onOpenPicker(null);
            onOpenBranchPicker(null);
            onOpenTriggerPicker(false);
          }}
          className="workflow-react-flow bg-[radial-gradient(color-mix(in_srgb,var(--color-edge)_70%,transparent)_1px,transparent_1px)] [background-size:20px_20px]"
        >
          <Background color="var(--color-edge)" size={2} gap={20} />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
      </ReactFlowProvider>
    </section>
  );
}

function WorkflowFlowNode({ data }: NodeProps<Node<WorkflowNodeData>>) {
  const isAddTrigger = data.variant === "add-trigger";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        data.onClick();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        data.onClick();
      }}
      className={`nodrag nopan relative grid h-[88px] w-[360px] cursor-pointer items-center gap-3 rounded-lg border px-3 py-0 text-left shadow-sm transition-colors ${
        isAddTrigger
          ? "grid-cols-[44px_minmax(0,1fr)] border-dashed border-accent bg-accent/10"
          : "grid-cols-[40px_minmax(0,1fr)_28px] bg-panel"
      } ${
        data.gotoConnectionActive && !isAddTrigger
          ? "border-pink-400 shadow-[0_0_0_4px_color-mix(in_srgb,#f472b6_18%,transparent)]"
          : (data.gotoCandidate || data.gotoSource) && !isAddTrigger
            ? "border-emerald-400 bg-emerald-500/10 shadow-[0_0_0_4px_color-mix(in_srgb,#34d399_16%,transparent)] hover:border-emerald-300"
            : data.active && !isAddTrigger
              ? "border-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_16%,transparent)]"
              : isAddTrigger
                ? "hover:bg-accent/15"
                : "border-edge hover:border-edge-strong"
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="workflow-handle"
      />
      <span
        className={`flex h-10 w-10 self-center items-center justify-center rounded-md border text-sm font-semibold ${
          isAddTrigger
            ? "border-accent/20 bg-accent/15 text-accent"
            : data.tone === "trigger"
              ? "border-sky-500/30 bg-sky-500/10 text-sky-200"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
        }`}
      >
        {isAddTrigger ? (
          "+"
        ) : data.icon ? (
          <TriggerPresetIcon icon={data.icon} />
        ) : data.tone === "trigger" ? (
          "T"
        ) : (
          "A"
        )}
      </span>
      <span className="flex min-w-0 flex-col justify-center">
        {isAddTrigger ? null : (
          <span
            className={`block text-[11px] font-medium ${
              data.tone === "trigger"
                ? "text-accent"
                : "uppercase text-neutral-500"
            }`}
          >
            {data.eyebrow}
          </span>
        )}
        <span
          className={`mt-0.5 block truncate text-sm font-medium ${
            isAddTrigger ? "text-accent" : "text-white"
          }`}
        >
          {data.title}
        </span>
        {data.subtitle ? (
          <span className="mt-0.5 block truncate text-xs text-neutral-500">
            {data.subtitle}
          </span>
        ) : null}
      </span>
      {data.canDelete ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            data.onMenuToggle();
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-raised hover:text-white"
          aria-label={__("{0} options", [data.title])}
        >
          ...
        </button>
      ) : isAddTrigger ? null : (
        <span aria-hidden="true" />
      )}
      {data.menuOpen ? (
        <WorkflowNodeMenu data={data} />
      ) : null}
      {data.gotoTargetLabel ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            data.onDisconnectGoto();
          }}
          className={`absolute left-1/2 top-[calc(100%+8px)] z-40 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-md border shadow-xl transition-colors ${
            data.gotoConnectionHighlighted
              ? "border-pink-400/40 bg-pink-500/15 text-pink-200 hover:bg-pink-500 hover:text-white"
              : "border-edge bg-panel text-neutral-400 hover:border-pink-400/50 hover:bg-pink-500/15 hover:text-pink-200"
          }`}
          aria-label={__("Disconnect Go To")}
          title={__("Disconnect Go To")}
        >
          <DisconnectIcon />
        </button>
      ) : null}
      <Handle
        type="source"
        position={Position.Bottom}
        className="workflow-handle"
      />
    </div>
  );
}

function DisconnectIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="m14 7 3-3a4 4 0 0 1 6 6l-3 3" />
      <path d="m10 17-3 3a4 4 0 0 1-6-6l3-3" />
      <path d="m8 8 8 8" />
      <path d="m7 2 2 5" />
      <path d="m15 17 2 5" />
    </svg>
  );
}

function WorkflowNodeMenu({ data }: { data: WorkflowNodeData }) {
  const isAction = data.tone === "action";
  return (
    <div
      className="absolute right-3 top-12 z-[10000] w-44 rounded-md border border-edge bg-panel py-1 text-sm text-neutral-300 shadow-2xl"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex h-9 items-center justify-between border-b border-edge px-3 text-xs font-medium text-neutral-400">
        <span>{__("Actions")}</span>
        <button
          type="button"
          onClick={data.onCloseMenu}
          className="flex h-6 w-6 items-center justify-center rounded text-lg leading-none text-neutral-500 transition-colors hover:bg-raised hover:text-white"
          aria-label={__("Close actions menu")}
        >
          ×
        </button>
      </div>

      {isAction ? (
        <MenuFlyout label={__("Notes")}>
          <MenuItem disabled>{__("No notes yet")}</MenuItem>
        </MenuFlyout>
      ) : null}

      {isAction ? (
        <MenuFlyout label={__("Copy")}>
          <MenuItem onSelect={data.onCopy}>{__("Copy Action")}</MenuItem>
          <MenuItem onSelect={data.onCopyFromHere}>
            {__("Copy All Actions From Here")}
          </MenuItem>
        </MenuFlyout>
      ) : null}

      {isAction ? (
        <MenuItem
          onSelect={data.onPasteBelow}
          disabled={!data.canPasteBelow}
        >
          {__("Paste Below")}
        </MenuItem>
      ) : null}

      {isAction ? (
        <MenuFlyout label={__("Move")}>
          <MenuItem onSelect={data.onMove} disabled={!data.canMove}>
            {__("Move Action")}
          </MenuItem>
          <MenuItem onSelect={data.onMoveFromHere} disabled={!data.canMove}>
            {__("Move All Actions From Here")}
          </MenuItem>
        </MenuFlyout>
      ) : null}

      {data.canSetGoto ? (
        <MenuFlyout label={__("Go To")}>
          <MenuItem onSelect={data.onSetGotoDestination}>
            {__("Set Go To Destination")}
          </MenuItem>
          <MenuItem
            onSelect={data.onDisconnectGoto}
            disabled={!data.gotoTargetLabel}
            tone="danger"
          >
            {__("Disconnect Goto")}
          </MenuItem>
        </MenuFlyout>
      ) : null}

      <MenuFlyout label={__("Delete")}>
        <MenuItem onSelect={data.onDelete} tone="danger">
          {isAction ? __("Delete Action") : __("Delete Trigger")}
        </MenuItem>
      </MenuFlyout>
    </div>
  );
}

function MenuFlyout({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`flex h-9 w-full cursor-pointer items-center justify-between px-3 text-left transition-colors hover:bg-raised ${label === __("Delete") ? "text-red-400 hover:text-red-500" : "text-neutral-300 hover:text-white"}`}
      >
        <span>{label}</span>
        <span className="text-lg leading-none text-neutral-500">›</span>
      </button>
      <div
        className={`absolute -top-1 left-[calc(100%-1px)] min-w-52 rounded-md border border-edge bg-panel py-1 shadow-2xl transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 ${
          open ? "visible opacity-100" : "invisible opacity-0"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function MenuItem({
  children,
  disabled = false,
  tone = "normal",
  onSelect,
}: {
  children: ReactNode;
  disabled?: boolean;
  tone?: "normal" | "danger";
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`flex h-9 w-full items-center px-3 text-left transition-colors disabled:cursor-not-allowed disabled:text-neutral-600 ${
        tone === "danger"
          ? "text-red-400 hover:bg-red-500/10 hover:text-red-500 cursor-pointer"
          : "text-neutral-300 hover:bg-raised hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function ConnectorFlowNode({ data }: NodeProps<Node<ConnectorNodeData>>) {
  return (
    <div className="nodrag nopan relative flex w-[280px] justify-center">
      <Handle
        type="target"
        position={Position.Top}
        className="workflow-handle"
      />
      <div className="z-10 flex items-center gap-1">
        {data.moveActive ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              data.onMoveHere();
            }}
            className="h-7 rounded border border-edge-strong bg-panel px-2 text-xs font-medium text-neutral-200 shadow-sm transition-colors hover:border-accent hover:text-white"
            aria-label={__("Move here after {0}", [data.afterIndex + 1])}
          >
            {__("Move Here")}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                data.onOpen();
              }}
              className={`flex h-7 w-7 items-center justify-center rounded-full border bg-ink text-lg leading-none shadow-sm transition-colors hover:border-accent hover:text-white ${
                data.open
                  ? "border-accent text-white shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_16%,transparent)]"
                  : "border-edge-strong text-neutral-300"
              }`}
              aria-label={__("Add step after {0}", [data.afterIndex + 1])}
            >
              +
            </button>
            {data.pasteActive ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  data.onPasteHere();
                }}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-edge-strong bg-panel text-neutral-300 shadow-sm transition-colors hover:border-accent hover:text-white"
                aria-label={__("Paste after {0}", [data.afterIndex + 1])}
                title={__("Paste here")}
              >
                <TriggerPresetIcon icon="clipboard" />
              </button>
            ) : null}
          </>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="workflow-handle"
      />
    </div>
  );
}

function BranchFlowNode({ data }: NodeProps<Node<BranchNodeData>>) {
  return (
    <div className="nodrag nopan relative grid h-[74px] w-[280px] grid-cols-[26px_minmax(0,1fr)] items-center gap-2 rounded-md border border-edge bg-panel px-3 text-left shadow-sm">
      <Handle
        type="target"
        position={Position.Top}
        className="workflow-handle"
      />
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-500/10 text-violet-300">
        <TriggerPresetIcon icon={data.tone === "none" ? "noop" : "branch"} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="block text-[10px] font-semibold text-violet-300">
          {data.label}
        </span>
        <span className="mt-1 block truncate text-[11px] text-neutral-300">
          {data.description}
        </span>
      </span>
      <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-b-md bg-violet-500" />
      <Handle
        type="source"
        position={Position.Bottom}
        className="workflow-handle"
      />
    </div>
  );
}

const WORKFLOW_NODE_TYPES = {
  "workflow-node": WorkflowFlowNode,
  "connector-node": ConnectorFlowNode,
  "branch-node": BranchFlowNode,
};

function isSameSelectedNode(left: SelectedNode, right: SelectedNode) {
  if (left.type !== right.type) return false;
  if (left.type === "none" || right.type === "none") return true;
  if (left.type === "trigger" && right.type === "trigger") {
    return left.index === right.index;
  }
  if (left.type === "step" && right.type === "step") {
    return left.index === right.index;
  }
  if (left.type === "branchStep" && right.type === "branchStep") {
    return (
      left.stepIndex === right.stepIndex &&
      left.actionIndex === right.actionIndex &&
      isSameBranchPath(left.branch, right.branch)
    );
  }
  return false;
}

function isSameBranchPath(left: BranchPath, right: BranchPath) {
  if (left.type !== right.type) return false;
  if (left.type === "else" || right.type === "else") return true;
  return left.index === right.index;
}

function isSameBranchInsertTarget(
  left: BranchInsertTarget,
  right: NonNullable<BranchInsertTarget>,
) {
  return (
    left !== null &&
    left.stepIndex === right.stepIndex &&
    left.afterIndex === right.afterIndex &&
    isSameBranchPath(left.branch, right.branch)
  );
}

function isGotoDestinationCandidate(
  source: GotoPickerSource,
  targetIndex: number,
) {
  if (!source) return false;
  return source.type !== "step" || source.index !== targetIndex;
}

function isGotoPickerSource(
  source: GotoPickerSource,
  node: SelectedNode,
) {
  if (!source) return false;
  return isSameSelectedNode(gotoSourceToSelectedNode(source), node);
}

function isGotoSourceData(value: unknown): value is SelectedNode {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<SelectedNode>;
  if (source.type === "step") {
    return typeof source.index === "number";
  }
  if (source.type === "branchStep") {
    return (
      typeof source.stepIndex === "number" &&
      typeof source.actionIndex === "number" &&
      Boolean(source.branch) &&
      typeof source.branch === "object" &&
      ((source.branch as Partial<BranchPath>).type === "else" ||
        ((source.branch as Partial<BranchPath>).type === "branch" &&
          typeof (source.branch as Partial<{ index: number }>).index ===
            "number"))
    );
  }
  return false;
}

function gotoSourceToSelectedNode(
  source: NonNullable<GotoPickerSource>,
): SelectedNode {
  if (source.type === "step") {
    return { type: "step", index: source.index };
  }
  return {
    type: "branchStep",
    stepIndex: source.stepIndex,
    branch: source.branch,
    actionIndex: source.actionIndex,
  };
}

function buildCanvasNodes({
  triggers,
  steps,
  selectedNode,
  openNodeMenu,
  stepPickerAfter,
  branchStepPicker,
  triggerPickerOpen,
  workflowClipboard,
  workflowMove,
  gotoPickerFor,
  hoveredGotoSource,
  onSelectNode,
  onOpenNodeMenu,
  onOpenBranchPicker,
  onOpenPicker,
  onDeleteTrigger,
  onDeleteStep,
  onCopyStep,
  onCopyStepsFrom,
  onBeginMoveStep,
  onBeginMoveStepsFrom,
  onMoveHere,
  onPasteStepsBelow,
  onBeginGotoDestination,
  onBeginBranchGotoDestination,
  onChooseGotoDestination,
  onDisconnectGoto,
  onDisconnectBranchGoto,
  onDeleteBranchStep,
  onOpenTriggerPicker,
}: {
  triggers: DraftTriggerList;
  steps: Array<DraftStep>;
  selectedNode: SelectedNode;
  openNodeMenu: SelectedNode;
  stepPickerAfter: number | null;
  branchStepPicker: BranchInsertTarget;
  triggerPickerOpen: boolean;
  workflowClipboard: WorkflowClipboard;
  workflowMove: WorkflowMove;
  gotoPickerFor: GotoPickerSource;
  hoveredGotoSource: SelectedNode;
  onSelectNode: (node: SelectedNode) => void;
  onOpenNodeMenu: (node: SelectedNode) => void;
  onOpenBranchPicker: (target: BranchInsertTarget) => void;
  onOpenPicker: (index: number | null) => void;
  onDeleteTrigger: (index: number) => void;
  onDeleteStep: (index: number) => void;
  onCopyStep: (index: number) => void;
  onCopyStepsFrom: (index: number) => void;
  onBeginMoveStep: (index: number) => void;
  onBeginMoveStepsFrom: (index: number) => void;
  onMoveHere: (afterIndex: number) => void;
  onPasteStepsBelow: (index: number) => void;
  onBeginGotoDestination: (index: number) => void;
  onBeginBranchGotoDestination: (
    stepIndex: number,
    branch: BranchPath,
    actionIndex: number,
  ) => void;
  onChooseGotoDestination: (
    source: NonNullable<GotoPickerSource>,
    targetIndex: number,
  ) => void;
  onDisconnectGoto: (index: number) => void;
  onDisconnectBranchGoto: (
    stepIndex: number,
    branch: BranchPath,
    actionIndex: number,
  ) => void;
  onDeleteBranchStep: (
    stepIndex: number,
    branch: BranchPath,
    actionIndex: number,
  ) => void;
  onOpenTriggerPicker: (open: boolean) => void;
}) {
  const cardWidth = 360;
  const cardHeight = 88;
  const stepGap = 104;
  const connectorHeight = 28;
  const cardCenterX = 0;
  const cardX = cardCenterX - cardWidth / 2;
  const connectorX = cardCenterX - 140;
  const triggerCount = Math.max(1, triggers.length + 1);
  const triggerSpacing = 410;
  const firstTriggerCenterX = -((triggerCount - 1) * triggerSpacing) / 2;
  const triggerCenterX = (index: number) =>
    firstTriggerCenterX + index * triggerSpacing;
  const nodes: Array<WorkflowCanvasNode> = [];

  triggers.forEach((trigger, index) => {
    const triggerNode: SelectedNode = { type: "trigger", index };
    nodes.push({
      id: `trigger-${index}`,
      type: "workflow-node",
      position: { x: triggerCenterX(index) - cardWidth / 2, y: 0 },
      draggable: false,
      zIndex: isSameSelectedNode(openNodeMenu, triggerNode) ? 1000 : 20,
      data: {
        active:
          selectedNode.type === "trigger" && selectedNode.index === index,
        canDelete: true,
        canMove: false,
        canPasteBelow: false,
        canSetGoto: false,
        eyebrow: index === 0 ? __("Trigger") : __("Trigger {0}", [index + 1]),
        gotoCandidate: false,
        gotoConnectionActive: false,
        gotoConnectionHighlighted: false,
        gotoSource: false,
        gotoTargetLabel: "",
        menuOpen: isSameSelectedNode(openNodeMenu, triggerNode),
        title: triggerTitle(trigger),
        subtitle: triggerLabel(trigger),
        tone: "trigger",
        variant: "normal",
        icon: triggerIcon(trigger),
        onClick: () => {
          onOpenNodeMenu({ type: "none" });
          onSelectNode(triggerNode);
        },
        onCloseMenu: () => onOpenNodeMenu({ type: "none" }),
        onCopy: () => undefined,
        onCopyFromHere: () => undefined,
        onDelete: () => onDeleteTrigger(index),
        onMenuToggle: () =>
          onOpenNodeMenu(
            isSameSelectedNode(openNodeMenu, triggerNode)
              ? { type: "none" }
              : triggerNode,
          ),
        onMove: () => undefined,
        onMoveFromHere: () => undefined,
        onPasteBelow: () => undefined,
        onSetGotoDestination: () => undefined,
        onDisconnectGoto: () => undefined,
      },
    });
  });

  nodes.push({
    id: "add-trigger",
    type: "workflow-node",
    position: {
      x: triggerCenterX(triggers.length) - cardWidth / 2,
      y: 0,
    },
    draggable: false,
    data: {
      active: triggerPickerOpen,
      canDelete: false,
      canMove: false,
      canPasteBelow: false,
      canSetGoto: false,
      eyebrow: __("Trigger"),
      gotoCandidate: false,
      gotoConnectionActive: false,
      gotoConnectionHighlighted: false,
      gotoSource: false,
      gotoTargetLabel: "",
      menuOpen: false,
      title: __("Add New Trigger"),
      subtitle: triggers.length
        ? __("Start this workflow another way")
        : __("Choose how this workflow starts"),
      tone: "trigger",
      variant: "add-trigger",
      onClick: () => {
        onOpenTriggerPicker(!triggerPickerOpen);
      },
      onCloseMenu: () => undefined,
      onCopy: () => undefined,
      onCopyFromHere: () => undefined,
      onDelete: () => undefined,
      onMenuToggle: () => undefined,
      onMove: () => undefined,
      onMoveFromHere: () => undefined,
      onPasteBelow: () => undefined,
      onSetGotoDestination: () => undefined,
      onDisconnectGoto: () => undefined,
    },
  });

  nodes.push({
    id: "connector--1",
    type: "connector-node",
    position: {
      x: connectorX,
      y: cardHeight + (286 - cardHeight) / 2 - connectorHeight / 2,
    },
    draggable: false,
    data: {
      afterIndex: -1,
      moveActive: workflowMove !== null,
      open: stepPickerAfter === -1,
      onMoveHere: () => onMoveHere(-1),
      onOpen: () => onOpenPicker(stepPickerAfter === -1 ? null : -1),
      onPasteHere: () => onPasteStepsBelow(-1),
      pasteActive: Boolean(workflowClipboard?.steps.length),
    },
  });
  let nodeY = 286;
  steps.forEach((step, index) => {
    const stepNode: SelectedNode = { type: "step", index };
    const gotoHighlighted =
      isSameSelectedNode(selectedNode, stepNode) ||
      isSameSelectedNode(openNodeMenu, stepNode) ||
      isSameSelectedNode(hoveredGotoSource, stepNode);
    nodes.push({
      id: `step-${index}`,
      type: "workflow-node",
      position: { x: cardX, y: nodeY },
      draggable: false,
      zIndex: isSameSelectedNode(openNodeMenu, stepNode) ? 1000 : 20,
      data: {
        active: selectedNode.type === "step" && selectedNode.index === index,
        canDelete: true,
        canMove: true,
        canPasteBelow: Boolean(workflowClipboard?.steps.length),
        canSetGoto: step.kind === "go_to",
        eyebrow: __("Action {0}", [index + 1]),
        gotoCandidate:
          isGotoDestinationCandidate(gotoPickerFor, index),
        gotoConnectionActive:
          step.kind === "go_to" &&
          step.targetStepIndex !== undefined &&
          isSameSelectedNode(selectedNode, stepNode),
        gotoConnectionHighlighted:
          step.kind === "go_to" &&
          step.targetStepIndex !== undefined &&
          gotoHighlighted,
        gotoSource: isGotoPickerSource(gotoPickerFor, stepNode),
        gotoTargetLabel:
          step.kind === "go_to" && step.targetStepIndex !== undefined
            ? __("Action {0}", [step.targetStepIndex + 1])
            : "",
        menuOpen: isSameSelectedNode(openNodeMenu, stepNode),
        title: stepTitle(step),
        subtitle: stepSubtitle(step),
        tone: "action",
        icon: actionIcon(step.kind),
        onClick: () => {
          if (gotoPickerFor && isGotoDestinationCandidate(gotoPickerFor, index)) {
            onChooseGotoDestination(gotoPickerFor, index);
            return;
          }
          onOpenNodeMenu({ type: "none" });
          onSelectNode(stepNode);
        },
        onCloseMenu: () => onOpenNodeMenu({ type: "none" }),
        onCopy: () => onCopyStep(index),
        onCopyFromHere: () => onCopyStepsFrom(index),
        onDelete: () => onDeleteStep(index),
        onMenuToggle: () =>
          onOpenNodeMenu(
            isSameSelectedNode(openNodeMenu, stepNode)
              ? { type: "none" }
              : stepNode,
          ),
        onMove: () => onBeginMoveStep(index),
        onMoveFromHere: () => onBeginMoveStepsFrom(index),
        onPasteBelow: () => onPasteStepsBelow(index),
        onSetGotoDestination: () => onBeginGotoDestination(index),
        onDisconnectGoto: () => onDisconnectGoto(index),
      },
    });

    const branchItems =
      step.kind === "if_else" ? ifElseBranchItems(step, index) : [];
    const branchWidth = 280;
    const branchGap = 140;
    const branchY = nodeY + cardHeight + 54;
    const branchRowWidth =
      branchItems.length * branchWidth + Math.max(0, branchItems.length - 1) * branchGap;
    const firstBranchX = cardCenterX - branchRowWidth / 2;
    branchItems.forEach((branch, branchIndex) => {
      const branchX = firstBranchX + branchIndex * (branchWidth + branchGap);
      const branchCenterX = branchX + branchWidth / 2;
      const branchConnectorX = branchCenterX - 140;
      nodes.push({
        id: branch.id,
        type: "branch-node",
        position: {
          x: branchX,
          y: branchY,
        },
        draggable: false,
        data: {
          description: branch.description,
          label: branch.label,
          tone: branch.tone,
        },
      });
      nodes.push({
        id: `${branch.id}-connector--1`,
        type: "connector-node",
        position: {
          x: branchConnectorX,
          y: branchY + 100,
        },
        draggable: false,
        data: {
          afterIndex: -1,
          moveActive: false,
          open: isSameBranchInsertTarget(branchStepPicker, {
            stepIndex: index,
            branch: branch.branch,
            afterIndex: -1,
          }),
          onMoveHere: () => undefined,
          onOpen: () =>
            onOpenBranchPicker(
              isSameBranchInsertTarget(branchStepPicker, {
                stepIndex: index,
                branch: branch.branch,
                afterIndex: -1,
              })
                ? null
                : { stepIndex: index, branch: branch.branch, afterIndex: -1 },
            ),
          onPasteHere: () => undefined,
          pasteActive: false,
        },
      });
      branch.steps.forEach((branchStep, branchStepIndex) => {
        const branchStepNode: SelectedNode = {
          type: "branchStep",
          stepIndex: index,
          branch: branch.branch,
          actionIndex: branchStepIndex,
        };
        const branchGotoHighlighted =
          isSameSelectedNode(selectedNode, branchStepNode) ||
          isSameSelectedNode(openNodeMenu, branchStepNode) ||
          isSameSelectedNode(hoveredGotoSource, branchStepNode);
        const branchStepY =
          branchY + 148 + branchStepIndex * (cardHeight + stepGap);
        nodes.push({
          id: `${branch.id}-step-${branchStepIndex}`,
          type: "workflow-node",
          position: { x: branchCenterX - cardWidth / 2, y: branchStepY },
          draggable: false,
          zIndex: isSameSelectedNode(openNodeMenu, branchStepNode) ? 1000 : 20,
          data: {
            active: isSameSelectedNode(selectedNode, branchStepNode),
            canDelete: true,
            canMove: false,
            canPasteBelow: false,
            canSetGoto: branchStep.kind === "go_to",
            eyebrow: __("Action {0}", [branchStepIndex + 1]),
            gotoCandidate: false,
            gotoConnectionActive:
              branchStep.kind === "go_to" &&
              branchStep.targetStepIndex !== undefined &&
              isSameSelectedNode(selectedNode, branchStepNode),
            gotoConnectionHighlighted:
              branchStep.kind === "go_to" &&
              branchStep.targetStepIndex !== undefined &&
              branchGotoHighlighted,
            gotoSource: isGotoPickerSource(gotoPickerFor, branchStepNode),
            gotoTargetLabel:
              branchStep.kind === "go_to" &&
              branchStep.targetStepIndex !== undefined
                ? __("Action {0}", [branchStep.targetStepIndex + 1])
                : "",
            menuOpen: isSameSelectedNode(openNodeMenu, branchStepNode),
            title: stepTitle(branchStep),
            subtitle: stepSubtitle(branchStep),
            tone: "action",
            icon: actionIcon(branchStep.kind),
            onClick: () => {
              onOpenNodeMenu({ type: "none" });
              onSelectNode(branchStepNode);
            },
            onCloseMenu: () => onOpenNodeMenu({ type: "none" }),
            onCopy: () => undefined,
            onCopyFromHere: () => undefined,
            onDelete: () =>
              onDeleteBranchStep(index, branch.branch, branchStepIndex),
            onMenuToggle: () =>
              onOpenNodeMenu(
                isSameSelectedNode(openNodeMenu, branchStepNode)
                  ? { type: "none" }
                  : branchStepNode,
              ),
            onMove: () => undefined,
            onMoveFromHere: () => undefined,
            onPasteBelow: () => undefined,
            onSetGotoDestination: () =>
              onBeginBranchGotoDestination(index, branch.branch, branchStepIndex),
            onDisconnectGoto: () =>
              onDisconnectBranchGoto(index, branch.branch, branchStepIndex),
          },
        });
        nodes.push({
          id: `${branch.id}-connector-${branchStepIndex}`,
          type: "connector-node",
          position: {
            x: branchConnectorX,
            y:
              branchStepY +
              cardHeight +
              stepGap / 2 -
              connectorHeight / 2,
          },
          draggable: false,
          data: {
            afterIndex: branchStepIndex,
            moveActive: false,
            open: isSameBranchInsertTarget(branchStepPicker, {
              stepIndex: index,
              branch: branch.branch,
              afterIndex: branchStepIndex,
            }),
            onMoveHere: () => undefined,
            onOpen: () =>
              onOpenBranchPicker(
                isSameBranchInsertTarget(branchStepPicker, {
                  stepIndex: index,
                  branch: branch.branch,
                  afterIndex: branchStepIndex,
                })
                  ? null
                  : {
                      stepIndex: index,
                      branch: branch.branch,
                      afterIndex: branchStepIndex,
                    },
              ),
            onPasteHere: () => undefined,
            pasteActive: false,
          },
        });
      });
    });

    const maxBranchSteps = branchItems.reduce(
      (count, branch) => Math.max(count, branch.steps.length),
      0,
    );
    const branchExtraHeight =
      branchItems.length > 0
        ? 170 + maxBranchSteps * (cardHeight + stepGap)
        : 0;
    if (step.kind !== "if_else") {
      nodes.push({
        id: `connector-${index}`,
        type: "connector-node",
        position: {
          x: connectorX,
          y:
            nodeY +
            cardHeight +
            branchExtraHeight +
            stepGap / 2 -
            connectorHeight / 2,
        },
        draggable: false,
        data: {
          afterIndex: index,
          moveActive: workflowMove !== null,
          open: stepPickerAfter === index,
          onMoveHere: () => onMoveHere(index),
          onOpen: () => onOpenPicker(stepPickerAfter === index ? null : index),
          onPasteHere: () => onPasteStepsBelow(index),
          pasteActive: Boolean(workflowClipboard?.steps.length),
        },
      });
    }
    nodeY += cardHeight + stepGap + branchExtraHeight;
  });

  return nodes;
}

function buildCanvasEdges(
  triggers: DraftTriggerList,
  steps: Array<DraftStep>,
  selectedNode: SelectedNode,
  openNodeMenu: SelectedNode,
  hoveredGotoSource: SelectedNode,
) {
  const edge = (
    id: string,
    source: string,
    target: string,
    options?: {
      accent?: boolean;
      active?: boolean;
      arrow?: boolean;
      branch?: boolean;
      dashed?: boolean;
      goto?: boolean;
      gotoSource?: SelectedNode;
    },
  ): Edge => {
    const strokeColor = options?.goto
      ? options.active
        ? "var(--color-accent)"
        : "var(--color-edge-strong)"
      : options?.branch
        ? "color-mix(in_srgb,#a78bfa_80%,white)"
      : options?.accent
        ? "color-mix(in_srgb,var(--color-accent)_85%,white)"
        : "var(--color-edge-strong)";
    return {
      id,
      source,
      target,
      type: "smoothstep",
      zIndex: options?.goto ? (options.active ? 1000 : 900) : undefined,
      className: options?.goto
        ? `workflow-goto-edge${options.active ? " workflow-goto-edge-active" : ""}`
        : undefined,
      data: options?.gotoSource ? { gotoSource: options.gotoSource } : undefined,
      interactionWidth: options?.goto ? 28 : undefined,
      markerEnd:
        options?.arrow === false
          ? undefined
          : {
              type: MarkerType.ArrowClosed,
              width: options?.goto ? 24 : 16,
              height: options?.goto ? 24 : 16,
              color: strokeColor,
            },
      style: {
        stroke: strokeColor,
        strokeWidth:
          options?.goto
            ? options.active
              ? 2.4
              : 2.6
            : options?.branch || options?.accent
              ? 1.75
              : 1.25,
        strokeDasharray: options?.dashed
          ? options?.goto
            ? "7 6"
            : "5 5"
          : undefined,
      },
    };
  };

  const edges: Array<Edge> = triggers.map((_, index) =>
    edge(`trigger-${index}-to-connector--1`, `trigger-${index}`, "connector--1", {
      arrow: false,
    }),
  );
  edges.push(
    edge("add-trigger-to-connector--1", "add-trigger", "connector--1", {
      arrow: false,
    }),
  );
  if (steps.length > 0) {
    edges.push(edge("connector--1-to-step-0", "connector--1", "step-0"));
  }
  steps.forEach((step, index) => {
    if (step.kind === "if_else") {
      ifElseBranchItems(step, index).forEach((branch) => {
        edges.push(
          edge(`step-${index}-to-${branch.id}`, `step-${index}`, branch.id, {
            branch: true,
          }),
        );
        edges.push(
          edge(`${branch.id}-to-plus`, branch.id, `${branch.id}-connector--1`, {
            branch: true,
          }),
        );
        branch.steps.forEach((_, branchStepIndex) => {
          const branchStep = branch.steps[branchStepIndex];
          const connectorId =
            branchStepIndex === 0
              ? `${branch.id}-connector--1`
              : `${branch.id}-connector-${branchStepIndex - 1}`;
          edges.push(
            edge(
              `${connectorId}-to-${branch.id}-step-${branchStepIndex}`,
              connectorId,
              `${branch.id}-step-${branchStepIndex}`,
            ),
          );
          edges.push(
            edge(
              `${branch.id}-step-${branchStepIndex}-to-connector`,
              `${branch.id}-step-${branchStepIndex}`,
              `${branch.id}-connector-${branchStepIndex}`,
            ),
          );
          if (
            branchStep?.kind === "go_to" &&
            branchStep.targetStepIndex !== undefined &&
            branchStep.targetStepIndex >= 0 &&
            branchStep.targetStepIndex < steps.length
          ) {
            const branchStepNode: SelectedNode = {
              type: "branchStep",
              stepIndex: index,
              branch: branch.branch,
              actionIndex: branchStepIndex,
            };
            edges.push(
              edge(
                `${branch.id}-go-to-${branchStepIndex}-to-${branchStep.targetStepIndex}`,
                `${branch.id}-step-${branchStepIndex}`,
                `step-${branchStep.targetStepIndex}`,
                {
                  active:
                    isSameSelectedNode(selectedNode, branchStepNode) ||
                    isSameSelectedNode(openNodeMenu, branchStepNode) ||
                    isSameSelectedNode(hoveredGotoSource, branchStepNode),
                  dashed: true,
                  goto: true,
                  gotoSource: branchStepNode,
                },
              ),
            );
          }
        });
        if (index < steps.length - 1) {
          const branchTailId =
            branch.steps.length > 0
              ? `${branch.id}-connector-${branch.steps.length - 1}`
              : `${branch.id}-connector--1`;
          edges.push(
            edge(
              `${branchTailId}-to-step-${index + 1}`,
              branchTailId,
              `step-${index + 1}`,
            ),
          );
        }
      });
    } else {
      edges.push(
        edge(
          `step-${index}-to-connector-${index}`,
          `step-${index}`,
          `connector-${index}`,
        ),
      );
    }
    if (step.kind !== "if_else" && index < steps.length - 1) {
      edges.push(
        edge(
          `connector-${index}-to-step-${index + 1}`,
          `connector-${index}`,
          `step-${index + 1}`,
        ),
      );
    }
    if (
      step.kind === "go_to" &&
      step.targetStepIndex !== undefined &&
      step.targetStepIndex !== index &&
      step.targetStepIndex >= 0 &&
      step.targetStepIndex < steps.length
    ) {
      const gotoActive =
        isSameSelectedNode(selectedNode, { type: "step", index }) ||
        isSameSelectedNode(openNodeMenu, { type: "step", index }) ||
        isSameSelectedNode(hoveredGotoSource, { type: "step", index });
      edges.push(
        edge(`go-to-${index}-to-${step.targetStepIndex}`, `step-${index}`, `step-${step.targetStepIndex}`, {
          active: gotoActive,
          dashed: true,
          goto: true,
          gotoSource: { type: "step", index },
        }),
      );
    }
  });
  return edges;
}

function ifElseBranchItems(step: IfElseStep, stepIndex: number) {
  return [
    ...step.branches.map((branch, index) => ({
      branch: { type: "branch" as const, index },
      id: `step-${stepIndex}-branch-${index}`,
      label: branch.name || __("Branch"),
      description: branchConditionLabel(branch),
      steps: (branch.steps ?? []) as Array<BranchActionStep>,
      tone: "branch" as const,
    })),
    {
      branch: { type: "else" as const },
      id: `step-${stepIndex}-branch-none`,
      label: step.elseLabel || __("None"),
      description: __("When none of the conditions are met"),
      steps: (step.elseSteps ?? []) as Array<BranchActionStep>,
      tone: "none" as const,
    },
  ];
}

function branchConditionLabel(branch: IfElseStep["branches"][number]) {
  if (branch.conditions?.length) return branch.match === "any" ? __("Any of {0} conditions match", [branch.conditions.length + 1]) : __("All of {0} conditions match", [branch.conditions.length + 1]);
  const field =
    IF_ELSE_FIELD_OPTIONS.find((option) => option.value === branch.field)?.label ??
    branch.field;
  const operator =
    IF_ELSE_OPERATOR_OPTIONS.find((option) => option.value === branch.operator)
      ?.label ?? branch.operator;
  if (branch.operator === "is_empty" || branch.operator === "is_not_empty") {
    return __("If {0} {1}", [field, operator.toLowerCase()]);
  }
  return __('If {0} {1} "{2}"', [field, operator.toLowerCase(), branch.value || __("value")]);
}

function SidebarActionCatalog({
  excludeKinds = [],
  onSelect,
}: {
  excludeKinds?: Array<StepKind>;
  onSelect: (kind: ActionKind) => void;
}) {
  const actionOptions: Array<ActionCatalogOption> = ACTION_LIBRARY.filter(
    (item) => !excludeKinds.includes(isCatalogOperation(item.kind)?"erpnext":item.kind),
  ).map((item) => ({
      value: item.kind,
      title: item.title,
      description: item.description,
      group: item.group,
      icon: item.icon,
    }));
  return (
    <SidebarCatalogList
      searchLabel={__("Search Actions")}
      options={actionOptions}
      onSelect={(value) => onSelect(value as ActionKind)}
    />
  );
}

function SidebarTriggerCatalog({
  onSelect,
}: {
  onSelect: (trigger: DraftTrigger) => void;
}) {
  return (
    <SidebarTriggerList
      options={TRIGGER_LIBRARY}
      onSelect={onSelect}
    />
  );
}

function SidebarTriggerList({
  options,
  onSelect,
}: {
  options: Array<TriggerCatalogOption>;
  onSelect: (trigger: DraftTrigger) => void;
}) {
  return (
    <SidebarCatalogList
      searchLabel={__("Search Triggers")}
      options={options}
      onSelect={(value) => {
        const option = options.find((item) => item.value === value);
        if (option) onSelect(option.trigger);
      }}
    />
  );
}

function SidebarCatalogList({
  searchLabel,
  options,
  onSelect,
}: {
  searchLabel: string;
  options: Array<CatalogOption<string> & { icon: WorkflowCatalogIcon }>;
  onSelect: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = options.filter((option) => {
    if (!normalizedQuery) return true;
    return `${option.title} ${option.description} ${option.group}`
      .toLowerCase()
      .includes(normalizedQuery);
  });
  const groups = Array.from(new Set(filteredOptions.map((item) => item.group)));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={searchLabel}
        aria-label={searchLabel}
      />
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-edge bg-ink/30 p-2">
        {groups.length === 0 ? (
          <div className="px-2 py-8 text-center text-sm text-neutral-500">
            {__("No matches")}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group} className="mb-3 last:mb-0">
              <div className="px-1 py-1 text-xs font-semibold text-white">
                {group}
              </div>
              <div className="space-y-1">
                {filteredOptions
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <button
                      key={`${item.group}-${item.value}`}
                      type="button"
                      onClick={() => {
                        if (!item.disabled) onSelect(item.value);
                      }}
                      disabled={item.disabled}
                      className="grid w-full grid-cols-[44px_minmax(0,1fr)] items-center overflow-hidden rounded border border-edge bg-panel text-left transition-colors hover:border-edge-strong hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="flex h-11 items-center justify-center border-r border-edge bg-accent/10 text-accent">
                        <TriggerPresetIcon icon={item.icon} />
                      </span>
                      <span className="flex min-w-0 items-center gap-2 px-3">
                        <span className="truncate text-sm font-medium text-neutral-200">
                          {item.title}
                        </span>
                        {item.disabled ? (
                          <span className="shrink-0 rounded border border-edge px-1.5 py-0.5 text-[10px] font-normal uppercase text-neutral-500">
                            {__("Soon")}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TriggerPresetIcon({ icon }: { icon: WorkflowCatalogIcon }) {
  const shared = {
    "aria-hidden": true,
    className: "h-5 w-5",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
  } as const;
  if (icon === "calendar") {
    return (
      <svg {...shared}>
        <path d="M7 3v3" />
        <path d="M17 3v3" />
        <path d="M4 9h16" />
        <path d="M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
      </svg>
    );
  }
  if (icon === "bell") {
    return (
      <svg {...shared}>
        <path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8Z" />
        <path d="M10 21h4" />
      </svg>
    );
  }
  if (icon === "branch") {
    return (
      <svg {...shared}>
        <path d="M6 4v5a4 4 0 0 0 4 4h4" />
        <path d="M6 20v-5a4 4 0 0 1 4-4h4" />
        <path d="m14 8 4 4-4 4" />
      </svg>
    );
  }
  if (icon === "check") {
    return (
      <svg {...shared}>
        <path d="M5 12.5 10 17l9-10" />
        <path d="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
      </svg>
    );
  }
  if (icon === "clipboard") {
    return (
      <svg {...shared}>
        <path d="M9 4h6l1 2h2v15H6V6h2l1-2Z" />
        <path d="M9 6h6" />
        <path d="M9 11h6" />
        <path d="M9 15h4" />
      </svg>
    );
  }
  if (icon === "deal") {
    return (
      <svg {...shared}>
        <path d="M8 7h8" />
        <path d="M9 7V5h6v2" />
        <path d="M4 9h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9Z" />
        <path d="M4 13h16" />
      </svg>
    );
  }
  if (icon === "email") {
    return (
      <svg {...shared}>
        <path d="M4 6h16v12H4V6Z" />
        <path d="m4 7 8 6 8-6" />
      </svg>
    );
  }
  if (icon === "go_to") {
    return (
      <svg {...shared}>
        <path d="M5 12h9" />
        <path d="m11 8 4 4-4 4" />
        <path d="M19 5v6a6 6 0 0 1-6 6H7" />
      </svg>
    );
  }
  if (icon === "log") {
    return (
      <svg {...shared}>
        <path d="M6 3h12v18H6V3Z" />
        <path d="M9 8h6" />
        <path d="M9 12h6" />
        <path d="M9 16h3" />
      </svg>
    );
  }
  if (icon === "manual") {
    return (
      <svg {...shared}>
        <path d="M8 5v14" />
        <path d="m8 12 8-7v14l-8-7Z" />
      </svg>
    );
  }
  if (icon === "note") {
    return (
      <svg {...shared}>
        <path d="M6 3h9l3 3v15H6V3Z" />
        <path d="M14 3v4h4" />
        <path d="M8.5 12h7" />
        <path d="M8.5 16h5" />
      </svg>
    );
  }
  if (icon === "noop") {
    return (
      <svg {...shared}>
        <circle cx="12" cy="12" r="8" />
        <path d="m7 17 10-10" />
      </svg>
    );
  }
  if (icon === "record") {
    return (
      <svg {...shared}>
        <path d="M5 5h14v14H5V5Z" />
        <path d="M8 9h8" />
        <path d="M8 13h8" />
        <path d="M8 17h5" />
      </svg>
    );
  }
  if (icon === "task") {
    return (
      <svg {...shared}>
        <path d="M9 6h11" />
        <path d="M9 12h11" />
        <path d="M9 18h11" />
        <path d="m4 6 1 1 2-2" />
        <path d="m4 12 1 1 2-2" />
        <path d="m4 18 1 1 2-2" />
      </svg>
    );
  }
  if (icon === "wait") {
    return (
      <svg {...shared}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v5l3 2" />
      </svg>
    );
  }
  return (
    <svg {...shared}>
      <path d="M16 11a4 4 0 1 0-8 0" />
      <path d="M5 20a7 7 0 0 1 14 0" />
      <path d="M18 8a3 3 0 0 1 0 6" />
      <path d="M6 8a3 3 0 0 0 0 6" />
    </svg>
  );
}

function BuilderInspector({
  selectedNode,
  triggers,
  steps,
  stepPickerAfter,
  branchStepPicker,
  triggerPickerOpen,
  formError,
  onTrigger,
  onChooseTrigger,
  onChooseStep,
  onChooseBranchStep,
  onStep,
  onBranchStep,
  onRemoveStep,
  onRemoveBranchStep,
  onMoveStep,
  onMoveBranchStep,
}: {
  selectedNode: SelectedNode;
  triggers: DraftTriggerList;
  steps: Array<DraftStep>;
  stepPickerAfter: number | null;
  branchStepPicker: BranchInsertTarget;
  triggerPickerOpen: boolean;
  formError: string;
  onTrigger: (index: number, value: DraftTriggerState) => void;
  onChooseTrigger: (trigger: DraftTrigger) => void;
  onChooseStep: (afterIndex: number, kind: ActionKind) => void;
  onChooseBranchStep: (
    target: NonNullable<BranchInsertTarget>,
    kind: ActionKind,
  ) => void;
  onStep: (index: number, step: DraftStep) => void;
  onBranchStep: (
    stepIndex: number,
    branch: BranchPath,
    actionIndex: number,
    step: BranchActionStep,
  ) => void;
  onRemoveStep: (index: number) => void;
  onRemoveBranchStep: (
    stepIndex: number,
    branch: BranchPath,
    actionIndex: number,
  ) => void;
  onMoveStep: (index: number, direction: -1 | 1) => void;
  onMoveBranchStep: (
    stepIndex: number,
    branch: BranchPath,
    actionIndex: number,
    direction: -1 | 1,
  ) => void;
}) {
  const selectedStep =
    selectedNode.type === "step" ? steps[selectedNode.index] : undefined;
  const selectedBranchStep =
    selectedNode.type === "branchStep"
      ? branchStepsFor(
          steps[selectedNode.stepIndex],
          selectedNode.branch,
        )[selectedNode.actionIndex]
      : undefined;
  const selectedBranchSteps =
    selectedNode.type === "branchStep"
      ? branchStepsFor(steps[selectedNode.stepIndex], selectedNode.branch)
      : [];
  const selectedTrigger =
    selectedNode.type === "trigger" ? triggers[selectedNode.index] : undefined;
  const choosingAction = stepPickerAfter !== null || branchStepPicker !== null;
  const choosingTrigger = triggerPickerOpen;
  let inspectorTitle = __("Workflow settings");
  let inspectorDescription = __("Select a trigger or action to edit its settings.");
  if (choosingAction) {
    inspectorTitle = __("Add action");
    inspectorDescription = __("Search actions and flow blocks.");
  } else if (choosingTrigger) {
    inspectorTitle = __("Workflow Trigger");
    inspectorDescription =
      __("Adds a workflow trigger and enrolls matching records into the workflow.");
  } else if (selectedNode.type === "trigger") {
    inspectorTitle = __("Trigger settings");
    inspectorDescription = __("Choose how the workflow starts.");
  } else if (selectedNode.type === "step" || selectedNode.type === "branchStep") {
    inspectorTitle = __("Action settings");
    inspectorDescription = __("Configure the selected action.");
  }
  const body = choosingAction ? (
    <SidebarActionCatalog
      excludeKinds={branchStepPicker ? ["if_else"] : []}
      onSelect={(kind) => {
        if (branchStepPicker) {
          onChooseBranchStep(branchStepPicker, kind);
          return;
        }
        if (stepPickerAfter !== null) onChooseStep(stepPickerAfter, kind);
      }}
    />
  ) : choosingTrigger ? (
    <SidebarTriggerCatalog onSelect={onChooseTrigger} />
  ) : selectedNode.type === "trigger" && selectedTrigger ? (
    <TriggerEditor
      key={JSON.stringify(selectedNode)}
      trigger={selectedTrigger}
      onChange={(trigger) => onTrigger(selectedNode.index, trigger)}
    />
  ) : selectedNode.type === "step" && selectedStep ? (
    <StepEditor
      key={JSON.stringify(selectedNode)}
      index={selectedNode.index}
      step={selectedStep}
      steps={steps}
      stepCount={steps.length}
      goToSourceIndex={selectedNode.index}
      onChange={(step) => onStep(selectedNode.index, step)}
      onRemove={() => onRemoveStep(selectedNode.index)}
      onMove={onMoveStep}
    />
  ) : selectedNode.type === "branchStep" && selectedBranchStep ? (
    <StepEditor
      key={JSON.stringify(selectedNode)}
      index={selectedNode.actionIndex}
      step={selectedBranchStep}
      steps={steps}
      stepCount={selectedBranchSteps.length}
      actionKinds={BRANCH_ACTION_KINDS}
      canDeleteSingle
      onChange={(step) =>
        isBranchActionStep(step)
          ? onBranchStep(
              selectedNode.stepIndex,
              selectedNode.branch,
              selectedNode.actionIndex,
              step,
            )
          : undefined
      }
      onRemove={() =>
        onRemoveBranchStep(
          selectedNode.stepIndex,
          selectedNode.branch,
          selectedNode.actionIndex,
        )
      }
      onMove={(index, direction) =>
        onMoveBranchStep(
          selectedNode.stepIndex,
          selectedNode.branch,
          index,
          direction,
        )
      }
    />
  ) : null;

  return (
    <aside className="flex min-h-0 flex-col border-t border-edge bg-panel/50 lg:border-l lg:border-t-0">
      <div className="border-b border-edge px-4 py-3">
        <h2 className="text-sm font-medium text-white">{inspectorTitle}</h2>
        <p className="mt-1 text-xs text-neutral-500">{inspectorDescription}</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
        {formError ? (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-400">
            {formError}
          </p>
        ) : null}
        <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
      </div>
    </aside>
  );
}

function TriggerEditor({
  trigger,
  onChange,
}: {
  trigger: DraftTriggerState;
  onChange: (trigger: DraftTriggerState) => void;
}) {
  return (
    <div className="h-full space-y-3 overflow-y-auto">
      {trigger && <ErpTriggerFields trigger={trigger} onChange={onChange}/>}
      {trigger?.kind === "schedule" ? (
        <Field label={__("Every")}>
          <div className="grid grid-cols-[minmax(0,1fr)_90px] gap-2">
            <NumberInput
              value={String(trigger.intervalMinutes)}
              onChange={(value) =>
                onChange({
                  ...trigger,
                  kind: "schedule",
                  intervalMinutes: Math.max(5, Number(value) || 5),
                })
              }
              min={5}
            />
            <span className="flex items-center rounded-md border border-edge bg-ink px-3 text-sm text-neutral-400">
              minutes
            </span>
          </div>
        </Field>
      ) : null}
      {trigger?.kind === "record" ? (
        <div className="space-y-3 rounded-md border border-edge bg-ink/30 p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase text-neutral-500">
                {__("Filters")}
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                {__("AND filters: all conditions must match.")}
              </div>
            </div>
            <Button
              variant="secondary"
              onClick={() =>
                onChange({
                  ...trigger,
                  filters: [
                    ...(trigger.filters ?? []),
                    defaultTriggerFilter(trigger.entityType),
                  ],
                })
              }
              disabled={(trigger.filters ?? []).length >= 10}
            >
              + {__("Add")}
            </Button>
          </div>
          {(trigger.filters ?? []).length === 0 ? (
            <div className="rounded border border-dashed border-edge px-3 py-4 text-center text-xs text-neutral-500">
              {__("No filters")}
            </div>
          ) : (
            <div className="space-y-2">
              {(trigger.filters ?? []).map((filter, filterIndex) => (
                <div key={filterIndex}>
                  {filterIndex > 0 ? (
                    <div className="my-2 flex items-center gap-2">
                      <span className="h-px flex-1 bg-edge" />
                      <span className="rounded border border-edge bg-raised px-2 py-0.5 text-[10px] font-semibold text-neutral-400">
                        AND
                      </span>
                      <span className="h-px flex-1 bg-edge" />
                    </div>
                  ) : null}
                  <TriggerFilterRow
                    entityType={trigger.entityType}
                    filter={filter}
                    onChange={(nextFilter) => {
                      const filters = [...(trigger.filters ?? [])];
                      filters[filterIndex] = nextFilter;
                      onChange({ ...trigger, filters });
                    }}
                    onRemove={() =>
                      onChange({
                        ...trigger,
                        filters: (trigger.filters ?? []).filter(
                          (_, index) => index !== filterIndex,
                        ),
                      })
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TriggerFilterRow({
  entityType,
  filter,
  onChange,
  onRemove,
}: {
  entityType: EntityType;
  filter: TriggerFilter;
  onChange: (filter: TriggerFilter) => void;
  onRemove: () => void;
}) {
  const fieldOptions = TRIGGER_FILTER_FIELDS[entityType];
  return (
    <div className="grid gap-2 rounded border border-edge bg-panel p-2">
      <div className="grid grid-cols-[minmax(0,1fr)_32px] gap-2">
        <Select
          value={filter.field}
          onChange={(value) => onChange({ ...filter, field: value })}
          options={fieldOptions}
          ariaLabel={__("Trigger filter field")}
        />
        <button
          type="button"
          onClick={onRemove}
          className="flex h-9 w-8 items-center justify-center rounded-md border border-edge text-neutral-500 transition-colors hover:border-red-500/40 hover:text-red-300"
          aria-label={__("Remove trigger filter")}
        >
          ×
        </button>
      </div>
      <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
        <Select
          value={filter.operator}
          onChange={(value) =>
            onChange({ ...filter, operator: value as TriggerFilter["operator"] })
          }
          options={IF_ELSE_OPERATOR_OPTIONS}
          ariaLabel={__("Trigger filter operator")}
        />
        <Input
          value={filter.value}
          onChange={(event) =>
            onChange({ ...filter, value: event.target.value })
          }
          disabled={
            filter.operator === "is_empty" ||
            filter.operator === "is_not_empty"
          }
          placeholder={__("Value")}
          aria-label={__("Trigger filter value")}
        />
      </div>
    </div>
  );
}

function StepEditor({
  index,
  step,
  steps,
  stepCount,
  actionKinds,
  canDeleteSingle = false,
  goToSourceIndex,
  onChange,
  onRemove,
  onMove,
}: {
  index: number;
  step: DraftStep;
  steps: Array<DraftStep>;
  stepCount: number;
  actionKinds?: ReadonlyArray<StepKind>;
  canDeleteSingle?: boolean;
  goToSourceIndex?: number;
  onChange: (step: DraftStep) => void;
  onRemove: () => void;
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  const actionOptions = ACTION_LIBRARY.filter(
    (item) => !actionKinds || actionKinds.includes(isCatalogOperation(item.kind)?"erpnext":item.kind),
  );
  return (
    <div className="h-full space-y-3 overflow-y-auto border-t border-edge pt-4">
      <Field label={__("Action")}>
        <Select
          value={step.kind==="erpnext"&&step.operation&&isCatalogOperation(step.operation)?step.operation:step.kind}
          onChange={(value) => onChange(createDefaultStep(value as ActionKind))}
          options={actionOptions.map((item) => ({
            value: item.kind,
            label: item.title,
          }))}
          ariaLabel={__("Action type")}
        />
      </Field>
      <Field label={__("Step name")}>
        <Input
          value={step.label}
          onChange={(event) => onChange({ ...step, label: event.target.value })}
          placeholder={__("Step name")}
        />
      </Field>
      <StepFields
        step={step}
        steps={steps}
        goToSourceIndex={goToSourceIndex}
        onChange={onChange}
      />
      <div className="flex items-center justify-between border-t border-edge pt-3">
        <div className="flex gap-1">
          <Button
            variant="ghost"
            onClick={() => onMove(index, -1)}
            disabled={index === 0}
          >
            {__("Up")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => onMove(index, 1)}
            disabled={index === stepCount - 1}
          >
            {__("Down")}
          </Button>
        </div>
        <Button
          variant="danger"
          onClick={onRemove}
          disabled={!canDeleteSingle && stepCount <= 1}
        >
          {__("Delete")}
        </Button>
      </div>
    </div>
  );
}

function StepFields({
  step,
  steps,
  goToSourceIndex,
  onChange,
}: {
  step: DraftStep;
  steps: Array<DraftStep>;
  goToSourceIndex?: number;
  onChange: (step: DraftStep) => void;
}) {
  if (step.kind === "send_email") return <EmailFields step={step} onChange={onChange}/>;
  if (step.kind === "custom_code") return <CodeFields step={step} onChange={onChange}/>;
  if (step.kind === "run_ai_capability" || step.kind === "erpnext" || step.kind === "outgoing_webhook" || step.kind === "get_document" || step.kind === "api_request") return <ErpStepFields step={step} onChange={onChange}/>;
  if (step.kind === "noop") return null;
  if (step.kind === "wait") {
    const waitUnit = waitUnitForMinutes(step.durationMinutes);
    const waitAmount = step.durationMinutes / waitUnit.multiplier;
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
        <Field label={__("Wait for")}>
          <NumberInput
            value={String(waitAmount)}
            onChange={(value) =>
              onChange({
                ...step,
                durationMinutes: Math.max(
                  1,
                  Math.round((Number(value) || 1) * waitUnit.multiplier),
                ),
              })
            }
            min={1}
          />
        </Field>
        <Field label={__("Unit")}>
          <Select
            value={waitUnit.unit}
            onChange={(value) => {
              const nextUnit = waitUnitMultiplier(value);
              onChange({
                ...step,
                durationMinutes: Math.max(1, Math.round(waitAmount * nextUnit)),
              });
            }}
            options={WAIT_UNIT_OPTIONS}
            ariaLabel={__("Wait unit")}
          />
        </Field>
      </div>
    );
  }
  if (step.kind === "if_else") {
    return (
      <div className="space-y-4">
        <Field label={__("Conditional logic")}>
          <Select
            value="build"
            onChange={() => undefined}
            options={[{ value: "build", label: __("Route actions using conditions") }]}
            ariaLabel={__("Scenario recipe")}
          />
        </Field>
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase text-neutral-500">
            {__("Branches")}
          </div>
          {step.branches.map((branch, branchIndex) => (
            <div
              key={branchIndex}
              className="rounded-md border border-edge bg-ink/40 p-3"
            >
              <div className="mb-3 grid grid-cols-[minmax(0,1fr)_32px] items-center gap-2">
                <Input
                  value={branch.name}
                  onChange={(event) => {
                    const branches = [...step.branches];
                    branches[branchIndex] = {
                      ...branch,
                      name: event.target.value,
                    };
                    onChange({ ...step, branches });
                  }}
                  placeholder={__("Branch")}
                  aria-label={__("Branch {0} name", [branchIndex + 1])}
                />
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...step,
                      branches: step.branches.filter(
                        (_, index) => index !== branchIndex,
                      ),
                    })
                  }
                  disabled={step.branches.length <= 1}
                  className="flex h-9 w-8 items-center justify-center rounded-md border border-edge text-neutral-500 transition-colors hover:border-red-500/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={__("Delete branch {0}", [branchIndex + 1])}
                >
                  ×
                </button>
              </div>
              <ErpConditionFields branch={branch} onChange={(next) => {const branches=[...step.branches];branches[branchIndex]=next;onChange({...step,branches})}} />
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() =>
              onChange({
                ...step,
                branches: [
                  ...step.branches,
                  {
                    name: __("Branch"),
                    field: "current_day_of_week",
                    operator: "is",
                    value: "Monday",
                    steps: [],
                  },
                ],
              })
            }
            disabled={step.branches.length >= 10}
          >
            + {__("Add Branch")}
          </Button>
          <div className="rounded-md border border-edge bg-ink/40 p-3">
            <div className="mb-2 text-xs font-semibold text-neutral-400">
              {__("Else Branch")}
            </div>
            <Input
              value={step.elseLabel}
              onChange={(event) =>
                onChange({ ...step, elseLabel: event.target.value })
              }
              placeholder={__("None")}
              aria-label={__("None branch label")}
            />
          </div>
        </div>
      </div>
    );
  }
  if (step.kind === "go_to") {
    return (
      <Field label={__("Destination")}>
        <Select
          value={
            step.targetStepIndex === undefined
              ? ""
              : String(step.targetStepIndex)
          }
          onChange={(value) =>
            onChange({
              ...step,
              targetStepIndex: value === "" ? undefined : Number(value),
            })
          }
          options={[
            { value: "", label: __("Select destination") },
            ...steps
              .map((item, itemIndex) => ({
                value: String(itemIndex),
                label: __("Action {0}: {1}", [itemIndex + 1, stepTitle(item)]),
              }))
              .filter((option) => option.value !== String(goToSourceIndex)),
          ]}
          ariaLabel={__("Go To destination")}
        />
      </Field>
    );
  }
  if (step.kind === "log") {
    return (
      <Field label={__("Message")}>
        <TextArea
          value={step.message}
          onChange={(value) => onChange({ ...step, message: value })}
          placeholder={__("Log message")}
        />
      </Field>
    );
  }
  if (step.kind === "create_note") {
    return (
      <>
        <Field label={__("Title")}>
          <MergeFieldTextInput
            value={step.title}
            onChange={(value) => onChange({ ...step, title: value })}
            placeholder={__("Note title")}
          />
        </Field>
        <Field label={__("Body")}>
          <TextArea
            value={step.body ?? ""}
            onChange={(value) => onChange({ ...step, body: value || undefined })}
            placeholder={__("Note body")}
          />
        </Field>
      </>
    );
  }
  if (step.kind === "create_task") {
    return (
      <>
        <Field label={__("Title")}>
          <MergeFieldTextInput
            value={step.title}
            onChange={(value) => onChange({ ...step, title: value })}
            placeholder={__("Task title")}
          />
        </Field>
        <Field label={__("Description")}>
          <TextArea
            value={step.description ?? ""}
            onChange={(value) =>
              onChange({ ...step, description: value || undefined })
            }
            placeholder={__("Task description")}
          />
        </Field>
        <Field label={__("Due offset")}>
          <NumberInput
            value={step.dueOffsetDays === undefined ? "" : String(step.dueOffsetDays)}
            onChange={(value) =>
              onChange({
                ...step,
                dueOffsetDays: value.trim()
                  ? Math.max(0, Number(value) || 0)
                  : undefined,
              })
            }
            min={0}
            placeholder={__("Days from run")}
          />
        </Field>
      </>
    );
  }
  if (step.kind === "update_record") {
    return (
      <>
        <div className="grid grid-cols-2 gap-2">
          <Field label={__("Object")}>
            <Select
              value={step.entityType}
              onChange={(value) =>
                onChange(defaultUpdateStep(value as UpdateEntityType))
              }
              options={UPDATE_ENTITY_OPTIONS}
              ariaLabel={__("Update record type")}
            />
          </Field>
          <Field label={__("Field")}>
            <Select
              value={step.field}
              onChange={(value) => onChange({ ...step, field: value })}
              options={fieldOptions(step.entityType)}
              ariaLabel={__("Update field")}
            />
          </Field>
        </div>
        <Field label={__("Fixed record id")}>
          <Input
            value={step.recordId}
            onChange={(event) =>
              onChange({ ...step, recordId: event.target.value })
            }
            placeholder={__("Paste a Convex record id")}
          />
        </Field>
        <Field label={__("Value")}>
          <UpdateValueInput step={step} onChange={onChange} />
        </Field>
      </>
    );
  }
  if (step.kind === "send_notification") {
    return (
      <>
        <Field label={__("Channel")}>
          <Select
            value={step.channel}
            onChange={(value) =>
              onChange({ ...step, channel: value as "activity" | "slack" })
            }
            options={[
              { value: "activity", label: __("Activity") },
              { value: "slack", label: "Slack" },
            ]}
            ariaLabel={__("Notification channel")}
          />
        </Field>
        <Field label={__("Message")}>
          <TextArea
            value={step.message}
            onChange={(value) => onChange({ ...step, message: value })}
            placeholder={__("Notification message")}
          />
        </Field>
      </>
    );
  }
  return null;
}

function UpdateValueInput({
  step,
  onChange,
}: {
  step: Extract<DraftStep, { kind: "update_record" }>;
  onChange: (step: DraftStep) => void;
}) {
  if (step.entityType === "deal") {
    return (
      <Select
        value={step.value}
        onChange={(value) => onChange({ ...step, value })}
        options={DEAL_STAGE_OPTIONS}
        ariaLabel={__("Deal stage")}
      />
    );
  }
  if (step.entityType === "project") {
    return (
      <Select
        value={step.value}
        onChange={(value) => onChange({ ...step, value })}
        options={PROJECT_STATUS_OPTIONS}
        ariaLabel={__("Project status")}
      />
    );
  }
  if (step.entityType === "task") {
    return (
      <Select
        value={step.value}
        onChange={(value) => onChange({ ...step, value })}
        options={TASK_STATUS_OPTIONS}
        ariaLabel={__("Task status")}
      />
    );
  }
  return (
    <Input
      value={step.value}
      onChange={(event) => onChange({ ...step, value: event.target.value })}
      placeholder={__("Value")}
    />
  );
}

function WorkflowSettingsPanel({
  name,
  description,
  formError,
  onName,
  onDescription,
}: {
  name: string;
  description: string;
  formError: string;
  onName: (value: string) => void;
  onDescription: (value: string) => void;
}) {
  return (
    <div className="p-4">
      <Panel className="mx-auto max-w-2xl p-4">
        <div className="mb-4">
          <h2 className="text-sm font-medium text-white">{__("Settings")}</h2>
          <p className="mt-1 text-xs text-neutral-500">
            {__("Name the recipe and keep a short internal note for the workflow list.")}
          </p>
        </div>
        <div className="space-y-4">
          <Field label={__("Recipe name")}>
            <Input
              value={name}
              onChange={(event) => onName(event.target.value)}
              placeholder={__("Recipe name")}
              aria-label={__("Recipe name")}
            />
          </Field>
          <Field label={__("Description")}>
            <TextArea
              value={description}
              onChange={onDescription}
              placeholder={__("What this workflow does")}
              rows={4}
            />
          </Field>
          {formError ? (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-400">
              {formError}
            </p>
          ) : null}
        </div>
      </Panel>
      <WorkflowConnections/>
    </div>
  );
}

function RunHistory({
  workflow,
  runs,
  title = "Runs",
}: {
  workflow: Workflow | undefined;
  runs: Array<WorkflowRun> | undefined;
  title?: string;
}) {
  return (
    <div className="p-4">
      <Panel className="p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-white">{title}</h2>
            <p className="mt-1 text-xs text-neutral-500">
              {workflow ? workflow.name : __("Select a workflow")}
            </p>
          </div>
          {workflow?.currentVersion ? (
            <Badge>v{workflow.currentVersion.number}</Badge>
          ) : null}
        </div>
        {!workflow ? (
          <EmptyState message={__("Select a workflow")} />
        ) : runs === undefined ? (
          <p className="text-sm text-neutral-500">{__("Loading...")}</p>
        ) : runs.length === 0 ? (
          <EmptyState message={__("No runs recorded")} />
        ) : (
          <div className="divide-y divide-edge">
            {runs.map((run) => (
              <div key={run._id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <RunStatusBadge status={run.status} />
                    <span className="truncate text-sm text-white">
                      {__("{0} run", [run.triggerKind])}
                    </span>
                  </div>
                  <span className="text-xs text-neutral-500">
                    {timeAgo(run.createdAt)}
                  </span>
                </div>
                {run.error ? (
                  <p className="mt-2 text-xs text-red-400">{run.error}</p>
                ) : null}
                <div className="mt-3 space-y-2">
                  {run.steps.map((step) => (
                    <div
                      key={step._id}
                      className="grid grid-cols-[44px_minmax(0,1fr)_96px] gap-2 rounded-md bg-ink px-3 py-2 text-xs"
                    >
                      <span className="text-neutral-600">#{step.position}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-neutral-300">
                          {step.label}
                        </span>
                        <span className="mt-1 block truncate text-neutral-500">
                          {step.error ?? step.output ?? __("No output")}
                        </span>
                      </span>
                      <span className="text-right">
                        <RunStatusBadge status={step.status} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function VersionHistory({
  workflow,
  versions,
  currentVersionId,
  title = __("Versions"),
}: {
  workflow: Workflow | undefined;
  versions: Array<WorkflowVersionRow> | undefined;
  currentVersionId: Id<"workflowVersions"> | undefined;
  title?: string;
}) {
  return (
    <div className="p-4">
      <Panel className="p-4">
        <div className="mb-4">
          <h2 className="text-sm font-medium text-white">{title}</h2>
          <p className="mt-1 text-xs text-neutral-500">
            {workflow ? workflow.name : __("Select a workflow")}
          </p>
        </div>
        {!workflow ? (
          <EmptyState message={__("Select a workflow")} />
        ) : versions === undefined ? (
          <p className="text-sm text-neutral-500">{__("Loading...")}</p>
        ) : versions.length === 0 ? (
          <EmptyState message={__("No versions recorded")} />
        ) : (
          <div className="divide-y divide-edge">
            {versions.map((version) => (
              <div
                key={version._id}
                className="grid grid-cols-[80px_minmax(0,1fr)_130px] items-center gap-3 py-3 text-sm"
              >
                <div className="flex items-center gap-2">
                  <Badge>v{version.number}</Badge>
                  {version._id === currentVersionId ? <StatusDot status="active" /> : null}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-white">
                    {triggerLabel(version.trigger)}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-neutral-500">
                    {__("{0} actions", [version.steps.length])}
                    {version.validationErrors.length > 0
                      ? ` - ${version.validationErrors[0]}`
                      : ""}
                  </div>
                </div>
                <span className="text-right text-xs text-neutral-500">
                  {shortDate(version.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-neutral-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function TextArea({
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  rows?: number;
}) {
  return (
    <MergeFieldTextarea
      value={value}
      rows={rows}
      onChange={onChange}
      placeholder={placeholder}
    />
  );
}

function StatusBadge({ status }: { status: WorkflowStatus }) {
  const classes = {
    active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    draft: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    paused: "border-sky-500/30 bg-sky-500/10 text-sky-200",
    archived: "border-neutral-700 bg-neutral-900 text-neutral-400",
  }[status];
  const label = { active: __("Active"), draft: __("Draft"), paused: __("Paused"), archived: __("Archived") }[status] ?? status;
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${classes}`}>
      {label}
    </span>
  );
}

function StatusDot({ status }: { status: WorkflowStatus }) {
  const classes = {
    active: "bg-emerald-400",
    draft: "bg-amber-500",
    paused: "bg-sky-500",
    archived: "bg-neutral-600",
  }[status];
  return <span className={`h-2 w-2 shrink-0 rounded-full ${classes}`} />;
}

function RunStatusBadge({ status }: { status: WorkflowRun["status"] }) {
  const classes = {
    queued: "border-sky-500/30 bg-sky-500/10 text-sky-200",
    running: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    succeeded: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    failed: "border-red-500/30 bg-red-500/10 text-red-400",
    canceled: "border-neutral-700 bg-neutral-900 text-neutral-400",
  }[status];
  const label = { queued: __("Queued"), running: __("Running"), succeeded: __("Succeeded"), failed: __("Failed"), canceled: __("Canceled") }[status] ?? status;
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${classes}`}>
      {label}
    </span>
  );
}

function createInitialWorkflowName() {
  return __("New Workflow : {0}", [Date.now()]);
}

function defaultTriggerFilter(entityType: EntityType): TriggerFilter {
  return {
    field: TRIGGER_FILTER_FIELDS[entityType][0]?.value ?? "name",
    operator: "is",
    value: "",
  };
}

function workflowTriggerList(workflow: Workflow | undefined): DraftTriggerList {
  if (!workflow) return [];
  const version = workflow.currentVersion;
  if (version?.triggers) return version.triggers;
  if (version?.trigger) return [version.trigger];
  if (workflow.triggers) return workflow.triggers;
  return workflow.trigger ? [workflow.trigger] : [];
}

function createDefaultStep(kind: ActionKind): DraftStep {
  if(isCrmOperation(kind))return createCrmStep(kind);
  if(isReservasOperation(kind))return createReservasStep(kind) as DraftStep;
  if(isPulseOperation(kind))return createPulseStep(kind);
  if(kind==="run_ai_capability")return {kind,label:__("Run AI Capability"),configJson:JSON.stringify({capability:"meeting-summary",input:{notes:{$ref:"trigger.notes"}}})};
  if(kind==="outgoing_webhook")return {kind,label:__("Outgoing webhook"),configJson:JSON.stringify({url:"",method:"POST",headers:{},body:{$ref:"trigger"}},null,2)};
  if(kind==="api_request")return {kind,label:__("API request"),configJson:JSON.stringify({url:"",method:"GET",headers:{}})};
  if(kind==="custom_code")return {kind,label:__("Run Code"),code:"return { documentName: input.name, processed: true };"};
  if(kind==="get_document")return {kind,label:__("Get document"),configJson:JSON.stringify({doctype:"Task",name:{$ref:"trigger.name"}})};
  if(kind==="erpnext")return {kind,label:__("ERPNext document"),operation:"get_document",configJson:JSON.stringify({doctype:"Task",name:{$ref:"trigger.name"}},null,2)};
  if (kind === "noop") return { kind: "noop", label: __("No operation") };
  if (kind === "create_note") {
    return { kind: "create_note", label: __("Create note"), title: __("Workflow note") };
  }
  if (kind === "create_task") {
    return { kind: "create_task", label: __("Create task"), title: __("Workflow task") };
  }
  if (kind === "update_record") return defaultUpdateStep("deal");
  if (kind === "send_notification") {
    return {
      kind: "send_notification",
      label: __("Send notification"),
      channel: "activity",
      message: __("Workflow notification."),
    };
  }
  if (kind === "send_email") {
    return {
      kind: "send_email",
      label: __("Send email"),
      to: "",
      subject: __("Workflow notification"),
      body: __("This workflow sent an email."),
    };
  }
  if (kind === "go_to") {
    return {
      kind: "go_to",
      label: __("Go To"),
    };
  }
  if (kind === "wait") {
    return {
      kind: "wait",
      label: __("Wait"),
      durationMinutes: 60,
    };
  }
  if (kind === "if_else") {
    return {
      kind: "if_else",
      label: __("If / Else"),
      branches: [
        {
          name: __("Branch"),
          field: "current_day_of_week",
          operator: "is",
          value: "Monday",
          steps: [],
        },
      ],
      elseLabel: "None",
      elseSteps: [],
    };
  }
  return {
    kind: "log",
    label: __("Record workflow event"),
    message: __("Workflow executed."),
  };
}

function isBranchActionKind(kind: StepKind): kind is BranchActionKind {
  return BRANCH_ACTION_KINDS.includes(kind as BranchActionKind);
}

function isBranchActionStep(step: DraftStep): step is BranchActionStep {
  return isBranchActionKind(step.kind);
}

function branchStepsFor(
  step: DraftStep | undefined,
  branch: BranchPath,
): Array<BranchActionStep> {
  if (!step || step.kind !== "if_else") return [];
  if (branch.type === "else") {
    return (step.elseSteps ?? []) as Array<BranchActionStep>;
  }
  return (step.branches[branch.index]?.steps ?? []) as Array<BranchActionStep>;
}

function updateIfElseBranchSteps(
  steps: Array<DraftStep>,
  stepIndex: number,
  branch: BranchPath,
  update: (steps: Array<BranchActionStep>) => Array<BranchActionStep>,
): Array<DraftStep> {
  return steps.map((step, index) => {
    if (index !== stepIndex || step.kind !== "if_else") return step;
    if (branch.type === "else") {
      return {
        ...step,
        elseSteps: update((step.elseSteps ?? []) as Array<BranchActionStep>),
      };
    }
    return {
      ...step,
      branches: step.branches.map((item, branchIndex) =>
        branchIndex === branch.index
          ? {
              ...item,
              steps: update((item.steps ?? []) as Array<BranchActionStep>),
            }
          : item,
      ),
    };
  });
}

function cloneBranchSteps(steps: Array<BranchActionStep> | undefined) {
  return (steps ?? []).map((step) => ({ ...step })) as Array<BranchActionStep>;
}

function cloneSteps(steps: Array<DraftStep>): Array<DraftStep> {
  return steps.map((step) => {
    if (step.kind === "go_to") return { kind: "go_to", label: step.label };
    if (step.kind === "if_else") {
      return {
        ...step,
        branches: step.branches.map((branch) => ({
          ...branch,
          steps: cloneBranchSteps(branch.steps),
        })),
        elseSteps: cloneBranchSteps(step.elseSteps),
      };
    }
    return { ...step };
  });
}

function retargetStepsAfterDelete(
  steps: Array<DraftStep>,
  deletedIndex: number,
): Array<DraftStep> {
  return steps
    .filter((_, itemIndex) => itemIndex !== deletedIndex)
    .map((step) => {
      if (step.kind !== "go_to" || step.targetStepIndex === undefined) {
        return step;
      }
      if (step.targetStepIndex === deletedIndex) {
        return { kind: "go_to", label: step.label };
      }
      if (step.targetStepIndex > deletedIndex) {
        return { ...step, targetStepIndex: step.targetStepIndex - 1 };
      }
      return step;
    });
}

function moveStepsToInsertionPoint(
  steps: Array<DraftStep>,
  move: NonNullable<WorkflowMove>,
  afterIndex: number,
): { steps: Array<DraftStep>; selectedIndex: number } {
  const start = move.index;
  const end = move.type === "step" ? start + 1 : steps.length;
  const moving = steps.slice(start, end);
  if (moving.length === 0) return { steps, selectedIndex: Math.max(0, start) };

  if (afterIndex >= start - 1 && afterIndex < end) {
    return { steps, selectedIndex: start };
  }

  const remaining = [...steps.slice(0, start), ...steps.slice(end)];
  const adjustedAfterIndex =
    afterIndex >= end ? afterIndex - moving.length : afterIndex;
  const insertAt = Math.max(
    0,
    Math.min(remaining.length, adjustedAfterIndex + 1),
  );
  return {
    steps: [
      ...remaining.slice(0, insertAt),
      ...moving,
      ...remaining.slice(insertAt),
    ],
    selectedIndex: insertAt,
  };
}

function waitUnitMultiplier(unit: string) {
  if (unit === "days") return 1440;
  if (unit === "hours") return 60;
  return 1;
}

function waitUnitForMinutes(minutes: number): {
  unit: "minutes" | "hours" | "days";
  multiplier: number;
} {
  if (minutes % 1440 === 0) return { unit: "days", multiplier: 1440 };
  if (minutes % 60 === 0) return { unit: "hours", multiplier: 60 };
  return { unit: "minutes", multiplier: 1 };
}

function formatDuration(minutes: number) {
  if (minutes % 1440 === 0) {
    const value = minutes / 1440;
    return value === 1 ? __("1 day") : __("{0} days", [value]);
  }
  if (minutes % 60 === 0) {
    const value = minutes / 60;
    return value === 1 ? __("1 hour") : __("{0} hours", [value]);
  }
  return minutes === 1 ? __("1 minute") : __("{0} minutes", [minutes]);
}

function validateDraft(
  name: string,
  triggers: DraftTriggerList,
  steps: Array<DraftStep>,
  allowEmpty = false,
) {
  const errors: Array<string> = [];
  if (!name.trim()) errors.push(__("Workflow name is required."));
  if (triggers.length === 0) errors.push(__("Workflow trigger is required."));
  if (triggers.length > 8) errors.push(__("Workflow supports up to 8 triggers."));
  for (const [index, trigger] of triggers.entries()) {
    const label = __("Trigger {0}", [index + 1]);
    if (trigger.kind === "schedule" && trigger.intervalMinutes < 5) {
      errors.push(__("{0} schedule interval must be at least 5 minutes.", [label]));
    }
    if (
      trigger.kind === "record" &&
      (trigger.event === "stage_changed" ||
        trigger.event === "status_changed") &&
      trigger.entityType !== "deal" &&
      trigger.entityType !== "project" &&
      trigger.entityType !== "task"
    ) {
      errors.push(
        __("{0} stage/status changes only apply to deals, projects, or tasks.", [label]),
      );
    }
    if (trigger.kind === "record") {
      const filters = trigger.filters ?? [];
      if (filters.length > 10) errors.push(__("{0} supports up to 10 filters.", [label]));
      for (const [filterIndex, filter] of filters.entries()) {
        if (!filter.field.trim()) {
          errors.push(__("{0} filter {1} needs a field.", [label, filterIndex + 1]));
        }
        if (
          filter.operator !== "is_empty" &&
          filter.operator !== "is_not_empty" &&
          !filter.value.trim()
        ) {
          errors.push(__("{0} filter {1} needs a value.", [label, filterIndex + 1]));
        }
      }
    }
  }
  if (!allowEmpty && steps.length === 0) errors.push(__("Add at least one action before testing or publishing."));
  for (const [index, step] of steps.entries()) {
    const label = __("Action {0}", [index + 1]);
    if (!step.label.trim()) errors.push(__("{0} needs a name.", [label]));
    if (step.kind === "log" && !step.message.trim()) {
      errors.push(__("{0} needs a log message.", [label]));
    }
    if (step.kind === "create_note" && !step.title.trim() && !step.body?.trim()) {
      errors.push(__("{0} needs note content.", [label]));
    }
    if (step.kind === "create_task" && !step.title.trim()) {
      errors.push(__("{0} needs a task title.", [label]));
    }
    if (
      step.kind === "create_task" &&
      step.dueOffsetDays !== undefined &&
      (step.dueOffsetDays < 0 || step.dueOffsetDays > 3650)
    ) {
      errors.push(__("{0} due offset must be between 0 and 3650 days.", [label]));
    }
    if (step.kind === "update_record") {
      if (!fieldOptions(step.entityType).some((option) => option.value === step.field)) {
        errors.push(__("{0} targets an unsupported field.", [label]));
      }
      if (!step.recordId.trim()) errors.push(__("{0} needs a record id.", [label]));
      if (!step.value.trim()) errors.push(__("{0} needs a value.", [label]));
    }
    if (step.kind === "send_notification" && !step.message.trim()) {
      errors.push(__("{0} needs a notification message.", [label]));
    }
    if (step.kind === "send_email") {
      if (!step.to.includes("@") && !hasMergeField(step.to)) {
        errors.push(__("{0} needs an email recipient.", [label]));
      }
      if (!step.subject.trim()) errors.push(__("{0} needs an email subject.", [label]));
      if (!step.body.trim()) errors.push(__("{0} needs an email body.", [label]));
    }
    if (step.kind === "wait") {
      if (!Number.isFinite(step.durationMinutes) || step.durationMinutes < 1) {
        errors.push(__("{0} wait must be at least 1 minute.", [label]));
      }
      if (step.durationMinutes > 525600) {
        errors.push(__("{0} wait cannot be longer than 365 days.", [label]));
      }
    }
    if (step.kind === "if_else") {
      if (step.branches.length === 0) errors.push(__("{0} needs at least one branch.", [label]));
      if (step.branches.length > 10) errors.push(__("{0} supports up to 10 branches.", [label]));
      for (const [branchIndex, branch] of step.branches.entries()) {
        if (!branch.name.trim()) {
          errors.push(__("{0} branch {1} needs a name.", [label, branchIndex + 1]));
        }
        if (!branch.field.trim()) {
          errors.push(__("{0} branch {1} needs a field.", [label, branchIndex + 1]));
        }
        if (
          branch.operator !== "is_empty" &&
          branch.operator !== "is_not_empty" &&
          !branch.value.trim()
        ) {
          errors.push(__("{0} branch {1} needs a value.", [label, branchIndex + 1]));
        }
        validateBranchDraftSteps(
          errors,
          __("{0} branch {1}", [label, branchIndex + 1]),
          branch.steps ?? [],
          steps.length,
        );
      }
      if (!step.elseLabel.trim()) errors.push(__("{0} needs a None branch label.", [label]));
      validateBranchDraftSteps(
        errors,
        __("{0} None branch", [label]),
        step.elseSteps ?? [],
        steps.length,
      );
    }
    if (step.kind === "go_to") {
      if (step.targetStepIndex === undefined) {
        errors.push(__("{0} needs a Go To destination.", [label]));
      } else if (
        !Number.isInteger(step.targetStepIndex) ||
        step.targetStepIndex < 0 ||
        step.targetStepIndex >= steps.length
      ) {
        errors.push(__("{0} has an invalid Go To destination.", [label]));
      } else if (step.targetStepIndex === index) {
        errors.push(__("{0} cannot go to itself.", [label]));
      }
    }
  }
  return errors;
}

function validateBranchDraftSteps(
  errors: Array<string>,
  label: string,
  steps: Array<BranchActionStep>,
  topLevelStepCount: number,
) {
  for (const [index, step] of steps.entries()) {
    const actionLabel = __("{0} action {1}", [label, index + 1]);
    if (!step.label.trim()) errors.push(__("{0} needs a name.", [actionLabel]));
    if (step.kind === "log" && !step.message.trim()) {
      errors.push(__("{0} needs a log message.", [actionLabel]));
    }
    if (step.kind === "send_email") {
      if (!step.to.includes("@") && !hasMergeField(step.to)) {
        errors.push(__("{0} needs an email recipient.", [actionLabel]));
      }
      if (!step.subject.trim()) errors.push(__("{0} needs an email subject.", [actionLabel]));
      if (!step.body.trim()) errors.push(__("{0} needs an email body.", [actionLabel]));
    }
    if (step.kind === "wait") {
      if (!Number.isFinite(step.durationMinutes) || step.durationMinutes < 1) {
        errors.push(__("{0} wait must be at least 1 minute.", [actionLabel]));
      }
      if (step.durationMinutes > 525600) {
        errors.push(__("{0} wait cannot be longer than 365 days.", [actionLabel]));
      }
    }
    if (step.kind === "go_to") {
      if (step.targetStepIndex === undefined) {
        errors.push(__("{0} needs a Go To destination.", [actionLabel]));
      } else if (
        !Number.isInteger(step.targetStepIndex) ||
        step.targetStepIndex < 0 ||
        step.targetStepIndex >= topLevelStepCount
      ) {
        errors.push(__("{0} has an invalid Go To destination.", [actionLabel]));
      }
    }
  }
}

function testDisabledReason({
  workflow,
  dirty,
  draftValidationErrors,
  validationErrors,
}: {
  creating: boolean;
  workflow: Workflow | undefined;
  dirty: boolean;
  draftValidationErrors: Array<string>;
  validationErrors: Array<string>;
}) {
  if (draftValidationErrors.length > 0) return draftValidationErrors[0];
  if (!dirty && !workflow) return __("Select or create a workflow to test.");
  if (!dirty && validationErrors.length > 0) return validationErrors[0];
  return "";
}

function defaultUpdateStep(entityType: UpdateEntityType): DraftStep {
  if (entityType === "deal") {
    return {
      kind: "update_record",
      label: __("Update deal"),
      entityType,
      recordId: "",
      field: "stage",
      value: "QUALIFIED",
    };
  }
  if (entityType === "project") {
    return {
      kind: "update_record",
      label: __("Update project"),
      entityType,
      recordId: "",
      field: "status",
      value: "active",
    };
  }
  if (entityType === "task") {
    return {
      kind: "update_record",
      label: __("Update task"),
      entityType,
      recordId: "",
      field: "status",
      value: "todo",
    };
  }
  return {
    kind: "update_record",
    label: __("Update {0}", [entityLabel(entityType as EntityType)]),
    entityType,
    recordId: "",
    field: entityType === "company" ? "description" : "title",
    value: "",
  };
}

function fieldOptions(entityType: UpdateEntityType) {
  if (entityType === "company") {
    return [
      { value: "description", label: __("Description") },
      { value: "industry", label: __("Industry") },
    ];
  }
  if (entityType === "contact") return [{ value: "title", label: __("Title") }];
  return [
    {
      value: entityType === "deal" ? "stage" : "status",
      label: entityType === "deal" ? "Stage" : "Status",
    },
  ];
}

function triggerTitle(trigger: DraftTriggerState) {
  if(trigger?.kind==="crm")return crmTriggerTitle(trigger);
  if(isReservasTrigger(trigger))return reservasTriggerTitle(trigger);
  if(trigger?.kind==="incoming_webhook")return trigger.name||__("Incoming webhook");
  if(trigger?.kind==="document_event")return __("{0} event", [trigger.doctype]);
  if (!trigger) return __("Add a Trigger");
  if (trigger.kind === "schedule") return __("Custom Date Reminder");
  if (trigger.kind === "record") {
    const entity = entityLabel(trigger.entityType);
    if (trigger.entityType === "deal" && trigger.event === "stage_changed") {
      return __("Opportunity Stage Changed");
    }
    if (trigger.entityType === "task" && trigger.event === "status_changed") {
      return __("Task Completed");
    }
    if (trigger.entityType === "contact" && trigger.event === "created") {
      return __("Contact Created");
    }
    if (trigger.event === "created") return __("{0} Added", [entity]);
    if (trigger.event === "updated") return __("{0} Changed", [entity]);
    return __("{0} {1}", [entity, eventLabel(trigger.event)]);
  }
  return __("Launch manually");
}

function triggerLabel(trigger: DraftTriggerState) {
  if(trigger?.kind==="crm")return crmTriggerLabel(trigger);
  if(isReservasTrigger(trigger))return reservasTriggerLabel(trigger);
  if(trigger?.kind==="incoming_webhook")return __("Receive a JSON payload");
  if(trigger?.kind==="document_event")return `${trigger.doctype} · ${{after_insert:__("Created"),on_update:__("Updated"),on_submit:__("Submitted"),on_cancel:__("Cancelled"),on_update_after_submit:__("Updated after submission")}[trigger.event]??trigger.event}`;
  if (!trigger) return __("Choose how this workflow starts");
  if (trigger.kind === "schedule") return __("Every {0}m", [trigger.intervalMinutes]);
  if (trigger.kind === "record") {
    const filters = trigger.filters?.length
      ? " · " + (trigger.filters.length === 1 ? __("1 filter") : __("{0} filters", [trigger.filters.length]))
      : "";
    return `${entityLabel(trigger.entityType)} · ${eventLabel(trigger.event)}${filters}`;
  }
  return __("Manual");
}

function entityLabel(entityType: EntityType) {
  if (entityType === "deal") return __("Opportunity");
  return ENTITY_OPTIONS.find((option) => option.value === entityType)?.label ?? entityType;
}

function eventLabel(event: RecordEvent) {
  return EVENT_OPTIONS.find((option) => option.value === event)?.label ?? event;
}

function triggerIcon(trigger: DraftTrigger): WorkflowCatalogIcon {
  if(trigger.kind==="crm")return trigger.doctype==="CRM Deal"?"deal":"contact";
  if(isReservasTrigger(trigger))return "calendar";
  if(trigger.kind==="incoming_webhook")return "go_to";
  if(trigger.kind==="document_event")return "record";
  if (trigger.kind === "manual") return "manual";
  if (trigger.kind === "schedule") return "calendar";
  if (trigger.entityType === "deal") return "deal";
  if (trigger.entityType === "note") return "note";
  if (trigger.entityType === "task") {
    return trigger.event === "status_changed" ? "check" : "task";
  }
  return "contact";
}

function actionIcon(kind: StepKind): WorkflowCatalogIcon {
  return ACTION_LIBRARY.find((item) => item.kind === kind)?.icon ?? "record";
}

function stepTitle(step: DraftStep) {
  const action = ACTION_LIBRARY.find((item) => item.kind === (step.kind==="erpnext"&&step.operation&&isCatalogOperation(step.operation)?step.operation:step.kind));
  return action?.title ?? step.kind;
}

function stepSubtitle(step: DraftStep) {
  if(step.kind==="run_ai_capability"){try{return JSON.parse(step.configJson).capability||__("Choose an AI capability")}catch{return __("Choose an AI capability")}}
  if(step.kind==="api_request"){try{const c=JSON.parse(step.configJson);return (c.method||"GET")+" "+(c.url||__("Configure request"))}catch{return __("Configure API request")}}
  if(step.kind==="custom_code")return __("Transform data with JavaScript");
  if(step.kind==="get_document"){try{return __("Get {0}", [JSON.parse(step.configJson).doctype])}catch{return __("Get an ERPNext document")}}
  if(step.kind==="erpnext"&&step.operation&&isCrmOperation(step.operation)){try{const c=JSON.parse(step.configJson);return c.subject||c.email_template||c.template||c.body||__("Write the message")}catch{return __("Write the message")}}
  if(step.kind==="erpnext"&&step.operation&&isReservasOperation(step.operation)){try{const c=JSON.parse(step.configJson);return c.service||(c.booking==="{{trigger.name}}"?__("This booking"):c.booking)||__("Booking")}catch{return __("Booking")}}
  if(step.kind==="erpnext")return step.operation?.replaceAll("_"," ")||__("ERPNext action");
  if(step.kind==="outgoing_webhook"){try{return JSON.parse(step.configJson).url||__("Configure HTTP request")}catch{return __("Configure HTTP request")}}
  if (step.kind === "noop") return step.label;
  if (step.kind === "log") return step.message;
  if (step.kind === "create_note") return step.title || __("Untitled note");
  if (step.kind === "create_task") return step.title || __("Untitled task");
  if (step.kind === "update_record") {
    return `${step.entityType}.${step.field} = ${step.value || __("value")}`;
  }
  if (step.kind === "send_notification") return `${step.channel}: ${step.message}`;
  if (step.kind === "wait") return formatDuration(step.durationMinutes);
  if (step.kind === "if_else") {
    return step.branches.length === 1 ? __("1 branch + none") : __("{0} branches + none", [step.branches.length]);
  }
  if (step.kind === "go_to") {
    return step.targetStepIndex === undefined
      ? __("Choose destination")
      : __("Go to Action {0}", [step.targetStepIndex + 1]);
  }
  return step.subject || __("Email");
}
