export type MergeFieldOption = {
  path: string;
  label: string;
  group: string;
  description: string;
};

export const MERGE_FIELD_OPTIONS: Array<MergeFieldOption> = [
 {path:"trigger.name",label:"Document name",group:"ERPNext / Webhook",description:"Name from the incoming payload"},
 {path:"trigger.customer",label:"Customer",group:"ERPNext / Webhook",description:"Customer from the incoming payload"},
 {path:"trigger.doctype",label:"DocType",group:"ERPNext / Webhook",description:"Incoming document type"},
 {path:"trigger.status",label:"Status",group:"ERPNext / Webhook",description:"Incoming document status"},
  {
    path: "contact.name",
    label: "Contact name",
    group: "Contact",
    description: "Full contact name",
  },
  {
    path: "contact.firstName",
    label: "Contact first name",
    group: "Contact",
    description: "First word of the contact name",
  },
  {
    path: "contact.lastName",
    label: "Contact last name",
    group: "Contact",
    description: "Remaining contact name",
  },
  {
    path: "contact.email",
    label: "Contact email",
    group: "Contact",
    description: "Primary email address",
  },
  {
    path: "contact.title",
    label: "Contact title",
    group: "Contact",
    description: "Role or job title",
  },
  {
    path: "contact.custom.FIELD_KEY",
    label: "Contact custom field",
    group: "Contact",
    description: "Replace FIELD_KEY with the custom field key",
  },
  {
    path: "company.name",
    label: "Company name",
    group: "Company",
    description: "Linked company name",
  },
  {
    path: "company.domain",
    label: "Company domain",
    group: "Company",
    description: "Website domain",
  },
  {
    path: "company.industry",
    label: "Company industry",
    group: "Company",
    description: "Industry value",
  },
  {
    path: "company.custom.FIELD_KEY",
    label: "Company custom field",
    group: "Company",
    description: "Replace FIELD_KEY with the custom field key",
  },
  {
    path: "deal.name",
    label: "Deal name",
    group: "Deal",
    description: "Opportunity name",
  },
  {
    path: "deal.stage",
    label: "Deal stage",
    group: "Deal",
    description: "Current deal stage",
  },
  {
    path: "deal.amount",
    label: "Deal amount",
    group: "Deal",
    description: "Formatted amount and currency",
  },
  {
    path: "task.title",
    label: "Task title",
    group: "Task",
    description: "Current task title",
  },
  {
    path: "task.dueDate",
    label: "Task due date",
    group: "Task",
    description: "Due date when set",
  },
  {
    path: "task.status",
    label: "Task status",
    group: "Task",
    description: "Current task status",
  },
  {
    path: "owner.name",
    label: "Owner name",
    group: "Owner",
    description: "Assigned teammate name",
  },
  {
    path: "owner.email",
    label: "Owner email",
    group: "Owner",
    description: "Assigned teammate email",
  },
  {
    path: "workflow.name",
    label: "Workflow name",
    group: "Workflow",
    description: "Running workflow name",
  },
  {
    path: "system.today",
    label: "Today",
    group: "System",
    description: "Current date",
  },
];

export const MERGE_FIELD_PATTERN =
  /{{\s*([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+){0,5})\s*}}/g;

const KNOWN_PATHS = new Set(MERGE_FIELD_OPTIONS.map((option) => option.path));

export function mergeFieldKnown(path: string) {
  if (KNOWN_PATHS.has(path) || /^(trigger|steps)\.[A-Za-z0-9_.]+$/.test(path)) return true;
  return /^[a-z][A-Za-z0-9_]*\.custom\.[A-Za-z0-9_]+$/.test(path);
}

export function hasMergeField(value: string) {
  MERGE_FIELD_PATTERN.lastIndex = 0;
  return MERGE_FIELD_PATTERN.test(value);
}

export function activeMergeFieldQuery(value: string, caretIndex: number) {
  const beforeCaret = value.slice(0, caretIndex);
  const openIndex = beforeCaret.lastIndexOf("{{");
  if (openIndex === -1) return null;
  const closeIndex = beforeCaret.lastIndexOf("}}");
  if (closeIndex > openIndex) return null;
  const rawQuery = beforeCaret.slice(openIndex + 2);
  if (rawQuery.includes("\n")) return null;
  return {
    openIndex,
    query: rawQuery.trim(),
  };
}

export function mergeFieldSuggestions(query: string, options: MergeFieldOption[] = MERGE_FIELD_OPTIONS.filter(o=>o.path.startsWith("trigger.")||o.path.startsWith("system.")||o.path.startsWith("workflow."))) {
  const normalized = query.toLowerCase();
  return options.filter((option) => {
    if (!normalized) return true;
    return (
      option.path.toLowerCase().includes(normalized) ||
      option.label.toLowerCase().includes(normalized) ||
      option.group.toLowerCase().includes(normalized)
    );
  }).slice(0, 8);
}

export function insertMergeField(
  value: string,
  caretIndex: number,
  option: MergeFieldOption,
) {
  const active = activeMergeFieldQuery(value, caretIndex);
  const start = active?.openIndex ?? caretIndex;
  const next = value.slice(caretIndex, caretIndex + 1);
  const token = `{{${option.path}}}`;
  const suffix = next && !/\s|[.,;:!?)]/.test(next) ? " " : "";
  const nextValue = `${value.slice(0, start)}${token}${suffix}${value.slice(caretIndex)}`;
  const nextCaret = start + token.length + suffix.length;
  return { value: nextValue, caretIndex: nextCaret };
}
