"""Build API requests and apply authorization before using the shared transport."""
import base64,os
from urllib.parse import urlencode,urlsplit,urlunsplit,parse_qsl
from .definition import DefinitionError
from .transport import request


def secret(value):
    if isinstance(value,str) and value.startswith('secret:'):
        resolved=os.environ.get(value[7:])
        if not resolved:raise DefinitionError('An API credential environment variable is not configured')
        return resolved
    return value


def execute(config,run_id,step_id):
    if any(config.get(k) for k in ('bodyError','headersError','queryError')):raise DefinitionError('Correct the request configuration before running')
    headers={k:secret(v) for k,v in config.get('headers',{}).items()}
    original_query=urlsplit(config['url']).query
    query=[]
    query.extend((k,v) for k,values in config.get('query',{}).items() for v in (values if isinstance(values,list) else [values]))
    auth=config.get('authorization',{});kind=auth.get('type','none')
    if kind!='none':headers={k:v for k,v in headers.items() if k.lower()!='authorization'}
    if kind=='bearer':headers['Authorization']='Bearer '+str(secret(auth.get('token','')))
    elif kind=='basic':headers['Authorization']='Basic '+base64.b64encode((str(secret(auth.get('username','')))+':'+str(secret(auth.get('password','')))).encode()).decode()
    elif kind=='api_key':
        name=auth.get('name','X-API-Key');value=secret(auth.get('value',''))
        if auth.get('in','header')=='query':
            original_query=urlencode([(k,v) for k,v in parse_qsl(original_query,keep_blank_values=True) if k!=name])
            query=[(k,v) for k,v in query if k!=name]+[(name,value)]
        else:headers[name]=value
    for k,v in headers.items():
        if not isinstance(v,str) or any(c in k+v for c in ('\r','\n')) or k.lower() in ('host','content-length','connection','transfer-encoding'):raise DefinitionError('Invalid or reserved HTTP header')
    headers['Idempotency-Key']=f'{run_id}:{step_id}'
    content_type=config.get('contentType')
    if content_type:headers={k:v for k,v in headers.items() if k.lower()!='content-type'};headers['Content-Type']=content_type
    parts=urlsplit(config['url']);url=urlunsplit((parts.scheme,parts.netloc,parts.path,'&'.join(q for q in (original_query,urlencode(query,doseq=True)) if q),parts.fragment))
    body=config.get('body');kwargs={}
    if content_type=='application/x-www-form-urlencoded' and body is not None:
        if not isinstance(body,dict):raise DefinitionError('Form body must contain named fields')
        kwargs['raw_body']=urlencode(body,doseq=True).encode();body=None
    elif content_type in ('text/plain','application/xml') and body is not None:
        if not isinstance(body,str):raise DefinitionError('Text or XML body must be text')
        kwargs['raw_body']=body.encode();body=None
    result=request(url,config.get('method','POST'),headers,body,**kwargs)
    return result if config.get('saveResponse',True) else {'status':result['status']}
