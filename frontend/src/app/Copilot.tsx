// The AI sidebar in the workflow editor. It reads the workflow exactly as the editor holds it
// (unsaved edits included), proposes changes as a list the person reads first, applies them as one
// step and takes them back with one Undo. Nothing is saved until the person presses Save.
// The server (quest_automations/copilot.py) checks every change; turns run as background jobs and
// the reply shows as it arrives. The conversation is kept per workflow in this browser.
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {__} from '../lib/i18n';

export type CopilotWorkflow={name:string;description?:string;triggers:any[];steps:any[]};
export type CopilotSelection={type:string;index?:number;stepIndex?:number};
export type CopilotContext={
 key:string; // the workflow id, or "new"
 get:()=>CopilotWorkflow;
 selected:CopilotSelection;
 selectedLabel:string|null;
 apply:(proposal:CopilotWorkflow)=>void;
};

type Model={name:string;label:string;model:string;provider:string;reasoning_efforts:string[];tier?:string};
type Status={configured:boolean;bridge_installed:boolean;setup_url:string;models:Model[];selected:string;active:Model|null;effort:string};
type Msg={
 role:'user'|'assistant';text?:string;reply?:string;changes?:string[];notes?:string[];suggestions?:string[];
 proposal?:CopilotWorkflow|null;token?:string|null;clarify?:string;options?:string[];error?:string;
 state?:'proposed'|'applied'|'discarded'|'undone'|'superseded'|'expired'|'open'|'answered';
 askedOn?:string;before?:CopilotWorkflow;appliedAs?:string;cancelled?:boolean;
};

