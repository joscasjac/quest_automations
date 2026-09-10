from pathlib import Path
"""Authenticated editor/AI API and separately authenticated incoming webhooks."""
import hashlib,hmac,json
from urllib.parse import urlsplit,parse_qs,unquote,urlencode
import frappe
from .store import Store
from .core.definition import DefinitionError,validate,select_trigger,EVENTS
from .core.engine import preview
from .core.graph import KINDS
from .native import erp_doctypes,erp_metadata,erp_email_accounts,erp_files

def has_access():return frappe.session.user!='Guest' and 'System Manager' in frappe.get_roles()
def require_access():
    if not has_access():frappe.throw('System Manager access is required',frappe.PermissionError)
def endpoint(workflow_id,trigger_id,test=False):
    query={'workflow_id':workflow_id,'trigger_id':trigger_id}
    if test:query['test']='1'
    return frappe.utils.get_url()+'/api/method/quest_automations.api.webhook?'+urlencode(query)

@frappe.whitelist(methods=['GET','POST'])
def dispatch(path='',method='GET',body=None):
    require_access();store=Store();method=method.upper();body=json.loads(body) if isinstance(body,str) else body or {}
    if method not in ('GET','POST','PUT'):frappe.throw('Unsupported method')
    if method!='GET' and frappe.request.method!='POST':frappe.throw('Mutations require POST')
    parsed=urlsplit(path);route=parsed.path.strip('/');params=parse_qs(parsed.query)
    if not isinstance(body,dict):frappe.throw('Request body must be an object')
    if len(json.dumps(body).encode())>1024*1024:frappe.throw('Request exceeds 1 MB')
    try:
        if route=='api/v1/connection':return {'erpnextConfigured':True,'publicBaseUrl':frappe.utils.get_url(),'native':True}
        if route=='api/v1/doctypes':return {'items':erp_doctypes(),'source':'live'}
        if route.startswith('api/v1/doctypes/'):return erp_metadata(unquote(route[len('api/v1/doctypes/'):]))
        if route=='api/v1/email-accounts':return {'items':erp_email_accounts(),'source':'live'}
        if route=='api/v1/files':return {'items':erp_files()}
        if route=='api/v1/catalog':return {'schemaVersion':2,'graphActions':list(KINDS),'graphTriggers':['manual','incoming_webhook','document_event','schedule'],'documentEvents':EVENTS}
        if route=='api/v1/openapi.json':return json.loads(Path(frappe.get_app_path('quest_automations','openapi.json')).read_text())
        if route=='api/v1/workflows':
            if method=='GET':return store.list()
            if method=='POST':return store.save(body['definition'])
        parts=route.split('/')
        if len(parts)>=4 and parts[:3]==['api','v1','workflows']:
            identifier=parts[3];operation=parts[4] if len(parts)==5 else ''
            if len(parts)==4:
                if method=='GET':return store.workflow(identifier)
                if method=='PUT':return store.save(body['definition'],identifier,body.get('revision'))
            if method=='GET':
                if operation=='versions':return store.versions(identifier)
                if operation=='runs':return store.runs(identifier)
                trigger_id=params.get('triggerId',[None])[0]
                if operation=='webhook-sample':return store.sample(identifier,trigger_id)
                if operation=='webhook':
                    row=store.workflow(identifier);t=select_trigger(row['draft'],trigger_id=trigger_id)
                    if t['kind']=='document_event':return {'native':True,'triggerId':t['id'],'authentication':'Native ERPNext document event; no webhook registration required'}
                    if t['kind']!='incoming_webhook':raise DefinitionError('Choose an incoming webhook trigger')
                    url=endpoint(identifier,t['id']);return {'triggerId':t['id'],'url':url,'path':url,'testUrl':endpoint(identifier,t['id'],True),'secret':store.hook_secret(identifier,t['id']),'testSecret':store.hook_secret(identifier,'test:'+t['id']),'authentication':'X-Automation-Secret: <secret>','publicUrlConfigured':True}
            if method=='POST':
                if operation=='listen':return store.listen(identifier,body['triggerId'])
                if operation=='validate':validate(body.get('definition',store.workflow(identifier)['draft']));return {'valid':True}
                if operation=='test':
                    result=preview(body.get('definition',store.workflow(identifier)['draft']),body.get('input',{}))
                    if body.get('record'):result['runId']=store.record_preview(identifier,body.get('input',{}),result)['id']
                    return result
                if operation=='publish':
                    result=store.publish(identifier,body.get('revision'));from .jobs import wake;wake();return result
                if operation=='pause':return store.pause(identifier)
                if operation=='run':
                    key=frappe.get_request_header('Idempotency-Key') or body.get('eventId')
                    if not key or len(key)>200:raise DefinitionError('Provide Idempotency-Key or eventId')
                    result=store.enqueue(identifier,body.get('input',{}),'manual:'+key,'manual',body.get('triggerId'));from .jobs import wake;wake();return result
        frappe.local.response.http_status_code=404;return {'error':'Endpoint not found'}
    except (DefinitionError,KeyError,ValueError,TypeError) as e:
        frappe.db.rollback();frappe.local.response.http_status_code=409 if 'Revision conflict' in str(e) else 400;return {'error':str(e)}

@frappe.whitelist(allow_guest=True,methods=['POST'])
def webhook(workflow_id,trigger_id,test=None,**kwargs):
    store=Store()
    try:
        secret=store.hook_secret(workflow_id,('test:' if str(test)=='1' else '')+trigger_id)
        supplied=frappe.get_request_header('X-Automation-Secret') or ''
        if not hmac.compare_digest(secret,supplied):frappe.local.response.http_status_code=401;return {'error':'Invalid webhook secret'}
        raw=frappe.request.get_data()
        if len(raw)>1024*1024:raise DefinitionError('Webhook exceeds 1 MB')
        payload=json.loads(raw)
        if not isinstance(payload,dict):raise DefinitionError('Webhook payload must be an object')
        if str(test)=='1':return store.capture(workflow_id,trigger_id,payload)
        key=frappe.get_request_header('X-Event-ID') or hashlib.sha256(raw).hexdigest()
        if len(key)>200:raise DefinitionError('Event ID exceeds 200 characters')
        result=store.enqueue(workflow_id,payload,'incoming:'+key,'incoming_webhook',trigger_id)
        from .jobs import wake
        wake();return {'runId':result['id'],'status':result['status']}
    except (DefinitionError,KeyError,ValueError,TypeError) as e:
        frappe.db.rollback();frappe.local.response.http_status_code=400;return {'error':str(e)}
