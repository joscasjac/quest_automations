// Build an automation by describing it: write what should happen, answer a question or two, read
// the plan in plain sentences, try it on a real record, turn it on. The server (builder.py) writes
// the workflow; the visual editor stays available for the details.
import {useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {useNavigate,useSearchParams} from 'react-router-dom';
import {Button,Panel} from '../components/ui';
import {__} from '../lib/i18n';

type Sentence={kind:string;text:string;then?:Sentence[];else?:Sentence[];steps?:Sentence[];took?:'then'|'else';result?:Record<string,unknown>};
type Question={question:string;choices:string[]};
type Draft={plan:any;sentences:Sentence[];notes:string[];ai_steps:number};
type TestResult={record:string|null;doctype:string|null;trigger:Sentence;steps:Sentence[];notes:string[]};
type Context={lang:'es'|'en';model:string|null;problem:string|null;recipes:Array<{title:string;text:string}>};

const WORDS={
 title:__('Build with AI'),
 subtitle:__('Say what should happen. The AI builds the automation; you review and test it before turning it on.'),
 ask:__('What should happen?'),
 placeholder:__('E.g. When a new lead comes in, create a call task for the lead owner and let me know if it came from the website.'),
 recipes:__('Or start from one of these'),
 make:__('Build the plan'),
 making:__('Building the plan…'),
 questions:__('A couple of questions first'),
 questionsHint:__('So the automation does exactly what you want.'),
 other:__('Another answer…'),
 continue:__('Continue'),
 plan:__('Here’s how it would work'),
 name:__('Name'),
 change:__('Anything to change?'),
 changePlaceholder:__('E.g. also let Maria know'),
 changeButton:__('Apply change'),
 changing:__('Changing…'),
 test:__('Try it on a real record'),
 testing:__('Trying…'),
 save:__('Save without turning on'),
 activate:__('Turn on'),
 activating:__('Turning on…'),
 startOver:__('Start over'),
 tested:__('Tried with'),
 testedNone:__('Trial'),
 nothingDone:__('Nothing was created, changed or sent. AI steps did run so you can see what they would write.'),
 then:__('Yes:'),
 else:__('Otherwise:'),
 took:__('would take this path'),
 skipped:__('doesn’t apply'),
 active:__('Done and turned on!'),
 activeText:__('It starts with the next record that matches. Every run shows in its history.'),
 saved:__('Saved, not turned on'),
 savedText:__('Turn it on whenever you like, here or from the list.'),
 advanced:__('Open in the advanced editor'),
 back:__('Back to my automations'),
 another:__('Build another'),
 noModel:__('Choose an AI model first'),
 openAi:__('Open AI Command Center'),
 editedElsewhere:__('This automation was edited in the advanced editor. Open it there to change it.'),
 uses:__('Uses'),
 nothingDoneShort:__('Nothing was created, changed or sent.'),
 stepWords:{trigger:__('When'),ai:__('AI'),task:__('Task'),note:__('Note'),notify:__('Notice'),email:__('Mail'),sms:__('SMS'),update:__('Change'),wait:__('Wait'),if:__('If'),link:__('Link'),other:__('Step')} as Record<string,string>,
};

async function call<T>(method:string,args:Record<string,unknown>={},post=true):Promise<T>{
 const native=(window as any).automationFrappe;
 const url='/api/method/quest_automations.builder.'+method+(post?'':'?'+new URLSearchParams(args as Record<string,string>));
 const response=await fetch(url,{method:post?'POST':'GET',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Frappe-CSRF-Token':native?.csrfToken??''},body:post?JSON.stringify(args):undefined});
 const data=await response.json().catch(()=>({}));
 if(!response.ok){
  let message='';
  try{message=JSON.parse(JSON.parse(data._server_messages)[0]).message}catch{message=data.exception?.split(':').slice(1).join(':').trim()||''}
  throw new Error(message||__('Something went wrong. Try again.'));
 }
 return data.message as T;
}

// ⟦Field⟧ markers from the server become chips.
function Rich({text}:{text:string}){
 const parts=text.split(/(⟦[^⟧]*⟧)/);
 return <>{parts.map((p,i)=>p.startsWith('⟦')?<span key={i} className="mx-0.5 inline-block rounded bg-accent/15 px-1.5 py-px text-[0.92em] text-accent">{p.slice(1,-1)}</span>:<span key={i}>{p}</span>)}</>;
}

const TONE:Record<string,string>={trigger:'bg-accent/15 text-accent',ai:'bg-accent/25 text-accent',if:'bg-amber-500/15 text-amber-500',wait:'bg-white/10 text-neutral-400'};
function Chip({kind,words}:{kind:string;words:Record<string,string>}){
 return <span className={`mt-0.5 inline-flex w-16 shrink-0 justify-center rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[kind]??'border border-emerald-800 text-emerald-400'}`}>{words[kind]??words.other}</span>;
}

function Steps({items,words,nested=false}:{items:Sentence[];words:typeof WORDS;nested?:boolean}):ReactNode{
 return <ol className={nested?'mt-2 space-y-2 border-l border-edge pl-4':'space-y-2'}>{items.map((s,i)=><li key={i} className="rounded-md border border-edge bg-ink px-3 py-2.5">
  <div className="flex items-start gap-3"><Chip kind={s.kind} words={words.stepWords}/><p className="text-sm leading-6 text-white"><Rich text={s.text}/></p></div>
  {s.result&&<dl className="mt-2 space-y-1.5 rounded-md bg-white/5 p-3 text-sm">{Object.entries(s.result).map(([k,v])=><div key={k}><dt className="text-xs text-neutral-500">{k}</dt><dd className="whitespace-pre-wrap text-neutral-200">{typeof v==='boolean'?(v?'✓':'✗'):String(v)}</dd></div>)}</dl>}
  {(s.then?.length||s.else?.length)?<div className="mt-1 space-y-1 pl-[76px]">
   {!!s.then?.length&&<div><p className="mt-1 text-xs text-neutral-500">{words.then}</p><Steps items={s.then} words={words} nested/></div>}
   {!!s.else?.length&&<div><p className="mt-1 text-xs text-neutral-500">{words.else}</p><Steps items={s.else} words={words} nested/></div>}
  </div>:null}
  {s.took&&<div className="mt-1 pl-[76px]"><p className="mt-1 text-xs text-neutral-500">{s.took==='then'?words.then:words.else} {words.took}</p>{s.steps?.length?<Steps items={s.steps} words={words} nested/>:null}</div>}
 </li>)}</ol>;
}

export function DescribePage(){
 const navigate=useNavigate();const [params]=useSearchParams();const existing=params.get('id');
 const [ctx,setCtx]=useState<Context|null>(null);const w=WORDS;
 const [description,setDescription]=useState('');
 const [questions,setQuestions]=useState<Question[]|null>(null);const [answers,setAnswers]=useState<string[]>([]);
 const [draft,setDraft]=useState<Draft|null>(null);const [change,setChange]=useState('');
 const [trial,setTrial]=useState<TestResult|null>(null);
 const [busy,setBusy]=useState<string|null>(null);const [error,setError]=useState('');
 const [workflowId,setWorkflowId]=useState<string|null>(existing);const [done,setDone]=useState<'active'|'draft'|null>(null);
 const [elsewhere,setElsewhere]=useState(false);
 const box=useRef<HTMLTextAreaElement>(null);

 useEffect(()=>{call<Context>('context',{},false).then(setCtx).catch(e=>setError(e.message))},[]);
 useEffect(()=>{if(!existing)return;call<any>('load',{workflow_id:existing},false).then(r=>{
  if(!r.simple){setElsewhere(true);return}
  setDescription(r.description);setDraft({plan:r.plan,sentences:r.sentences,notes:[],ai_steps:0});
 }).catch(e=>setError(e.message))},[existing]);

 async function run<T>(label:string,fn:()=>Promise<T>):Promise<T|undefined>{
  setBusy(label);setError('');
  try{return await fn()}catch(e){setError((e as Error).message)}finally{setBusy(null)}
 }
 async function make(withAnswers?:Array<{question:string;answer:string}>){
  const result=await run('make',()=>call<any>('draft',{description,answers:withAnswers??null}));
  if(!result)return;
  if(result.questions){setQuestions(result.questions);setAnswers(result.questions.map(()=>''));return}
  setQuestions(null);setDraft(result);setTrial(null);
 }
 async function applyChange(){
  if(!draft||!change.trim())return;
  const result=await run('change',()=>call<Draft>('draft',{description,current:draft.plan,change}));
  if(result){setDraft(result);setChange('');setTrial(null);setDescription(d=>d+'\n'+change)}
 }
 async function tryIt(){
  if(!draft)return;const result=await run('test',()=>call<TestResult>('test',{plan:draft.plan}));if(result)setTrial(result);
 }
 async function save(activate:boolean){
  if(!draft)return;
  const result=await run(activate?'activate':'save',()=>call<{id:string;status:string}>('save',{plan:draft.plan,description,workflow_id:workflowId,activate:activate?1:0}));
  if(result){setWorkflowId(result.id);setDone(activate?'active':'draft')}
 }
 function reset(){setDescription('');setQuestions(null);setDraft(null);setTrial(null);setDone(null);setWorkflowId(null);setError('');navigate('/app/workflows/describe');setTimeout(()=>box.current?.focus(),0)}

 const header=<div className="mb-6"><button type="button" onClick={()=>navigate('/app/workflows')} className="mb-3 text-sm text-neutral-500 hover:text-white">← {w.back}</button>
  <h1 className="text-2xl font-semibold text-white">{w.title}</h1><p className="mt-1 max-w-2xl text-sm text-neutral-500">{w.subtitle}</p></div>;
 const alert=error&&<p role="alert" className="mb-4 rounded-md border border-red-900 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>;

 if(elsewhere)return <div className="mx-auto max-w-3xl">{header}<Panel className="p-6"><p className="text-sm text-neutral-300">{w.editedElsewhere}</p><div className="mt-4"><Button variant="primary" onClick={()=>navigate('/app/workflows/'+existing)}>{w.advanced}</Button></div></Panel></div>;

 if(done)return <div className="mx-auto max-w-3xl">{header}<Panel className="p-8 text-center">
  <div className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full text-xl ${done==='active'?'border border-emerald-800 text-emerald-400':'bg-white/10 text-neutral-300'}`}>{done==='active'?'✓':'•'}</div>
  <h2 className="text-lg font-semibold text-white">{done==='active'?w.active:w.saved}</h2>
  <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500">{done==='active'?w.activeText:w.savedText}</p>
  <div className="mt-6 flex flex-wrap justify-center gap-2">
   {done==='draft'&&<Button variant="primary" onClick={()=>save(true)} disabled={!!busy}>{busy==='activate'?w.activating:w.activate}</Button>}
   <Button onClick={()=>navigate('/app/workflows/'+workflowId)}>{w.advanced}</Button>
   <Button variant="ghost" onClick={()=>navigate('/app/workflows')}>{w.back}</Button>
   <Button variant="ghost" onClick={reset}>{w.another}</Button>
  </div></Panel></div>;

 return <div className="mx-auto max-w-3xl pb-16">{header}{alert}
  {ctx?.problem&&<div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3"><div><p className="text-sm font-medium text-amber-500">{w.noModel}</p><p className="text-sm text-neutral-400">{ctx.problem}</p></div><a href="/ai/models" className="text-sm text-accent hover:underline">{w.openAi} →</a></div>}

  {!draft&&<Panel className="p-5">
   <label htmlFor="describe" className="text-sm font-medium text-white">{w.ask}</label>
   <textarea id="describe" ref={box} value={description} onChange={e=>setDescription(e.target.value)} rows={4} placeholder={w.placeholder} autoFocus
    className="mt-2 w-full resize-y rounded-md border border-edge bg-ink px-3 py-2.5 text-[15px] leading-6 text-white placeholder:text-neutral-500 focus:border-accent focus:outline-none" disabled={!!questions}/>
   {questions?<div className="mt-5 space-y-5 border-t border-edge pt-5">
    <div><h2 className="text-sm font-medium text-white">{w.questions}</h2><p className="text-sm text-neutral-500">{w.questionsHint}</p></div>
    {questions.map((q,i)=><fieldset key={i}><legend className="mb-2 text-sm text-neutral-200">{q.question}</legend>
     <div className="flex flex-wrap gap-2">{q.choices.map(c=><button type="button" key={c} aria-pressed={answers[i]===c} onClick={()=>setAnswers(a=>a.map((x,n)=>n===i?c:x))}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${answers[i]===c?'border-accent bg-accent/15 text-accent':'border-edge text-neutral-300 hover:border-edge-strong'}`}>{c}</button>)}</div>
     <input value={q.choices.includes(answers[i])?'':answers[i]} onChange={e=>setAnswers(a=>a.map((x,n)=>n===i?e.target.value:x))} placeholder={w.other} aria-label={q.question}
      className="mt-2 w-full rounded-md border border-edge bg-ink px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-accent focus:outline-none"/>
    </fieldset>)}
    <div className="flex gap-2"><Button variant="primary" disabled={!!busy||answers.some(a=>!a.trim())} onClick={()=>make(questions.map((q,i)=>({question:q.question,answer:answers[i]})))}>{busy?w.making:w.continue}</Button><Button variant="ghost" onClick={()=>setQuestions(null)}>{w.startOver}</Button></div>
   </div>:<div className="mt-3 flex justify-end"><Button variant="primary" disabled={!!busy||description.trim().length<3||!!ctx?.problem} onClick={()=>make()}>{busy?w.making:w.make}</Button></div>}
  </Panel>}

  {!draft&&!questions&&!!ctx?.recipes.length&&<section className="mt-8"><h2 className="mb-3 text-sm text-neutral-500">{w.recipes}</h2>
   <div className="grid gap-3 sm:grid-cols-2">{ctx.recipes.map(r=><button type="button" key={r.title} onClick={()=>{setDescription(r.text);box.current?.focus()}}
    className="rounded-lg border border-edge bg-panel p-4 text-left transition-colors hover:border-edge-strong">
    <p className="text-sm font-medium text-white">{r.title}</p><p className="mt-1 line-clamp-3 text-sm text-neutral-500">{r.text}</p></button>)}</div></section>}

  {draft&&<>
   <Panel className="p-5">
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
     <label className="min-w-0 flex-1 text-xs text-neutral-500">{w.name}
      <input value={draft.plan.name??''} onChange={e=>setDraft({...draft,plan:{...draft.plan,name:e.target.value}})} className="mt-1 w-full border-0 border-b border-transparent bg-transparent p-0 pb-1 text-lg font-semibold text-white focus:border-accent focus:outline-none"/></label>
     <Button variant="ghost" onClick={reset}>{w.startOver}</Button>
    </div>
    <h2 className="mb-3 text-sm text-neutral-500">{w.plan}</h2>
    <Steps items={draft.sentences} words={w}/>
    {draft.notes.map(n=><p key={n} className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-500">{n}</p>)}
    <form className="mt-5 flex gap-2 border-t border-edge pt-4" onSubmit={e=>{e.preventDefault();applyChange()}}>
     <input value={change} onChange={e=>setChange(e.target.value)} placeholder={w.changePlaceholder} aria-label={w.change}
      className="min-w-0 flex-1 rounded-md border border-edge bg-ink px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-accent focus:outline-none"/>
     <Button type="submit" disabled={!!busy||!change.trim()}>{busy==='change'?w.changing:w.changeButton}</Button>
    </form>
   </Panel>

   {trial&&<Panel className="mt-4 p-5">
    <h2 className="mb-3 text-sm text-neutral-500">{trial.record?<>{w.tested} <span className="font-medium text-white">{trial.record}</span></>:w.testedNone}</h2>
    <Steps items={[trial.trigger,...trial.steps]} words={w}/>
    <p className="mt-3 text-xs text-neutral-500">{trial.steps.some(s=>s.kind==='ai')?w.nothingDone:w.nothingDoneShort}</p>
   </Panel>}

   <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-edge bg-ink/90 py-3 backdrop-blur">
    <Button onClick={tryIt} disabled={!!busy}>{busy==='test'?w.testing:w.test}</Button>
    <Button variant="ghost" onClick={()=>save(false)} disabled={!!busy}>{w.save}</Button>
    <Button variant="primary" onClick={()=>save(true)} disabled={!!busy}>{busy==='activate'?w.activating:w.activate}</Button>
   </div>
  </>}
 </div>;
}
