# Run AI Capability

A capability is data in **Quest AI Capability**: a stable key, instructions, input schema, output schema and sample input. Edit these live; no asset build, Python change or deployment is required for another summary, classifier, extractor or draft generator using the supported JSON formats. The connected ChatGPT account and selected model are reused.

## Create, test, publish

1. Create a capability or duplicate a starter. Give it a lowercase key such as `meeting-summary`.
2. Write instructions and define exactly the data the job needs. Input and output schemas use strict JSON objects. Supported field types: string, number, integer, boolean, null, object and array; optional scalar enums and descriptions. All object fields are required and additionalProperties must be false. References, arbitrary schema extensions and code are unsupported.
3. Add invented test input. **Test draft** can run unsaved instructions. It consumes ChatGPT allowance and creates one **Quest AI Run** debug record, but executes no CRM, email or downstream workflow action. Open the result and use **Refresh result** while it processes.
4. Save your edits. Workflows continue using the previous published revision. **Publish capability** validates and snapshots the saved definition. Native change history preserves previous values; copy them back, test and republish to roll back. **Enabled for workflows** pauses new uses without deleting history.
5. In the visual editor add **Run AI Capability**, choose the published capability and map its input fields. The result fields appear in the later-action data picker. The list comes from the live site; use **Refresh capabilities** after publishing another definition.

A new capability using these inputs/outputs needs no rebuild. New integrations, modalities, schema vocabulary or privileged backend operations can still require app code.

## Workflow contract

```json
{
  "kind": "run_ai_capability",
  "label": "Summarize meeting",
  "configJson": "{\"capability\":\"meeting-summary\",\"input\":{\"notes\":{\"$ref\":\"trigger.notes\"}}}"
}
```

Output is `{run, capability, revision, definition_hash, model, data}`. Read a summary at `steps.step_0.data.summary`, or use a typed `$ref`. Optional `revision` pins the current published revision; the action fails if that revision is no longer live. Without a pin, each new execution uses the current published definition. Completed retries reuse the captured result, never regenerate under newly published instructions.

The action uses the current owner/publishing user and normal document permissions. It receives only mapped input, performs no hidden CRM search, cannot access credentials and has no model tools. Use normal Get document/field mappings to supply approved business fields. Credential-named fields, oversized input/output and values outside the declared format are rejected.

## Review and debugging

The runner returns content only. Existing note/task/update actions can consume the validated output under the workflow's normal permissions. Customer email drafts need a separate human-reviewed sending process. Workflows containing this AI action cannot use Send email for customers; only a fixed notification to Joseph without CC/BCC is allowed. Cancellation-specific approvals remain enforced by the existing server methods.

AI Run records capture inputs, the exact definition, published revision (zero for an unsaved test), model, duration, validated output and a sanitized notice on failure. Run history cannot be edited or forged through ordinary document updates. A workflow/run/step key prevents duplicate inference; a repeated test request ID returns the same run. Failed or interrupted executions must be inspected rather than silently retried. Never treat queued/running state as completed AI output.

All provider responses must reach the completed stream event and pass local output validation before downstream actions resume. Partial, refused, oversized or malformed responses stop the step. Provider tokens and raw error responses are never stored in run history. Changing credentials, permissions, human approval or transactional sending still belongs in tested app code.

## Installation and recovery

The migration seeds three starters as drafts: Meeting summary, Inquiry triage, Email draft for review. It also seeds native Client Scripts for the capability editor and run viewer. Existing records/scripts are never overwritten. The runner UI scripts can be edited live like the review workspace. Export verified live changes to Git; disable a broken Client Script and reload to use the native record form.

Official transport and output contracts: [Sign in with ChatGPT inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) and [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
