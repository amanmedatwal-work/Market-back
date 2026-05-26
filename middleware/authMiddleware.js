const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      req.user = await User.findById(decoded.id).select('-password');

      if (!req.user) {
        res.status(401).json({ message: 'User not found. Please log in again.' });
        return;
      }

      next();
      return;
    } catch (error) {
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        res.status(401).json({ message: 'Session expired. Please log in again.' });
        return;
      }
      res.status(401).json({ message: 'Not authorized, token failed' });
      return;
    }
  }

  if (!token) {
    res.status(401).json({ message: 'Not authorized, no token' });
    return;
  }
};

const seller = (req, res, next) => {
  if (req.user && (req.user.role === 'seller' || req.user.role === 'admin')) {
    next();
  } else {
    res.status(401).json({ message: 'Not authorized as a seller' });
  }
};

const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(401).json({ message: 'Not authorized as an admin' });
  }
};

module.exports = { protect, seller, admin };