async function call<T>(method:string,args:Record<string,unknown>={},post=true):Promise<T>{
 const native=(window as any).automationFrappe;
 const url='/api/method/quest_automations.copilot.'+method+(post?'':'?'+new URLSearchParams(args as Record<string,string>));
 const response=await fetch(url,{method:post?'POST':'GET',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Frappe-CSRF-Token':native?.csrfToken??''},body:post?JSON.stringify(args):undefined});
 const data=await response.json().catch(()=>({}));
 if(!response.ok){
  let message='';
  try{message=JSON.parse(JSON.parse(data._server_messages)[0]).message}catch{message=data.exception?.split(':').slice(1).join(':').trim()||''}
  throw new Error(message||__('Something went wrong. Try again.'));
 }
 return data.message as T;
}

const STORE='quest-automations-copilot:';
function load(key:string):Msg[]{
 try{
  const saved=JSON.parse(localStorage.getItem(STORE+key)||'[]') as Msg[];
  // a proposal from an earlier visit was made for a board that may be gone; it can't be applied blind
  return saved.map(m=>m.state==='proposed'||m.state==='open'?{...m,state:'expired'}:m.state==='applied'?{...m,before:undefined}:m);
 }catch{return []}
}
function store(key:string,messages:Msg[]){
 try{localStorage.setItem(STORE+key,JSON.stringify(messages.slice(-40).map(m=>({...m,before:undefined}))))}catch{/* the chat still works without browser storage */}
}
// the editor keeps an empty description as '', the server as null
const norm=(w:CopilotWorkflow):CopilotWorkflow=>({name:w.name??'',description:w.description??'',triggers:w.triggers??[],steps:w.steps??[]});
const same=(a:CopilotWorkflow,b:CopilotWorkflow)=>JSON.stringify(norm(a))===JSON.stringify(norm(b));

const STARTERS_EMPTY=['When a new lead comes in, create a call task for its owner','Every Monday, remind me of deals with no activity','When a booking is completed, have the AI summarize the notes'];
const STARTERS=['Explain what this workflow does','Add a reminder one day later','Notify me when it finishes','Make the messages friendlier'];

const EFFORTS:Record<string,string>={default:'Default',minimal:'Minimal',low:'Light',medium:'Medium',high:'High',xhigh:'Extra high',max:'Max'};
function modelName(m:Model|null|undefined){
 const raw=String(m?.model||m?.label||'').trim();
 if(!raw)return __('Model');
 const claude=raw.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?/i);
 if(claude)return `${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3]?'.'+claude[3]:''}`;
 if(/^gpt-/i.test(raw))return 'GPT-'+raw.slice(4);
 return raw.replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
}

function ModelMenu({status,disabled,onModel,onEffort}:{status:Status;disabled:boolean;onModel:(name:string)=>void;onEffort:(level:string)=>void}){
 const [open,setOpen]=useState(false);const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;const close=(e:MouseEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false)};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close)},[open]);
 const active=status.active;const efforts=active?.reasoning_efforts??[];
 const isActive=(m:Model)=>status.selected?m.name===status.selected:m.name===active?.name;
 return <div ref={root} className="relative" onKeyDown={e=>{if(e.key==='Escape'&&open){e.stopPropagation();setOpen(false)}}}>
  <button type="button" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(o=>!o)}
   aria-label={__('Model: {0}',[modelName(active)])}
   className="flex max-w-[200px] items-center gap-1.5 rounded-md px-2 py-1 text-xs text-neutral-400 hover:bg-raised hover:text-white disabled:opacity-40">
   <span className="truncate">{modelName(active)}</span>
   {status.effort!=='default'&&<span className="text-neutral-500">· {__(EFFORTS[status.effort]??status.effort,null,'Thinking level')}</span>}
   <span aria-hidden="true">▾</span>
  </button>
  {open&&<div role="menu" className="absolute bottom-full left-0 z-20 mb-2 max-h-80 w-72 overflow-y-auto rounded-lg border border-edge bg-panel p-1 shadow-lg">
   <p className="px-2 pb-1 pt-1.5 text-[11px] uppercase tracking-wide text-neutral-500">{__('Model')}</p>
   {status.models.map(m=><button key={m.name} type="button" role="menuitemradio" aria-checked={isActive(m)} onClick={()=>{onModel(m.name);setOpen(false)}}
    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm text-white hover:bg-raised">
    <span className="min-w-0"><span className="block truncate">{modelName(m)}</span><span className="block truncate text-xs text-neutral-500">{m.provider}{m.tier?' · '+__(m.tier):''}</span></span>
    {isActive(m)&&<span aria-hidden="true" className="text-accent">✓</span>}
   </button>)}
   {status.selected&&<button type="button" role="menuitem" onClick={()=>{onModel('');setOpen(false)}} className="w-full rounded-md px-2 py-1.5 text-left text-xs text-neutral-400 hover:bg-raised hover:text-white">{__('Use the default model')}</button>}
   {efforts.length>0&&<>
    <div className="my-1 border-t border-edge"/>
    <p className="px-2 pb-1 pt-1 text-[11px] uppercase tracking-wide text-neutral-500">{__('Thinking')}</p>
    <div className="flex flex-wrap gap-1 px-2 pb-2">{['default',...efforts].map(level=><button key={level} type="button" role="menuitemradio" aria-checked={status.effort===level} onClick={()=>onEffort(level)}
     className={`rounded-md border px-2 py-1 text-xs ${status.effort===level?'border-accent text-accent':'border-edge text-neutral-400 hover:text-white'}`}>{__(EFFORTS[level]??level,null,'Thinking level')}</button>)}</div>
   </>}
  </div>}
 </div>;
}

