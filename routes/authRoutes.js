const express = require('express');
const router = express.Router();
const passport = require('../config/passport');
const {
  registerUser,
  loginUser,
  upgradeToSeller,
  googleOAuthCallback,
  githubOAuthCallback,
  getOAuthStatus,
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// Email/password auth
router.post('/register', registerUser);
router.post('/login', loginUser);
router.put('/upgrade-to-seller', protect, upgradeToSeller);

// OAuth status check
router.get('/oauth-status', getOAuthStatus);

// Middleware: capture role from query and store in cookie for OAuth callback
const captureOAuthRole = (req, res, next) => {
  const role = req.query.role || 'buyer';
  res.cookie('oauth_role', role, {
    maxAge: 5 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
  });
  next();
};

// Wrapper to catch passport errors and redirect instead of leaking raw JSON
const oauthCallbackHandler = (provider, strategy, callback) => {
  return (req, res, next) => {
    passport.authenticate(strategy, { session: false, failureRedirect: `${CLIENT_URL}/login?error=oauth_failed` })(
      req,
      res,
      (err) => {
        if (err) {
          console.error(`[${provider} OAuth] Authentication error:`, err);
          const reason = encodeURIComponent(err.message || 'Unknown error');
          return res.redirect(`${CLIENT_URL}/login?error=oauth_failed&reason=${reason}`);
        }
        callback(req, res, next);
      }
    );
  };
};

// Google OAuth
router.get(
  '/google',
  captureOAuthRole,
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);
router.get(
  '/google/callback',
  oauthCallbackHandler('Google', 'google', googleOAuthCallback)
);

// GitHub OAuth
router.get(
  '/github',
  captureOAuthRole,
  passport.authenticate('github', { scope: ['user:email'], session: false })
);
router.get(
  '/github/callback',
  oauthCallbackHandler('GitHub', 'github', githubOAuthCallback)
);

module.exports = router;
