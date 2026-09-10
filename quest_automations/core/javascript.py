"""Restricted JS process with bounded, validated HTTP requests through the parent."""
import json,selectors,subprocess,sys,tempfile,time
from pathlib import Path
from .definition import DefinitionError,validate


def execute_code(code, context, run_id='preview', step_id='code'):
 root=Path(__file__).resolve().parent.parent
 python=root/'.venv/bin/python'
 if not python.exists():python=Path(sys.executable)
 payload=json.dumps({'code':code,'input':context['trigger'],'steps':context['steps']},allow_nan=False)
 if len(payload.encode())>1024*1024:raise DefinitionError('Code input exceeds 1 MB')
 process=None
 try:
  with tempfile.TemporaryDirectory(prefix='automation-js-') as directory:
   process=subprocess.Popen([str(python),'-I',str(root/'core/js_worker.py')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,cwd=directory,env={})
   process.stdin.write(payload+'\n');process.stdin.flush();count=0;deadline=time.monotonic()+120
   with selectors.DefaultSelector() as selector:
    selector.register(process.stdout,selectors.EVENT_READ)
    while True:
     if time.monotonic()>deadline or not selector.select(min(5,max(0,deadline-time.monotonic()))):raise DefinitionError('JavaScript exceeded its execution limit')
     line=process.stdout.readline(1024*1024+4096)
     if not line:raise DefinitionError('JavaScript runtime stopped unexpectedly')
     message=json.loads(line)
     if 'error' in message:raise DefinitionError(message['error'])
     if 'result' in message:return message['result']
     call=message['request'];count+=1
     if count>5:raise DefinitionError('At most 5 API requests per code action')
     reply={'id':call['id']}
     try:
      if context.get('_preview'):raise DefinitionError('API calls are not sent in preview. Use a live run to execute this request.')
      config=call['config']
      validate({'schemaVersion':1,'name':'Code API request','trigger':{'kind':'manual'},'steps':[{'id':'request','kind':'outgoing_webhook','config':config}]})
      from .engine import execute_action
      reply['result']=execute_action('outgoing_webhook',config,run_id,step_id+':'+str(count))
     except DefinitionError as error:reply['error']=str(error)
     # Ambiguous network errors escape rather than being treated as safely retryable JS errors.
     process.stdin.write(json.dumps(reply)+'\n');process.stdin.flush()
 except (json.JSONDecodeError,OSError,KeyError,TypeError):raise DefinitionError('Invalid JavaScript request or unavailable runtime')
 finally:
  if process:
   if process.poll() is None:process.kill()
   process.wait()
   process.stdin.close();process.stdout.close()
