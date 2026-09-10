import {useEffect,useRef,useState} from 'react';
import {basicSetup} from 'codemirror';
import {EditorView,keymap} from '@codemirror/view';
import {Compartment} from '@codemirror/state';
import {indentWithTab} from '@codemirror/commands';
import {indentUnit,syntaxHighlighting,HighlightStyle} from '@codemirror/language';
import {javascript,javascriptLanguage} from '@codemirror/lang-javascript';
import type {Completion,CompletionContext} from '@codemirror/autocomplete';
function javascriptLanguageCompletions(options:Completion[]){return javascriptLanguage.data.of({autocomplete:(context:CompletionContext)=>{const word=context.matchBefore(/[\w.]+/);if(!word&&!context.explicit)return null;return {from:word?.from??context.pos,options,validFor:/^[\w.]*$/}}})}
import {json} from '@codemirror/lang-json';
import {html} from '@codemirror/lang-html';
import {tags} from '@lezer/highlight';
import {SearchSelect} from './SearchSelect';
import {useFieldSources} from './FieldSources';
import {Button} from '../components/ui';

export function MappedInput({label,value,onChange,multiline=false,secret=false}:{label:string;value:string;onChange:(v:string)=>void;multiline?:boolean;secret?:boolean}){
 const ref=useRef<HTMLInputElement & HTMLTextAreaElement>(null);const [open,setOpen]=useState(false);const sources=useFieldSources();
 const props={ref,'aria-label':label,value,onChange:(e:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>onChange(e.target.value),className:'w-full min-w-0 rounded-md border border-edge bg-ink px-3 py-2 pr-10 text-sm text-white focus:outline-accent'};
 return <div className="space-y-2"><div className="relative">{multiline?<textarea {...props} rows={5}/>:<input {...props} type={secret?'password':'text'}/>}<button type="button" aria-label={'Custom values for '+label} title="Custom values" className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded text-neutral-400 hover:bg-raised hover:text-accent" onClick={()=>setOpen(!open)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 3h7l11 11-7 7L3 10z"/><circle cx="7.5" cy="7.5" r="1"/></svg></button></div>{open&&<SearchSelect label={'Choose custom value for '+label} value="" placeholder="Choose a custom value…" options={sources.map(s=>({value:s.path,label:s.label,detail:s.group}))} onChange={path=>{const start=ref.current?.selectionStart??value.length;const end=ref.current?.selectionEnd??start;const token='{{'+path+'}}';onChange(value.slice(0,start)+token+value.slice(end));setOpen(false);requestAnimationFrame(()=>{ref.current?.focus();ref.current?.setSelectionRange(start+token.length,start+token.length)})}}/>}</div>
}

export function CodeEditor({label,value,onChange,language='javascript'}:{label:string;value:string;onChange:(v:string)=>void;language?:'javascript'|'json'|'html'|'text'}){
 const host=useRef<HTMLDivElement>(null);const editor=useRef<EditorView|null>(null);
 const latest=useRef(value);latest.current=value;
 const change=useRef(onChange);change.current=onChange;
 const mode=useRef(new Compartment());const completion=useRef(new Compartment());
 const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [fields,setFields]=useState(false);const sources=useFieldSources();
 const format=async()=>{setBusy(true);setError('');const original=latest.current;try{const [{format},babel,estree,htmlPlugin]=await Promise.all([import('prettier/standalone'),import('prettier/plugins/babel'),import('prettier/plugins/estree'),import('prettier/plugins/html')]);const formatted=await format(original,{parser:language==='javascript'?'babel':language==='json'?'json':'html',plugins:[babel.default,estree.default,htmlPlugin.default],tabWidth:2,printWidth:80});if(latest.current===original)change.current(formatted)}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 const formatRef=useRef(format);formatRef.current=format;
 useEffect(()=>{
  if(!host.current)return;
  const view=new EditorView({parent:host.current,doc:latest.current,extensions:[
   basicSetup,indentUnit.of('  '),mode.current.of([]),completion.current.of([]),
   keymap.of([indentWithTab,{key:'Alt-Shift-f',run:()=>{void formatRef.current();return true}}]),
   EditorView.contentAttributes.of({'aria-label':label,spellcheck:'false'}),
   EditorView.updateListener.of(update=>{if(update.docChanged){setError('');change.current(update.state.doc.toString())}}),
   EditorView.theme({
    '&':{color:'var(--color-white)',backgroundColor:'var(--color-ink)',fontSize:'13px'},
    '.cm-scroller':{fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',minHeight:'260px',maxHeight:'440px',overflow:'auto'},
    '.cm-content':{padding:'12px 0',caretColor:'var(--color-white)'},
    '.cm-gutters':{backgroundColor:'var(--color-panel)',color:'var(--color-neutral-500)',borderColor:'var(--color-edge)'},
    '.cm-activeLine, .cm-activeLineGutter':{backgroundColor:'var(--color-raised)'},
    '.cm-cursor':{borderLeftColor:'var(--color-white)'},
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection':{backgroundColor:'var(--color-glow)'},
    '.cm-tooltip, .cm-panels':{backgroundColor:'var(--color-panel)',color:'var(--color-white)',borderColor:'var(--color-edge)'},
    '.cm-searchMatch':{backgroundColor:'var(--color-glow)'},
    '.cm-matchingBracket':{backgroundColor:'var(--color-glow)',outline:'1px solid var(--color-accent)'},
    '&.cm-focused':{outline:'2px solid var(--color-accent)',outlineOffset:'-2px'},
   }),
   syntaxHighlighting(HighlightStyle.define([
    {tag:[tags.keyword,tags.operator],color:'var(--color-accent)'},
    {tag:[tags.string,tags.special(tags.string)],color:'var(--color-emerald-400)'},
    {tag:[tags.number,tags.bool,tags.null],color:'var(--color-yellow-400)'},
    {tag:tags.comment,color:'var(--color-neutral-500)'},
   ])),
  ]});editor.current=view;return()=>{view.destroy();editor.current=null};
 },[label]);
 useEffect(()=>{editor.current?.dispatch({effects:mode.current.reconfigure(language==='javascript'?javascript():language==='json'?json():language==='html'?html():[])})},[language,label]);
 useEffect(()=>{
  const options=[{label:'input',type:'variable',info:'Incoming trigger data'},{label:'steps',type:'variable',info:'Earlier action results'},{label:'api.request',type:'function',info:'Call an HTTPS API'},...sources.map(s=>({label:s.path.replace(/^trigger/,'input'),type:'property',info:s.label}))];
  editor.current?.dispatch({effects:completion.current.reconfigure(language==='javascript'?javascriptLanguageCompletions(options):[])});
 },[sources,language,label]);
 useEffect(()=>{const view=editor.current;if(view&&view.state.doc.toString()!==value)view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value}})},[value,label]);
 const insert=(text:string)=>{const view=editor.current;if(!view)return;view.dispatch(view.state.replaceSelection(text));view.focus()};
 return <div className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium text-white">{label}</span><div className="flex gap-2"><Button onClick={()=>setFields(!fields)}>Custom values</Button>{language!=='text'&&<Button disabled={busy} onClick={format}>{busy?'Formatting…':'Format code'}</Button>}</div></div>{language==='html'&&<div className="flex flex-wrap gap-2">{[['Bold','strong'],['Italic','em'],['Heading','h2'],['Paragraph','p'],['List','ul']].map(([title,tag])=><Button key={tag} onClick={()=>{const view=editor.current;const selected=view?view.state.sliceDoc(view.state.selection.main.from,view.state.selection.main.to)||'Text':'Text';insert('<'+tag+'>'+(tag==='ul'?'<li>'+selected+'</li>':selected)+'</'+tag+'>')}}>{title}</Button>)}</div>}{fields&&<SearchSelect label={'Custom values for '+label} value="" placeholder="Choose a field…" options={sources.map(s=>({value:s.path,label:s.label,detail:s.group}))} onChange={path=>{insert(language==='javascript'?path.replace(/^trigger/,'input'):'{{'+path+'}}');setFields(false)}}/>}<div ref={host} className="min-w-0 overflow-hidden rounded-md border border-edge"/><p className="text-xs text-neutral-500">Tab indents · Shift+Tab outdents · Ctrl/⌘+F searches · Alt+Shift+F formats. Press Esc then Tab to leave the editor.</p>{error&&<pre role="alert" className="whitespace-pre-wrap text-xs text-red-400">{error}</pre>}</div>
}
