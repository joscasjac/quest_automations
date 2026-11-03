import catalog from './pulseCatalog.json';
import type {ErpStep} from './types';
export type PulseOperation = `pulse_${string}`;
export type PulseParameterType = 'string'|'object'|'array'|'boolean'|'number';
export const pulseActions = catalog as Record<string,{label:string;required:string[];optional:string[];types:Record<string,PulseParameterType>}>;
export function isPulseOperation(value:string):value is PulseOperation {return Object.hasOwn(pulseActions,value)}
export function pulseDefaultValue(operation:string,key:string):unknown {
 const type=pulseActions[operation]?.types[key];
 return type==='object'?{}:type==='array'?[]:type==='boolean'?false:type==='number'?0:'';
}
export function pulseInitialConfig(operation:string):Record<string,unknown> {
 return Object.fromEntries((pulseActions[operation]?.required??[]).map(key=>[key,pulseDefaultValue(operation,key)]));
}
export function createPulseStep(operation:PulseOperation):Extract<ErpStep,{kind:'erpnext'}> {
 return {kind:'erpnext',operation,label:pulseActions[operation].label,configJson:JSON.stringify(pulseInitialConfig(operation))};
}
export const PULSE_ACTION_LIBRARY = Object.entries(pulseActions).map(([kind,entry])=>({
 kind:kind as PulseOperation,title:entry.label,description:'Use native ERPNext records with Pulse permissions and validation.',group:'Pulse',icon:'record' as const,
}));
