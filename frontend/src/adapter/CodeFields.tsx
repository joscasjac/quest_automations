import {useState} from 'react';
import {Button} from '../components/ui';
import {SearchSelect} from './SearchSelect';
import type {CodeStep} from './types';
import {CodeEditor} from './Editors';
export function CodeFields({step,onChange}:{step:CodeStep;onChange:(s:CodeStep)=>void}){
 const [snippets,setSnippets]=useState(false);
 const examples=[{value:'return { ...input, processed: true };',label:'Add a field to the incoming document'},{value:'const response = await api.request({url: "https://api.example.com/items", method: "GET"});\nreturn response.body;',label:'Call an API'},{value:'return (input.items || []).map(item => ({ ...item, amount: item.qty * item.rate }));',label:'Transform child table rows'}];
 return <div className="space-y-4"><p className="text-sm text-neutral-400">Use <code>input</code> for the incoming document and <code>steps</code> for earlier action results. Return a value for the next action.</p><Button onClick={()=>setSnippets(!snippets)}>Snippets</Button>{snippets&&<SearchSelect label="Code snippets" value="" options={examples} onChange={code=>{onChange({...step,code:step.code+'\n'+code});setSnippets(false)}}/>}<CodeEditor label="Code" value={step.code} onChange={code=>onChange({...step,code})}/><details><summary className="cursor-pointer text-sm text-neutral-400">API request example</summary><pre className="overflow-x-auto text-xs text-neutral-300">{'const response = await api.request({\n  url: "https://api.example.com/items",\n  method: "GET",\n  headers: { Authorization: "secret:API_AUTH" }\n});\nreturn response.body;'}</pre></details><p className="text-xs text-neutral-500">2-second CPU limit, 32 MB memory, up to 5 HTTPS calls. No imports or filesystem access. Test Workflow does not send API requests. Use secret:ENV_NAME in headers for server-held credentials.</p></div>
}
