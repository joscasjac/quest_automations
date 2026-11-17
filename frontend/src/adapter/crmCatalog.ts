import catalog from './crmCatalog.json';
import type {ErpStep} from './types';
import {CRM_DESCRIPTION_EN,CRM_ES,crmLang} from './crmI18n';
import type {CrmLang} from './crmI18n';
export type CrmOperation = `crm_${string}`;
export type CrmParameterType = 'string'|'object'|'array'|'boolean'|'number';
export const CRM_DOCTYPES = ['CRM Lead','CRM Deal'] as const;
const englishActions = catalog as Record<string,{label:string;required:string[];optional:string[];types:Record<string,CrmParameterType>}>;
export function crmActionLabel(operation:string,lang:CrmLang=crmLang()):string{return (lang==='es'?CRM_ES.actions[operation]:undefined)??englishActions[operation]?.label??operation}
// Labels follow the Frappe user's language; inputs and types are language independent.
export const crmActions = Object.fromEntries(Object.entries(englishActions).map(([kind,entry])=>[kind,{...entry,label:crmActionLabel(kind)}])) as typeof englishActions;
export function isCrmOperation(value:string):value is CrmOperation {return Object.hasOwn(crmActions,value)}
export function crmDefaultValue(operation:string,key:string):unknown {
 const type=crmActions[operation]?.types[key];
 return type==='object'?{}:type==='array'?[]:type==='boolean'?false:type==='number'?0:'';
}
export function crmInitialConfig(operation:string):Record<string,unknown> {
 return Object.fromEntries((crmActions[operation]?.required??[]).map(key=>[key,key==='doctype'?CRM_DOCTYPES[0]:crmDefaultValue(operation,key)]));
}
export function createCrmStep(operation:CrmOperation):Extract<ErpStep,{kind:'erpnext'}> {
 return {kind:'erpnext',operation,label:crmActions[operation].label,configJson:JSON.stringify(crmInitialConfig(operation))};
}
export const CRM_ACTION_LIBRARY = Object.entries(crmActions).map(([kind,entry])=>({
 kind:kind as CrmOperation,title:entry.label,description:crmLang()==='es'?CRM_ES.description:CRM_DESCRIPTION_EN,group:'CRM',icon:'record' as const,
}));
