import type {VisualStep} from './types';
import {Choice, ObjectFields, ValueInput, useMetadata} from './ErpFields';
import {Button, Input, Select} from '../components/ui';
import {SearchSelect} from './SearchSelect';

const kinds=['find_documents','filter_list','map_fields','for_each','end_loop','stop','begin_transaction','commit_transaction'];
export function isVisualStep(step:{kind:string}):step is VisualStep{return kinds.includes(step.kind)}
export function visualDefault(kind:string):VisualStep|undefined{
 switch(kind){
 case 'find_documents':return {kind,label:'Find CRM records',doctype:'CRM Lead',filters:[],fields:['name'],limit:100};
 case 'filter_list':return {kind,label:'Keep matching items',list:'',match:'all',conditions:[]};
 case 'map_fields':return {kind,label:'Prepare fields',mappings:[{name:'value',value:'',format:'text'}]};
 case 'for_each':return {kind,label:'Repeat for each item',list:'',itemName:'item',maxItems:50,collect:{}};
 case 'stop':return {kind,label:'Stop workflow',outcome:'skip',message:'No action needed'};
 case 'end_loop':return {kind,label:'Continue after all items'};
 case 'begin_transaction':return {kind,label:'Save CRM changes together'};
 case 'commit_transaction':return {kind,label:'Finish CRM changes'};
 }
}
const choices=(values:string[])=>values.map(value=>({value,label:value.replaceAll('_',' ')}));
export function VisualFields({step,onChange}:{step:VisualStep;onChange:(step:VisualStep)=>void}){
 const meta=useMetadata(step.kind==='find_documents'?step.doctype:'');
 const fields=[{value:'name',label:'Record ID'},...(meta?.fields??[]).filter(f=>!['Section Break','Column Break','Tab Break','HTML','Button','Password'].includes(f.fieldtype)).map(f=>({value:f.fieldname,label:f.label||f.fieldname}))];
 return <div className="space-y-5">
 <label className="block space-y-2 text-sm text-white"><span>Action name</span><Input value={step.label} onChange={e=>onChange({...step,label:e.target.value})}/></label>
 {step.kind==='find_documents'&&<>
 <Choice label="Document type" value={step.doctype} options={[]} onChange={doctype=>onChange({...step,doctype,filters:[],fields:['name']})}/>
 <details><summary className="cursor-pointer text-sm text-neutral-400">Child table settings</summary><Choice label="Parent document type" value={step.parent??''} options={[]} onChange={parent=>onChange({...step,parent})}/></details>
 <section className="space-y-4"><h3 className="text-sm font-medium text-white">Match every filter</h3>{step.filters.map((f,i)=><div key={i} className="space-y-3 border-b border-edge pb-4">
 <SearchSelect label={`Search filter ${i+1} field`} value={f.field} options={fields} onChange={field=>onChange({...step,filters:step.filters.map((r,n)=>n===i?{...r,field}:r)})}/>
 <Select ariaLabel={`Search filter ${i+1} comparison`} value={f.operator} options={choices(['=','!=','in','not in','like','not like','is'])} onChange={operator=>onChange({...step,filters:step.filters.map((r,n)=>n===i?{...r,operator}:r)})}/>
 <ValueInput label={`Search value ${i+1}`} value={f.value} onChange={value=>onChange({...step,filters:step.filters.map((r,n)=>n===i?{...r,value}:r)})}/>
 <Button variant="danger" onClick={()=>onChange({...step,filters:step.filters.filter((_,n)=>n!==i)})}>Remove filter</Button>
 </div>)}<Button onClick={()=>onChange({...step,filters:[...step.filters,{field:'name',operator:'=',value:''}]})}>Add search filter</Button></section>
 <section className="space-y-2"><h3 className="text-sm font-medium text-white">Fields to return</h3>{step.fields.map(field=><div key={field} className="flex items-center justify-between gap-2 text-sm"><span>{fields.find(f=>f.value===field)?.label??field}</span><Button onClick={()=>onChange({...step,fields:step.fields.filter(f=>f!==field)})}>Remove</Button></div>)}<SearchSelect label="Add return field" value="" options={fields.filter(f=>!step.fields.includes(f.value))} onChange={field=>onChange({...step,fields:[...step.fields,field]})}/></section>
 <label className="block space-y-2 text-sm"><span>Maximum results</span><Input type="number" min={1} max={1000} value={step.limit} onChange={e=>onChange({...step,limit:Number(e.target.value)})}/></label><p className="text-xs leading-5 text-neutral-400">Uses the publishing user's permissions. Stops if this limit is reached so a partial search cannot create duplicate records.</p>
 </>}
 {(step.kind==='filter_list'||step.kind==='for_each')&&<ValueInput label="List to process" value={step.list} onChange={list=>onChange({...step,list})}/>}
 {step.kind==='filter_list'&&<>
 <label className="block space-y-2 text-sm"><span>Keep one item per field (optional)</span><Input value={step.uniqueBy??''} placeholder="email" onChange={e=>onChange({...step,uniqueBy:e.target.value})}/></label>
 <Select ariaLabel="Match conditions" value={step.match} options={[{value:'all',label:'Match every condition'},{value:'any',label:'Match any condition'}]} onChange={match=>onChange({...step,match:match as 'all'|'any'})}/>
 {step.conditions.map((c,i)=><section key={i} className="space-y-3 border-b border-edge pb-4">
 <label className="block space-y-2 text-sm"><span>Item field</span><Input value={c.field} placeholder="email" onChange={e=>onChange({...step,conditions:step.conditions.map((r,n)=>n===i?{...r,field:e.target.value}:r)})}/></label>
 <Select ariaLabel={`List condition ${i+1}`} value={c.operator} options={choices(['is','is_not','is_empty','is_not_empty','not_in_list','email_domain_is_not','is_email'])} onChange={operator=>onChange({...step,conditions:step.conditions.map((r,n)=>n===i?{...r,operator}:r)})}/>
 {!['is_empty','is_not_empty','is_email'].includes(c.operator)&&<ValueInput label={`Compare with ${i+1}`} value={c.value??''} onChange={value=>onChange({...step,conditions:step.conditions.map((r,n)=>n===i?{...r,value}:r)})}/>}
 {c.operator==='not_in_list'&&<label className="block space-y-2 text-sm"><span>Field in the exclusion list</span><Input value={c.listField??'name'} onChange={e=>onChange({...step,conditions:step.conditions.map((r,n)=>n===i?{...r,listField:e.target.value}:r)})}/></label>}
 <Button variant="danger" onClick={()=>onChange({...step,conditions:step.conditions.filter((_,n)=>n!==i)})}>Remove condition</Button></section>)}
 <Button onClick={()=>onChange({...step,conditions:[...step.conditions,{field:'email',operator:'is_not_empty'}]})}>Add list condition</Button>
 </>}
 {step.kind==='map_fields'&&<>{step.mappings.map((m,i)=><section key={i} className="space-y-3 border-b border-edge pb-4">
 <label className="block space-y-2 text-sm"><span>Output name</span><Input value={m.name} onChange={e=>onChange({...step,mappings:step.mappings.map((r,n)=>n===i?{...r,name:e.target.value}:r)})}/></label>
 <ValueInput label={`Value for ${m.name||'field'}`} value={m.value} onChange={value=>onChange({...step,mappings:step.mappings.map((r,n)=>n===i?{...r,value}:r)})}/>
 <ValueInput label="Use when empty or missing" value={m.fallback??''} onChange={fallback=>onChange({...step,mappings:step.mappings.map((r,n)=>n===i?{...r,fallback}:r)})}/>
 <Select ariaLabel={`Format ${m.name}`} value={m.format??'text'} options={[{value:'text',label:'Keep original value'},{value:'lowercase',label:'Lowercase and trim'},{value:'html',label:'Escape HTML'},{value:'first_word',label:'First word'},{value:'remaining_words',label:'Remaining words'},{value:'short_title',label:'Task title (up to 140 characters)'}]} onChange={format=>onChange({...step,mappings:step.mappings.map((r,n)=>n===i?{...r,format}:r)})}/>
 <Button variant="danger" onClick={()=>onChange({...step,mappings:step.mappings.filter((_,n)=>n!==i)})}>Remove mapping</Button>
 </section>)}<Button onClick={()=>onChange({...step,mappings:[...step.mappings,{name:'field'+(step.mappings.length+1),value:'',format:'text'}]})}>Add field mapping</Button><p className="text-xs leading-5 text-neutral-400">Mapped values are available to later actions and branches under Shared fields.</p></>}
 {step.kind==='for_each'&&<>
 <label className="block space-y-2 text-sm"><span>Current item name</span><Input value={step.itemName} onChange={e=>onChange({...step,itemName:e.target.value})}/></label>
 <label className="block space-y-2 text-sm"><span>Maximum items</span><Input type="number" min={1} max={200} value={step.maxItems} onChange={e=>onChange({...step,maxItems:Number(e.target.value)})}/></label>
 <p className="text-sm leading-6 text-neutral-400">Place actions after this block, followed by End repeat. Each action runs once for every item.</p>
 <h3 className="text-sm font-medium text-white">Collect after each item</h3><ObjectFields values={step.collect} onChange={collect=>onChange({...step,collect})}/>
 </>}
 {step.kind==='stop'&&<><Select ariaLabel="Stop outcome" value={step.outcome} options={[{value:'skip',label:'Finish — no further actions'},{value:'error',label:'Fail — report an error'}]} onChange={outcome=>onChange({...step,outcome:outcome as 'skip'|'error'})}/><ValueInput label="Reason" value={step.message} onChange={message=>onChange({...step,message:String(message)})}/></>}
 {step.kind==='end_loop'&&<p className="text-sm leading-6 text-neutral-400">Returns to the matching For each block until every item is complete, then continues with the next action.</p>}
 {(step.kind==='begin_transaction'||step.kind==='commit_transaction')&&<p className="text-sm leading-6 text-neutral-400">Place Begin transaction first and Commit transaction last. Native CRM changes are saved together. If an action fails, all changes in this run are rolled back. Requests, emails and waits cannot run inside a transaction.</p>}
 </div>
}
