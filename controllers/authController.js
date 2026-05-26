const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getConnectionStatus } = require('../config/db');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    const userExists = await User.findOne({ email });

    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const user = await User.create({
      name,
      email,
      password,
      role: role || 'buyer',
    });

    if (user) {
      res.status(201).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        authProvider: user.authProvider,
        token: generateToken(user._id),
      });
    } else {
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error) {
    if (!getConnectionStatus()) {
      return res.status(500).json({ message: 'Server error! Make sure MongoDB is running.' });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Auth user & get token
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (user && (await user.matchPassword(password))) {
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        authProvider: user.authProvider,
        token: generateToken(user._id),
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    if (!getConnectionStatus()) {
      return res.status(500).json({ message: 'Server error! Make sure MongoDB is running.' });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Upgrade current user to seller role
// @route   PUT /api/auth/upgrade-to-seller
// @access  Private
const upgradeToSeller = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role === 'seller' || user.role === 'admin') {
      return res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        authProvider: user.authProvider,
        token: generateToken(user._id),
        message: 'Already a seller',
      });
    }

    user.role = 'seller';
    const updatedUser = await user.save();

    res.json({
      _id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      avatar: updatedUser.avatar,
      authProvider: updatedUser.authProvider,
      token: generateToken(updatedUser._id),
      message: 'Upgraded to seller successfully',
    });
  } catch (error) {
    if (!getConnectionStatus()) {
      return res.status(500).json({ message: 'Server error! Make sure MongoDB is running.' });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Google OAuth callback
// @route   GET /api/auth/google/callback
// @access  Public (via Passport)
const googleOAuthCallback = (req, res) => {
  const user = req.user;
  if (!user) {
    console.error('[Google OAuth] Callback reached without user. Authentication failed.');
    return res.redirect(`${process.env.CLIENT_URL || 'http://localhost:5173'}/login?error=oauth_failed`);
  }
  console.log(`[Google OAuth] Successful login for: ${user.email}`);
  const intendedRole = req.cookies?.oauth_role || user.role;
  const token = generateToken(user._id);
  const userData = JSON.stringify({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    intent: intendedRole,
    avatar: user.avatar,
    authProvider: user.authProvider,
    token,
  });
  res.redirect(
    `${process.env.CLIENT_URL || 'http://localhost:5173'}/auth/callback?data=${encodeURIComponent(userData)}`
  );
};

// @desc    GitHub OAuth callback
// @route   GET /api/auth/github/callback
// @access  Public (via Passport)
const githubOAuthCallback = (req, res) => {
  const user = req.user;
  if (!user) {
    console.error('[GitHub OAuth] Callback reached without user. Authentication failed.');
    return res.redirect(`${process.env.CLIENT_URL || 'http://localhost:5173'}/login?error=oauth_failed`);
  }
  console.log(`[GitHub OAuth] Successful login for: ${user.email}`);
  const intendedRole = req.cookies?.oauth_role || user.role;
  const token = generateToken(user._id);
  const userData = JSON.stringify({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    intent: intendedRole,
    avatar: user.avatar,
    authProvider: user.authProvider,
    token,
  });
  res.redirect(
    `${process.env.CLIENT_URL || 'http://localhost:5173'}/auth/callback?data=${encodeURIComponent(userData)}`
  );
};

// @desc    Check OAuth configuration status
// @route   GET /api/auth/oauth-status
// @access  Public
const getOAuthStatus = (req, res) => {
  res.json({
    google: {
      configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      clientId: process.env.GOOGLE_CLIENT_ID || null,
    },
    github: {
      configured: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      clientId: process.env.GITHUB_CLIENT_ID || null,
    },
  });
};

module.exports = {
  registerUser,
  loginUser,
  upgradeToSeller,
  googleOAuthCallback,
  githubOAuthCallback,
  getOAuthStatus,
};
