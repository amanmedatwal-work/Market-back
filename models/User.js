const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: false,
    },
    role: {
      type: String,
      enum: ['buyer', 'seller', 'admin'],
      default: 'buyer',
    },
    bio: {
      type: String,
      default: '',
    },
    isVerifiedSeller: {
      type: Boolean,
      default: false,
    },
    // OAuth fields
    googleId: {
      type: String,
      index: true,
      sparse: true,
    },
    githubId: {
      type: String,
      index: true,
      sparse: true,
    },
    avatar: {
      type: String,
      default: '',
    },
    authProvider: {
      type: String,
      enum: ['email', 'google', 'github'],
      default: 'email',
    },
  },
  {
    timestamps: true,
  }
);

userSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model('User', userSchema);

module.exports = User;
