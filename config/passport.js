const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const User = require('../models/User');

const CLIENT_BASE_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const API_BASE_URL = process.env.API_URL || 'http://localhost:5000';

// Serialize user ID into session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

// ─── Google OAuth Strategy ──────────────────────────────────────────────
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${API_BASE_URL}/api/auth/google/callback`,
        scope: ['profile', 'email'],
        passReqToCallback: true,
      },
      async (req, accessToken, refreshToken, profile, done) => {
        try {
          const email =
            profile.emails && profile.emails.length > 0
              ? profile.emails[0].value
              : `${profile.id}@google-oauth.local`;
          const name = profile.displayName || profile.username || 'Google User';
          const avatar =
            profile.photos && profile.photos.length > 0
              ? profile.photos[0].value
              : '';
          const oauthRole = req.cookies?.oauth_role || 'buyer';

          let user = await User.findOne({ googleId: profile.id });

          if (user) {
            user.avatar = avatar || user.avatar;
            if (user.authProvider !== 'google') {
              user.googleId = profile.id;
              user.authProvider = 'google';
            }
            await user.save();
            return done(null, user);
          }

          // Check if email already registered
          const existingByEmail = await User.findOne({ email });
          if (existingByEmail) {
            existingByEmail.googleId = profile.id;
            existingByEmail.authProvider = 'google';
            existingByEmail.avatar = avatar || existingByEmail.avatar;
            await existingByEmail.save();
            return done(null, existingByEmail);
          }

          // Create new user with role from cookie
          user = await User.create({
            name,
            email,
            googleId: profile.id,
            authProvider: 'google',
            avatar,
            role: oauthRole,
          });

          return done(null, user);
        } catch (err) {
          console.error('[Google OAuth] Error in strategy callback:', err.message);
          return done(err, null);
        }
      }
    )
  );
  console.log('✓ Google OAuth strategy configured');
} else {
  console.warn('⚠ Google OAuth not configured (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET missing)');
}

// ─── GitHub OAuth Strategy ──────────────────────────────────────────────
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: `${API_BASE_URL}/api/auth/github/callback`,
        scope: ['user:email'],
        passReqToCallback: true,
      },
      async (req, accessToken, refreshToken, profile, done) => {
        try {
          const email =
            profile.emails && profile.emails.length > 0
              ? profile.emails[0].value
              : `${profile.id}@github-oauth.local`;
          const name = profile.displayName || profile.username || 'GitHub User';
          const avatar =
            profile.photos && profile.photos.length > 0
              ? profile.photos[0].value
              : '';
          const oauthRole = req.cookies?.oauth_role || 'buyer';

          let user = await User.findOne({ githubId: profile.id });

          if (user) {
            user.avatar = avatar || user.avatar;
            if (user.authProvider !== 'github') {
              user.githubId = profile.id;
              user.authProvider = 'github';
            }
            await user.save();
            return done(null, user);
          }

          const existingByEmail = await User.findOne({ email });
          if (existingByEmail) {
            existingByEmail.githubId = profile.id;
            existingByEmail.authProvider = 'github';
            existingByEmail.avatar = avatar || existingByEmail.avatar;
            await existingByEmail.save();
            return done(null, existingByEmail);
          }

          user = await User.create({
            name,
            email,
            githubId: profile.id,
            authProvider: 'github',
            avatar,
            role: oauthRole,
          });

          return done(null, user);
        } catch (err) {
          console.error('[GitHub OAuth] Error in strategy callback:', err.message);
          return done(err, null);
        }
      }
    )
  );
  console.log('✓ GitHub OAuth strategy configured');
} else {
  console.warn('⚠ GitHub OAuth not configured (GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET missing)');
}

module.exports = passport;
