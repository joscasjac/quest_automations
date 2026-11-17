import catalog from './crmCatalog.json';
import type {ErpStep} from './types';
export type CrmOperation = `crm_${string}`;
export type CrmParameterType = 'string'|'object'|'array'|'boolean'|'number';
export const CRM_DOCTYPES = ['CRM Lead','CRM Deal'] as const;
export const crmActions = catalog as Record<string,{label:string;required:string[];optional:string[];types:Record<string,CrmParameterType>}>;
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
 kind:kind as CrmOperation,title:entry.label,description:'Act on a CRM Lead or Deal through CRM Conversations; activity is logged on that record.',group:'CRM',icon:'record' as const,
}));
