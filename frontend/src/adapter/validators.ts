import {v} from "convex/values";
// Deal stages carried over from upstream.
export const dealStage = v.union(
  v.literal("QUALIFIED"),
  v.literal("MEETING"),
  v.literal("PROPOSAL"),
  v.literal("NEGOTIATION"),
  v.literal("CLOSED_WON"),
  v.literal("CLOSED_LOST"),
);

export const activityType = v.union(
  v.literal("NOTE"),
  v.literal("CALL"),
  v.literal("EMAIL"),
  v.literal("MEETING"),
  v.literal("TASK"),
  v.literal("STAGE_CHANGE"),
  v.literal("ENRICHMENT"),
);

export const projectStatus = v.union(
  v.literal("planned"),
  v.literal("active"),
  v.literal("on_hold"),
  v.literal("completed"),
  v.literal("archived"),
);

export const taskStatus = v.union(
  v.literal("backlog"),
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("blocked"),
  v.literal("done"),
  v.literal("canceled"),
);

export const taskPriority = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("urgent"),
);

export const dashboardWidgetKind = v.union(
  v.literal("pipeline_totals"),
  v.literal("pipeline_by_stage"),
  v.literal("overdue_tasks"),
  v.literal("owner_workload"),
  v.literal("stale_records"),
  v.literal("recent_activity"),
  v.literal("sync_health"),
);

export const workflowStatus = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("paused"),
  v.literal("archived"),
);

export const workflowConditionOperator = v.union(
  v.literal("is"),
  v.literal("is_not"),
  v.literal("contains"),
  v.literal("does_not_contain"),
  v.literal("is_empty"),
  v.literal("is_not_empty"),
);

export const workflowTriggerFilter = v.object({
  field: v.string(),
  operator: workflowConditionOperator,
  value: v.string(),
});

export const workflowTrigger = v.union(
  v.object({ kind: v.literal("manual") }),
  v.object({
    kind: v.literal("schedule"),
    intervalMinutes: v.number(),
  }),
  v.object({
    kind: v.literal("record"),
    entityType: v.union(
      v.literal("company"),
      v.literal("contact"),
      v.literal("deal"),
      v.literal("project"),
      v.literal("task"),
      v.literal("note"),
    ),
    event: v.union(
      v.literal("created"),
      v.literal("updated"),
      v.literal("stage_changed"),
      v.literal("status_changed"),
    ),
    filters: v.optional(v.array(workflowTriggerFilter)),
  }),
);

const workflowNoopStep = v.object({
    kind: v.literal("noop"),
    label: v.string(),
  });
const workflowLogStep = v.object({
    kind: v.literal("log"),
    label: v.string(),
    message: v.string(),
  });
const workflowCreateNoteStep = v.object({
    kind: v.literal("create_note"),
    label: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
    contactId: v.optional(v.id("contacts")),
    dealId: v.optional(v.id("deals")),
  });
const workflowCreateTaskStep = v.object({
    kind: v.literal("create_task"),
    label: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.optional(taskStatus),
    priority: v.optional(taskPriority),
    projectId: v.optional(v.id("projects")),
    parentTaskId: v.optional(v.id("projectTasks")),
    assigneeId: v.optional(v.id("users")),
    companyId: v.optional(v.id("companies")),
    contactId: v.optional(v.id("contacts")),
    dealId: v.optional(v.id("deals")),
    dueOffsetDays: v.optional(v.number()),
  });
const workflowUpdateRecordStep = v.object({
    kind: v.literal("update_record"),
    label: v.string(),
    entityType: v.union(
      v.literal("company"),
      v.literal("contact"),
      v.literal("deal"),
      v.literal("project"),
      v.literal("task"),
    ),
    recordId: v.string(),
    field: v.string(),
    value: v.string(),
  });
const workflowSendNotificationStep = v.object({
    kind: v.literal("send_notification"),
    label: v.string(),
    channel: v.union(v.literal("activity"), v.literal("slack")),
    message: v.string(),
    slackEvent: v.optional(
      v.union(
        v.literal("records"),
        v.literal("deals"),
        v.literal("tasks"),
        v.literal("agent"),
      ),
    ),
  });
const workflowSendEmailStep = v.object({
    kind: v.literal("send_email"),
    label: v.string(),
    to: v.string(),
    subject: v.string(),
    body: v.string(),
  });
const workflowWaitStep = v.object({
    kind: v.literal("wait"),
    label: v.string(),
    durationMinutes: v.number(),
  });
const workflowGoToStep = v.object({
    kind: v.literal("go_to"),
    label: v.string(),
    targetStepIndex: v.optional(v.number()),
  });

export const workflowBranchStep = v.union(
  workflowNoopStep,
  workflowLogStep,
  workflowCreateNoteStep,
  workflowCreateTaskStep,
  workflowUpdateRecordStep,
  workflowSendNotificationStep,
  workflowSendEmailStep,
  workflowWaitStep,
  workflowGoToStep,
);

export const workflowStep = v.union(
  workflowBranchStep,
  workflowGoToStep,
  v.object({
    kind: v.literal("if_else"),
    label: v.string(),
    branches: v.array(
      v.object({
        name: v.string(),
        field: v.string(),
        operator: workflowConditionOperator,
        value: v.string(),
        steps: v.optional(v.array(workflowBranchStep)),
      }),
    ),
    elseLabel: v.string(),
    elseSteps: v.optional(v.array(workflowBranchStep)),
  }),
);

export const workflowRunStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("canceled"),
);

