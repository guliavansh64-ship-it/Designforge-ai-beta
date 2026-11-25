import { GoogleAuth } from 'google-auth-library'; import fs from 'fs';
const c = await new GoogleAuth({ keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS, scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
const B='https://firestore.googleapis.com/v1/projects/designforge-ai-official/databases/(default)/collectionGroups';
const spec = JSON.parse(fs.readFileSync('../../firestore.indexes.json','utf8'));
console.log('fieldOverrides', (spec.fieldOverrides||[]).length);
let ok=0, exist=0, err=0;
for (const ix of spec.indexes) {
  const fields = ix.fields.map(f => ({ fieldPath: f.fieldPath, ...(f.order && { order: f.order }), ...(f.arrayConfig && { arrayConfig: f.arrayConfig }) }));
  try { await c.request({ url: `${B}/${ix.collectionGroup}/indexes`, method: 'POST', data: { queryScope: ix.queryScope || 'COLLECTION', fields } }); ok++; }
  catch (e) { const s=e.response?.status; if (s===409) exist++; else { err++; console.log('ERR', ix.collectionGroup, s, e.response?.data?.error?.message); } }
}
console.log({ total: spec.indexes.length, created: ok, alreadyExisted: exist, errors: err });
