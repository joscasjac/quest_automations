import hashlib,time
import frappe
from .store import Store,names,load,put,TRIGGER_CACHE
from .core.graph import event_trigger
from .core.definition import trigger_list,DefinitionError

def wake():
    frappe.enqueue('quest_automations.jobs.drain',queue='long',timeout=900,enqueue_after_commit=True)

def event_triggers():
    """doctype → events that some active workflow listens to. document_event runs on every save of
    every record, so this is read from Redis; store.put/delete clear it when a workflow changes."""
    cached=frappe.cache.get_value(TRIGGER_CACHE)
    if cached is not None:return cached
    out={}
    for name in names('Workflow',{'status':'active'},limit=10000):
        try:published=load(name).get('published')
        except KeyError:continue
        if not published:continue
        for t in trigger_list(published):
            e=event_trigger(t)
            if e.get('doctype') and e.get('event'):out.setdefault(e['doctype'],set()).add(e['event'])
    out={k:sorted(v) for k,v in out.items()}
    frappe.cache.set_value(TRIGGER_CACHE,out,expires_in_sec=600)
    return out

def document_event(doc,method):
    if doc.doctype in ('Automation Record','Error Log','Scheduled Job Log','Activity Log'):return
    if method not in event_triggers().get(doc.doctype,()):return
    payload=doc.as_dict()
    for f in doc.meta.fields:
        if f.fieldtype=='Password':payload.pop(f.fieldname,None)
    previous=doc.get_doc_before_save()
    if previous:
        payload['previous']={k:v for k,v in previous.as_dict().items() if k in payload and k!='previous'}
    payload['event']=method
    frappe.enqueue('quest_automations.jobs.receive_document',payload=payload,ancestry=list(getattr(frappe.flags, 'automation_ancestry', None) or []),queue='long',enqueue_after_commit=True)

def _visible_event(payload):
    """Filter the captured event under the publishing user's field permissions."""
    def snapshot(value):
        doc = frappe.get_doc({key: item for key, item in value.items() if key not in ('previous', 'event')})
        doc.apply_fieldlevel_read_permissions()
        result = doc.as_dict()
        for field in doc.meta.fields:
            if field.fieldtype == 'Password':
                result.pop(field.fieldname, None)
        return result
    visible = snapshot(payload)
    if payload.get('previous'):
        visible['previous'] = snapshot(payload['previous'])
    visible['event'] = payload['event']
    return visible


def receive_document(payload, ancestry=None):
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
                    store.enqueue(name,_visible_event(payload),'document:'+key,'document_event',trigger['id'],ancestry=ancestry)
                except DefinitionError as exc:
                    frappe.log_error(title='Automation trigger rejected',message='Workflow '+name+': '+str(exc))
                except frappe.PermissionError:
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
            previous_ancestry = getattr(frappe.flags, 'automation_ancestry', None)
            try:
                frappe.flags.automation_ancestry = [*run.get('ancestry', []), run['workflow_id']]
                user=run.get('run_as')
                from .store import EDITOR_ROLES,check_author
                if not user or not frappe.db.get_value('User',user,'enabled') or not set(EDITOR_ROLES)&set(frappe.get_roles(user)):raise DefinitionError('The publishing user must be an enabled System Manager or Sales Manager')
                check_author(run['definition'],user)
                frappe.set_user(user)
                if run['definition'].get('schemaVersion')==2:
                    from .core.graph import process
                    process(run,store)
                else:raise DefinitionError('Save this legacy workflow in the editor to upgrade before running')
            except Exception:
                frappe.db.rollback();store.checkpoint(run,'needs_attention',error='Execution stopped. Inspect the destination and server error log.');frappe.log_error(title='Automation execution failed')
            finally:
                frappe.flags.automation_ancestry = previous_ancestry
                frappe.set_user(original)
