const mongoose = require('mongoose');

let isConnected = false;

const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    console.warn('MongoDB connection skipped: MONGO_URI is not set.');
    return;
  }

  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    isConnected = true;
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`MongoDB Connection Error: ${error.message}`);
    console.warn('WARNING: Server will start without a database. Retrying connection...');
    setTimeout(connectDB, 5000);
  }
};

mongoose.connection.on('disconnected', () => {
  isConnected = false;
  console.warn('MongoDB disconnected. Attempting to reconnect...');
});

mongoose.connection.on('reconnected', () => {
  isConnected = true;
  console.log('MongoDB reconnected');
});

const getConnectionStatus = () => isConnected;

module.exports = connectDB;
module.exports.getConnectionStatus = getConnectionStatus;
