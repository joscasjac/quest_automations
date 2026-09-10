import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,Routes,Route,Navigate} from 'react-router-dom';
import {Workflows,WorkflowBuilderPage} from './app/Workflows';
import {Input,Button} from './components/ui';
import {request} from './adapter/api';
import './index.css';
function Appearance(){
 const [theme,setTheme]=useState<'light'|'dark'>(()=>{
  try{return localStorage.getItem('quest-automations-theme')==='dark'?'dark':'light'}catch{return 'light'}
 });
 useEffect(()=>{
  document.documentElement.classList.toggle('light',theme==='light');
  document.documentElement.style.colorScheme=theme;
  try{localStorage.setItem('quest-automations-theme',theme)}catch{/* Theme still works when browser storage is unavailable. */}
 },[theme]);
 return <header className="flex items-center justify-between gap-4 border-b border-edge px-6 py-2"><span className="text-sm font-medium text-white">Quest Automations</span><div role="group" aria-label="Appearance" className="flex items-center gap-1"><span className="mr-2 text-xs text-neutral-500">Appearance</span>{(['light','dark'] as const).map(value=><Button key={value} aria-pressed={theme===value} variant={theme===value?'primary':'ghost'} onClick={()=>setTheme(value)}>{value==='light'?'Light':'Dark'}</Button>)}</div></header>
}
function App(){
 const [connected,setConnected]=useState(false);const [token,setToken]=useState(sessionStorage.getItem('automation-token')??'');const [error,setError]=useState('');
 async function connect(){sessionStorage.setItem('automation-token',token);try{await request('connection');setConnected(true);setError('')}catch(e){setError((e as Error).message)}}
 useEffect(()=>{if(token||(window as any).automationFrappe)connect();const show=(e:Event)=>setError((e as CustomEvent).detail);window.addEventListener('automation-error',show);return()=>window.removeEventListener('automation-error',show)},[]);
 if(!connected)return <main className="mx-auto mt-[15vh] max-w-md space-y-5 px-6"><h1 className="text-xl font-semibold text-white">ERPNext Automations</h1><form className="space-y-4" onSubmit={e=>{e.preventDefault();connect()}}><label className="block text-xs text-neutral-500">Automation API token<Input type="password" value={token} onChange={e=>setToken(e.target.value)} autoComplete="off"/></label><Button type="submit" variant="primary">Connect</Button></form>{error&&<p role="alert" className="text-sm text-red-400">{error}</p>}</main>;
 return <BrowserRouter basename={(window as any).automationFrappe?'/automations':undefined}>{error&&<div role="alert" className="fixed bottom-3 left-3 z-[10001] rounded-md border border-red-400 bg-panel p-3 text-sm text-red-400">{error}<Button onClick={()=>setError('')}>Dismiss</Button></div>}<div className="p-6"><Routes><Route path="/app/workflows" element={<Workflows/>}/><Route path="/app/workflows/new" element={<WorkflowBuilderPage mode="new"/>}/><Route path="/app/workflows/:workflowId" element={<WorkflowBuilderPage mode="detail"/>}/><Route path="*" element={<Navigate to="/app/workflows" replace/>}/></Routes></div></BrowserRouter>
}
createRoot(document.getElementById('root')!).render(<><Appearance/><App/></>);
