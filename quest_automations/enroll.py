"""Adding CRM records to a workflow that has a "From the CRM" trigger.

Used by the CRM (crm_campaigns), the editor API and FAC. Whoever adds people needs read access to
each record; the run itself executes as the user who published the workflow.
"""
import frappe

from .core.definition import DefinitionError
from .store import Store

MAX = 5000


def snapshot(doctype, name):
	doc = frappe.get_doc(doctype, name)
	doc.check_permission('read')
	doc.apply_fieldlevel_read_permissions()
	data = doc.as_dict()
	for field in doc.meta.fields:
		if field.fieldtype == 'Password':
			data.pop(field.fieldname, None)
	return frappe.parse_json(frappe.as_json(data))


def enroll(workflow_id, doctype, names, trigger_id=None):
	if doctype not in ('CRM Lead', 'CRM Deal'):
		raise DefinitionError('Add leads or deals')
	if isinstance(names, str):
		names = frappe.parse_json(names) if names.startswith('[') else [names]
	if not isinstance(names, list) or not names or len(names) > MAX:
		raise DefinitionError(f'Add 1–{MAX} records')
	store = Store()
	added, already, failed = [], [], []
	for name in dict.fromkeys(n for n in names if isinstance(n, str) and n):
		try:
			run = store.enroll(workflow_id, doctype, name, snapshot(doctype, name), trigger_id)
		except frappe.PermissionError:
			failed.append({'name': name, 'error': 'No permission'})
			continue
		(already if run.get('already') else added).append({'name': name, 'run': run['id']})
	if added:
		from .jobs import wake

		wake()
	return {'added': added, 'already': already, 'failed': failed}


def cancel(run_id, reason):
	return Store().cancel(run_id, reason)
