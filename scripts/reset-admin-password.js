require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

async function resetPassword() {
  await mongoose.connect(process.env.MONGO_URI);
  
  const user = await User.findOne({ regNo: 'ADMIN001' });
  if (!user) {
    console.log('❌ User ADMIN001 not found');
    process.exit(1);
  }
  
  console.log(`Found: ${user.name} (${user.email}) - Role: ${user.role}`);
  
  const newPassword = 'Admin001@2026';
  const hashed = await bcrypt.hash(newPassword, 10);
  
  user.password = hashed;
  await user.save();
  
  console.log(`✅ Password updated to: ${newPassword}`);
  
  await mongoose.connection.close();
}

resetPassword().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
