import {createContext,useContext} from 'react';
export const WorkflowDraftContext=createContext<{save:()=>Promise<unknown>;busy:boolean;savedTriggerIds:string[]}|null>(null);
export const useWorkflowDraft=()=>useContext(WorkflowDraftContext);
