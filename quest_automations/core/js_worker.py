"""QuickJS with a JSON message bridge; no direct host capabilities exposed."""
import json,sys,resource
resource.setrlimit(resource.RLIMIT_CPU,(4,4))
resource.setrlimit(resource.RLIMIT_CORE,(0,0))
try:
 import quickjs
 payload=json.loads(sys.stdin.readline(1024*1024+1))
 ctx=quickjs.Context();ctx.set_memory_limit(32*1024*1024);ctx.set_max_stack_size(512*1024);ctx.set_time_limit(2)
 ctx.set('__payload',json.dumps({'input':payload['input'],'steps':payload['steps']}));ctx.set('__source',payload['code'])
 ctx.eval('''
 globalThis.__queue=[];globalThis.__pending={};globalThis.__done=false;globalThis.__error=null;globalThis.__result=null;
 let __counter=0;
 const api=Object.freeze({request: config => new Promise((resolve,reject)=>{
   const id=++__counter;if(id>5){reject(new Error('At most 5 API calls per code action'));return;}
   __pending[id]={resolve,reject};__queue.push({id,config});
 })});
 const data=JSON.parse(__payload);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 new AsyncFunction('input','steps','api','"use strict";\\n'+__source)(data.input,data.steps,api).then(result=>{
   if(result===undefined)throw new Error('Return a JSON value from your code.');
   __result=JSON.stringify(result,(_,v)=>{if(typeof v==='number'&&!Number.isFinite(v)||['function','symbol','bigint'].includes(typeof v))throw new Error('Return JSON-compatible values.');return v;});__done=true;
 }).catch(error=>{__error=String(error);__done=true;});
 ''')
 for turn in range(1000):
  while ctx.execute_pending_job():pass
  if ctx.eval('__done'):
   error=ctx.eval('__error')
   if error:raise ValueError(error)
   output=ctx.eval('__result')
   if len(output.encode())>1024*1024:raise ValueError('Code output exceeds 1 MB')
   print(json.dumps({'result':json.loads(output)}),flush=True);break
  queued=json.loads(ctx.eval('JSON.stringify(__queue.splice(0))'))
  if not queued:raise ValueError('Code is waiting on a promise that cannot resolve')
  for item in queued:
   print(json.dumps({'request':item}),flush=True)
   response=json.loads(sys.stdin.readline(1024*1024+4096))
   ctx.set('__response',json.dumps(response))
   ctx.eval('(()=>{const r=JSON.parse(__response);const p=__pending[r.id];delete __pending[r.id];r.error?p.reject(new Error(r.error)):p.resolve(r.result)})()')
 else:raise ValueError('Too many JavaScript execution cycles')
except Exception as error:print(json.dumps({'error':'JavaScript: '+str(error)[:2000]}),flush=True)
