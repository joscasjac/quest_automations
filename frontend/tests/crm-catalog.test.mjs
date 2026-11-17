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
 assert.equal(CRM_ACTION_LIBRARY.length,12);
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
 assert.deepEqual(crmInitialConfig('crm_send_whatsapp_template'),{doctype:'CRM Lead',name:'',template:''});
 assert.deepEqual(crmActions.crm_send_messenger.optional,['profile']);
 assert.equal(crmDefaultValue('crm_log_call','duration'),0);
 assert.deepEqual(crmDefaultValue('crm_get_conversation','channels'),[]);
});

const i18nSource = buildSync({entryPoints:[path.join(root,'src/adapter/crmI18n.ts')],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const i18nModule = {exports:{}};
new Function('module','exports','require',i18nSource)(i18nModule,i18nModule.exports,require);
const {CRM_ES,crmLang,crmText,crmFieldLabel}=i18nModule.exports;
const {crmActionLabel}=catalogModule.exports;

test('Spanish covers every CRM action label and falls back to English',()=>{
 for(const kind of Object.keys(crmActions)){
  assert.equal(typeof CRM_ES.actions[kind],'string',kind);
  assert.equal(crmActionLabel(kind,'es'),CRM_ES.actions[kind]);
  assert.equal(crmActionLabel(kind,'en'),crmActions[kind].label);
  for(const field of Object.keys(crmActions[kind].types))assert.notEqual(crmFieldLabel(field,'es'),undefined,field);
 }
 assert.equal(crmActionLabel('crm_send_whatsapp','es'),'CRM: Enviar WhatsApp');
 assert.equal(crmActionLabel('crm_get_conversation','es'),'CRM: Obtener conversación');
 assert.equal(crmLang('es'),'es');assert.equal(crmLang('es-MX'),'es');assert.equal(crmLang('en'),'en');assert.equal(crmLang(undefined),'en');assert.equal(crmLang('fr'),'en');
 assert.equal(crmText('remove',{field:'Teléfono'},'es'),'Quitar Teléfono');
 assert.equal(crmText('remove',{field:'phone'},'en'),'Remove phone');
 assert.match(crmText('hint',{},'es'),/^Usa CRM Conversations/);
});
