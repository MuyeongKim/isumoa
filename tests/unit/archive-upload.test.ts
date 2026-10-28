import { describe, expect, it } from 'vitest';
import { BlobReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js/index-native.js';
import JSZip from 'jszip';
import iconv from 'iconv-lite';
import { isZip, readArchive, ZIP_LIMITS } from '../../web/src/upload/readArchive.ts';
const pdf = new TextEncoder().encode('%PDF-1.4\n% synthetic fixture');
async function archive(entries: { name: string; data?: Uint8Array; options?: Record<string,unknown> }[]): Promise<File> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers:false });
  for(const e of entries)await writer.add(e.name, new Uint8ArrayReader(e.data ?? pdf), e.options);
  return new File([await writer.close()], '가상수료증.zip', {type:'application/zip'});
}
describe('수료증 ZIP', () => {
  it('폴더와 한글·대문자 PDF 및 사진을 찾고 그 외 파일과 중첩 ZIP은 안내한다', async()=>{
    const zip=await archive([{name:'총무과/같은이름.PDF'},{name:'재무과/같은이름.pdf'},{name:'사진.png',data:Uint8Array.from([137,80,78,71,13,10,26,10,0])},{name:'설명.txt',data:new Uint8Array()},{name:'또다른.zip',data:new Uint8Array()}]);
    const r=await readArchive(zip);expect(r.files.map(f=>f.path)).toEqual(['총무과/같은이름.PDF','재무과/같은이름.pdf','사진.png']);expect(r.files[0].file.name).toBe('같은이름.PDF');expect(r.skipped).toHaveLength(2);expect(new Uint8Array(await r.files[0].file.arrayBuffer())).toEqual(pdf);
  });
  it('Windows CP949로 압축한 한글 파일 이름을 복원한다',async()=>{
    const z=new JSZip();z.file('부서/청렴교육.pdf',pdf);const data=await z.generateAsync({type:'uint8array',encodeFileName:((s:string)=>iconv.encode(s,'cp949')) as unknown as (s:string)=>string});const r=await readArchive(new File([new Uint8Array(data)],'cp949.zip'));expect(r.files[0].path).toBe('부서/청렴교육.pdf');
  });
  it('경로 이탈·바로가기·형식 위장은 읽지 않고 안전한 파일은 유지한다',async()=>{
    const zip=await archive([{name:'shortcut.pdf',data:new TextEncoder().encode('/etc/passwd'),options:{unixMode:0o120777}},{name:'fake.pdf',data:new TextEncoder().encode('MZ fake executable')},{name:'정상.pdf'}]);const r=await readArchive(zip);expect(r.files.map(f=>f.path)).toEqual(['정상.pdf']);expect(r.skipped).toHaveLength(2);
  });
  it('경로 이탈 ZIP은 압축 전체를 거부한다',async()=>{for(const name of ['../escape.pdf','C:/escape.pdf'])await expect(readArchive(await archive([{name},{name:'정상.pdf'}]))).rejects.toThrow('경로');});
  it('헤더 크기를 속인 파일은 등록하지 않는다',async()=>{
    const zip=await archive([{name:'위조.pdf',options:{level:0}}]);const b=new Uint8Array(await zip.arrayBuffer()),v=new DataView(b.buffer);const central=Buffer.from(b).indexOf(Buffer.from([80,75,1,2]));v.setUint32(22,1,true);v.setUint32(central+24,1,true);
    const result=await readArchive(new File([b],'위조.zip'),()=>{},{files:1000,bytes:10});expect(result.files).toHaveLength(0);expect(result.skipped).toHaveLength(1);
  });
  it('암호 ZIP의 파일은 안내하고 다른 파일은 읽는다',async()=>{
    const zip=await archive([{name:'잠금.pdf',options:{password:'synthetic-password'}},{name:'정상.pdf'}]);const r=await readArchive(zip);expect(r.files).toHaveLength(1);expect(r.skipped[0].reason).toContain('암호');
  });
  it('CRC가 맞지 않는 파일은 성공으로 처리하지 않고 다음 파일을 읽는다',async()=>{
    const zip=await archive([{name:'손상.pdf',options:{level:0}},{name:'정상.pdf',options:{level:0}}]);const b=new Uint8Array(await zip.arrayBuffer());const offset=Buffer.from(b).indexOf(Buffer.from(pdf));b[offset+12]^=1;const r=await readArchive(new File([b],'손상.zip'));expect(r.files.map(f=>f.path)).toEqual(['정상.pdf']);expect(r.skipped[0].reason).toContain('손상');
  });
  it('잘못된 ZIP과 용량·개수 초과는 등록 준비를 막는다',async()=>{
    await expect(readArchive(new File(['not a zip'],'잘못.zip'))).rejects.toThrow('ZIP');
    await expect(readArchive({name:'large.zip',size:ZIP_LIMITS.archiveBytes+1} as File)).rejects.toThrow('300MB');
    const zip=await archive([{name:'정상.pdf'}]);await expect(readArchive(zip,()=>{},{files:0,bytes:1000})).rejects.toThrow('1,000');await expect(readArchive(zip,()=>{},{files:1000,bytes:1})).rejects.toThrow('500MB');
  });
  it('수료증 없는 ZIP은 빈 결과와 건너뛴 사유를 반환한다',async()=>{
    const r=await readArchive(await archive([{name:'안내.txt',data:new Uint8Array()},{name:'__MACOSX/._안내.txt',data:new Uint8Array()}]));expect(r.files).toHaveLength(0);expect(r.skipped).toHaveLength(1);expect(isZip(new File([],'교육.ZIP'))).toBe(true);
  });
});
