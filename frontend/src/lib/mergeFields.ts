import {__} from './i18n';
export type MergeFieldOption = {
  path: string;
  label: string;
  group: string;
  description: string;
};

export const MERGE_FIELD_OPTIONS: Array<MergeFieldOption> = [
 {path:"trigger.name",label:__("Document name"),group:__("ERPNext / Webhook"),description:__("Name from the incoming payload")},
 {path:"trigger.customer",label:__("Customer"),group:__("ERPNext / Webhook"),description:__("Customer from the incoming payload")},
 {path:"trigger.doctype",label:__("DocType"),group:__("ERPNext / Webhook"),description:__("Incoming document type")},
 {path:"trigger.status",label:__("Status"),group:__("ERPNext / Webhook"),description:__("Incoming document status")},
  {
    path: "contact.name",
    label: __("Contact name"),
    group: __("Contact"),
    description: __("Full contact name"),
  },
  {
    path: "contact.firstName",
    label: __("Contact first name"),
    group: __("Contact"),
    description: __("First word of the contact name"),
  },
  {
    path: "contact.lastName",
    label: __("Contact last name"),
    group: __("Contact"),
    description: __("Remaining contact name"),
  },
  {
    path: "contact.email",
    label: __("Contact email"),
    group: __("Contact"),
    description: __("Primary email address"),
  },
  {
    path: "contact.title",
    label: __("Contact title"),
    group: __("Contact"),
    description: __("Role or job title"),
  },
  {
    path: "contact.custom.FIELD_KEY",
    label: __("Contact custom field"),
    group: __("Contact"),
    description: __("Replace FIELD_KEY with the custom field key"),
  },
  {
    path: "company.name",
    label: __("Company name"),
    group: __("Company"),
    description: __("Linked company name"),
  },
  {
    path: "company.domain",
    label: __("Company domain"),
    group: __("Company"),
    description: __("Website domain"),
  },
  {
    path: "company.industry",
    label: __("Company industry"),
    group: __("Company"),
    description: __("Industry value"),
  },
  {
    path: "company.custom.FIELD_KEY",
    label: __("Company custom field"),
    group: __("Company"),
    description: __("Replace FIELD_KEY with the custom field key"),
  },
  {
    path: "deal.name",
    label: __("Deal name"),
    group: __("Deal"),
    description: __("Opportunity name"),
  },
  {
    path: "deal.stage",
    label: __("Deal stage"),
    group: __("Deal"),
    description: __("Current deal stage"),
  },
  {
    path: "deal.amount",
    label: __("Deal amount"),
    group: __("Deal"),
    description: __("Formatted amount and currency"),
  },
  {
    path: "task.title",
    label: __("Task title"),
    group: __("Task"),
    description: __("Current task title"),
  },
  {
    path: "task.dueDate",
    label: __("Task due date"),
    group: __("Task"),
    description: __("Due date when set"),
  },
  {
    path: "task.status",
    label: __("Task status"),
    group: __("Task"),
    description: __("Current task status"),
  },
  {
    path: "owner.name",
    label: __("Owner name"),
    group: __("Owner"),
    description: __("Assigned teammate name"),
  },
  {
    path: "owner.email",
    label: __("Owner email"),
    group: __("Owner"),
    description: __("Assigned teammate email"),
  },
  {
    path: "workflow.name",
    label: __("Workflow name"),
    group: __("Automation"),
    description: __("Running workflow name"),
  },
  {
    path: "system.today",
    label: __("Today"),
    group: __("System"),
    description: __("Current date"),
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
