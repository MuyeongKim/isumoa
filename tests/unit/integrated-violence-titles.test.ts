import { expect, it } from 'vitest';
import { classifyTrainings, currentTrainingNotes, integratedViolenceFlags, isIntegratedViolenceTitle } from '../../server/src/certs/trainingClassifier.ts';
const trainings=[{id:1,code:'violence-integrated',name:'4대 폭력예방교육',keywords:['4대 폭력'],applicable:true}];
it.each(['2026 4대폭력 예방교육','2026. 4대 폭력예방교육','(2026) 4대폭력예방교육','2026_4대폭력예방','2026. 4대·폭력 예방교육','4 대 폭 력 예방교육','가정폭력·성폭력·성매매·성희롱 예방교육','2026년 4대폭력 예방교육','중앙부처 4대폭력 예방교육','4대폭력 예방교육 중급과정','사대폭력 예방교육','2026 (사대폭력 예방교육)'])('전체 범위가 명시된 원문 표기를 연결한다: %s',title=>{
 expect(isIntegratedViolenceTitle(title)).toBe(true);expect(classifyTrainings(title,title,trainings,new Map())).toMatchObject({trainingIds:[1],source:'integrated'});expect(integratedViolenceFlags(title,trainings)).toEqual([]);
});
it.each(['14대폭력 예방교육','24대폭력 예방교육','20264대폭력 예방교육','십사대폭력 예방교육','2026 성희롱·성폭력 예방교육','성희롱·성매매·성폭력 예방교육','2026 4대폭력 예방교육(가정폭력 제외)','2026 4대폭력 중 성희롱편','4대폭력 부분 이수','4대폭력 선택과정','성희롱·성매매·성폭력·가정폭력 교육'])('다른 숫자·불완전한 범위·예방 근거 없는 제목은 확인 표시를 유지한다: %s',title=>{
 expect(isIntegratedViolenceTitle(title)).toBe(false);expect(integratedViolenceFlags(title,trainings)).toEqual([expect.objectContaining({level:'warning'})]);
});
it('네 주제 나열과 예방 표현이 본문에만 있으면 신뢰 연결하지 않는다',()=>{
 const body='가정폭력·성폭력·성매매·성희롱 예방교육';for(const title of [null,'직무교육'])expect(classifyTrainings(title,body,trainings,new Map()).source).not.toBe('integrated');
});
it('정확한 대기 연결의 파생 경고만 재평가하며 다른 경고·notes·확정·제외 기록은 유지한다',()=>{
 const notes=[{code:'training-name-suggestion',level:'warning' as const,message:'이름 비교'},{code:'training-integrated-check',level:'warning' as const,message:'전체 범위 확인'},{code:'duplicate',level:'warning' as const,message:'중복'}];
 const title='2026 4대폭력 예방교육';expect(currentTrainingNotes(notes,'draft',title,[1],trainings)).toEqual(notes.slice(2));expect(notes).toHaveLength(3);
 for(const status of ['confirmed','excluded'])expect(currentTrainingNotes(notes,status,title,[1],trainings)).toEqual(notes);
 expect(currentTrainingNotes(notes,'draft',title,[1,2],trainings)).toEqual(notes);expect(currentTrainingNotes(notes,'draft','2026 성희롱·성폭력 예방교육',[1],trainings)).toEqual(notes);
});
