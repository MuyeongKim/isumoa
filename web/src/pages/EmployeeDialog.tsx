import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { EMPLOYEE_STATUSES, EMPLOYEE_STATUS_LABELS, type Department, type Employee } from '@shared/types.ts';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogActions } from '@/components/ui/Dialog';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/Field';
import { api, errorMessage } from '@/lib/api';

/** 빈 칸은 null로 보낸다 */
function text(form: FormData, key: string): string | null {
  const value = String(form.get(key) ?? '').trim();
  return value === '' ? null : value;
}

export function EmployeeDialog({
  open,
  employee,
  departments,
  onClose,
}: {
  open: boolean;
  /** 없으면 새 직원 추가 */
  employee: Employee | null;
  departments: Department[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);
  async function save(): Promise<boolean> {
    if (savingRef.current || !formRef.current?.reportValidity()) return false;
    const form = new FormData(formRef.current);

    const body = {
      name: text(form, 'name'),
      empNo: text(form, 'empNo'),
      departmentId: Number(form.get('departmentId')),
      position: text(form, 'position'),
      empType: text(form, 'empType'),
      birthDate: text(form, 'birthDate'),
      status: form.get('status'),
      hiredOn: text(form, 'hiredOn'),
      leftOn: text(form, 'leftOn'),
      note: text(form, 'note'),
    };
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      if (employee) await api.patch(`/employees/${employee.id}`, body);
      else await api.post('/employees', body);
      toast.success(employee ? `${body.name} 님 정보를 저장했습니다.` : `${body.name} 님을 추가했습니다.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['employees'] }),
        queryClient.invalidateQueries({ queryKey: ['departments'] }),
        queryClient.invalidateQueries({ queryKey: ['overview'] }),
      ]);
      setDirty(false);
      onClose();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); void save(); }
  function requestClose() { formRef.current?.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true })); }

  return (
    <Dialog open={open} onClose={onClose} title={employee ? '직원 정보 수정' : '직원 추가'} width="lg" dirty={dirty} busy={saving} onSave={save}>
      <form ref={formRef} onSubmit={submit} onChange={() => setDirty(true)} className="space-y-4">
        <fieldset disabled={saving} className="space-y-4">
        <FormError message={error} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="성명" htmlFor="emp-name" required>
            <Input id="emp-name" name="name" defaultValue={employee?.name} required autoFocus />
          </Field>
          <Field label="사번" htmlFor="emp-no">
            <Input id="emp-no" name="empNo" defaultValue={employee?.empNo ?? ''} />
          </Field>
          <Field label="부서" htmlFor="emp-dept" required>
            <Select id="emp-dept" name="departmentId" defaultValue={employee?.departmentId ?? ''} required>
              <option value="" disabled>
                부서 선택
              </option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="직급·직위" htmlFor="emp-position">
            <Input id="emp-position" name="position" defaultValue={employee?.position ?? ''} />
          </Field>
          <Field label="직종" htmlFor="emp-type" hint="예: 일반직, 공무직">
            <Input id="emp-type" name="empType" defaultValue={employee?.empType ?? ''} />
          </Field>
          <Field label="재직 상태" htmlFor="emp-status">
            <Select id="emp-status" name="status" defaultValue={employee?.status ?? 'active'}>
              {EMPLOYEE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {EMPLOYEE_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="생년월일" htmlFor="emp-birth" hint="동명이인 구분에 씁니다">
            <Input id="emp-birth" name="birthDate" defaultValue={employee?.birthDate ?? ''} placeholder="1985-03-12" />
          </Field>
          <Field label="임용일" htmlFor="emp-hired">
            <Input id="emp-hired" name="hiredOn" defaultValue={employee?.hiredOn ?? ''} placeholder="2020-01-02" />
          </Field>
          <Field label="퇴직일" htmlFor="emp-left">
            <Input id="emp-left" name="leftOn" defaultValue={employee?.leftOn ?? ''} placeholder="비워 두면 재직 중" />
          </Field>
        </div>
        <Field label="메모" htmlFor="emp-note">
          <Textarea id="emp-note" name="note" defaultValue={employee?.note ?? ''} rows={2} />
        </Field>
        <DialogActions>
          <Button disabled={saving} onClick={requestClose}>취소</Button>
          <Button type="submit" variant="primary" loading={saving}>
            {employee ? '저장' : '추가'}
          </Button>
        </DialogActions>
        </fieldset>
      </form>
    </Dialog>
  );
}
