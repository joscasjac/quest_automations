import {useEffect,useState} from 'react';
import type {Workflow,Version,Run,Trigger,EditorStep} from './types';
export async function request(path:string,method='GET',body?:unknown){
 const native=(window as any).automationFrappe;
 const response=await fetch(native?'/api/method/quest_automations.api.dispatch':'/api/v1/'+path,native?{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Frappe-CSRF-Token':native.csrfToken},body:JSON.stringify({path:'api/v1/'+path,method,body:body??{}})}:{method,headers:{Authorization:'Bearer '+sessionStorage.getItem('automation-token'),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const envelope=await response.json();const data=native?envelope.message:envelope;if(!response.ok||data?.error)throw new Error(data?.error||envelope.error||'API request failed');return data;

}
type Ref<T>={name:string;result?:T};
const ref=<T,>(name:string):Ref<T>=>({name});
export const api={workflows:{list:ref<Workflow[]>('list'),get:ref<Workflow|null>('get'),runsForDefinition:ref<Run[]>('runs'),versionsForDefinition:ref<Version[]>('versions'),deleteWorkflow:ref<void>('delete'),deleteTrigger:ref<void>('delete-trigger'),createDraft:ref<string>('create'),updateDefinition:ref<void>('update'),publishVersion:ref<{validationErrors:string[]}>('save'),setStatus:ref<void>('status'),runManual:ref<string>('test')}};
const cached=new Map<string,any>();const pending=new Map<string,any>();
let generation=0;
export function normalizeDefinition(d:any){
 if(d.schemaVersion===2){const convert=(step:any):any=>({...step,kind:step.kind==='outgoing_webhook'?'api_request':step.kind,...(step.kind==='if_else'?{branches:step.branches.map((b:any)=>({...b,steps:b.steps?.map(convert)})),elseSteps:step.elseSteps?.map(convert)}:{})});return {...d,steps:d.steps.map(convert)}}
 const triggers=(d.triggers??[{...d.trigger,id:'legacy'}]).map((t:any)=>({...t}));
 const ids=Object.fromEntries(d.steps.map((s:any,i:number)=>[s.id,'step_'+i]));
 const remap=(v:any):any=>Array.isArray(v)?v.map(remap):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,k==='$ref'&&typeof x==='string'?x.replace(/^steps\.([^.]+)/,(_:string,id:string)=>'steps.'+(ids[id]??id)):remap(x)])):v;
 const convert=(s:any):EditorStep=>{
  s={...s,config:remap(s.config)};
  if(s.kind==='delay')return {kind:'wait',label:'Wait',durationMinutes:s.config.seconds/60};
  return {kind:s.kind==='outgoing_webhook'?'api_request':'erpnext',label:s.kind.replaceAll('_',' '),operation:s.kind,configJson:JSON.stringify(s.config,null,2)};
 };
 return {schemaVersion:2,name:d.name,description:d.description,triggers,steps:d.steps.map(convert)};
}
function version(d:any,id:string,number:number,created:number):Version {const definition=normalizeDefinition(d);return {_id:id as Version['_id'],number,trigger:definition.triggers[0],triggers:definition.triggers,steps:definition.steps,validationErrors:[],createdAt:created*1000}}
function workflow(row:any):Workflow{cached.set(row.id,row);const v=version(row.draft,row.id+':'+row.revision,row.revision,row.updated);return {_id:row.id,name:row.draft.name,description:row.draft.description,status:row.status,trigger:v.trigger,triggers:v.triggers,currentVersion:v,currentVersionId:v._id,recentRuns:row.recentRuns??[],updatedAt:row.updated*1000}}
async function query(name:string,args:any){
 if(name==='list')return (await request('workflows')).map(workflow);
 if(name==='get')return workflow(await request('workflows/'+args.definitionId));
 if(name==='versions')return (await request(`workflows/${args.definitionId}/versions`)).map((v:any)=>version(v.definition,v.id,v.number,v.created));
 const status=(s:string)=>s==='waiting'?'running':s==='needs_attention'?'failed':s==='filtered_out'?'succeeded':s;
 return (await request(`workflows/${args.definitionId}/runs`)).map((r:any)=>({_id:r.id,status:status(r.status),triggerKind:r.trigger_id??'manual',createdAt:r.created*1000,error:r.error,steps:r.logs.map((l:any,i:number)=>({_id:r.id+':'+i,position:i+1,label:l.label??l.id,status:status(l.status),error:l.error,output:JSON.stringify(r.outputs[l.id]??l.output??'')}))}));
}
export function useQuery<T>(reference:Ref<T>,args?:any):T|undefined{
 const key=JSON.stringify(args);const [state,setState]=useState<T>();
 useEffect(()=>{if(args==='skip'){setState(undefined);return}let alive=true;let previous='';let seen=generation;
 const load=async()=>{try{const result=await query(reference.name,args);const value=JSON.stringify(result);if(alive&&value!==previous){previous=value;setState(result)}}catch(e){if(alive)window.dispatchEvent(new CustomEvent('automation-error',{detail:(e as Error).message}))}};
 load();const timer=setInterval(()=>{if(seen!==generation||reference.name==='runs'||reference.name==='get'||reference.name==='list'){seen=generation;load()}},1500);return()=>{alive=false;clearInterval(timer)};
 },[reference.name,key]);return state;
}
export function useMutation(reference:Ref<unknown>){return async(args:any):Promise<any>=>{
 let result:any;const id=args.definitionId;
 if(reference.name==='delete'||reference.name==='delete-trigger'){const row=cached.get(id);result=await request(`workflows/${id}/${reference.name}`,'POST',{revision:row?.revision,triggerId:args.triggerId});if(reference.name==='delete')cached.delete(id);else cached.set(id,result);generation++;return result}
 if(reference.name==='update'){pending.set(id,{name:args.name,description:args.description});return}
 if(reference.name==='create'||reference.name==='save'){
  const row=cached.get(id);
  const triggers:Trigger[]=(args.triggers??[args.trigger]).map((t:Trigger)=>({...t,id:t.id??'trigger_'+crypto.randomUUID().slice(0,8)}));
  const definition={schemaVersion:2,name:args.name??pending.get(id)?.name??row?.draft.name,description:args.description??pending.get(id)?.description??row?.draft.description,triggers,steps:args.steps};
  result=await request('workflows'+(id?'/'+id:''),id?'PUT':'POST',{definition,revision:row?.revision});cached.set(result.id,result);pending.delete(id);
  if(id&&row.status==='active'&&!args.draftOnly)await request(`workflows/${id}/publish`,'POST',{revision:result.revision});
  result=reference.name==='create'?result.id:{validationErrors:[]};
 }else if(reference.name==='status'){
  const row=cached.get(id);result=await request(`workflows/${id}/${args.status==='active'?'publish':args.status==='archived'?'archive':'pause'}`,'POST',{revision:row?.revision});
 }else if(reference.name==='test'){
  const input=JSON.parse(sessionStorage.getItem('automation-test-input')??'{}');result=await request(`workflows/${id}/test`,'POST',{input,record:true});
 }
 generation++;return result;
}}
