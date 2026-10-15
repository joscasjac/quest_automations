# Live maintenance

The site database is the runtime source for site-specific UI and policy. Git contains recoverable defaults, not a migration that repeatedly overwrites live changes.

| Change | Live surface | Deployment |
| --- | --- | --- |
| Review layout, labels, CSS, interaction | Client Script: Quest Follow-up Review | Save, refresh the page |
| Draft instructions, signature, booking link, review introduction | Quest Followup Playbook | Save; applies to future drafts |
| Trigger, routing, CRM mapping, notification workflow | Quest Automations visual editor | Validate/test, publish |
| ChatGPT model | Quest ChatGPT Connection | Select available model |
| New server capability, credentials, approval, permissions, schema | Tested custom app | One batched Frappe Cloud release |

## Test and recover

1. Read/export the current live document before editing. Keep the original as a backup.
2. Use **Test instructions** in the playbook to generate from an invented scenario. It uses the connected ChatGPT allowance, but creates no meeting, task, review notification or customer email. Unsaved playbook changes are supported.
3. Save a validated playbook when ready. Native change history records changes. To roll back, copy the previous values from that history into the form and save. Existing drafts retain the policy snapshot used for generation.
4. UI changes live in the native Client Script. Export the script after a verified change. To roll back, restore the previous script backup and refresh. Disable this script to recover the original native record form; server approval protections remain active.
5. Review failures using the per-draft notice, model, policy revision, linked meeting and supporting evidence. **Prepare draft again** retries waiting/failed drafts only. Queued emails are never regenerated or resent by the retry action.
6. Review & send saves edits and obtains a server-signed content hash for the confirmation. Only the separate Approve & send action queues the email. Senders, current cancellation/recipient checks and duplicate prevention are server-controlled.

Future tools should reuse this separation: live workflow + validated data-only playbook + site-specific Client Script, with small stable app methods for privileged operations. Adding a genuinely new server capability may still need deployment. This is not a promise that every code change can run without a release.

## Installation

`after_migrate` seeds missing live fields/scripts and playbook values once. It never replaces an existing Client Script or a nonempty playbook value. The packaged default review UI is `quest_automations/live/followup-review.js`.
