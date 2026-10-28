export const UPDATE_REPOSITORY = 'MuyeongKim/isumoa-releases';
export const UPDATE_MANIFEST_URL = `https://raw.githubusercontent.com/${UPDATE_REPOSITORY}/main/latest.json`;
export const UPDATE_RELEASES_URL = `https://github.com/${UPDATE_REPOSITORY}/releases/latest`;
export interface UpdateRelease { version: string; notes: string; publishedAt: string; url: string; fileName: string; downloadUrl: string; bytes: number; sha256: string }
export interface UpdateStatus { currentVersion: string; supported: boolean; releasesUrl: string; phase: 'idle'|'checking'|'available'|'current'|'downloading'|'ready'|'installing'|'completed'|'error'; latest: UpdateRelease | null; preparedVersion: string | null; downloadedBytes: number; error: string | null; checkedAt: string | null }
export function compareVersions(a: string, b: string): number { const aa=a.replace(/^v/,'').split('.').map(Number),bb=b.replace(/^v/,'').split('.').map(Number); for(let i=0;i<3;i++){const n=(aa[i]??0)-(bb[i]??0);if(n)return n>0?1:-1;}return 0; }
export function parseUpdateRelease(value: unknown): UpdateRelease {
  const r=value as Record<string,unknown>; const version=typeof r?.tag_name==='string'?r.tag_name.replace(/^v/,''):'';
  if(!/^\d+\.\d+\.\d+$/.test(version)||r.draft!==false||r.prerelease!==false||!Array.isArray(r.assets))throw Error('올바른 정식 릴리스 정보가 아닙니다.');
  const fileName=`isumoa-setup-${version}-win-x64.exe`,a=r.assets.find((a:Record<string,unknown>)=>a.name===fileName);
  const downloadUrl=`https://github.com/${UPDATE_REPOSITORY}/releases/download/v${version}/${fileName}`;
  if(!a||a.browser_download_url!==downloadUrl||!Number.isSafeInteger(a.size)||a.size<=0||a.size>300*1024*1024||typeof a.digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(a.digest))throw Error('설치 파일의 주소·크기·체크섬을 확인할 수 없습니다.');
  return{version,notes:typeof r.body==='string'?r.body.slice(0,20000):'',publishedAt:typeof r.published_at==='string'?r.published_at:'',url:`https://github.com/${UPDATE_REPOSITORY}/releases/tag/v${version}`,fileName,downloadUrl,bytes:a.size,sha256:a.digest.slice(7)};
}
