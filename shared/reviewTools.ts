import type { CertificateInput } from './types.ts';
export const RULE_FIELDS = ['name','birth','org','dept','course','period','completed','hours','certNo','provider'] as const;
export type RuleField = typeof RULE_FIELDS[number];
export const FIELD_LABELS: Record<RuleField,string> = {name:'성명',birth:'생년월일',org:'소속',dept:'부서',course:'과정명',period:'교육기간',completed:'이수일',hours:'교육시간',certNo:'증서번호',provider:'교육기관'};
export interface CourseRule { id:string; title:string; enabled:boolean; courseTitles:string[]; keywords:string[]; excludeKeywords:string[]; providers:string[]; fromYear:number|null; toYear:number|null; trainingCode:string; referenceHours:number|null }
export interface RulePack { schemaVersion:1; version:string; minimumAppVersion:string; name:string; rules:CourseRule[]; fieldAliases:Partial<Record<RuleField,string[]>> }
export interface RuleBundle { official:RulePack; custom:RulePack; version:string }
export interface RuleSnapshot { revision:number; at:string; label:string; official:RulePack; custom:RulePack }
export interface RuleState extends RuleBundle { revision:number; history:RuleSnapshot[] }
export interface RuleChange { added:string[]; changed:string[]; removed:string[]; aliasesChanged:boolean }
export interface RulePreview { pack:RulePack; changes:RuleChange; token:string; revision:number; kind:'custom'|'official'; version:string }
export interface OfficialRuleEnvelope { pack:RulePack; sha256:string; signature:string }
export interface LocalAiSettings { enabled:boolean; endpoint:string; model:string; timeoutSeconds:number }
export interface LocalModel { name:string; size:number; digest:string }
export type AssistField = 'courseTitle'|'provider'|'certNo'|'completedOn'|'hours'|'trainingCodes';
export interface AssistSuggestion { field:AssistField; value:string|number|string[]; reason:string; evidence:string }
export interface AssistResult { kind:'rules'|'local_llm'; inputHash:string; ruleVersion:string; model:string|null; summary:string; suggestions:AssistSuggestion[]; rejected:number; reviewId?:number }
export interface AssistRequest { input:CertificateInput }

export function mergedAliases(bundle?:RuleBundle):Partial<Record<RuleField,string[]>> {const result:Partial<Record<RuleField,string[]>>={};for(const key of RULE_FIELDS){const words=[...(bundle?.official.fieldAliases[key]??[]),...(bundle?.custom.fieldAliases[key]??[])];if(words.length)result[key]=[...new Set(words)];}return result;}
