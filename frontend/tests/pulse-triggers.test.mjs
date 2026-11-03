import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const {buildSync}=require('esbuild');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const backend=JSON.parse(execFileSync('python3',['-c',"import json,runpy; print(json.dumps(runpy.run_path('quest_automations/core/pulse_events.py')['PULSE_EVENT_PRESETS']))"],{cwd:path.dirname(root),encoding:'utf8'}));
const lines=readFileSync(path.join(root,'src/app/Workflows.tsx'),'utf8').split('\n');
const frontend=lines.filter(line=>line.startsWith('{"value": "pulse_event_')).map(line=>JSON.parse(line.replace(/,$/,'')));
const source=buildSync({entryPoints:[path.join(root,'src/adapter/api.ts')],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const apiModule={exports:{}};
new Function('module','exports','require',source)(apiModule,apiModule.exports,require);
const {api,useMutation,normalizeDefinition}=apiModule.exports;

test('all visible Pulse trigger presets mirror validated backend metadata',()=>{
 assert.equal(frontend.length,19);
 assert.deepEqual(frontend,backend);
});

test('review and approval changed-field metadata survives actual save request and reload',async()=>{
 const previousWindow=globalThis.window, previousFetch=globalThis.fetch;
 globalThis.window={automationFrappe:{csrfToken:'qa-csrf'}};
 try{
  for(const value of ['pulse_event_request_review','pulse_event_approval']){
   const preset=frontend.find(row=>row.value===value);
   const trigger={id:'event-qa',...preset.trigger};
   let sent;
   globalThis.fetch=async(_url,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({message:{id:'workflow-'+value,revision:1,draft:sent.body.definition,status:'draft'}})}};
   await useMutation(api.workflows.createDraft)({name:'Lifecycle preset',triggers:[trigger],steps:[{kind:'noop',label:'Observe'}]});
   assert.deepEqual(sent.body.definition.triggers[0],trigger);
   const reloaded=normalizeDefinition(JSON.parse(JSON.stringify(sent.body.definition)));
   assert.deepEqual(reloaded.triggers[0].changedFields,preset.trigger.changedFields);
   assert.deepEqual(reloaded.triggers[0].condition,preset.trigger.condition);
  }
 }finally{globalThis.window=previousWindow;globalThis.fetch=previousFetch}
});
