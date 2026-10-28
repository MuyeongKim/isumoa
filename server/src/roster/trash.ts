import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { RosterTrashResult } from '../../../shared/types.ts';
import type { DB } from '../db/schema.ts';
import { nowIso } from '../db/sqlite.ts';
import { HttpError } from '../lib/errors.ts';

export const RosterSelection = z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000).transform(ids => [...new Set(ids)]) });

/** 일부만 삭제되지 않도록 선택 전체를 같은 트랜잭션에서 처리한다. */
export async function trashRoster(db: Kysely<DB>, kind: 'departments' | 'employees' | 'trainings', ids: number[], restore = false): Promise<RosterTrashResult> {
  return db.transaction().execute(async trx => {
    const rows = await trx.selectFrom(kind).select(['id', 'deleted_at']).where('id', 'in', ids).execute();
    if (rows.length !== ids.length || rows.some(r => restore ? !r.deleted_at : !!r.deleted_at)) {
      throw new HttpError(409, '선택한 항목이 바뀌었습니다. 목록을 새로 고친 뒤 다시 선택해 주세요.');
    }
    const stamp = nowIso();
    let employees = 0;
    if (kind === 'departments') {
      if (restore) {
        // 부서와 함께 삭제했던 직원만 복원한다. 먼저 별도로 삭제한 직원은 휴지통에 둔다.
        for (const row of rows) {
          const result = await trx.updateTable('employees').set({ deleted_at: null, deleted_department_id: null, updated_at: stamp })
            .where('deleted_department_id', '=', row.id).where('deleted_at', 'is not', null).executeTakeFirst();
          employees += Number(result.numUpdatedRows);
        }
      } else {
        const result = await trx.updateTable('employees').set(eb => ({ deleted_at: stamp, deleted_department_id: eb.ref('department_id'), updated_at: stamp }))
          .where('department_id', 'in', ids).where('deleted_at', 'is', null).executeTakeFirst();
        employees = Number(result.numUpdatedRows);
      }
    } else if (kind === 'employees' && restore) {
      const blocked = await trx.selectFrom('employees as e').innerJoin('departments as d', 'd.id', 'e.department_id')
        .select('e.id').where('e.id', 'in', ids).where('d.deleted_at', 'is not', null).executeTakeFirst();
      if (blocked) throw new HttpError(409, '삭제된 부서에 속한 직원이 있습니다. 설정의 부서 휴지통에서 부서를 먼저 복원해 주세요.');
    }
    await trx.updateTable(kind).set({ deleted_at: restore ? null : stamp }).where('id', 'in', ids).execute();
    if (kind === 'employees') await trx.updateTable('employees').set({ deleted_department_id: null, updated_at: stamp }).where('id', 'in', ids).execute();
    if (kind === 'trainings') await trx.updateTable('trainings').set({ updated_at: stamp }).where('id', 'in', ids).execute();
    return { changed: ids.length, ...(kind === 'departments' ? { employees } : {}) };
  });
}
