import {createContext,useContext,useEffect,useMemo,useState} from 'react';
import type {ReactNode} from 'react';
import type {MergeFieldOption} from '../lib/mergeFields';
import {request} from './api';
import {useParams} from 'react-router-dom';
export const FieldSources=createContext<MergeFieldOption[]>([]);
export const useFieldSources=()=>useContext(FieldSources);
const layout=new Set(['Section Break','Column Break','Tab Break','HTML','Button','Fold','Heading']);
export function FieldSourcesProvider({triggers,steps,selection,children}:{triggers:any[];steps:any[];selection:any;children:ReactNode}){
 const {workflowId}=useParams();const [samples,setSamples]=useState<Record<string,any>>({});
 const triggerIds=JSON.stringify(triggers.filter(t=>t.kind==='incoming_webhook'&&t.id).map(t=>t.id));
 useEffect(()=>{let active=true;const receive=(event:Event)=>{const d=(event as CustomEvent).detail;setSamples(previous=>({...previous,[d.triggerId]:d.sample}))};window.addEventListener('webhook-sample',receive);const load=()=>{if(workflowId)for(const id of JSON.parse(triggerIds))request(`workflows/${workflowId}/webhook-sample?triggerId=${encodeURIComponent(id)}`).then(s=>{if(active&&s.sample)setSamples(previous=>JSON.stringify(previous[id])===JSON.stringify(s.sample)?previous:{...previous,[id]:s.sample})}).catch(()=>{})};load();const timer=setInterval(load,3000);return()=>{active=false;clearInterval(timer);window.removeEventListener('webhook-sample',receive)}},[workflowId,triggerIds]);
 const [apiRuns,setApiRuns]=useState<any[]>([]);
 useEffect(()=>{let alive=true;let previous='';const load=()=>{if(workflowId)request(`workflows/${workflowId}/runs`).then(runs=>{const encoded=JSON.stringify(runs);if(alive&&encoded!==previous){previous=encoded;setApiRuns(runs)}}).catch(()=>{})};load();const timer=setInterval(load,3000);return()=>{alive=false;clearInterval(timer)}},[workflowId]);
 const [loaded,setLoaded]=useState<Record<string,any>>({});
 const sources=useMemo(()=>{
  const out:Array<{type:string;prefix:string;group:string}>=[];
  const entities:Record<string,string>={contact:'Contact',company:'Customer',deal:'Opportunity',task:'Task',project:'Project',note:'Note'};
  for(const t of triggers){const type=t.doctype||entities[t.entityType];if(type)out.push({type,prefix:'trigger',group:'Trigger · '+type})}
  const add=(step:any,prefix:string)=>{if(step.kind==='get_document'||step.kind==='erpnext'){try{const c=JSON.parse(step.configJson);if(c.doctype)out.push({type:c.doctype,prefix,group:step.label+' · '+c.doctype})}catch{}}};
  steps.forEach((s,i)=>{add(s,'steps.step_'+i);if(s.kind==='if_else')[...s.branches,{steps:s.elseSteps}].forEach((b:any,n:number)=>(b.steps??[]).forEach((child:any,k:number)=>add(child,`steps.step_${i}_branch_${n}_${k}`)))});return out;
 },[JSON.stringify(triggers),JSON.stringify(steps)]);
 const types=JSON.stringify([...new Set(sources.map(s=>s.type))]);
 useEffect(()=>{let active=true;const names=JSON.parse(types) as string[];Promise.all(names.map(async name=>{try{return [name,await request('doctypes/'+encodeURIComponent(name))] as const}catch{return [name,{fields:[]}] as const}})).then(entries=>{if(active)setLoaded(Object.fromEntries(entries))});return()=>{active=false}},[types]);
 const options=useMemo(()=>{
  const all:MergeFieldOption[]=[{path:'trigger',label:'Entire incoming document',group:'Trigger',description:'Data received by the trigger'},{path:'trigger.name',label:'Document ID',group:'Trigger',description:'Name of the incoming document'},{path:'trigger.doctype',label:'Document type',group:'Trigger',description:'Incoming document type'}];
  for(const [id,sample] of Object.entries(samples)){if(!JSON.parse(triggerIds).includes(id))continue;const walk=(value:any,path:string,depth=0)=>{if(depth>5)return;all.push({path,label:path.replace(/^trigger\./,''),group:'Webhook · '+id,description:Array.isArray(value)?'List':value===null?'Empty value':typeof value});if(Array.isArray(value)){if(value.length)walk(value[0],path+'.0',depth+1)}else if(value&&typeof value==='object')for(const [key,child] of Object.entries(value))if(/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))walk(child,path+'.'+key,depth+1)};walk(sample,'trigger')}
  for(const source of sources){all.push({path:source.prefix,label:'Entire '+source.type+' document',group:source.group,description:'Document data'});for(const f of loaded[source.type]?.fields??[]){if(!f.fieldname||layout.has(f.fieldtype))continue;all.push({path:source.prefix+'.'+f.fieldname,label:f.label||f.fieldname,group:source.group,description:(f.is_custom_field?'Custom field · ':'')+f.fieldtype})}}
  steps.forEach((s,i)=>{
   if(!['api_request','outgoing_webhook'].includes(s.kind))return;
   let config:any;try{config=JSON.parse(s.configJson)}catch{return}
   const prefix=`steps.step_${i}`;
   all.push({path:prefix+'.status',label:s.label+' HTTP status',group:s.label,description:'HTTP status code'});
   if(config.saveResponse===false)return;
   all.push({path:prefix+'.body',label:s.label+' response body',group:s.label,description:'Entire saved API response'});
   let sample=config.responseSample;
   if(sample===undefined){const run=apiRuns.find(r=>{const original=r.definition?.steps?.[i];try{const c=JSON.parse(original?.configJson??'{}');return original?.kind===s.kind&&c.url===config.url&&(c.method??'POST')===(config.method??'POST')&&r.outputs?.['step_'+i]?.body!==undefined}catch{return false}});sample=run?.outputs?.['step_'+i]?.body}
   let count=0;const walk=(value:any,path:string,label:string,depth:number)=>{if(depth>5||++count>300)return;if(depth>0)all.push({path,label,group:s.label+' response',description:Array.isArray(value)?'List':value===null?'Empty':typeof value});if(Array.isArray(value)){if(value.length)walk(value[0],path+'.0',label+'[0]',depth+1)}else if(value&&typeof value==='object')for(const [key,child] of Object.entries(value))if(/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))walk(child,path+'.'+key,label?label+'.'+key:key,depth+1)};
   if(sample!==undefined)walk(sample,prefix+'.body','',0);
  });
  steps.forEach((s,i)=>{if(s.kind==='custom_code')all.push({path:'steps.step_'+i,label:s.label+' result',group:'Previous actions',description:'Value returned by JavaScript'})});
  all.push({path:'workflow.name',label:'Workflow name',group:'Workflow',description:'Current workflow'},{path:'system.today',label:'Today',group:'System',description:'Current date'});
  return all.filter((o,i)=>{
    if(all.findIndex(p=>p.path===o.path&&p.group===o.group)!==i)return false;
    const match=o.path.match(/^steps\.step_(\d+)(?:_branch_(\d+)_(\d+))?/);
    if(!match)return true;
    if(selection.type==='step')return Number(match[1])<selection.index;
    if(selection.type==='branchStep')return Number(match[1])<selection.stepIndex||(Number(match[1])===selection.stepIndex&&Number(match[2])===(selection.branch.type==='else'?steps[selection.stepIndex].branches.length:selection.branch.index)&&Number(match[3])<selection.actionIndex);
    return false;
  });
 },[sources,loaded,steps,selection,samples,triggerIds,apiRuns]);
 return <FieldSources.Provider value={options}>{children}</FieldSources.Provider>
}
