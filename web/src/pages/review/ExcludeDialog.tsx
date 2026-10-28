import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogActions } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Field';
import type { BulkExcludePreview } from '@shared/types.ts';

const REASONS = ['이수증이 아님 (표지·빈 쪽)', '관리 대상 교육이 아님', '중복 제출', '다른 기관 직원', '내용을 읽을 수 없음'];

export function ExcludeDialog({ open, fileName = '', hasEdits = false, preview, scopeLabel, busy = false, onClose, onExclude }: { open: boolean; fileName?: string; hasEdits?: boolean; preview?: BulkExcludePreview; scopeLabel?: string; busy?: boolean; onClose: () => void; onExclude: (reason: string, saveEdits: boolean) => void }) {
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [saveEdits, setSaveEdits] = useState(true);
  const value = reason === '기타' ? other.trim() : reason;

  return (
    <Dialog open={open} onClose={onClose} dismissible={!busy} title={preview ? `${preview.ids.length}건 선택 제외` : '수료증 제외'} description="제외한 수료증은 이수 현황에 합산하지 않습니다. 원본은 보존하며 나중에 되돌릴 수 있습니다.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value && !busy) onExclude(value, saveEdits);
        }}
      >
        {preview ? <div className="mb-4 space-y-2 text-[13px]">
          {scopeLabel && <p className="text-ink-soft">{scopeLabel}</p>}
          <p className="font-semibold">선택한 {preview.ids.length}건 · 검수 대기 {preview.drafts}건 · 확정 {preview.confirmed}건</p>
          {preview.confirmed > 0 && <p className="rounded-lg border border-warn/40 bg-warn-soft p-3">이미 확정한 {preview.confirmed}건도 이수 현황 합산에서 제외됩니다. 대상과 사유를 확인해 주세요.</p>}
          <ul className="max-h-40 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-paper" aria-label="선택 제외 대상">
            {preview.items.map(item => <li key={item.id} className="px-3 py-2">
              <span className="block font-medium break-all">#{item.id} · {item.employeeName ?? '직원 미정'} · {item.fileName}</span>
              <span className="block text-[12px] break-all text-ink-soft">{item.status === 'confirmed' ? '확정' : '검수 대기'} · {item.courseTitle ?? '과정명 미정'}</span>
            </li>)}
          </ul>
        </div> : <p className="mb-4 rounded-lg bg-paper px-3 py-2 text-[13px] break-all"><strong>대상:</strong> {fileName}</p>}
        <p className="mb-3 text-[13px] text-ink-soft">제외 사유를 직접 골라 주세요. 기존 판독값과 원본은 보존합니다.</p>
        {hasEdits && <div className="mb-4 rounded-lg border border-warn/30 bg-warn-soft p-3 text-[13px]">
          <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-navy" checked={saveEdits} onChange={e => setSaveEdits(e.target.checked)} />수정값을 임시 저장하고 제외</label>
          <p className="mt-1.5 text-ink-soft">{saveEdits ? '저장할 수 없는 값이 있으면 제외 전에 오류를 알려 드립니다.' : '이번에 입력한 미저장 수정값은 버리고 기존 기록으로 제외합니다.'}</p>
        </div>}
        <fieldset className="space-y-2" disabled={busy}>
          <legend className="sr-only">제외 사유</legend>
          {[...REASONS, '기타'].map((r) => (
            <label key={r} className="flex items-center gap-2 text-[14px]">
              <input type="radio" name="reason" className="size-4 accent-navy" checked={reason === r} onChange={() => setReason(r)} autoFocus={r === REASONS[0]} />
              {r}
            </label>
          ))}
          {reason === '기타' && <Input value={other} onChange={(e) => setOther(e.target.value)} placeholder="사유를 적어 주세요" maxLength={200} disabled={busy} autoFocus />}
        </fieldset>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>취소</Button>
          <Button type="submit" variant="danger" disabled={!value} loading={busy}>
            {preview ? `${preview.ids.length}건 제외` : '수료증 제외'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
