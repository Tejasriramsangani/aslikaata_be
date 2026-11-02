/* eslint-disable */
/**
 * Creates (or rotates) the staff logins for the admin panel directly in MongoDB.
 *
 *   npm run seed:admins
 *
 * - Each account gets a freshly generated random password, printed ONCE at the end.
 * - Re-running it is safe: existing accounts keep their email/role, get a NEW password,
 *   their lock is cleared and all of their old sessions are revoked.
 * - Nothing is written to disk and no password is stored in plain text (bcrypt hash only).
 *
 * Optional: pass your own password for one run with  ADMIN_SEED_PASSWORD=...  (min 8 chars,
 * applied to every account) - otherwise random ones are generated.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { MongoClient, ObjectId } = require('mongodb');

const ACCOUNTS = [
  {
    role: 'SUPER_ADMIN',
    name: 'Ramesh Varma',
    email: 'admin@aslikaata.com',
    mobile: '9848022334',
    assignedDivision: 'All Andhra Divisions',
  },
  {
    role: 'YARD_MANAGER',
    name: 'K. Venkat Rao',
    email: 'yard.manager@aslikaata.com',
    mobile: '9848022335',
    assignedDivision: 'Vijayawada Central Yard',
  },
  {
    role: 'DISPATCHER',
    name: 'Suresh Reddy',
    email: 'dispatcher@aslikaata.com',
    mobile: '9848022336',
    assignedDivision: 'Guntur Autonagar Fleet Hub',
  },
  {
    role: 'ACCOUNTANT',
    name: 'P. Anitha',
    email: 'accounts@aslikaata.com',
    mobile: '9848022337',
    assignedDivision: 'All Andhra Divisions',
  },
];

// Letters/digits without look-alikes (no 0/O, 1/l/I) + a few symbols; always has every class.
function generatePassword(length = 16) {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '@#$%*!?'];
  const all = sets.join('');
  const chars = sets.map((s) => s[crypto.randomInt(s.length)]);
  while (chars.length < length) chars.push(all[crypto.randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set (aslikaata_be/.env)');
  const fixed = process.env.ADMIN_SEED_PASSWORD;
  if (fixed && fixed.length < 8) throw new Error('ADMIN_SEED_PASSWORD must be at least 8 characters');

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const users = db.collection('users');
  const creds = db.collection('admincredentials');
  const sessions = db.collection('sessions');
  const now = new Date();
  const out = [];

  try {
    for (const acc of ACCOUNTS) {
      const email = acc.email.toLowerCase();
      const existing = await creds.findOne({ email });

      // 1) The underlying user (role ADMIN is what the API guards check).
      let user = existing ? await users.findOne({ _id: new ObjectId(String(existing.userId)) }) : null;
      if (!user) user = await users.findOne({ mobile: { $in: [acc.mobile, `+91${acc.mobile}`] } });
      if (!user) {
        const res = await users.insertOne({
          mobile: acc.mobile,
          roles: ['ADMIN'],
          status: 'ACTIVE',
          termsVersion: '1.0',
          termsAcceptedAt: now,
          lastLoginAt: null,
          deletedAt: null,
          anonymizedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        user = { _id: res.insertedId };
      } else {
        await users.updateOne(
          { _id: user._id },
          { $addToSet: { roles: 'ADMIN' }, $set: { status: 'ACTIVE', updatedAt: now } },
        );
      }

      // 2) Fresh password -> bcrypt hash (same cost as the API: 10).
      const password = fixed || generatePassword();
      const passwordHash = await bcrypt.hash(password, 10);

      await creds.updateOne(
        { email },
        {
          $set: {
            userId: user._id,
            passwordHash,
            name: acc.name,
            role: acc.role,
            assignedDivision: acc.assignedDivision,
            failedLoginAttempts: 0,
            lockedUntil: null,
            updatedAt: now,
          },
          $setOnInsert: { email, isTotpEnabled: false, totpSecretEnc: null, createdAt: now },
        },
        { upsert: true },
      );

      // 3) Any session issued with an old password is no longer valid.
      const revoked = await sessions.updateMany(
        { userId: { $in: [String(user._id), user._id] }, revokedAt: null },
        { $set: { revokedAt: now } },
      );

      out.push({ role: acc.role, email, password, status: existing ? 'password reset' : 'created', revoked: revoked.modifiedCount });
    }
  } finally {
    await client.close();
  }

  console.log('\nAdmin panel logins (shown once - store them in a password manager):\n');
  for (const r of out) {
    console.log(`  ${r.role.padEnd(13)} ${r.email.padEnd(30)} ${r.password}   [${r.status}]`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
