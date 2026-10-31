import { expect, it } from 'vitest';
import { privateText, redactPersonalText, sanitizeAiPayload, maskPrivateValues } from '../../server/src/assist/privacy.ts';
import { buildAiMessages, validateAiReply } from '../../server/src/assist/review.ts';
import { defaultRules, emptyCustom } from '../../server/src/rules/service.ts';
import type { CertificateInput, Training } from '../../shared/types.ts';
const rules={official:defaultRules,custom:emptyCustom,version:'test'};
const input:CertificateInput={employeeId:null,courseTitle:'공공윤리 실천사례',provider:'가상교육원',certNo:'TEST-1',completedOn:'2026-10-20',hours:3,year:2026,credits:[]};
const suffix='\n과정명 : 공공윤리 실천사례\n이수일 : 2026-10-20\n교육시간 : 2시간\n교육기관 : 가상교육원';
it.each([
 ['콜론 없음','이름  김연진\n생년월일  1990.03.02'],
 ['탭 표','성명\t김연진\n생년월일\t1990/03/02'],
 ['세로선 표','| 이름 | 김연진 | 생년월일 | 1990.03.02 |'],
 ['다음 줄 값','이름\n김연진\n생년월일\n1990.03.02'],
 ['띄어 쓴 머리글','성  명  김연진\n생 년 월 일 1990년 3월 2일'],
 ['붙은 값','성명김연진\n생년월일19900302'],
 ['여러 항목 한 줄','이름 김연진  생년월일 1990-03-02  부서 가상검증과'],
 ['개인정보 머리글 다음 행','이름 | 생년월일\n김연진 | 1990.03.02'],
 ['전각 공백 머리글','성　명　김연진\n생　년　월　일　1990.03.02'],
 ['전각 구분자','│ 이름 ： 김연진 │ 생년월일 ： 1990.03.02 │'],
])('%s에서도 OCR 직원 판독값 없이 개인정보를 가리고 이수 정보는 보존한다',(_,personal)=>{const out=privateText('수료증\n'+personal+suffix,[]);expect(out).not.toContain('김연진');expect(out).not.toMatch(/1990|19900302/);expect(out).toContain('공공윤리 실천사례');expect(out).toContain('2026-10-20');expect(out).toContain('2시간');expect(out).toContain('가상교육원');});
it('개인정보와 교육 항목이 같은 행이어도 교육값은 남긴다',()=>{const out=privateText('이름 김연진 | 과정명 : 공공윤리 실천사례 | 생년월일 1990.03.02 | 교육시간 : 2시간',[]);expect(out).not.toContain('김연진');expect(out).not.toContain('1990');expect(out).toContain('공공윤리 실천사례');expect(out).toContain('2시간');});
it.each(['1990.03.02','1990/3/2','1990년 3월 2일','19900302'])('알고 있는 직원 생년월일의 %s 표기도 치환한다',birth=>{const out=privateText('김 연 진 · '+birth+suffix,['김연진','1990-03-02']);expect(out).not.toContain('김 연 진');expect(out).not.toContain('1990');expect(out).toContain('2026-10-20');});
it('추가한 개인정보 항목 이름과 뒤의 값을 함께 가린다',()=>{const out=privateText('수강자 김연진\n본인생일 1990.03.02'+suffix,[],{name:['수강자'],birth:['본인생일']});expect(out).not.toContain('김연진');expect(out).not.toContain('1990');expect(out).toContain('공공윤리');});
it('교육·개인정보 머리글의 다음 행 대응이 불명확하면 AI 요청 전에 보류한다',()=>{expect(()=>privateText('성명 | 과정명\n김연진 | 공공윤리 실천사례'+suffix,[])).toThrow('표 구조');});
it('이미 뒷자리가 가려진 주민번호·전화·이메일도 AI에는 전달하지 않는다',()=>{const out=privateText('850312-1******\n010-1234-5678\na@example.com'+suffix,[]);expect(out).not.toContain('850312');expect(out).not.toContain('010-');expect(out).not.toContain('example.com');expect(out).toContain('2026-10-20');});
it('짧은 사번이 다른 숫자 내부의 날짜·증서번호까지 훼손하지 않는다',()=>{expect(maskPrivateValues('사번 001 / 이수일 2001-03-02 / TEST-1001',['001'])).toBe('사번 [개인정보 가림] / 이수일 2001-03-02 / TEST-1001');});
it('잘못 읽은 판독값과 교육·규칙 메타데이터를 포함한 실제 요청 전체를 가린다',()=>{const redacted=redactPersonalText('이름 김연진\n생년월일 1990.03.02'+suffix,[]);const badInput={...input,courseTitle:'김연진 공공윤리 실천사례',provider:'1990/3/2',certNo:'김 연 진'};const messages=buildAiMessages(badInput,redacted.text,[{id:1,code:'integrity',name:'김연진 청렴교육',active:true,deletedAt:null,fromYear:null,toYear:null,reqType:'hours',reqValue:1}] as Training[],rules,redacted.values);const sent=JSON.stringify(messages);expect(sent).not.toContain('김연진');expect(sent).not.toContain('김 연 진');expect(sent).not.toContain('1990');expect(sent).toContain('공공윤리 실천사례');expect(sent).toContain('2026-10-20');});
it('나중에 발견한 개인정보도 요청 앞쪽 필드까지 치환한다',()=>{const r=sanitizeAiPayload({first:'김연진',last:'이름 김연진'},[]);expect(JSON.stringify(r)).not.toContain('김연진');});
const good={field:'hours',value:2,reason:'원문 명시',evidence:'교육시간 : 2시간'};
it('길이가 넘는 제안 하나 때문에 정상 제안을 잃지 않으며 초과 값은 잘라 적용하지 않는다',()=>{const bad={field:'courseTitle',value:'가'.repeat(301),reason:'긴 값',evidence:'가'.repeat(301)};const r=validateAiReply({summary:'비교',suggestions:[good,bad]},input,suffix+'\n'+bad.evidence,[],rules);expect(r.suggestions).toEqual([good]);expect(r.rejected).toBe(1);});
it('기관·증서번호 저장 한도 100자, 이유·근거 길이, 잘못된 항목을 개별 검사한다',()=>{const r=validateAiReply({summary:'비교',suggestions:[{...good,field:'provider',value:'가'.repeat(101)},{...good,field:'certNo',value:'가'.repeat(101)},{...good,reason:'가'.repeat(401)},{...good,evidence:'가'.repeat(601)},{...good,field:'employeeId'},good]},input,suffix,[],rules);expect(r.suggestions).toEqual([good]);expect(r.rejected).toBe(5);});
it('같은 항목의 잘못된 후보가 정상 후보보다 먼저 와도 정상 후보를 살린다',()=>{const r=validateAiReply({summary:'비교',suggestions:[{...good,value:50},good]},input,suffix,[],rules);expect(r.suggestions).toEqual([good]);expect(r.rejected).toBe(1);});
it('응답 외곽 형식이나 개수 상한이 틀리면 사용자용 한국어로 안내한다',()=>{for(const body of[{summary:'비교',suggestions:[],autoConfirm:true},{summary:123,suggestions:[]},{summary:'비교',suggestions:Array(13).fill(good)}])expect(()=>validateAiReply(body,input,suffix,[],rules)).toThrow('AI 응답 형식을 확인하지 못했습니다');});

it('현재 값과 같은 정상 제안은 변경 후보에서 생략한다',()=>{const same={field:'provider',value:input.provider,reason:'원문과 같음',evidence:'교육기관 : 가상교육원'};const r=validateAiReply({summary:'비교',suggestions:[same,good]},input,suffix,[],rules);expect(r.suggestions).toEqual([good]);expect(r.rejected).toBe(0);});

it('개인정보 열의 값이 다른 판독 필드에 섞여도 요청 전체에서 가린다',()=>{const r=redactPersonalText('이름 | 생년월일\n김연진 | 1990.03.02'+suffix,[]);const sent=JSON.stringify(sanitizeAiPayload({current:{courseTitle:'김연진',provider:'1990-03-02'},documentText:r.text},r.values));expect(sent).not.toContain('김연진');expect(sent).not.toContain('1990');expect(sent).toContain('공공윤리');});
