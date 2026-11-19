// CRM steps and the "Added from the CRM" trigger, provided by the crm_campaigns app on this site.
// Steps are ERPNext actions with a crm_* operation (like Pulse actions); the site runs them.
import {useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {Select} from '../components/ui';
import {MappedInput} from './Editors';
import {RichEmail} from './RichEmail';
import {ErpConditionFields} from './ErpFields';
import type {ErpStep,Trigger} from './types';
import type {MergeFieldOption} from '../lib/mergeFields';

export type CrmOperation=`crm_${string}`;
export const CRM_OPERATIONS=['crm_send_email','crm_send_whatsapp','crm_send_sms'] as const;
export function isCrmOperation(value:string):value is CrmOperation{return (CRM_OPERATIONS as readonly string[]).includes(value)}

const TITLES:Record<string,{title:string;description:string;label:string;config:Record<string,unknown>}>={
 crm_send_email:{title:'CRM: send campaign email',description:'Email the lead or deal, as a campaign or from the owner’s mailbox. Opens, clicks and replies can steer later steps.',label:'Send email',config:{subject:'',preheader:'',body:'',send_as:'campaign'}},
 crm_send_whatsapp:{title:'CRM: send WhatsApp template',description:'Send an approved WhatsApp template. It shows in the lead’s Conversations.',label:'Send WhatsApp',config:{template:'',fields:''}},
 crm_send_sms:{title:'CRM: send SMS',description:'Send an SMS with the opt-out line. It shows in the lead’s Conversations.',label:'Send SMS',config:{body:''}},
};
export const CRM_ACTION_LIBRARY=CRM_OPERATIONS.map(kind=>({kind:kind as CrmOperation,title:TITLES[kind].title,description:TITLES[kind].description,group:'CRM',icon:'record' as const}));
export function createCrmStep(operation:CrmOperation):Extract<ErpStep,{kind:'erpnext'}>{
 return {kind:'erpnext',operation,label:TITLES[operation].label,configJson:JSON.stringify(TITLES[operation].config)};
}
export const CRM_TRIGGER_LIBRARY=[
 {value:'crm_lead',title:'Lead added from the CRM',description:'Start when someone adds a lead from the CRM, an agent or the API.',group:'CRM',icon:'contact' as const,trigger:{kind:'crm',doctype:'CRM Lead',exit:{onReply:true}}},
 {value:'crm_deal',title:'Deal added from the CRM',description:'Start when someone adds a deal from the CRM, an agent or the API.',group:'CRM',icon:'deal' as const,trigger:{kind:'crm',doctype:'CRM Deal',exit:{onReply:true}}},
];

type Context={templates:Array<{name:string;label:string;body:string;status:string}>;fields:Record<string,{common:Array<{value:string;label:string}>;more:Array<{value:string;label:string}>}>;channels:Record<string,string|null>;email:{provider:string;from:[string,string];problem:string|null};opt_out_line?:string};
let shared:Promise<Context|null>|null=null;
function loadContext():Promise<Context|null>{
 if(shared)return shared;
 const native=(window as any).automationFrappe;
 shared=fetch('/api/method/crm_campaigns.automation.editor_context',{credentials:'same-origin',headers:{Accept:'application/json',...(native?{'X-Frappe-CSRF-Token':native.csrfToken}:{})}}).then(r=>r.ok?r.json():null).then(d=>d?.message??null).catch(()=>null);
 return shared;
}
function useCrmContext(){const [ctx,setCtx]=useState<Context|null>(null);useEffect(()=>{let alive=true;loadContext().then(c=>{if(alive)setCtx(c)});return()=>{alive=false}},[]);return ctx}

function Label({name,hint,children}:{name:string;hint?:string;children:ReactNode}){return <div className="space-y-1.5"><div className="text-sm font-medium text-white">{name}</div>{children}{hint&&<p className="text-xs text-neutral-500">{hint}</p>}</div>}
function Note({children,tone='info'}:{children:ReactNode;tone?:'info'|'warn'}){return <p className={'rounded-md border px-3 py-2 text-xs leading-5 '+(tone==='warn'?'border-amber-500/30 bg-amber-500/10 text-amber-200':'border-edge bg-ink/40 text-neutral-400')}>{children}</p>}

const FIELD_HINT='Write the person’s fields the ERPNext way, such as {{ first_name }}, or pick them from Custom values.';

export function CrmActionFields({step,onChange}:{step:ErpStep;onChange:(s:ErpStep)=>void}){
 const ctx=useCrmContext();
 let config:Record<string,any>={};try{config=JSON.parse(step.configJson)||{}}catch{config={}}
 const update=(patch:Record<string,unknown>)=>onChange({...step,configJson:JSON.stringify({...config,...patch})});
 const op=step.operation as string;
 if(op==='crm_send_email'){
  const personal=config.send_as==='personal';
  return <div className="space-y-5">
   {ctx&&!personal&&ctx.email.problem&&<Note tone="warn">{ctx.email.problem}</Note>}
   <Label name="Send as" hint={personal?'From the owner’s own mailbox (Gmail, Outlook or the ERP account), like a one-to-one email. No campaign layout; a small unsubscribe line is added.':`As a campaign, ${ctx?`with ${ctx.email.provider==='ERP'?'the ERP email account':ctx.email.provider}${ctx.email.from?.[1]?` from ${ctx.email.from[1]}`:''}`:'with the campaign email provider'}. Your business address and an unsubscribe link are added.`}>
    <Select ariaLabel="Send as" value={personal?'personal':'campaign'} options={[{value:'campaign',label:'Campaign email'},{value:'personal',label:'Personal email from the owner'}]} onChange={send_as=>update({send_as})}/>
   </Label>
   <MappedInput label="Subject" value={config.subject??''} onChange={subject=>update({subject})}/>
   {!personal&&<MappedInput label="Preview text (optional)" value={config.preheader??''} onChange={preheader=>update({preheader})}/>}
   <RichEmail value={config.body??''} onChange={body=>update({body})}/>
   <p className="text-xs text-neutral-500">{FIELD_HINT} People who unsubscribed from email are skipped.</p>
  </div>;
 }
 if(op==='crm_send_whatsapp'){
  const templates=(ctx?.templates??[]).filter(t=>t.status==='APPROVED');
  const tpl=(ctx?.templates??[]).find(t=>t.name===config.template);
  const blanks=[...new Set(String(tpl?.body??'').match(/\{\{\d+\}\}/g)??[])].length;
  const chosen=String(config.fields??'').split(',').map(s=>s.trim());
  const fieldOptions=[{value:'',label:'Choose a field'},...Object.values(ctx?.fields??{}).flatMap(f=>[...f.common,...f.more]).filter((f,i,all)=>all.findIndex(x=>x.value===f.value)===i)];
  return <div className="space-y-5">
   {ctx?.channels?.WhatsApp&&<Note tone="warn">{ctx.channels.WhatsApp}</Note>}
   <Label name="Template" hint="Only templates Meta approved can start a WhatsApp conversation. Create them in the CRM: Campaigns → Templates.">
    <Select ariaLabel="WhatsApp template" value={config.template??''} options={[{value:'',label:templates.length?'Choose a template':'No approved templates yet'},...templates.map(t=>({value:t.name,label:t.label}))]} onChange={template=>{const body=(ctx?.templates??[]).find(t=>t.name===template)?.body??'';const n=new Set(body.match(/\{\{\d+\}\}/g)??[]).size;update({template,fields:Array.from({length:n},(_,i)=>i===0?'first_name':'').join(', ')})}}/>
   </Label>
   {tpl&&<p className="whitespace-pre-wrap rounded-md border border-edge bg-ink/40 px-3 py-2 text-sm leading-6 text-neutral-300">{String(tpl.body).split(/(\{\{\d+\}\})/).map((part,i)=>/^\{\{\d+\}\}$/.test(part)?<mark key={i} className="rounded bg-glow px-1 text-accent">{part}</mark>:part)}</p>}
   {Array.from({length:blanks},(_,i)=><Label key={i} name={`Fill {{${i+1}}} with`}><Select ariaLabel={`Field for {{${i+1}}}`} value={chosen[i]??''} options={fieldOptions} onChange={value=>{const next=Array.from({length:blanks},(_,n)=>n===i?value:chosen[n]??'');update({fields:next.join(', ')})}}/></Label>)}
   <p className="text-xs text-neutral-500">It shows in the lead’s Conversations. People who opted out of WhatsApp are skipped.</p>
  </div>;
 }
 const body=String(config.body??'');
 const total=body.length+(ctx?.opt_out_line?ctx.opt_out_line.length+1:0);
 return <div className="space-y-5">
  {ctx?.channels?.SMS&&<Note tone="warn">{ctx.channels.SMS}</Note>}
  <MappedInput label="Message" multiline value={body} onChange={v=>update({body:v})}/>
  <p className="text-xs text-neutral-500">{FIELD_HINT} {ctx?.opt_out_line?`The line “${ctx.opt_out_line}” is added at the end. `:''}About {total} characters ({Math.max(1,Math.ceil(total/160))} SMS per person). It shows in the lead’s Conversations.</p>
 </div>;
}

export function CrmTriggerFields({trigger,onChange}:{trigger:Trigger&{kind:'crm'};onChange:(t:Trigger)=>void}){
 const exit=trigger.exit??{};
 const set=(patch:Record<string,unknown>)=>onChange({...trigger,exit:{...exit,...patch}} as Trigger);
 return <div className="space-y-5 text-sm">
  <Label name="Who can be added">
   <Select ariaLabel="Record type" value={trigger.doctype} options={[{value:'CRM Lead',label:'Leads'},{value:'CRM Deal',label:'Deals'}]} onChange={doctype=>onChange({...trigger,doctype} as Trigger)}/>
  </Label>
  <p className="text-xs text-neutral-500">People join from the CRM (a lead or deal, ticked rows or a filtered list), from an agent (FAC) or the API. Someone already in this workflow is not added twice.</p>
  <div className="space-y-3 rounded-md border border-edge bg-ink/30 p-3">
   <div className="text-xs font-semibold uppercase text-neutral-500">Leave the workflow</div>
   <label className="flex cursor-pointer items-start gap-2.5"><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--color-accent)]" checked={exit.onReply!==false} onChange={e=>set({onReply:e.target.checked})}/><span><span className="text-white">When they reply</span><span className="block text-xs text-neutral-500">A WhatsApp, SMS or email from them ends it, even during a wait, so a person takes over.</span></span></label>
   <p className="text-xs text-neutral-500">Always: when they unsubscribe, their email bounces, or someone takes them out from the CRM.</p>
   <label className="flex cursor-pointer items-start gap-2.5"><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--color-accent)]" checked={!!exit.condition} onChange={e=>set({condition:e.target.checked?{field:'trigger.status',operator:'is',value:''}:undefined})}/><span><span className="text-white">When the record matches</span><span className="block text-xs text-neutral-500">For example: status is Qualified. Checked before every step.</span></span></label>
   {exit.condition&&<ErpConditionFields branch={exit.condition} onChange={condition=>set({condition})} hint="When the lead or deal matches, it leaves before its next step."/>}
  </div>
 </div>;
}

