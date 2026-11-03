import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const {buildSync} = require('esbuild');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = buildSync({entryPoints:[path.join(root,'src/adapter/pulseCatalog.ts')],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const catalogModule = {exports:{}};
new Function('module','exports','require',source)(catalogModule,catalogModule.exports,require);
const {pulseActions,PULSE_ACTION_LIBRARY,createPulseStep,pulseInitialConfig,pulseDefaultValue,isPulseOperation}=catalogModule.exports;

test('all bounded operations create serializable ERP steps through the visible picker catalog',()=>{
 assert.equal(PULSE_ACTION_LIBRARY.length,61);
 assert.equal(new Set(PULSE_ACTION_LIBRARY.map(a=>a.kind)).size,61);
 for(const action of PULSE_ACTION_LIBRARY){
  const step=createPulseStep(action.kind);
  assert.equal(action.group,'Pulse');
  assert.equal(step.kind,'erpnext');
  assert.equal(step.operation,action.kind);
  assert.equal(step.label,action.title);
  const saved=JSON.parse(JSON.stringify(step));
  assert.deepEqual(Object.keys(JSON.parse(saved.configJson)),pulseActions[action.kind].required);
 }
 assert.equal(isPulseOperation('pulse_unknown'),false);
});

test('required fields and optional inputs retain bounded JSON shapes without phantom defaults',()=>{
 assert.deepEqual(pulseInitialConfig('pulse_create_task'),{project:'',subject:''});
 assert.equal(pulseActions.pulse_create_task.optional.includes('field_values'),true);
 assert.deepEqual(pulseDefaultValue('pulse_create_task','field_values'),{});
 assert.deepEqual(pulseInitialConfig('pulse_bulk_update_tasks'),{tasks:[],fields:{}});
 assert.deepEqual(pulseInitialConfig('pulse_set_checklist_item'),{name:'',is_done:false});
 assert.deepEqual(pulseInitialConfig('pulse_describe_operations'),{});
 for(const spec of Object.values(pulseActions)){
  assert.equal(spec.optional.some(key=>spec.required.includes(key)),false);
  assert.deepEqual(new Set(Object.keys(spec.types)),new Set([...spec.required,...spec.optional]));
 }
});

test('edited Pulse create configuration survives workflow save and reload serialization',()=>{
 const step=createPulseStep('pulse_create_task');
 step.configJson=JSON.stringify({project:'PROJ-1',subject:'Prepare delivery',field_values:{custom_delivery:'Ready'},assignees:['member@example.test']});
 const restored=JSON.parse(JSON.stringify({schemaVersion:2,triggers:[{id:'manual',kind:'manual'}],steps:[step]}));
 assert.equal(restored.steps[0].operation,'pulse_create_task');
 assert.equal(JSON.parse(restored.steps[0].configJson).field_values.custom_delivery,'Ready');
 assert.equal(JSON.parse(restored.steps[0].configJson).assignees[0],'member@example.test');
});


test('Pulse branch actions remain native ERP steps rather than invented workflow kinds',()=>{
 const child=createPulseStep('pulse_assign_task');
 child.configJson=JSON.stringify({task:{$ref:'trigger.name'},user:'member@example.test'});
 const restored=JSON.parse(JSON.stringify({kind:'if_else',label:'Route',branches:[{name:'Assign',steps:[child]}],elseSteps:[]}));
 assert.equal(restored.branches[0].steps[0].kind,'erpnext');
 assert.equal(restored.branches[0].steps[0].operation,'pulse_assign_task');
 assert.deepEqual(JSON.parse(restored.branches[0].steps[0].configJson).task,{$ref:'trigger.name'});
});
