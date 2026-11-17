import es from './crmCatalog.es.json';
// Spanish for CRM actions only. The language comes from the Frappe boot data
// (window.automationFrappe.lang); every other language falls back to English.
export type CrmLang='en'|'es';
export const CRM_ES=es as {actions:Record<string,string>;description:string;fields:Record<string,string>;help:Record<string,string>;text:Record<string,string>};
const EN_TEXT:Record<string,string>={
 hint:'Uses CRM Conversations on this site. Set doctype to CRM Lead or CRM Deal and name to its ID, for example {{trigger.name}}. The message, note, task or call is attached to that record. Permissions of the workflow user apply.',
 required:'(required)',remove:'Remove {field}',noInputs:'This action requires no inputs.',optionalInput:'Optional input',chooseOptional:'Choose an optional input…',addInput:'Add input',
 unavailable:'This CRM operation is unavailable in this editor version. Its JSON is preserved below.',
 footer:'Use native IDs for records. Objects contain field names and values; arrays contain IDs or rule objects. Advanced JSON supports structured inputs and data references.',
};
export const CRM_DESCRIPTION_EN='Act on a CRM Lead or Deal through CRM Conversations; activity is logged on that record.';
export function crmLang(lang:unknown=(globalThis as any).automationFrappe?.lang):CrmLang{
 return typeof lang==='string'&&lang.toLowerCase().startsWith('es')?'es':'en';
}
export function crmText(key:string,values:Record<string,string>={},lang:CrmLang=crmLang()):string{
 const template=(lang==='es'?CRM_ES.text[key]:undefined)??EN_TEXT[key]??key;
 return template.replace(/\{(\w+)\}/g,(match,name)=>values[name]??match);
}
export function crmFieldLabel(field:string,lang:CrmLang=crmLang()):string{return lang==='es'?CRM_ES.fields[field]??field:field}
export function crmFieldHelp(field:string,lang:CrmLang=crmLang()):string|undefined{return lang==='es'?CRM_ES.help[field]:undefined}
