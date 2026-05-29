const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

console.log('MONGO_URI from env:', process.env.MONGO_URI);

const testConnect = async () => {
  try {
    console.log('Connecting to MongoDB...');
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000
    });
    console.log(`Connection Success! Host: ${conn.connection.host}`);
    process.exit(0);
  } catch (err) {
    console.error('Connection Failed with Error:');
    console.error(err);
    process.exit(1);
  }
};

testConnect();
