/**
 * Grant/revoke admin. There is NO public admin registration — run this from a trusted machine
 * with the service account:  npm run make-admin -- user@example.com owner|admin|support|finance|revoke
 */
import { auth, db, C } from '../lib/firebase.js';

const [email, role] = process.argv.slice(2);
if (!email || !role) { console.error('Usage: npm run make-admin -- <email> <owner|admin|support|finance|revoke>'); process.exit(1); }
const user = await auth().getUserByEmail(email);
if (role === 'revoke') {
  await auth().setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), adminRole: null });
  await db().collection(C.adminUsers).doc(user.uid).set({ active: false, revokedAt: Date.now() }, { merge: true });
  await auth().revokeRefreshTokens(user.uid);
  console.log(`Revoked admin for ${email}`);
} else {
  if (!['owner', 'admin', 'support', 'finance'].includes(role)) throw new Error('Invalid role');
  await auth().setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), adminRole: role });
  await db().collection(C.adminUsers).doc(user.uid).set({ email, role, active: true, grantedAt: Date.now() });
  await db().collection(C.audit).add({ actorUid: 'cli', action: 'admin.grant', target: user.uid, details: { role }, at: Date.now() });
  console.log(`Granted ${role} to ${email}. They must sign out and back in. Enforce 2FA for this Google account (see docs/06-SECURITY.md).`);
}
process.exit(0);
