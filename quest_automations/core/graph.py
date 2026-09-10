"""Execution adapter for the complete CRM editor's graph (schemaVersion 2)."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import html
import json
import os
import re
import time
from .definition import DefinitionError, require, text_field, trigger_list, resolve, validate as validate_v1
from .transport import erp_request, erp_method, request

ENTITIES={'company':'Customer','contact':'Contact','deal':'Opportunity','project':'Project','task':'Task','note':'Note'}
FIELDS={'company':{'name':'customer_name','industry':'industry','description':'customer_details','domain':'website'},'contact':{'name':'first_name','email':'email_id','title':'designation'},'deal':{'name':'title','stage':'sales_stage','amountMinor':'opportunity_amount'},'project':{'name':'project_name','status':'status','description':'notes'},'task':{'title':'subject','status':'status','priority':'priority','description':'description','dueDate':'exp_end_date'}}
OPS=('is','is_not','contains','does_not_contain','is_empty','is_not_empty')
KINDS=('noop','log','create_note','create_task','update_record','send_notification','send_email','wait','go_to','if_else','erpnext','outgoing_webhook','get_document','custom_code','api_request')
PATTERN=re.compile(r'{{\s*([A-Za-z][A-Za-z0-9_.]*)\s*}}')


def event_trigger(trigger):
    if trigger['kind']!='record':return trigger
    result={**trigger,'kind':'document_event','doctype':ENTITIES[trigger['entityType']],'event':'after_insert' if trigger['event']=='created' else 'on_update'}
    return result


def validate_graph(definition):
    require(definition.get('schemaVersion')==2,'Expected schemaVersion 2')
    text_field(definition,'name')
    triggers=trigger_list(definition)
    for trigger in triggers:
        kind=trigger['kind']
        if kind=='schedule':
            require(type(trigger.get('intervalMinutes')) in (int,float) and 5<=trigger['intervalMinutes']<=525600,'Schedule interval must be 5–525600 minutes')
        if kind=='document_event':
            from .definition import EVENTS
            text_field(trigger,'doctype');require(trigger.get('event') in EVENTS,'Unsupported document event')
            if trigger.get('condition'):validate_condition(trigger['condition'])
        if kind=='record':
            require(trigger.get('entityType') in ENTITIES,'Unsupported record type')
            require(trigger.get('event') in ('created','updated','stage_changed','status_changed'),'Unsupported record event')
            for condition in trigger.get('filters',[]):validate_condition(condition)
    steps=definition.get('steps')
    require(isinstance(steps,list) and 1<=len(steps)<=100,'Provide 1–100 actions')
    count=0
    def check(step, nested=False):
        nonlocal count
        count+=1;require(count<=500,'Workflow exceeds 500 actions including branches')
        require(isinstance(step,dict) and step.get('kind') in KINDS,'Unsupported graph action')
        text_field(step,'label');kind=step['kind']
        if kind=='if_else':
            require(not nested,'Nested If/Else is not supported by the original editor')
            require(isinstance(step.get('branches'),list) and 1<=len(step['branches'])<=10,'Provide 1–10 branches')
            text_field(step,'elseLabel')
            for branch in step['branches']:
                text_field(branch,'name');validate_condition(branch)
                for child in branch.get('steps',[]):check(child,True)
            for child in step.get('elseSteps',[]):check(child,True)
        elif kind=='go_to':require(type(step.get('targetStepIndex')) is int and 0<=step['targetStepIndex']<len(steps),'Go To requires a valid destination')
        elif kind=='wait':require(type(step.get('durationMinutes')) in (int,float) and 1/60<=step['durationMinutes']<=525600,'Wait must be 1–525600 minutes')
        elif kind=='custom_code':
            require(isinstance(step.get('code'),str) and 0<len(step['code'])<=20000,'Provide JavaScript code up to 20,000 characters')
        elif kind in ('erpnext','outgoing_webhook','get_document','api_request'):
            config=json.loads(step.get('configJson','{}'));config.pop('responseSample',None);config.pop('bodyDraft',None)
            operation='outgoing_webhook' if kind=='api_request' else kind if kind in ('outgoing_webhook','get_document') else step.get('operation')
            # Structural validation uses synthetic earlier-step references as allowed IDs.
            refs=set(re.findall(r'steps\.([A-Za-z][A-Za-z0-9_-]*)\.',step['configJson']))
            prefix=[{'id':r,'kind':'delay','config':{'seconds':1}} for r in refs if r!='validate_action']
            validate_v1({'schemaVersion':1,'name':definition['name'],'trigger':{'kind':'manual'},'steps':prefix+[{'id':'validate_action','kind':operation,'config':config}]})
        elif kind=='update_record':
            require(step.get('entityType') in FIELDS and step.get('field') in FIELDS[step['entityType']],'Unsupported ERPNext field mapping; use ERPNext document for a native field')
            text_field(step,'recordId');require(isinstance(step.get('value'),str),'Record value must be text')
        elif kind in ('log','send_notification'):text_field(step,'message')
        elif kind=='create_task':text_field(step,'title')
        elif kind=='create_note':require(step.get('title') or step.get('body'),'Note needs content')
        elif kind=='send_email':
            for field in ('to','subject','body'):text_field(step,field)
            for field in ('sender','senderName','cc','bcc','preheader'):
                require(field not in step or isinstance(step[field],str),f'{field} must be text')
            require(isinstance(step.get('attachments',[]),list) and all(isinstance(v,str) for v in step.get('attachments',[])), 'Attachments must be ERPNext File names')
    for step in steps:check(step)
    return deepcopy(definition)


def validate_condition(condition):
    if isinstance(condition,dict) and 'conditions' in condition:
        require(condition.get('match','all') in ('all','any'),'Choose all or any conditions')
        require(isinstance(condition['conditions'],list) and len(condition['conditions'])<=19,'Use at most 20 conditions per branch')
        for child in condition['conditions']:
            require(isinstance(child,dict) and 'conditions' not in child,'Nested condition groups are not supported')
            validate_condition(child)
    require(isinstance(condition,dict) and condition.get('operator') in OPS,'Unsupported condition operator')
    text_field(condition,'field')
    require(isinstance(condition.get('value',''),str),'Condition value must be text')


def context_for(run):
    payload=run['input'];now=datetime.now(timezone.utc)
    context={'trigger':payload,'steps':run['outputs'],'workflow':{'name':run['definition']['name']},'system':{'today':now.date().isoformat()},'current_day_of_week':now.strftime('%A')}
    # Legacy merge fields resolve from explicitly supplied entities, never invented CRM records.
    for entity in ('contact','company','deal','task','owner','project'):
        if isinstance(payload.get(entity),dict):context[entity]=payload[entity]
    return context


def render(value,context):
    if isinstance(value,dict):return resolve({k:render(v,context) for k,v in value.items()},context)
    if isinstance(value,list):return [render(v,context) for v in value]
    if not isinstance(value,str):return value
    match=PATTERN.fullmatch(value)
    def lookup(path):
        parts=path.split('.')
        if any(p in ('__proto__','constructor','prototype','__class__') for p in parts):raise DefinitionError('Unsafe merge field')
        current=context
        for part in parts:
            if isinstance(current,dict) and part in current:current=current[part]
            elif isinstance(current,list) and part.isdigit() and int(part)<len(current):current=current[int(part)]
            else:raise DefinitionError('Missing merge field: '+path)
        return current
    if match:return lookup(match[1])
    return PATTERN.sub(lambda m:str(lookup(m[1])),value)


def condition_matches(condition,context):
    if 'conditions' in condition:
        primary={k:v for k,v in condition.items() if k not in ('conditions','match')}
        results=(condition_matches(c,context) for c in [primary,*condition['conditions']])
        return any(results) if condition.get('match')=='any' else all(results)
    field=condition['field']
    if field=='current_day_of_week':left=context[field]
    else:
        path=field if '.' in field else 'trigger.'+field
        try:left=render('{{'+path+'}}',context)
        except DefinitionError:left=None
    op=condition['operator'];right=render(condition.get('value',''),context)
    empty=left is None or left=='' or left==[]
    if op=='is_empty':return empty
    if op=='is_not_empty':return not empty
    if op=='is':return str(left).casefold()==str(right).casefold() if left is not None else False
    if op=='is_not':return not condition_matches({**condition,'operator':'is'},context)
    contains=str(right).casefold() in str(left).casefold() if left is not None else False
    return contains if op=='contains' else not contains


def compile_graph(definition):
    code=[];top={}
    def append(step,key):
        pos=len(code);code.append({'step':step,'id':key});return pos
    for i,step in enumerate(definition['steps']):
        top[i]=len(code);pos=append(step,f'step_{i}')
        if step['kind']=='if_else':
            targets=[];ends=[]
            for b,branch in enumerate([*step['branches'],{'steps':step.get('elseSteps',[])}]):
                targets.append(len(code))
                for n,child in enumerate(branch.get('steps',[])):append(child,f'step_{i}_branch_{b}_{n}')
                ends.append(append({'kind':'_jump','target':None},f'end_{i}_{b}'))
            code[pos]['targets']=targets
            for end in ends:code[end]['step']['target']=len(code)
    for instruction in code:
        if instruction['step']['kind']=='go_to':instruction['target']=top[instruction['step']['targetStepIndex']]
    return code


def execute_native(step,context,run_id,step_id):
    if step['kind']=='custom_code':
        from .javascript import execute_code
        return execute_code(step['code'],context,run_id,step_id)
    kind=step['kind'];raw_config=step.get('configJson');step=render({k:v for k,v in step.items() if k!='configJson'},context)
    if kind in ('noop','log'):return {'message':step.get('message','No operation')}
    if kind in ('erpnext','outgoing_webhook','get_document','api_request'):
        from .engine import execute_action
        # Render individual parsed values so quotes and arrays stay valid JSON.
        config=render({k:v for k,v in json.loads(raw_config).items() if k not in ('responseSample','bodyDraft')},context)
        return execute_action('outgoing_webhook' if kind=='api_request' else kind if kind in ('outgoing_webhook','get_document') else step['operation'],config,run_id,step_id)
    if kind=='create_note':
        content=step.get('body','')
        for key,entity in [('companyId','Customer'),('contactId','Contact'),('dealId','Opportunity')]:
            if step.get(key):content+=f'\n{entity}: {step[key]}'
        return erp_request('Note',fields={'title':step.get('title') or 'Workflow note','content':html.escape(content),'public':0})
    if kind=='create_task':
        fields={'subject':step['title'],'description':step.get('description','')}
        if step.get('projectId'):fields['project']=step['projectId']
        if step.get('parentTaskId'):fields['parent_task']=step['parentTaskId']
        if step.get('status'):fields['status']={'backlog':'Open','todo':'Open','in_progress':'Working','blocked':'Pending Review','done':'Completed','canceled':'Cancelled'}[step['status']]
        if step.get('priority'):fields['priority']={'low':'Low','medium':'Medium','high':'High','urgent':'High'}[step['priority']]
        if step.get('dueOffsetDays') is not None:fields['exp_end_date']=(datetime.now(timezone.utc)+timedelta(days=step['dueOffsetDays'])).date().isoformat()
        result=erp_request('Task',fields=fields)
        if step.get('assigneeId'):erp_method('frappe.desk.form.assign_to.add',{'doctype':'Task','name':result['name'],'assign_to':[step['assigneeId']]})
        return result
    if kind=='update_record':
        entity=step['entityType'];field=FIELDS[entity][step['field']];value=step['value']
        if step['field']=='amountMinor':value=float(value)/100
        if entity=='task' and step['field']=='status':value={'backlog':'Open','todo':'Open','in_progress':'Working','blocked':'Pending Review','done':'Completed','canceled':'Cancelled'}.get(value,value)
        if entity=='project' and step['field']=='status':value={'planned':'Open','active':'Open','on_hold':'Open','completed':'Completed','archived':'Cancelled'}.get(value,value)
        return erp_request(ENTITIES[entity],step['recordId'],{field:value})
    if kind=='send_email':
        from .transport import erp_email_accounts
        sender=step.get('sender')
        if sender and sender not in [a['email_id'] for a in erp_email_accounts()]:raise DefinitionError('Choose an enabled outgoing email account')
        content=step['body']
        if step.get('preheader'):content='<div style="display:none;max-height:0;overflow:hidden">'+html.escape(step['preheader'])+'</div>'+content
        attachments=step.get('attachments',[])
        for name in attachments:erp_request('File',name)  # Verify the integration user's read access.
        return erp_method('frappe.core.doctype.communication.email.make',{'recipients':step['to'],'subject':step['subject'],'content':content,'communication_medium':'Email','send_email':1,**({'sender':sender} if sender else {}),**({'sender_full_name':step['senderName']} if step.get('senderName') else {}),**{k:step[k] for k in ('cc','bcc','attachments') if step.get(k)}})
    if kind=='send_notification':
        if step.get('channel')=='slack':
            url=os.environ.get('SLACK_WEBHOOK_URL')
            require(bool(url),'Configure SLACK_WEBHOOK_URL on the server')
            return request(url,body={'text':step['message']})
        return erp_request('Comment',fields={'comment_type':'Info','reference_doctype':context['trigger']['doctype'],'reference_name':context['trigger']['name'],'content':step['message']})
    raise DefinitionError('Unsupported action')


def process(run,store=None,executor=execute_native,preview=False):
    code=compile_graph(run['definition']);visited={l['id'] for l in run['logs'] if l.get('goto')}
    while run['cursor']<len(code):
        instruction=code[run['cursor']];step=instruction['step'];kind=step['kind'];key=instruction['id'];context=context_for(run);context['_preview']=preview
        if kind=='_jump':run['cursor']=step['target'];continue
        log={'id':key,'label':step['label'],'at':time.time(),'status':'succeeded'}
        try:
            require(len(run['logs'])<1000,'Workflow exceeded the execution limit')
            if kind=='go_to':
                require(key not in visited,'Go To loop detected; this connection has already been followed')
                visited.add(key);log['goto']=True;log['output']='Go To action '+str(step['targetStepIndex']+1);run['cursor']=instruction['target']
            elif kind=='if_else':
                branch=next((i for i,b in enumerate(step['branches']) if condition_matches(b,context)),len(step['branches']))
                run['cursor']=instruction['targets'][branch];log['output']=step['branches'][branch]['name'] if branch<len(step['branches']) else step['elseLabel']
            elif kind=='erpnext' and step.get('operation')=='condition':
                from .definition import evaluate_condition
                passed=evaluate_condition(render({k:v for k,v in json.loads(step['configJson']).items() if k not in ('responseSample','bodyDraft')},context))
                run['outputs'][key]={'passed':passed};log['output']={'passed':passed}
                run['cursor']=run['cursor']+1 if passed else len(code)
            elif kind=='wait':
                run['cursor']+=1;log['output']=f"Wait {step['durationMinutes']} minutes"
                if not preview:
                    log['status']='waiting';run['logs'].append(log);store.checkpoint(run,'waiting',step['durationMinutes']*60);return
            else:
                if preview and kind not in ('noop','log','custom_code'):
                    # Validate field resolution, but never fabricate external outputs.
                    if kind in ('erpnext','outgoing_webhook','get_document','api_request'):render({k:v for k,v in json.loads(step['configJson']).items() if k not in ('responseSample','bodyDraft')},context)
                    else:render(step,context)
                    log['output']='Preview: would execute '+kind
                else:run['outputs'][key]=executor(step,context,run['id'],key)
                run['cursor']+=1
            run['logs'].append(log)
            if store:store.checkpoint(run,'running')
        except Exception as error:
            message=str(error) if isinstance(error,(DefinitionError,ValueError)) else 'External action failed or its result is uncertain. Inspect the destination before retrying.'
            log.update(status='failed',error=message);run['logs'].append(log);run['error']=message;run['status']='failed' if preview or isinstance(error,(DefinitionError,ValueError)) else 'needs_attention'
            if store:store.checkpoint(run,run['status'],error=message)
            return
    run['status']='succeeded'
    if store:store.checkpoint(run,'succeeded')


def preview_graph(definition,payload):
    validate_graph(definition)
    run={'id':'preview','definition':definition,'input':payload,'outputs':{},'logs':[],'cursor':0,'status':'running'}
    process(run,preview=True)
    return {'dryRun':True,'status':run['status'],'steps':run['logs'],'outputs':run['outputs'],'error':run.get('error'),'note':'Graph preview. No external writes or requests were made.'}
