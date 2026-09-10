import type { Infer, GenericId } from 'convex/values';
import type {workflowTrigger,workflowStep} from './validators';
export type Id<T extends string> = GenericId<T>;
export type Trigger = (Infer<typeof workflowTrigger> | {kind:'incoming_webhook';name?:string} | {kind:'document_event';doctype:string;event:string}) & {id?:string;condition?:{field:string;operator:'is'|'is_not'|'contains'|'does_not_contain'|'is_empty'|'is_not_empty';value:string;match?:'all'|'any';conditions?:Array<{field:string;operator:'is'|'is_not'|'contains'|'does_not_contain'|'is_empty'|'is_not_empty';value:string}>}};
type ErpStepFields = {label:string;operation?:'get_document'|'create_document'|'update_document'|'apply_workflow'|'condition';configJson:string};
export type ErpStep = (ErpStepFields & {kind:'erpnext'}) | (ErpStepFields & {kind:'outgoing_webhook'}) | (ErpStepFields & {kind:'get_document'}) | (ErpStepFields & {kind:'api_request'});
export type CodeStep={kind:'custom_code';label:string;code:string};
type NativeStep = Infer<typeof workflowStep>;
export type Step = Exclude<NativeStep,{kind:"send_email"}> | (Extract<NativeStep,{kind:"send_email"}> & {sender?:string;senderName?:string;cc?:string;bcc?:string;preheader?:string;attachments?:string[]}) | ErpStep | CodeStep;
// Branch actions retain the same editor capabilities, including the ERP additions.
export type EditorStep = Exclude<Step,{kind:'if_else'}> | (Omit<Extract<Step,{kind:'if_else'}>,'branches'|'elseSteps'> & {branches:Array<{name:string;match?:'all'|'any';conditions?:Array<{field:string;operator:'is'|'is_not'|'contains'|'does_not_contain'|'is_empty'|'is_not_empty';value:string}>;field:string;operator:'is'|'is_not'|'contains'|'does_not_contain'|'is_empty'|'is_not_empty';value:string;steps?:Array<Exclude<Step,{kind:'if_else'}>>}>;elseSteps?:Array<Exclude<Step,{kind:'if_else'}>>});
export type Version = {_id:Id<'workflowVersions'>;number:number;trigger:Trigger;triggers?:Trigger[];steps:EditorStep[];validationErrors:string[];createdAt:number};
export type RunStatus='queued'|'running'|'succeeded'|'failed'|'canceled';
export type Run={_id:string;status:RunStatus;triggerKind:string;createdAt:number;error?:string;steps:Array<{_id:string;position:number;label:string;status:RunStatus;error?:string;output?:string}>};
export type Workflow={_id:Id<'workflowDefinitions'>;name:string;description?:string;status:'draft'|'active'|'paused'|'archived';trigger:Trigger;triggers?:Trigger[];currentVersion:Version|null;currentVersionId?:Id<'workflowVersions'>;recentRuns:Run[];updatedAt:number};
