"""Site database persistence with row locks and deterministic event deduplication."""
import hashlib,hmac,json,secrets,threading,time,uuid
import frappe
from .core.definition import DefinitionError,validate,trigger_list,select_trigger

TYPE='Automation Record'
def encode(v):return json.dumps(json.loads(frappe.as_json(v)),allow_nan=False,separators=(',',':'))
def identity(*parts):return hashlib.sha256(encode(parts).encode()).hexdigest()
def load(name,lock=False):
    if lock:frappe.db.sql('select name from `tabAutomation Record` where name=%s for update',(name,))
    if not frappe.db.exists(TYPE,name):raise KeyError('Record not found')
    return json.loads(frappe.db.get_value(TYPE,name,'payload'))
def put(name,kind,value,parent=None):
    fields={'payload':encode(value),'kind':kind,'parent_record':parent,'status':value.get('status'),'due':value.get('due',0)}
    if frappe.db.exists(TYPE,name):frappe.db.set_value(TYPE,name,fields,update_modified=True)
    else:frappe.get_doc({'doctype':TYPE,'name':name,**fields}).insert(ignore_permissions=True)
def names(kind,filters=None,order='modified desc',limit=200):
    return frappe.get_all(TYPE,filters={'kind':kind,**(filters or {})},order_by=order,pluck='name',limit_page_length=limit)