export function CopilotPanel({ctx,onClose}:{ctx:CopilotContext;onClose:()=>void}){
 const [messages,setMessages]=useState<Msg[]>(()=>load(ctx.key));
 const [draft,setDraft]=useState('');
 const [status,setStatus]=useState<Status|null>(null);const [statusFailed,setStatusFailed]=useState(false);
 const [busy,setBusy]=useState(false);const [stage,setStage]=useState('');const [partial,setPartial]=useState('');
 const [modelSaving,setModelSaving]=useState(false);const [modelError,setModelError]=useState('');
 const turn=useRef(0);const thread=useRef<HTMLDivElement>(null);const input=useRef<HTMLTextAreaElement>(null);
 const now=norm(ctx.get());const nowJson=JSON.stringify(now);

 useEffect(()=>{setMessages(load(ctx.key))},[ctx.key]);
 useEffect(()=>{store(ctx.key,messages)},[ctx.key,messages]);
 useEffect(()=>{call<Status>('status',{},false).then(setStatus).catch(()=>setStatusFailed(true))},[]);
 useEffect(()=>{input.current?.focus()},[]);
 useLayoutEffect(()=>{const el=thread.current;if(el)el.scrollTop=el.scrollHeight},[messages.length,busy,partial]);

 const configured=status?status.configured:statusFailed;
 const last=[...messages].reverse().find(m=>m.role==='assistant');
 const suggestions=!busy&&last?.suggestions?.length?last.suggestions:[];
 const openClarify=last?.clarify&&last.state==='open'?last:null;
 const empty=!now.steps.length&&!now.triggers.length;

 function history(){
  return messages.filter(m=>!m.cancelled).slice(-10).map(m=>m.role==='user'?{role:'user',text:m.text}:
   {role:'assistant',text:[m.reply||m.clarify||m.error||'',m.changes?.length?'Changes: '+m.changes.join('; '):'',m.state?'('+m.state+')':''].filter(Boolean).join(' ')});
 }

 async function send(text?:string,answered=false){
  const prompt=(text??draft).trim();
  if(!prompt||busy||modelSaving)return;
  if(text===undefined)setDraft('');
  const past=history();const workflow=norm(ctx.get());const askedOn=JSON.stringify(workflow);
  const mine=++turn.current;
  setMessages(ms=>[...ms.map(m=>m.state==='proposed'||m.state==='open'?{...m,state:'superseded' as const}:m),{role:'user',text:prompt}]);
  setBusy(true);setStage(__('Reading the workflow…'));setPartial('');
  let reply:Msg;
  try{
   const {job}=await call<{job:string}>('start',{prompt,workflow,history:past,selected:ctx.selected,answered:answered?1:0});
   const started=Date.now();let result:any=null;
   while(mine===turn.current){
    const state=await call<any>('poll',{job},false);
    if(state.stage)setStage(state.stage);
    if(state.partial)setPartial(state.partial);
    if(state.state==='done'){result=state.result;break}
    if(state.state==='failed')throw new Error(state.error||__('Something went wrong. Try again.'));
    if(Date.now()-started>600000)throw new Error(__('The AI took too long. Try again.'));
    await new Promise(r=>setTimeout(r,700));
   }
   if(mine!==turn.current)return;
   reply=result.clarify?{role:'assistant',clarify:result.clarify,options:result.options??[],state:'open'}:
    {role:'assistant',reply:result.reply,changes:result.changes,notes:result.notes,suggestions:result.suggestions,proposal:result.proposal,token:result.token,state:result.proposal?'proposed':undefined,askedOn};
  }catch(e){
   if(mine!==turn.current)return;
   reply={role:'assistant',error:(e as Error).message};
  }
  setMessages(ms=>[...ms,reply]);setBusy(false);setPartial('');
  requestAnimationFrame(()=>input.current?.focus());
 }

 function cancel(){
  turn.current++;setBusy(false);setPartial('');
  setMessages(ms=>[...ms,{role:'assistant',cancelled:true}]);
 }

 async function apply(index:number){
  const m=messages[index];if(!m.proposal)return;
  try{
   await call('prepare',{token:m.token??null});
  }catch(e){
   setMessages(ms=>ms.map((x,i)=>i===index?{...x,notes:[...(x.notes??[]),(e as Error).message]}:x));return;
  }
  const before=norm(ctx.get());const after=norm(m.proposal);
  ctx.apply(after);
  setMessages(ms=>ms.map((x,i)=>i===index?{...x,state:'applied',before,appliedAs:JSON.stringify(after)}:x));
 }

 function undo(index:number){
  const m=messages[index];if(!m.before)return;
  ctx.apply(m.before);
  setMessages(ms=>ms.map((x,i)=>i===index?{...x,state:'undone',before:undefined}:x));
 }

 function newConversation(){
  if(busy)return;
  setMessages([]);setDraft('');requestAnimationFrame(()=>input.current?.focus());
 }

 async function chooseModel(name:string){
  if(!status)return;setModelSaving(true);setModelError('');
  try{
   const next=status.models.find(m=>m.name===name)??null;
   const effort=status.effort!=='default'&&(next??status.active)?.reasoning_efforts?.includes(status.effort)?status.effort:'default';
   setStatus(await call<Status>('set_model',{connection:name,reasoning_effort:effort}));
  }catch{setModelError(__('Could not switch models. Try again.'))}finally{setModelSaving(false)}
 }
 async function chooseEffort(level:string){
  if(!status)return;setModelSaving(true);setModelError('');
  try{setStatus(await call<Status>('set_model',{connection:status.selected,reasoning_effort:level}))}
  catch{setModelError(__('Could not switch models. Try again.'))}finally{setModelSaving(false)}
 }

 const placeholder=openClarify?__('Type your answer…'):ctx.selectedLabel?__('What should change here?'):empty?__('Describe the automation you want…'):__('Ask for any change to this workflow…');
 const starters=useMemo(()=>empty?STARTERS_EMPTY:STARTERS,[empty]);

 return <aside role="complementary" aria-labelledby="copilot-title" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose()}}}
  className="flex h-full min-h-0 w-full flex-col border-l border-edge bg-panel">
  <div className="flex items-start gap-2 border-b border-edge px-4 py-3">
   <div className="min-w-0 flex-1">
    <h2 id="copilot-title" className="flex items-center gap-1.5 text-sm font-semibold text-white"><span aria-hidden="true" className="text-accent">✦</span>{__('AI assistant')}</h2>
    <p className="mt-0.5 truncate text-xs text-neutral-500">
     {ctx.selectedLabel?<>{__('Working on')}: <b className="font-medium text-neutral-300">{ctx.selectedLabel}</b></>:<>{__('Working on')}: <b className="font-medium text-neutral-300">{now.name||__('this workflow')}</b></>}
    </p>
   </div>
   {messages.length>0&&<button type="button" onClick={newConversation} disabled={busy} title={__('New conversation')} aria-label={__('New conversation')} className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-raised hover:text-white disabled:opacity-40">✎</button>}
   <button type="button" onClick={onClose} title={__('Close (Esc)')} aria-label={__('Close')} className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-raised hover:text-white">✕</button>
  </div>

  <div ref={thread} role="log" aria-live="polite" aria-label={__('Conversation with the AI assistant')} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
   {status&&!configured&&<div className="rounded-md border border-edge bg-ink p-3 text-sm text-neutral-300">
    <p>{status.bridge_installed?__('The assistant uses your AI models. No model is available to you yet.'):__('The assistant needs FAC Model Bridge. Ask your administrator to install it.')}</p>
    {status.bridge_installed&&<a href={status.setup_url} target="_blank" rel="noopener" className="mt-2 inline-block text-accent hover:underline">{__('Open AI Command Center')} ↗</a>}
   </div>}

   {configured&&!messages.length&&<div className="space-y-3">
    <p className="text-sm font-medium text-white">{empty?__('Describe it and I will build it'):__('Ask for any change to this workflow')}</p>
    <p className="text-sm leading-6 text-neutral-400">{__('Triggers, steps, wording, waits, conditions. You see the list of changes first, and one click on Undo takes the whole thing back. Nothing is saved until you press Save.')}</p>
    <div className="flex flex-wrap gap-2">{starters.map(s=><button key={s} type="button" onClick={()=>send(__(s))} className="rounded-full border border-edge px-3 py-1 text-left text-xs text-neutral-300 hover:border-accent hover:text-white">{__(s)}</button>)}</div>
   </div>}

   {messages.map((m,i)=>m.role==='user'
    ?<div key={i} dir="auto" className="ml-8 whitespace-pre-wrap rounded-lg bg-raised px-3 py-2 text-sm text-white">{m.text}</div>
    :<div key={i} className="mr-4 space-y-2 text-sm text-neutral-200">
     {m.error&&<p dir="auto" role="alert" className="rounded-md border border-red-400/50 px-3 py-2 text-red-400">{m.error}</p>}
     {m.cancelled&&<p className="text-xs text-neutral-500">{__('Stopped, nothing changed')}</p>}
     {m.clarify&&<>
      <p dir="auto" className="leading-6">{m.clarify}</p>
      {m.state==='open'&&<div className="flex flex-wrap gap-2">{m.options?.map(o=><button key={o} type="button" disabled={busy} onClick={()=>{setMessages(ms=>ms.map((x,j)=>j===i?{...x,state:'answered'}:x));send(o,true)}} className="rounded-full border border-edge px-3 py-1 text-xs text-neutral-300 hover:border-accent hover:text-white">{o}</button>)}</div>}
      {m.state==='superseded'&&<p className="text-xs text-neutral-500">{__('A newer request replaced this question')}</p>}
     </>}
     {m.reply&&<p dir="auto" className="whitespace-pre-wrap leading-6">{m.reply}</p>}
     {!!m.changes?.length&&<ul dir="auto" className="space-y-1 rounded-md border border-edge bg-ink px-3 py-2">
      {m.changes.map((c,ci)=><li key={ci} className="flex gap-2 text-sm"><span aria-hidden="true" className="text-accent">+</span><span>{c}</span></li>)}
     </ul>}
     {!!m.notes?.length&&<ul dir="auto" className="space-y-1 text-xs text-amber-500">{m.notes.map((n,ni)=><li key={ni}>{n}</li>)}</ul>}
     {m.proposal&&m.state==='proposed'&&<>
      <div className="flex gap-2">
       <button type="button" disabled={!!m.askedOn&&m.askedOn!==nowJson} onClick={()=>apply(i)} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-ink hover:bg-primary-hover disabled:opacity-40">{__('Apply ({0})',[m.changes?.length??0])}</button>
       <button type="button" onClick={()=>setMessages(ms=>ms.map((x,j)=>j===i?{...x,state:'discarded'}:x))} className="rounded-md bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/15">{__('Discard')}</button>
      </div>
      {!!m.askedOn&&m.askedOn!==nowJson&&<p className="text-xs text-neutral-500">{__('The workflow changed since this was proposed. Ask again.')}</p>}
     </>}
     {m.state==='applied'&&<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-emerald-400"><span aria-hidden="true">✓</span>{__('Applied ({0})',[m.changes?.length??0])}
      {m.before&&m.appliedAs&&same(JSON.parse(m.appliedAs),now)&&<button type="button" onClick={()=>undo(i)} className="text-accent hover:underline">{__('Undo')}</button>}
      <span className="text-neutral-500">{__('Press Save to keep it.')}</span></p>}
     {m.state==='discarded'&&<p className="text-xs text-neutral-500">{__('Discarded, nothing changed')}</p>}
     {m.state==='undone'&&<p className="text-xs text-neutral-500">{__('Undone, the workflow is back as it was')}</p>}
     {m.state==='superseded'&&m.proposal&&<p className="text-xs text-neutral-500">{__('A newer request replaced this proposal, nothing changed')}</p>}
     {m.state==='expired'&&<p className="text-xs text-neutral-500">{__('From an earlier visit, nothing changed')}</p>}
    </div>)}

   {busy&&<div className="mr-4 space-y-1 text-sm">
    {partial&&<p dir="auto" className="whitespace-pre-wrap leading-6 text-neutral-200">{partial}</p>}
    <p className="flex items-center gap-2 text-xs text-neutral-500"><span className="inline-flex gap-0.5" aria-hidden="true"><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-500"/><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-500 [animation-delay:150ms]"/><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-500 [animation-delay:300ms]"/></span>{stage}
     <button type="button" onClick={cancel} className="text-accent hover:underline">{__('Cancel')}</button></p>
   </div>}

   {suggestions.length>0&&<div className="flex flex-wrap gap-2 pt-1">{suggestions.map(s=><button key={s} type="button" onClick={()=>send(s)} dir="auto" className="rounded-full border border-edge px-3 py-1 text-left text-xs text-neutral-300 hover:border-accent hover:text-white">{s}</button>)}</div>}
  </div>

  <form className="border-t border-edge p-3" onSubmit={e=>{e.preventDefault();send(undefined,!!openClarify)}}>
   <div className={`rounded-lg border border-edge bg-ink focus-within:border-accent ${busy||!configured?'opacity-60':''}`}>
    <textarea ref={input} value={draft} onChange={e=>setDraft(e.target.value)} rows={2} dir="auto" disabled={busy||modelSaving||!configured}
     placeholder={placeholder} aria-label={__('Message to the AI assistant')}
     onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send(undefined,!!openClarify)}}}
     className="block w-full resize-none bg-transparent px-3 pt-2.5 text-sm text-white placeholder:text-neutral-500 focus:outline-none"/>
    <div className="flex items-center gap-2 px-1.5 pb-1.5">
     {status&&configured&&<ModelMenu status={status} disabled={busy||modelSaving} onModel={chooseModel} onEffort={chooseEffort}/>}
     <span className="flex-1"/>
     <button type="submit" disabled={busy||modelSaving||!configured||!draft.trim()} title={__('Send (Enter)')} aria-label={__('Send (Enter)')}
      className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-ink hover:bg-primary-hover disabled:opacity-30">↑</button>
    </div>
   </div>
   {modelError&&<p role="alert" className="mt-1 text-xs text-red-400">{modelError}</p>}
  </form>
 </aside>;
}
