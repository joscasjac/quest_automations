"""Actions, run context and exit rules that other apps add to workflows.

An app lists modules in the `quest_automation_extensions` hook. Each module may define:

- ACTIONS: {operation: {label, description, required, optional, types}}. Steps use them as
  `{"kind": "erpnext", "operation": <operation>, "configJson": ...}`, like Pulse actions.
- validate(operation, config): raise ValueError for a bad configuration.
- execute(operation, config, context, run_id, step_id): run the action; returns its output.
- enrich(context, run): add live data to the context before each step (conditions read it).
- stop_reason(run): a reason to end this run now (for example, the person replied), or None.
- finished(run): told when a run ends, whatever the outcome.
- TRIGGERS: {kind: {label, description}} for triggers that other apps start with `enroll`.

This module imports nothing from Frappe at load time, so the portable core stays testable.
"""
import importlib


def modules():
	try:
		import frappe

		paths = frappe.get_hooks('quest_automation_extensions') or []
	except Exception:
		return []
	found = []
	for path in paths:
		try:
			found.append(importlib.import_module(path))
		except ImportError:
			continue
	return found


def actions():
	merged = {}
	for module in modules():
		merged.update(getattr(module, 'ACTIONS', {}) or {})
	return merged


def triggers():
	merged = {}
	for module in modules():
		merged.update(getattr(module, 'TRIGGERS', {}) or {})
	return merged


def owner(operation):
	for module in modules():
		if operation in (getattr(module, 'ACTIONS', {}) or {}):
			return module
	return None


def validate_action(operation, config):
	module = owner(operation)
	if module is not None and hasattr(module, 'validate'):
		module.validate(operation, config)


def execute(operation, config, context, run_id, step_id):
	module = owner(operation)
	if module is None:
		raise ValueError('Unsupported action: ' + operation)
	return module.execute(operation, config, context, run_id, step_id)


def enrich(context, run):
	for module in modules():
		if hasattr(module, 'enrich'):
			module.enrich(context, run)


def stop_reason(run):
	for module in modules():
		if hasattr(module, 'stop_reason'):
			reason = module.stop_reason(run)
			if reason:
				return reason
	return None


def finished(run):
	for module in modules():
		if hasattr(module, 'finished'):
			try:
				module.finished(run)
			except Exception:
				try:
					import frappe

					frappe.log_error(title='Automation extension failed after a run')
				except Exception:
					pass
