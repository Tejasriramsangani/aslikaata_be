const { MongoClient } = require('mongodb');

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/aslikaata';
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const wr = db.collection('weightranges');
  const slots = db.collection('timeslots');
  const settings = db.collection('appsettings');

  const now = new Date();
  const ranges = [
    { name: 'XS', displayLabel: '0 – 10 kg', minGrams: 0, maxGrams: 10000, displayOrder: 1, isActive: true, createdAt: now, updatedAt: now },
    { name: 'SMALL', displayLabel: '10 – 20 kg', minGrams: 10000, maxGrams: 20000, displayOrder: 2, isActive: true, createdAt: now, updatedAt: now },
    { name: 'MEDIUM', displayLabel: '20 – 30 kg', minGrams: 20000, maxGrams: 30000, displayOrder: 3, isActive: true, createdAt: now, updatedAt: now },
    { name: 'LARGE', displayLabel: '30 – 50 kg', minGrams: 30000, maxGrams: 50000, displayOrder: 4, isActive: true, createdAt: now, updatedAt: now },
    { name: 'BULK', displayLabel: '50+ kg', minGrams: 50000, maxGrams: 10000000, displayOrder: 5, isActive: true, createdAt: now, updatedAt: now },
  ];

  const before = await wr.countDocuments();
  if (before === 0) {
    await wr.insertMany(ranges);
    console.log('Inserted', ranges.length, 'weight ranges');
  } else {
    await wr.updateMany(
      { $or: [{ isActive: { $exists: false } }, { isActive: null }] },
      { $set: { isActive: true } },
    );
    console.log('Weight ranges already present:', before, '(repaired isActive if needed)');
  }

  if ((await slots.countDocuments()) === 0) {
    await slots.insertMany([
      { startTime: '09:00', endTime: '11:00', displayLabel: '9:00 AM – 11:00 AM', maxPickups: 15, displayOrder: 1, isActive: true, createdAt: now, updatedAt: now },
      { startTime: '11:00', endTime: '13:00', displayLabel: '11:00 AM – 1:00 PM', maxPickups: 15, displayOrder: 2, isActive: true, createdAt: now, updatedAt: now },
      { startTime: '13:00', endTime: '15:00', displayLabel: '1:00 PM – 3:00 PM', maxPickups: 15, displayOrder: 3, isActive: true, createdAt: now, updatedAt: now },
      { startTime: '15:00', endTime: '17:00', displayLabel: '3:00 PM – 5:00 PM', maxPickups: 15, displayOrder: 4, isActive: true, createdAt: now, updatedAt: now },
      { startTime: '17:00', endTime: '19:00', displayLabel: '5:00 PM – 7:00 PM', maxPickups: 15, displayOrder: 5, isActive: true, createdAt: now, updatedAt: now },
      { startTime: '19:00', endTime: '20:00', displayLabel: '7:00 PM – 8:00 PM', maxPickups: 15, displayOrder: 6, isActive: true, createdAt: now, updatedAt: now },
    ]);
    console.log('Inserted default time slots');
  } else {
    console.log('Time slots already present:', await slots.countDocuments());
  }

  await settings.updateOne(
    { key: 'bulkLimitKg' },
    {
      $set: { value: 50, description: 'Bulk threshold in KG', updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
  console.log('bulkLimitKg = 50');
  console.log('Active weight ranges:', await wr.countDocuments({ isActive: true }));
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
