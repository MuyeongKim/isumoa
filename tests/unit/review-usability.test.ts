import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { classifyTrainings, courseTitleKey, currentTrainingNotes, integratedViolenceFlags, isIntegratedViolenceTitle } from '../../server/src/certs/trainingClassifier.ts';
import { defaultRules, emptyCustom } from '../../server/src/rules/service.ts';
import { parseCertificateText } from '../../server/src/certs/parseText.ts';
import { evaluateRecognition } from '../../server/src/certs/evaluation.ts';
import { hasMoreColumns } from '../../shared/horizontalScroll.ts';
import { VIOLENCE } from '../../scripts/fixtures/sampleTrainings.ts';
import type { Training } from '../../shared/types.ts';
const trainings=[{id:3,code:'violence-integrated',name:'4대 폭력예방교육',keywords:['4대 폭력'],applicable:true}];
const full='2026년 폭력예방 통합교육(성희롱·성매매·성폭력·가정폭력)';
const rules={official:defaultRules,custom:emptyCustom,version:'test'};
it.each([full,'4대폭력','4대 폭력예방','통합 폭력예방(4대)','폭력예방 통합교육 (4대)','폭력 예방 통합교육(가정폭력 / 성폭력 / 성매매 / 성희롱)'])('전체 범위가 명확한 제목만 신뢰한다: %s',title=>{
 expect(isIntegratedViolenceTitle(title)).toBe(true);expect(classifyTrainings(title,title,trainings,new Map(),{rules})).toMatchObject({trainingIds:[3],source:'integrated'});
});
it.each(['폭력','14대 폭력예방','폭력예방 교육','성희롱·성폭력 예방교육','폭력예방 통합교육(성희롱·성매매·성폭력)','4대 폭력예방교육 중 성희롱편',full+' 성매매 미포함','4대 폭력예방(성희롱·성폭력)','4대 폭력예방교육 일부',full+' 중 택1'])('불완전한 제목은 학습 매핑·키워드가 있어도 확인 표시를 남긴다: %s',title=>{
 expect(isIntegratedViolenceTitle(title)).toBe(false);
 const result=classifyTrainings(title,full,trainings,new Map([[courseTitleKey(title),[3]]]));
 expect(result.source).not.toBe('integrated');expect(integratedViolenceFlags(title,trainings)).toEqual([expect.objectContaining({level:'warning'})]);
});
it('본문만 네 주제를 나열하거나 비활성·중복 통합교육이면 신뢰 연결을 적용하지 않는다',()=>{
 expect(classifyTrainings('폭력예방 교육',full,trainings,new Map()).source).toBe('name');
 expect(classifyTrainings(null,full,trainings,new Map()).source).not.toBe('integrated');
 expect(classifyTrainings(full,full,[{...trainings[0],applicable:false}],new Map()).trainingIds).toEqual([]);
 expect(classifyTrainings(full,full,[...trainings,{...trainings[0],id:4}],new Map()).source).not.toBe('integrated');
});
it('기존 대기 중 정확한 연결의 이름 비교 경고만 재평가하며 원본 notes는 보존한다',()=>{
 const notes=[{code:'training-name-suggestion',level:'warning' as const,message:'이름 비교'},{code:'duplicate',level:'warning' as const,message:'중복'},{code:'custom-rule-match',level:'warning' as const,message:'사용자 규칙'}];
 expect(currentTrainingNotes(notes,'draft',full,[3],trainings)).toEqual(notes.slice(1));expect(notes).toHaveLength(3);
 for(const status of ['confirmed','excluded'])expect(currentTrainingNotes(notes,status,full,[3],trainings)).toEqual(notes);
 expect(currentTrainingNotes(notes,'draft',full,[3,4],trainings)).toEqual(notes);
 expect(currentTrainingNotes(notes,'draft','폭력예방 교육',[3],trainings)).toEqual(notes);
});
it('현재 규칙으로 평가하며 참고시간 경고를 누락하거나 학습된 정답을 끌어오지 않는다',()=>{
 const text='수료증\n성명 : 홍길동\n과정명 : 가상 맞춤과정\n이수일 : 2026-10-20\n교육시간 : 2시간';
 const custom={...emptyCustom,rules:[{...defaultRules.rules[0],id:'eval',title:'평가과정',courseTitles:['가상 맞춤과정'],keywords:[],providers:[],fromYear:null,toYear:null,excludeKeywords:[],trainingCode:'violence-integrated',referenceHours:4}]};
 const ts=[{...trainings[0],reqType:'hours',reqValue:4,category:null,legalBasis:null,sortOrder:1,note:null,active:true,fromYear:null,toYear:null,deletedAt:null}] as Training[];
 const result=evaluateRecognition({text,read:parseCertificateText(text),route:'text'},{year:2026,trainings:ts,employees:[],rules:{...rules,custom}});
 expect(result.draft.trainingIds).toEqual([3]);expect(result.flags.map(f=>f.code)).toContain('rule-reference-hours');expect(result.flags.map(f=>f.code)).toContain('custom-rule-match');
 const baseline=evaluateRecognition({text,read:parseCertificateText(text),route:'text'},{year:2026,trainings:ts,employees:[],rules});expect(baseline.draft.trainingIds).toEqual([]);
 const recognized=evaluateRecognition({text:full,read:{...parseCertificateText(text),courseTitle:full},route:'text'},{year:2026,trainings:ts,employees:[],rules});expect(recognized.draft.trainingIds).toEqual([3]);expect(recognized.flags.map(f=>f.code)).not.toContain('training-name-suggestion');
});
it('샘플 생성 정답은 기본 배포판의 통합교육 1개 코드를 사용한다',()=>{
 expect(VIOLENCE).toEqual(['violence-integrated']);
 const truth=JSON.parse(readFileSync(new URL('../../samples/certs/정답.json',import.meta.url),'utf8')) as {trainings?:string[]}[];expect(truth.filter(t=>t.trainings?.includes('violence-integrated'))).toHaveLength(32);expect(truth.some(t=>t.trainings?.some(code=>['sexual-harassment','sexual-violence','prostitution','domestic-violence'].includes(code)))).toBe(false);
});
it('가로 스크롤은 화면에 남은 열이 있을 때만 안내한다',()=>{
 expect(hasMoreColumns(0,1100,1600)).toBe(true);expect(hasMoreColumns(100,1100,1600)).toBe(true);expect(hasMoreColumns(500,1100,1600)).toBe(false);expect(hasMoreColumns(499.5,1100,1600)).toBe(false);expect(hasMoreColumns(0,1700,1600)).toBe(false);expect(hasMoreColumns(0,0,1600)).toBe(false);expect(hasMoreColumns(-5,1100,1600)).toBe(true);
});

it('검증된 공식 과정명은 기존 공식 규칙 연결을 유지한다',()=>{const title='평등한일상폭력예방교육일반';expect(classifyTrainings(title,title,trainings,new Map(),{rules}).source).toBe('pack-official');expect(integratedViolenceFlags(title,trainings,{rules})).toEqual([]);});

it('공식 규칙의 정확한 제목이라도 일부 주제·제외 표현이 있으면 통합교육 확인 표시를 유지한다',()=>{const title='4대 폭력예방(성희롱·성폭력)';const partial={...rules,official:{...defaultRules,rules:[{...defaultRules.rules.find(r=>r.trainingCode==='violence-integrated')!,courseTitles:[title]}]}};expect(integratedViolenceFlags(title,trainings,{rules:partial})).toEqual([expect.objectContaining({level:'warning'})]);});