export function crmTriggerTitle(trigger:{doctype?:string}){return trigger.doctype==='CRM Deal'?'Deal added from the CRM':'Lead added from the CRM'}
export function crmTriggerLabel(trigger:{exit?:{onReply?:boolean;condition?:unknown}}){
 const parts=[trigger.exit?.onReply===false?'Keeps going after a reply':'Leaves when they reply'];
 if(trigger.exit?.condition)parts.push('exit condition');
 return parts.join(' · ');
}

// What conditions can read about earlier CRM steps and the person.
const STEP_RESULTS:Array<[string,string]>=[['delivered','Delivered'],['opened','Opened'],['clicked','Clicked a link'],['replied','Replied'],['bounced','Bounced'],['failed','Failed'],['skipped','Skipped (no address or opted out)'],['status','Status']];
export function crmFieldOptions(steps:any[]):MergeFieldOption[]{
 const out:MergeFieldOption[]=[];
 const add=(step:any,prefix:string)=>{if(step?.kind!=='erpnext'||!isCrmOperation(step.operation??''))return;for(const [key,label] of STEP_RESULTS)out.push({path:prefix+'.'+key,label:step.label+' · '+label,group:step.label,description:key==='status'?'Sent, Delivered, Read, Clicked, Replied, Failed or Skipped':'true or false'})};
 steps.forEach((s,i)=>{add(s,'steps.step_'+i);if(s.kind==='if_else')[...s.branches,{steps:s.elseSteps}].forEach((b:any,n:number)=>(b.steps??[]).forEach((child:any,k:number)=>add(child,`steps.step_${i}_branch_${n}_${k}`)))});
 if(out.length||steps.some(s=>s.kind==='if_else'))for(const [key,label] of [['opted_out','Opted out of any channel'],['opted_out_email','Opted out of email'],['opted_out_whatsapp','Opted out of WhatsApp'],['opted_out_sms','Opted out of SMS'],['replied','Replied since joining']])out.push({path:'person.'+key,label,group:'Person (CRM)',description:'true or false'});
 return out;
}
