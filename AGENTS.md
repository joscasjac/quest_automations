# Deployment and live maintenance

Prefer site data for changes that need frequent iteration. Reuse Quest Automations for triggers, routing, field mappings and run history. Reuse native Client Scripts/Custom Fields for site-specific review UI and Quest Followup Playbook for cancellation drafting policy. Never require an asset build for copy, layout, prompts, booking links or signatures.

Keep credential handling, permission checks, approval hashes, transactional sending, duplicate prevention and schema changes in tested app code. Do not add arbitrary Python/eval, bypass protected states or move approval enforcement into browser code. New privileged capabilities need an app deployment; ordinary configuration changes should not.

Before live edits: read/export the current record, validate locally, use native APIs, then verify in the browser. Export the resulting script/settings to source control as a recoverable snapshot. Migration seeds must create missing defaults only and never overwrite live edits. Use failed-draft retry and the no-send playbook sandbox to debug. Do not create real customer emails during debugging.

Batch backend changes into one tested release. Push the completed release, deploy only Quest Automations to the existing private bench, confirm site migration success, then perform one end-to-end verification. Avoid sequential speculative deployments.

For new AI jobs, use **Quest AI Capability** plus the **Run AI Capability** graph action. Define instructions, strict input/output JSON formats, and a sample; Test draft, save and publish the capability. Do not add a Python function per summarizer/classifier/extractor/draft generator. Use `docs/ai-capabilities.md` and the live catalog. A test produces an inspectable Quest AI Run only. Do not map AI content into unattended customer mail or protected approval fields.
