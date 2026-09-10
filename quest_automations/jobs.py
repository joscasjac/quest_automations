import hashlib,time
import frappe
from .store import Store,names,load,put
from .core.graph import event_trigger
from .core.definition import trigger_list,DefinitionError

def wake():
    frappe.enqueue('quest_automations.jobs.drain',queue='long',timeout=900,enqueue_after_commit=True)

def document_event(doc,method):
    if doc.doctype in ('Automation Record','Error Log','Scheduled Job Log','Activity Log'):return
    active=names('Workflow',{'status':'active'},limit=10000)
    if not any(any(event_trigger(t).get('doctype')==doc.doctype and event_trigger(t).get('event')==method for t in trigger_list(load(name)['published'])) for name in active):return
    payload=doc.as_dict()
    for f in doc.meta.fields:
        if f.fieldtype=='Password':payload.pop(f.fieldname,None)
    previous=doc.get_doc_before_save()
    if previous:
        payload['previous']={k:v for k,v in previous.as_dict().items() if k in payload and k!='previous'}
    payload['event']=method
    frappe.enqueue('quest_automations.jobs.receive_document',payload=payload,queue='long',enqueue_after_commit=True)

def receive_document(payload):
    original=frappe.session.user;store=Store()
    try:
        for name in names('Workflow',{'status':'active'},limit=10000):
            workflow=store.workflow(name)
            for trigger in trigger_list(workflow['published']):
                event=event_trigger(trigger)
                if event.get('kind')!='document_event' or event.get('doctype')!=payload['doctype'] or event.get('event')!=payload['event']:continue
                frappe.set_user(workflow['run_as'])
                try:
                    frappe.get_doc(payload['doctype'],payload['name']).check_permission('read')
                    key=hashlib.sha256(str((payload['doctype'],payload['name'],payload['modified'],payload['event'])).encode()).hexdigest()
                    store.enqueue(name,payload,'document:'+key,'document_event',trigger['id'])
                except (frappe.PermissionError,DefinitionError):
                    frappe.log_error(title='Automation trigger rejected',message='Check the publishing user permissions for workflow '+name)
                finally:frappe.set_user(original)
        wake()
    finally:frappe.set_user(original)

def drain():
    # Lock is scoped to this site and expires after the job's hard timeout.
    with frappe.cache.lock('quest_automations_worker:'+frappe.local.site,timeout=960,blocking_timeout=1):
        store=Store();original=frappe.session.user;started=time.monotonic()
        # A previous worker holding this lock cannot still be executing.
        for name in names('Run',{'status':'running'},limit=10000):
            r=load(name);r.update(status='needs_attention',error='Worker stopped during execution. Inspect destination before retrying.');put(name,'Run',r,r['workflow_id'])
        frappe.db.commit()
        while time.monotonic()-started<600:
            store.enqueue_schedules();run=store.claim()
            if not run:frappe.db.commit();break
            try:
                user=run.get('run_as')
                if not user or not frappe.db.get_value('User',user,'enabled') or 'System Manager' not in frappe.get_roles(user):raise DefinitionError('The publishing user must be an enabled System Manager')
                frappe.set_user(user)
                if run['definition'].get('schemaVersion')==2:
                    from .core.graph import process
                    process(run,store)
                else:raise DefinitionError('Save this legacy workflow in the editor to upgrade before running')
            except Exception:
                frappe.db.rollback();store.checkpoint(run,'needs_attention',error='Execution stopped. Inspect the destination and server error log.');frappe.log_error(title='Automation execution failed')
            finally:frappe.set_user(original)
