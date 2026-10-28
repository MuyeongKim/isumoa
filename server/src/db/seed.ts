import type { Kysely } from 'kysely';
import type { DB } from './schema.ts';
import { DEPLOYMENT_TRAININGS, COMMON_COURSE_MAPPINGS } from '../../../shared/deploymentCatalog.ts';
import type { CatalogEntry } from './trainingCatalog.ts';

/** 교육 과정이 하나도 없을 때(처음 실행) 공공기관 기본 목록을 넣는다 */
export async function seedDefaults(db: Kysely<DB>, catalog: readonly (Omit<CatalogEntry, 'keywords'> & { readonly keywords: readonly string[] })[] = DEPLOYMENT_TRAININGS): Promise<void> {
  const { count } = await db
    .selectFrom('trainings')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow();
  if (count > 0) return;

  await db
    .insertInto('trainings')
    .values(
      catalog.map((t, index) => ({
        code: t.code,
        name: t.name,
        category: t.category,
        legal_basis: t.legalBasis,
        req_type: t.reqType,
        req_value: t.reqValue,
        keywords: JSON.stringify(t.keywords),
        active: t.active ? 1 : 0,
        sort_order: (index + 1) * 10,
      })),
    )
    .execute();
  const created = await db.selectFrom('trainings').select(['id', 'code']).execute();
  for (const mapping of COMMON_COURSE_MAPPINGS) {
    const training = created.find(t => t.code === mapping.trainingCode);
    if (training) await db.insertInto('course_mappings').values({ title_key: mapping.title, training_id: training.id }).onConflict(oc => oc.columns(['title_key', 'training_id']).doNothing()).execute();
  }
}

export async function getSetting<T>(db: Kysely<DB>, key: string, fallback: T): Promise<T> {
  const row = await db.selectFrom('settings').select('value').where('key', '=', key).executeTakeFirst();
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export async function setSetting(db: Kysely<DB>, key: string, value: unknown): Promise<void> {
  await db
    .insertInto('settings')
    .values({ key, value: JSON.stringify(value) })
    .onConflict((oc) => oc.column('key').doUpdateSet({ value: JSON.stringify(value) }))
    .execute();
}
