# Quest Automations

Frappe/ERPNext v16 custom application. Installs the complete visual automation editor at `/automations`, using Frappe session/API authentication, site database storage, native document events and background workers. Access is restricted to System Managers. Actions run as the user who published the workflow and respect that user's ERPNext permissions.

Install from this repository on a Frappe Cloud private bench, deploy the bench, then install `quest_automations` on the site. The site scheduler must be enabled. No additional ERPNext API key or SMTP connection is needed inside the app. Workflows are initially drafts; installing does not activate local workflows.

API: `/api/method/quest_automations.api.dispatch` accepts `path` (the existing `api/v1/...` path), `method`, and `body`. Frappe session clients send the CSRF token. AI/API clients use normal Frappe API-token authentication belonging to a System Manager.

Incoming webhook: `/api/method/quest_automations.api.webhook?workflow_id=...&trigger_id=...`. Use `X-Automation-Secret` for webhook authentication (not the ERPNext user token). Test capture adds `test=1` and uses its separate test secret. Native document triggers need no manually configured ERPNext Webhook record.

Runs and configurations are stored in the site's Automation Record DocType and included in normal database backups. Running jobs interrupted before a checkpoint are marked needs_attention, never automatically replayed. Minute-resolution scheduler polling supports delayed actions and schedules. External HTTP requests retain the existing HTTPS, DNS, redirect, body-size and timeout protections.

JavaScript requires quickjs-ng and subprocess support in the bench environment. It runs in a separate constrained process. See the app's runtime tests before enabling production code actions.
