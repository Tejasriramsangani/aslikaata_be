/* eslint-disable */
/**
 * Finds user accounts that are really the same phone number stored two ways ("9848011111" and
 * "+919848011111") and merges each pair into one account.
 *
 *   npm run merge:users            -> DRY RUN: only prints what it would do
 *   npm run merge:users -- --apply -> does it
 *
 * Why: a second account for the same number has no employee profile / pickups, so logging in on it
 * shows an empty app. The account that owns the real data (employee profile first, then customer
 * profile, then most pickups, then oldest) is kept; the other one's addresses, notifications, device
 * tokens and pickups are moved over, its sessions are deleted, and the kept account's number is stored
 * in the plain 10-digit form. A duplicate that itself has an employee profile is NOT touched
 * (needs a person to decide) and is reported instead.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient, ObjectId } = require('mongodb');

const APPLY = process.argv.includes('--apply');
const last10 = (m) => String(m || '').replace(/\D/g, '').slice(-10);
const both = (id) => [new ObjectId(String(id)), String(id)]; // references may be stored either way

(async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set in .env');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db();
  console.log(APPLY ? 'APPLY MODE: changes will be written.\n' : 'DRY RUN: nothing will be changed. Re-run with --apply to merge.\n');

  const users = await db.collection('users').find({}).toArray();
  const groups = new Map();
  for (const u of users) {
    const key = last10(u.mobile);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(u);
  }
  const duplicates = [...groups.entries()].filter(([, list]) => list.length > 1);
  if (duplicates.length === 0) console.log('No duplicate phone numbers found.');

  for (const [number, list] of duplicates) {
    const scored = [];
    for (const u of list) {
      const [emp, cust, pickups] = await Promise.all([
        db.collection('employeeprofiles').countDocuments({ userId: { $in: both(u._id) } }),
        db.collection('customerprofiles').countDocuments({ userId: { $in: both(u._id) } }),
        db.collection('pickups').countDocuments({ customerId: { $in: both(u._id) } }),
      ]);
      scored.push({ u, emp, cust, pickups, score: (emp ? 1e6 : 0) + (cust ? 1e4 : 0) + pickups });
    }
    scored.sort((a, b) => b.score - a.score || a.u._id.getTimestamp() - b.u._id.getTimestamp());
    const [keep, ...extras] = scored;
    console.log(`Number ${number}: keep ${keep.u._id} "${keep.u.mobile}" (employeeProfile=${keep.emp}, customerProfile=${keep.cust}, pickups=${keep.pickups})`);

    for (const dup of extras) {
      const id = dup.u._id;
      if (dup.emp) {
        console.log(`  SKIP ${id} "${dup.u.mobile}": it has its own employee profile, resolve this one by hand.`);
        continue;
      }
      const move = [
        ['addresses', 'userId'],
        ['pickups', 'customerId'],
        ['notifications', 'userId'],
        ['devicetokens', 'userId'],
      ];
      const counts = {};
      for (const [col, field] of move) counts[col] = await db.collection(col).countDocuments({ [field]: { $in: both(id) } });
      const sessions = await db.collection('sessions').countDocuments({ userId: { $in: both(id) } });
      console.log(
        `  merge ${id} "${dup.u.mobile}" -> move ${JSON.stringify(counts)}, delete ${sessions} session(s)` +
          (dup.cust ? (keep.cust ? ', drop its duplicate customer profile' : ', move its customer profile') : ''),
      );
      if (!APPLY) continue;

      for (const [col, field] of move) {
        await db.collection(col).updateMany({ [field]: { $in: both(id) } }, { $set: { [field]: keep.u._id } });
      }
      if (dup.cust) {
        if (keep.cust) await db.collection('customerprofiles').deleteMany({ userId: { $in: both(id) } });
        else await db.collection('customerprofiles').updateMany({ userId: { $in: both(id) } }, { $set: { userId: keep.u._id } });
      }
      await db.collection('sessions').deleteMany({ userId: { $in: both(id) } });
      for (const role of dup.u.roles || []) {
        if (!(keep.u.roles || []).includes(role)) {
          await db.collection('users').updateOne({ _id: keep.u._id }, { $addToSet: { roles: role } });
        }
      }
      await db.collection('users').deleteOne({ _id: id });
    }

    if (APPLY && keep.u.mobile !== number) {
      await db.collection('users').updateOne({ _id: keep.u._id }, { $set: { mobile: number } });
      console.log(`  stored the kept account's number as "${number}"`);
    }
  }

  await client.close();
  console.log(APPLY ? '\nDone.' : '\nDry run finished. Nothing was changed.');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
