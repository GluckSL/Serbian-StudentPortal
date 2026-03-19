// migrate-program-to-services.js
// Copies programEnrolled → servicesOpted where servicesOpted is empty, then clears programEnrolled
// Usage: node migrate-program-to-services.js [--dry-run]

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/Updated-Gluck-Portal';
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB');
  if (DRY_RUN) console.log('🔍 DRY RUN MODE\n');

  // Find students where servicesOpted is empty but programEnrolled has a value
  const needsMigration = await User.find({
    role: 'STUDENT',
    programEnrolled: { $exists: true, $ne: '' },
    $or: [
      { servicesOpted: { $exists: false } },
      { servicesOpted: '' },
      { servicesOpted: null }
    ]
  });

  console.log(`Found ${needsMigration.length} students to migrate programEnrolled → servicesOpted`);

  for (const student of needsMigration) {
    if (DRY_RUN) {
      console.log(`  [DRY] ${student.name}: "${student.programEnrolled}" → servicesOpted`);
    } else {
      await User.updateOne({ _id: student._id }, {
        $set: { servicesOpted: student.programEnrolled }
      });
      console.log(`  ✅ ${student.name}: "${student.programEnrolled}" → servicesOpted`);
    }
  }

  // Now clear programEnrolled for ALL students (field is being removed)
  if (!DRY_RUN) {
    const result = await User.updateMany(
      { role: 'STUDENT' },
      { $unset: { programEnrolled: '' } }
    );
    console.log(`\n🧹 Cleared programEnrolled from ${result.modifiedCount} students`);
  } else {
    const total = await User.countDocuments({ role: 'STUDENT', programEnrolled: { $ne: '' } });
    console.log(`\n[DRY] Would clear programEnrolled from ${total} students`);
  }

  await mongoose.disconnect();
  console.log('🔌 Done');
  process.exit(0);
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
