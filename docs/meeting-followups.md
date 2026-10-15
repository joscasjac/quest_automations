# Contextual cancellation follow-ups

The private Quest Media Hub ERPNext agent runs on the existing Frappe Cloud private bench, using Frappe's long background queue. It does not require the owner's laptop after initial sign-in.

## ChatGPT connection

Open **Quest ChatGPT Connection** in Desk as joseph@questmediahub.com and choose **Continue with ChatGPT** to create the persistent cloud host ID. Run `scripts/connect-chatgpt.py` on the computer running the browser, with that host ID, and an owner-only output file:

```sh
python scripts/connect-chatgpt.py --host-id urn:uuid:HOST --output /private/tmp/quest-registration.json
```

The helper requires the app's `requests` and `PyJWT[crypto]` dependencies. Open its printed official authorization URL and complete consent yourself. For reauthorization pass `--client-id` with the saved issued registration ID. The helper validates the signature, issuer, audience, expiry, nonce, scopes and host ID before saving. Import the resulting protected JSON using **Import protected registration**, which transmits it directly to the authenticated ERPNext method without creating a File record or using browser storage. Remove the temporary file after verification.

The app uses the documented dynamic Sign in with ChatGPT registration and public Responses endpoint, not Hermes's or Codex's client identity or private ChatGPT backend. The account must be eligible and grant ChatGPT plan usage. Registration availability is determined by OpenAI. It never falls back to separately billed API usage. The account-specific model catalog determines available models; the chosen model is visible in settings. Tokens are encrypted in a Password field, readable only by server code, and refreshes are serialized. Disconnect attempts remote revocation and reports an unconfirmed revocation.

Official contract: https://developers.openai.com/siwc/token-sharing-open-source/sign-in and https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference. Follow applicable eligibility requirements; the direct OSS registration is not a commercial hosted sign-in client.

## Cancellation workflow

The Cal.com webhook must first match the current booking UID, ignore reschedule-request cancellations and superseded UIDs, mark the same private Event as Cancelled, then create one **Quest Meeting Followup** with the booking UID and reason. Its unique booking UID prevents duplicate tasks. Record creation verifies that the Event is currently cancelled and linked to a readable CRM Lead or Contact, derives its recipient from CRM, creates a CRM Task, and enqueues drafting after commit.

The draft uses bounded linked FCRM Notes (including Fathom notes), meeting/intake details and matching website inquiries. CRM text and transcripts are untrusted evidence. It recommends rescheduling, clarification, a commercial proposal when scope supports one, or no follow-up when contact was declined. The model has no tools, sending authority or access to ChatGPT conversations. It cannot invent commercial terms.

Joseph receives the recommendation and draft from the notifications account, with an authenticated Desk review link. Opening a link never sends email. **Review & send** saves edits and previews the exact recipient, sender, subject and body. The POST approval checks the current booking state, current CRM email, owner identity, draft digest and state under a database lock. It creates the Communication and queued email in the same database transaction, then marks the task Done. Repeated approval returns the existing result. Queued is not proof of delivery; verify Email Queue separately. **Close without sending** closes the task without sending.

Drafts recommending no follow-up cannot be sent through this action. Editing is allowed only for the subject and body while a draft awaits review. State, recipient, task and approval fields can only be changed by server code. When ChatGPT is disconnected or unavailable, the task and draft record remain visible for review/retry; no prospect email is sent.

## Verification

`python -m unittest discover -s tests -p test_chatgpt_followups.py -v` verifies cryptographic identity checks, host/scope/account/nonce mismatches, incomplete and failed streams, completed structured drafts, changed preview/recipient/meeting guards and double approval idempotence. A real Frappe smoke test and owner sign-in are required before considering the integration live.

## Live editing and debugging

Use **Quest Followup Playbook** to change drafting instructions, the booking page, signature and review introduction without a rebuild. **Test instructions** accepts unsaved values and an invented scenario, returning a preview without creating CRM records or sending email. Each generated follow-up stores the policy revision and values used. Native change history and exported Client Scripts provide rollback material. The review workspace itself is a site Client Script, so UI iteration also needs no asset build. See [Live maintenance](live-maintenance.md) for the operational procedure and the changes that still need an app release.
