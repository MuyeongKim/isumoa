import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogActions } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Field';

const REASONS = ['이수증이 아님 (표지·빈 쪽)', '중복 제출', '다른 기관 직원', '내용을 읽을 수 없음'];

export function ExcludeDialog({ open, onClose, onExclude }: { open: boolean; onClose: () => void; onExclude: (reason: string) => void }) {
  const [reason, setReason] = useState(REASONS[0]);
  const [other, setOther] = useState('');
  const value = reason === '기타' ? other.trim() : reason;

  return (
    <Dialog open={open} onClose={onClose} title="이수증 제외" description="제외한 이수증은 이수 현황에 들어가지 않습니다. 나중에 되돌릴 수 있습니다.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value) onExclude(value);
        }}
      >
        <fieldset className="space-y-2">
          <legend className="sr-only">제외 사유</legend>
          {[...REASONS, '기타'].map((r) => (
            <label key={r} className="flex items-center gap-2 text-[14px]">
              <input type="radio" name="reason" className="size-4 accent-navy" checked={reason === r} onChange={() => setReason(r)} autoFocus={r === REASONS[0]} />
              {r}
            </label>
          ))}
          {reason === '기타' && <Input value={other} onChange={(e) => setOther(e.target.value)} placeholder="사유를 적어 주세요" autoFocus />}
        </fieldset>
        <DialogActions>
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" variant="danger" disabled={!value}>
            제외
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
