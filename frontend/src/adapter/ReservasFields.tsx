import {__} from '../lib/i18n';
// Reservas (bookings) on this site: triggers when something happens to a booking, and steps that
// book, move or cancel. Triggers are Booking document events that Reservas announces itself
// (last_event changes), so an ordinary edit in Desk never starts them. Steps are ERPNext actions
// with a reservas_* operation that the reservas app runs.
import {useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {Select} from '../components/ui';
import {MappedInput} from './Editors';
import type {ErpStep,Trigger} from './types';

export type ReservasOperation=`reservas_${string}`;
export const RESERVAS_OPERATIONS=['reservas_booking_link','reservas_find_times','reservas_book','reservas_reschedule','reservas_cancel','reservas_set_status'] as const;
export function isReservasOperation(value:string):value is ReservasOperation{return (RESERVAS_OPERATIONS as readonly string[]).includes(value)}

const THIS_BOOKING='{{trigger.name}}';
const STEPS:Record<string,{title:string;description:string;label:string;config:Record<string,unknown>}>={
 reservas_booking_link:{title:__('Reservas: booking page link'),description:__('Get the link where the customer picks a time, to send in an email or WhatsApp.'),label:__('Booking link'),config:{service:''}},
 reservas_find_times:{title:__('Reservas: find free times'),description:__('Look up open times for a service. Later steps can use the earliest one.'),label:__('Find free times'),config:{service:'',from_date:'',days:7}},
 reservas_book:{title:__('Reservas: book a time'),description:__('Book a service for someone. Paid services hold the time and return a payment link.'),label:__('Book a time'),config:{service:'',start:'',customer_name:'',phone:'',email:''}},
 reservas_reschedule:{title:__('Reservas: move a booking'),description:__('Move a booking to another time. The customer is emailed the change.'),label:__('Move booking'),config:{booking:THIS_BOOKING,start:''}},
 reservas_cancel:{title:__('Reservas: cancel a booking'),description:__('Cancel a booking. A paid one is flagged so someone decides the refund.'),label:__('Cancel booking'),config:{booking:THIS_BOOKING,reason:''}},
 reservas_set_status:{title:__('Reservas: mark completed or no-show'),description:__('Close a confirmed booking as completed or as a no-show.'),label:__('Mark booking'),config:{booking:THIS_BOOKING,status:'Completed'}},
};
export const RESERVAS_ACTION_LIBRARY=RESERVAS_OPERATIONS.map(kind=>({kind:kind as ReservasOperation,title:STEPS[kind].title,description:STEPS[kind].description,group:'Reservas',icon:'calendar' as const}));
export function createReservasStep(operation:ReservasOperation):Extract<ErpStep,{kind:'erpnext'}>{
 return {kind:'erpnext',operation:operation as any,label:STEPS[operation].label,configJson:JSON.stringify(STEPS[operation].config)};
}

// What Reservas announces (reservas.events.EVENTS), with how the editor names it.
const EVENTS:Array<{value:string;title:string;description:string}>=[
 {value:'Booked',title:__('Booking made'),description:__('Someone booked, on the page, through an agent, in Desk or from a workflow. Paid services are still awaiting payment.')},
 {value:'Confirmed',title:__('Booking confirmed'),description:__('Free bookings right away; paid ones once the bank approves.')},
 {value:'Rescheduled',title:__('Booking moved'),description:__('The customer or staff moved it to another time.')},
 {value:'Cancelled',title:__('Booking cancelled'),description:__('The customer or staff cancelled it.')},
 {value:'Expired',title:__('Hold expired'),description:__('The customer did not pay in time and the time was released.')},
 {value:'Reminder sent',title:__('Reminder sent'),description:__('The reminder email went out, before the booking.')},
 {value:'Completed',title:__('Booking completed'),description:__('The booking took place (marked by staff, or 12 hours after it ended).')},
 {value:'No-show',title:__('Customer did not show'),description:__('Staff marked it as a no-show.')},
 {value:'Needs attention',title:__('Booking needs attention'),description:__('Paid after the hold ran out, or cancelled after paying: someone has to decide.')},
];
type Condition={field:string;operator:'is'|'is_not'|'contains'|'does_not_contain'|'is_empty'|'is_not_empty';value:string};
export function reservasTrigger(event:string,service=''):Trigger{
 const condition:any={field:'last_event',operator:'is',value:event};
 if(service)condition.conditions=[{field:'service',operator:'is',value:service}],condition.match='all';
 return {kind:'document_event',doctype:'Booking',event:'on_update',changedFields:['last_event_on'],condition} as Trigger;
}
export const RESERVAS_TRIGGER_LIBRARY=EVENTS.map(e=>({value:'reservas_'+e.value.toLowerCase().replace(/[^a-z]+/g,'_'),title:e.title,description:e.description,group:'Reservas',icon:'calendar' as const,trigger:reservasTrigger(e.value)}));
export function isReservasTrigger(trigger:any):boolean{
 return trigger?.kind==='document_event'&&trigger.doctype==='Booking'&&Array.isArray(trigger.changedFields)&&trigger.changedFields.includes('last_event_on')&&trigger.condition?.field==='last_event';
}
function triggerService(trigger:any):string{return (trigger.condition?.conditions??[]).find((c:Condition)=>c.field==='service')?.value??''}
export function reservasTriggerTitle(trigger:any){return EVENTS.find(e=>e.value===trigger.condition?.value)?.title??__('Reservas booking event')}
export function reservasTriggerLabel(trigger:any){const s=triggerService(trigger);return s?`Reservas · ${s}`:__('Reservas · any booking page')}

type Context={services:Array<{name:string;label:string;enabled:number}>;resources:Array<{name:string;label:string;enabled:number}>};
let shared:Promise<Context|null>|null=null;
function loadContext():Promise<Context|null>{
 if(shared)return shared;
 const native=(window as any).automationFrappe;
 shared=fetch('/api/method/reservas.automation.editor_context',{credentials:'same-origin',headers:{Accept:'application/json',...(native?{'X-Frappe-CSRF-Token':native.csrfToken}:{})}}).then(r=>r.ok?r.json():null).then(d=>d?.message??null).catch(()=>null);
 return shared;
}
function useReservas(){const [ctx,setCtx]=useState<Context|null>(null);useEffect(()=>{let alive=true;loadContext().then(c=>{if(alive)setCtx(c)});return()=>{alive=false}},[]);return ctx}

function Label({name,hint,children}:{name:string;hint?:string;children:ReactNode}){return <div className="space-y-1.5"><div className="text-sm font-medium text-white">{name}</div>{children}{hint&&<p className="text-xs text-neutral-500">{hint}</p>}</div>}

function ServiceSelect({value,onChange,allowAny,ctx}:{value:string;onChange:(v:string)=>void;allowAny?:string;ctx:Context|null}){
 const services=ctx?.services??[];
 const known=!value||services.some(s=>s.name===value)||value.includes('{{');
 return <Select ariaLabel={__('Booking page')} value={value} options={[{value:'',label:allowAny??__('Choose a booking page')},...services.map(s=>({value:s.name,label:s.enabled?s.label:__('{0} (off)',[s.label])})),...(known?[]:[{value,label:__('{0} (not found)',[value])}])]} onChange={onChange}/>;
}

export function ReservasTriggerFields({trigger,onChange}:{trigger:Trigger;onChange:(t:Trigger)=>void}){
 const ctx=useReservas();
 const event=(trigger as any).condition?.value??'Confirmed';
 const service=triggerService(trigger);
 const set=(e:string,s:string)=>onChange({...reservasTrigger(e,s),id:(trigger as any).id} as Trigger);
 return <div className="space-y-5 text-sm">
  <Label name={__('When')} hint={EVENTS.find(e=>e.value===event)?.description}>
   <Select ariaLabel={__('Booking event')} value={event} options={EVENTS.map(e=>({value:e.value,label:e.title}))} onChange={e=>set(e,service)}/>
  </Label>
  <Label name={__('Booking page')} hint={__('Only bookings for this page, or any.')}>
   <ServiceSelect ctx={ctx} value={service} allowAny={__('Any booking page')} onChange={s=>set(event,s)}/>
  </Label>
  <p className="text-xs text-neutral-500">{__('Later steps can use the booking’s fields: {0}. Use {1} for “this booking” in Reservas steps.',['{{trigger.customer_name}}, {{trigger.phone}}, {{trigger.email}}, {{trigger.starts_on}}, {{trigger.service}}, {{trigger.resource}}, {{trigger.status}}','{{trigger.name}}'])}</p>
 </div>;
}

export function ReservasActionFields({step,onChange}:{step:ErpStep;onChange:(s:ErpStep)=>void}){
 const ctx=useReservas();
 let config:Record<string,any>={};try{config=JSON.parse(step.configJson)||{}}catch{config={}}
 const update=(patch:Record<string,unknown>)=>onChange({...step,configJson:JSON.stringify({...config,...patch})});
 const op=step.operation as string;
 const text=(key:string,label:string)=><Label key={key} name={label}><MappedInput label={label} value={typeof config[key]==='object'&&config[key]?.$ref?'{{'+config[key].$ref+'}}':String(config[key]??'')} onChange={v=>update({[key]:v})}/></Label>;
 const service=(hint?:string,any?:string)=><Label name={__('Booking page')} hint={hint}><ServiceSelect ctx={ctx} value={String(config.service??'')} allowAny={any} onChange={s=>update({service:s})}/></Label>;
 const thisBooking=<Label name={__('Which booking')} hint={__('The booking that started this workflow, or another booking ID from an earlier step.')}>
  <Select ariaLabel={__('Which booking')} value={config.booking===THIS_BOOKING?'this':'other'} options={[{value:'this',label:__('The booking that started the workflow')},{value:'other',label:__('Another booking')}]} onChange={v=>update({booking:v==='this'?THIS_BOOKING:''})}/>
 </Label>;
 if(op==='reservas_booking_link')return <div className="space-y-5">{service(__('Use the link in a later step as {0}.',['{{steps.<this step>.url}}']),__('All booking pages'))}</div>;
 if(op==='reservas_find_times')return <div className="space-y-5">
  {service()}
  {text('from_date',__('From date (YYYY-MM-DD, empty for today)'))}
  <Label name={__('Days to look ahead')}><Select ariaLabel={__('Days')} value={String(config.days??7)} options={[1,3,7,14].map(n=>({value:String(n),label:n===1?__('1 day'):__('{0} days',[n])}))} onChange={v=>update({days:Number(v)})}/></Label>
  <p className="text-xs text-neutral-500">{__('Returns first (the earliest start), count and days. If nothing is free, next_free has the next day with times.')}</p>
 </div>;
 if(op==='reservas_book')return <div className="space-y-5">
  {service()}
  {text('start',__('Start (YYYY-MM-DD HH:MM, site time)'))}
  {text('customer_name',__('Customer name'))}
  {text('phone',__('Phone (WhatsApp)'))}
  {text('email',__('Email'))}
  {text('notes',__('Notes (optional)'))}
  <p className="text-xs text-neutral-500">{__('The time must be free, exactly like on the booking page. A paid service holds the time; send payment_url to the customer. url is their booking page.')}</p>
 </div>;
 if(op==='reservas_reschedule')return <div className="space-y-5">{thisBooking}{config.booking!==THIS_BOOKING&&text('booking',__('Booking ID'))}{text('start',__('New start (YYYY-MM-DD HH:MM, site time)'))}</div>;
 if(op==='reservas_cancel')return <div className="space-y-5">{thisBooking}{config.booking!==THIS_BOOKING&&text('booking',__('Booking ID'))}{text('reason',__('Reason (optional, shown on the booking)'))}</div>;
 return <div className="space-y-5">{thisBooking}{config.booking!==THIS_BOOKING&&text('booking',__('Booking ID'))}
  <Label name={__('Mark as')}><Select ariaLabel={__('Status')} value={String(config.status??'Completed')} options={[{value:'Completed',label:__('Completed')},{value:'No-show',label:__('No-show')}]} onChange={status=>update({status})}/></Label>
 </div>;
}
