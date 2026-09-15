"""Declarative building blocks; no user-provided code or credentials."""
import html
import re
from .definition import require, DefinitionError, text_field

KINDS = ('find_documents','filter_list','map_fields','for_each','end_loop','stop','begin_transaction','commit_transaction')
FORMATS = ('text','lowercase','html','first_word','remaining_words','short_title')


def validate_step(step):
    kind=step['kind']
    if kind=='find_documents':
        text_field(step,'doctype')
        require(isinstance(step.get('filters',[]),list),'Provide search filters')
        require(isinstance(step.get('fields',[]),list) and bool(step['fields']),'Choose fields to return')
        require(type(step.get('limit',100)) is int and 1<=step.get('limit',100)<=1000,'Search limit must be 1–1000')
        for f in step.get('filters',[]):
            text_field(f,'field');require(f.get('operator') in ('=','!=','in','not in','like','not like','is'), 'Unsupported search operator')
    elif kind in ('filter_list','for_each'):
        require('list' in step,'Choose a list')
        if kind=='for_each':
            require(isinstance(step.get('itemName'),str) and re.fullmatch('[a-zA-Z][a-zA-Z0-9_]{0,31}',step['itemName']),'Name the current item using letters and numbers')
            require(step['itemName'] not in ('constructor','prototype','__proto__'),'Unsafe item name')
            require(type(step.get('maxItems',50)) is int and 1<=step.get('maxItems',50)<=200,'Repeat limit must be 1–200')
            require(isinstance(step.get('collect',{}),dict),'Collected fields must be an object')
        else:
            require(isinstance(step.get('conditions',[]),list) and len(step.get('conditions',[]))<=20,'Provide up to 20 list conditions')
            require(isinstance(step.get('uniqueBy',''),str),'Unique field must be text')
            require(step.get('match','all') in ('all','any'),'Choose all or any conditions')
            for c in step.get('conditions',[]):
                text_field(c,'field');require(c.get('operator') in ('is','is_not','is_empty','is_not_empty','not_in_list','email_domain_is_not','is_email'),'Unsupported list condition')
    elif kind=='stop':
        require(step.get('outcome') in ('skip','error'),'Choose a stop outcome')
    elif kind=='map_fields':
        require(isinstance(step.get('mappings'),list) and 1<=len(step['mappings'])<=50,'Provide 1–50 field mappings')
        for m in step['mappings']:
            require(isinstance(m.get('name'),str) and re.fullmatch('[a-zA-Z][a-zA-Z0-9_]{0,63}',m['name']) and m['name'] not in ('constructor','prototype','__proto__'),'Provide a safe field name')
            require(m.get('format','text') in FORMATS,'Unsupported field format')
            require('value' in m,'Choose a value')


def execute(step,context):
    from .graph import render
    from ..native_actions import find_documents
    kind=step['kind']
    if kind in ('begin_transaction','commit_transaction'):return {'message':step['label']}
    if kind=='find_documents':
        filters=[]
        for f in step.get('filters',[]):filters.append([f['field'],f['operator'],render(f.get('value',''),context)])
        config={'doctype':step['doctype'],'filters':filters,'fields':step['fields'],'limit':step.get('limit',100)}
        if step.get('parent'):config['parent']=step['parent']
        rows=find_documents(config)
        return {'records':rows,'count':len(rows)}
    if kind=='map_fields':
        result={}
        for m in step['mappings']:
            try:value=render(m['value'],context)
            except DefinitionError:value=None
            if value is None or value=='':value=render(m.get('fallback',''),context)
            fmt=m.get('format','text')
            if fmt=='lowercase':value=str(value).strip().lower()
            elif fmt=='html':value=html.escape(str(value))
            elif fmt=='short_title':value=str(value).strip()[:140]
            elif fmt=='first_word':value=str(value).strip().split(' ')[0]
            elif fmt=='remaining_words':value=' '.join(str(value).strip().split(' ')[1:])
            result[m['name']]=value
        context['variables'].update(result)
        return result
    if kind=='filter_list':
        rows=render(step['list'],context)
        require(isinstance(rows,list) and len(rows)<=1000,'Choose a list containing at most 1000 items')
        def matches(row,c):
            value=row
            for p in c['field'].split('.'):value=value.get(p) if isinstance(value,dict) else None
            expected=render(c.get('value',''),context);op=c['operator'];empty=value is None or value==''
            if op=='is_email':return bool(re.fullmatch(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+',str(value).strip()))
            if op=='is_empty':return empty or isinstance(value,str) and not value.strip()
            if op=='is_not_empty':return not (empty or isinstance(value,str) and not value.strip())
            if op=='not_in_list':
                require(isinstance(expected,list),'Choose a list to exclude')
                names=[str(r.get(c.get('listField','name'),'')) if isinstance(r,dict) else str(r) for r in expected]
                return str(value).strip().casefold() not in [n.strip().casefold() for n in names]
            if op=='email_domain_is_not':
                domain=str(value).rsplit('@',1)[-1].casefold();other=str(expected).casefold()
                return '@' in str(value) and domain!=other and not domain.endswith('.'+other)
            same=str(value).casefold()==str(expected).casefold()
            return same if op=='is' else not same
        selected=[r for r in rows if (all if step.get('match','all')=='all' else any)(matches(r,c) for c in step.get('conditions',[]))]
        if step.get('uniqueBy'):
            seen=set();unique=[]
            for row in selected:
                value=row
                for p in step['uniqueBy'].split('.'):value=value.get(p) if isinstance(value,dict) else None
                key=str(value).strip().casefold()
                if key not in seen:seen.add(key);unique.append(row)
            selected=unique
        return {'items':selected,'count':len(selected)}
    raise DefinitionError('Unsupported visual action')


CATALOG = {
    'find_documents': {'doctype':'CRM Lead','filters':[{'field':'email','operator':'=','value':'{{trigger.email}}'}],'fields':['name','email'],'limit':100,'outputs':['records','count']},
    'filter_list': {'list':'{{trigger.items}}','match':'all','uniqueBy':'email','conditions':[{'field':'email','operator':'is_email'}],'outputs':['items','count']},
    'map_fields': {'mappings':[{'name':'email','value':'{{trigger.email}}','fallback':'','format':'lowercase'}],'formats':list(FORMATS),'outputs':'Named fields plus variables.<name>'},
    'for_each': {'list':'{{trigger.items}}','itemName':'item','maxItems':50,'collect':{'email':'{{items.item.email}}'},'outputs':['items','count'],'note':'Place actions between For each and End repeat; at most three nested repeats'},
    'end_loop': {'note':'Closes the nearest For each'},
    'stop': {'outcome':'skip','message':'No action needed','outcomes':['skip','error']},
    'begin_transaction': {'note':'First action; normal native permissions, defers checkpoints and rolls back database changes on failure'},
    'commit_transaction': {'note':'Last action; completes the native transaction'},
}
