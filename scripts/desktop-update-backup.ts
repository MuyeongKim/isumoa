// 서버가 종료된 뒤 업데이트 직전의 최종 DB·원본을 보관한다.
import { join } from 'node:path';
import { loadConfig } from '../server/src/config.ts';
import { openDatabase } from '../server/src/db/sqlite.ts';
import { runBackup } from '../server/src/ops/backup.ts';
import { loadRetention } from '../server/src/ops/retention.ts';
const config=loadConfig(),{db}=openDatabase(join(config.dataDir,'app.db'));
try{const result=await runBackup(db,config,(await loadRetention(db)).backupKeep);if(!result.ok)throw Error(result.error??'백업 실패');console.log(JSON.stringify({file:result.file,dir:config.backupDir}));}finally{await db.destroy();}
