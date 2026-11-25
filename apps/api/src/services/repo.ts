import type { Project, ProjectVersion, QualityAudit } from '@designforge/shared';
import { db, C } from '../lib/firebase.js';
import { Errors } from '../lib/errors.js';
import { newId } from '../lib/crypto.js';
import { putBlob, getBlob } from './blobs.js';

export type Access = 'owner' | 'editor' | 'viewer';

/** Central authorization for project access. Every route goes through this. */
export async function loadProject(projectId: string, uid: string, need: Access = 'owner'): Promise<Project & { access: Access }> {
  const snap = await db().collection(C.projects).doc(projectId).get();
  if (!snap.exists) throw Errors.notFound('Project');
  const p = { id: snap.id, ...(snap.data() as Omit<Project, 'id'>) };
  let access: Access | undefined;
  if (p.ownerId === uid) access = 'owner';
  else if (p.sharedWith?.[uid]) access = p.sharedWith[uid];
  // Return 404 (not 403) to avoid leaking existence of other users' projects.
  if (!access) throw Errors.notFound('Project');
  const rank = { viewer: 0, editor: 1, owner: 2 };
  if (rank[access] < rank[need]) throw Errors.forbidden(`Requires ${need} access`);
  return { ...p, access };
}

const INLINE_LIMIT = 800_000;

export async function createVersion(
  input: Omit<ProjectVersion, 'id' | 'createdAt' | 'html' | 'htmlStorageUrl'> & { html: string; audit?: QualityAudit; isVariant?: boolean },
  setHead = true,
) {
  const id = newId('v_');
  let html = input.html;
  let htmlStorageUrl: string | undefined;
  if (Buffer.byteLength(html, 'utf8') > INLINE_LIMIT) {
    const blob = await putBlob(input.ownerId, Buffer.from(html, 'utf8'), 'text/html', { projectId: input.projectId, kind: 'version_html' });
    htmlStorageUrl = blob.id;
    html = '';
  }
  const doc: ProjectVersion = { ...input, id, html, htmlStorageUrl, createdAt: Date.now() } as ProjectVersion;
  Object.keys(doc).forEach((k) => (doc as any)[k] === undefined && delete (doc as any)[k]);
  await db().collection(C.versions).doc(id).set(doc);

  if (!setHead) return doc;
  // Point the page + project to the new head version.
  const pRef = db().collection(C.projects).doc(input.projectId);
  await db().runTransaction(async (tx) => {
    const p = await tx.get(pRef);
    const pages = ((p.get('pages') as Project['pages']) ?? []).map((pg) =>
      pg.id === input.pageId ? { ...pg, currentVersionId: id, stitchScreenId: input.stitchScreenId ?? pg.stitchScreenId } : pg);
    tx.update(pRef, { pages, currentVersionId: id, updatedAt: Date.now(), ...(input.imageUrl ? { thumbnailUrl: input.imageUrl } : {}) });
  });
  return doc;
}

export async function getVersion(versionId: string, uid: string): Promise<ProjectVersion> {
  const snap = await db().collection(C.versions).doc(versionId).get();
  if (!snap.exists) throw Errors.notFound('Version');
  const v = snap.data() as ProjectVersion;
  await loadProject(v.projectId, uid, 'viewer');
  if (!v.html && v.htmlStorageUrl) {
    const blob = await getBlob(v.htmlStorageUrl, v.ownerId);
    if ('data' in blob) v.html = blob.data.toString('utf8');
  }
  return v;
}

export async function headVersion(project: Project, pageId?: string) {
  const page = pageId ? project.pages.find((p) => p.id === pageId) : project.pages[0];
  if (!page) throw Errors.notFound('Page');
  return { page, versionId: page.currentVersionId };
}
