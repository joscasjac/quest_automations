import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const {buildSync} = require('esbuild');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = buildSync({entryPoints:[path.join(root,'src/adapter/crmCatalog.ts')],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const catalogModule = {exports:{}};
new Function('module','exports','require',source)(catalogModule,catalogModule.exports,require);
const {crmActions,CRM_ACTION_LIBRARY,createCrmStep,crmInitialConfig,crmDefaultValue,isCrmOperation}=catalogModule.exports;

test('every CRM operation creates a serializable ERP step for the visible picker',()=>{
 assert.equal(CRM_ACTION_LIBRARY.length,9);
 for(const action of CRM_ACTION_LIBRARY){
  const step=createCrmStep(action.kind);
  assert.equal(action.group,'CRM');
  assert.match(action.title,/^CRM: /);
  assert.equal(step.kind,'erpnext');
  assert.equal(step.operation,action.kind);
  assert.deepEqual(Object.keys(JSON.parse(step.configJson)),crmActions[action.kind].required);
 }
 assert.equal(crmActions.crm_send_whatsapp.label,'CRM: send whatsapp');
 assert.equal(isCrmOperation('crm_unknown'),false);
 assert.equal(isCrmOperation('pulse_create_task'),false);
});

test('CRM steps target a lead by default and keep typed optional inputs',()=>{
 assert.deepEqual(crmInitialConfig('crm_send_sms'),{doctype:'CRM Lead',name:'',message:''});
 assert.deepEqual(crmInitialConfig('crm_describe_operations'),{});
 assert.equal(crmDefaultValue('crm_log_call','duration'),0);
 assert.deepEqual(crmDefaultValue('crm_get_conversation','channels'),[]);
});