class Store:
    def __init__(self):self.lock=threading.RLock()
    def workflow(self,name):
        row=load(name)
        if row.get('_kind')!='Workflow':raise KeyError('Workflow not found')
        return {**row,'recentRuns':[{'status':r['status']} for r in self.runs(name)]}
    def list(self):return [self.workflow(n) for n in names('Workflow')]
    def save(self,draft,identifier=None,revision=None):
        if not isinstance(draft,dict) or not draft.get('name'):raise DefinitionError('Draft needs a name')
        validate({**draft,'steps':draft.get('steps') or [{'kind':'noop','label':'Empty draft'}]})
        if len(encode(draft))>250000:raise DefinitionError('Draft exceeds 250 KB')
        now=time.time()
        if identifier:
            row=load(identifier,True)
            if row.get('_kind')!='Workflow':raise KeyError('Workflow not found')
            if type(revision) is not int or row['revision']!=revision:raise DefinitionError('Revision conflict: reload before saving')
            removed={t['id'] for t in row['draft'].get('triggers',[])}-{t['id'] for t in draft.get('triggers',[])}
            if removed:self._cleanup_triggers(row,removed)
            row.update(draft=draft,revision=revision+1,updated=now)
        else:
            identifier=str(uuid.uuid4());row={'id':identifier,'_kind':'Workflow','draft':draft,'published':None,'revision':1,'version':0,'status':'draft','updated':now,'run_as':frappe.session.user}
        put(identifier,'Workflow',row)
        if not frappe.db.get_value(TYPE,identifier,'secret'):
            doc=frappe.get_doc(TYPE,identifier);doc.secret=secrets.token_urlsafe(32);doc.save(ignore_permissions=True)
        version={'id':identifier+':'+str(row['revision']),'number':row['revision'],'definition':draft,'created':now}
        put(identity('version',identifier,row['revision']),'Version',version,identifier)
        return self.workflow(identifier)
    def publish(self,identifier,revision):
        row=load(identifier,True)
        if row['revision']!=revision:raise DefinitionError('Revision conflict: reload before publishing')
        row.update(published=validate(row['draft']),version=row['version']+1,status='active',run_as=frappe.session.user,updated=time.time())
        put(identifier,'Workflow',row)
        for name in names('Schedule',{'parent_record':identifier}):frappe.delete_doc(TYPE,name,ignore_permissions=True)
        for t in trigger_list(row['published']):
            if t['kind']=='schedule':put(identity('schedule',identifier,t['id']),'Schedule',{'workflow_id':identifier,'trigger_id':t['id'],'due':time.time()+t['intervalMinutes']*60,'interval':t['intervalMinutes']*60},identifier)
        return self.workflow(identifier)
    def pause(self,identifier):
        row=load(identifier,True);row.update(status='paused',updated=time.time());put(identifier,'Workflow',row);return self.workflow(identifier)
    def _cleanup_triggers(self,row,removed):
        # Completed run history remains an audit trail; pending work is canceled.
        for name in names('Run',{'parent_record':row['id']},limit=0):
            run=load(name)
            if run.get('trigger_id') not in removed:continue
            if run['status']=='running':raise DefinitionError('This trigger is running. Wait for it to finish before deleting.')
            if run['status'] in ('queued','waiting'):
                run.update(status='canceled',error='Trigger deleted');put(name,'Run',run,row['id'])
        for trigger_id in removed:
            epochs=row.setdefault('webhook_epochs',{});epochs[trigger_id]=epochs.get(trigger_id,0)+1
            for kind in ('sample','schedule'):
                name=identity(kind,row['id'],trigger_id)
                if frappe.db.exists(TYPE,name):frappe.delete_doc(TYPE,name,ignore_permissions=True)
        if row.get('published'):
            row['published']['triggers']=[t for t in row['published']['triggers'] if t['id'] not in removed]
            if not row['published']['triggers']:row.update(published=None,status='paused')
    def delete_trigger(self,identifier,trigger_id,revision):
        row=load(identifier,True)
        if row.get('_kind')!='Workflow':raise KeyError('Workflow not found')
        if row['revision']!=revision:raise DefinitionError('Revision conflict: reload before deleting')
        if trigger_id not in {t['id'] for t in row['draft'].get('triggers',[])}:raise DefinitionError('Trigger not found')
        self._cleanup_triggers(row,{trigger_id})
        row['draft']['triggers']=[t for t in row['draft']['triggers'] if t['id']!=trigger_id]
        row.update(revision=row['revision']+1,updated=time.time())
        put(identifier,'Workflow',row)
        return self.workflow(identifier)
    def delete(self,identifier,revision):
        row=load(identifier,True)
        if row.get('_kind')!='Workflow':raise KeyError('Workflow not found')
        if row['revision']!=revision:raise DefinitionError('Revision conflict: reload before deleting')
        # Caller holds the worker lock until commit, so no run can start here.
        for kind in ('Run','Schedule','Sample','Version'):
            for name in names(kind,{'parent_record':identifier},limit=0):
                frappe.delete_doc(TYPE,name,ignore_permissions=True)
        frappe.delete_doc(TYPE,identifier,ignore_permissions=True)
        return {'deleted':True,'id':identifier}
    def hook_secret(self,identifier,trigger_id=None):
        row=load(identifier)
        if row.get('_kind')!='Workflow':raise KeyError('Workflow not found')
        if trigger_id:
            select_trigger(row['draft'],'incoming_webhook',trigger_id.removeprefix('test:'))
        secret=frappe.get_doc(TYPE,identifier).get_password('secret')
        epoch=row.get('webhook_epochs',{}).get(trigger_id.removeprefix('test:'),0) if trigger_id else 0
        signed=(trigger_id+':'+str(epoch)) if epoch else trigger_id
        return hmac.new(secret.encode(),signed.encode(),hashlib.sha256).hexdigest() if trigger_id else secret
    def enqueue(self,identifier,payload,event_key,expected_trigger=None,trigger_id=None):
        row=load(identifier,True)
        if row['status']!='active' or not row['published']:raise DefinitionError('Workflow must be published and active')
        t=select_trigger(row['published'],expected_trigger,trigger_id,payload if expected_trigger=='document_event' else None) if expected_trigger or trigger_id else None
        if t:
            from .core.graph import condition_matches,context_for
            if t.get('condition') and not condition_matches(t['condition'],context_for({'input':payload,'outputs':{},'definition':row['published']})):return {'id':None,'status':'filtered_out'}
            if t['kind']=='record':
                if not all(condition_matches(f,{'trigger':payload}) for f in t.get('filters',[])):return {'id':None,'status':'filtered_out'}
                if t['event'] in ('stage_changed','status_changed'):
                    field='sales_stage' if t['event']=='stage_changed' else 'status'
                    if field not in payload.get('previous',{}) or payload.get(field)==payload['previous'][field]:return {'id':None,'status':'filtered_out'}
            if t['id']!='legacy':event_key=t['id']+':'+event_key
        run_id=identity('run',identifier,event_key)
        if frappe.db.exists(TYPE,run_id):return self.run(run_id)
        run={'id':run_id,'workflow_id':identifier,'version':row['version'],'definition':row['published'],'input':payload,'outputs':{},'logs':[],'cursor':0,'status':'queued','due':time.time(),'created':time.time(),'event_key':event_key,'trigger_id':t['id'] if t else None,'run_as':row['run_as']}
        put(run_id,'Run',run,identifier);return run
    def run(self,identifier):
        if frappe.db.get_value(TYPE,identifier,'kind')!='Run':raise KeyError('Run not found')
        return load(identifier)
    def runs(self,workflow_id):return [self.run(n) for n in names('Run',{'parent_record':workflow_id},limit=100)]
    def claim(self):
        rows=frappe.db.sql("select name from `tabAutomation Record` where kind='Run' and status in ('queued','waiting') and due<=%s order by due limit 1 for update skip locked",(time.time(),))
        if not rows:return None
        run=self.run(rows[0][0]);run.update(status='running',claimed_at=time.time());put(run['id'],'Run',run,run['workflow_id']);frappe.db.commit();return run
    def checkpoint(self,run,status,delay=0,error=None):
        run.update(status=status,due=time.time()+delay,error=error,claimed_at=time.time());put(run['id'],'Run',run,run['workflow_id']);frappe.db.commit()
    def versions(self,identifier):return [load(n) for n in names('Version',{'parent_record':identifier},limit=100)]
    def record_preview(self,identifier,payload,result):
        row=self.workflow(identifier);run_id=str(uuid.uuid4());now=time.time();run={'id':run_id,'workflow_id':identifier,'version':row['revision'],'definition':row['draft'],'input':payload,'outputs':result.get('outputs',{}),'logs':result.get('steps',[]),'cursor':0,'status':result.get('status','succeeded'),'due':now,'created':now,'error':result.get('error'),'trigger_id':'Preview'};put(run_id,'Run',run,identifier);return run
    def enqueue_schedules(self):
        for name in names('Schedule',{'due':['<=',time.time()]},order='due',limit=20):
            s=load(name,True)
            if s['due']>time.time() or self.workflow(s['workflow_id'])['status']!='active':continue
            self.enqueue(s['workflow_id'],{'scheduled_at':s['due']},'schedule:'+str(s['due']),'schedule',s['trigger_id']);s['due']=time.time()+s['interval'];put(name,'Schedule',s,s['workflow_id'])
    def listen(self,identifier,trigger_id):
        select_trigger(self.workflow(identifier)['draft'],'incoming_webhook',trigger_id)
        load(identifier,True);put(identity('sample',identifier,trigger_id),'Sample',{'expires':time.time()+300,'payload':None,'received':None},identifier);return self.sample(identifier,trigger_id)
    def sample(self,identifier,trigger_id):
        name=identity('sample',identifier,trigger_id)
        if not frappe.db.exists(TYPE,name):return {'listening':False,'sample':None}
        s=load(name);return {'listening':s['expires']>time.time() and s['payload'] is None,'sample':s['payload'],'received':s['received']}
    def capture(self,identifier,trigger_id,payload):
        name=identity('sample',identifier,trigger_id);s=load(name,True)
        if s['expires']<=time.time() or s['payload'] is not None:raise DefinitionError('Start listening in the editor first')
        s.update(payload=payload,received=time.time(),expires=0);put(name,'Sample',s,identifier);return {'captured':True}
