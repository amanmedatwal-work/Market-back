const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const connectDB = require('./config/db');

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['JWT_SECRET', 'MONGO_URI'];
const missing = requiredEnvVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Please set them in server/.env locally or in your deployment environment variables.');
}

// Warn about placeholder OAuth secrets
if (process.env.GOOGLE_CLIENT_SECRET === 'PASTE_YOUR_SECRET_HERE') {
  console.warn('⚠ Google OAuth: GOOGLE_CLIENT_SECRET is still a placeholder. Google login will fail.');
  console.warn('  Get a real secret from https://console.cloud.google.com/apis/credentials');
  console.warn('  Then add it to server/.env');
}
if (process.env.GITHUB_CLIENT_SECRET === 'PASTE_YOUR_SECRET_HERE') {
  console.warn('⚠ GitHub OAuth: GITHUB_CLIENT_SECRET is still a placeholder. GitHub login will fail.');
}

// Connect to database
connectDB();

// Initialize Passport (OAuth strategies)
const passport = require('./config/passport');

const app = express();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors({
  origin: function (origin, callback) {
    const configuredOrigins = [
      process.env.CLIENT_URL,
      process.env.FRONTEND_URL,
      ...(process.env.ALLOWED_ORIGINS || '').split(','),
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'https://marketplace-nine-blue.vercel.app',
    ].filter(Boolean).map((url) => url.trim().replace(/\/$/, ''));
    const normalizedOrigin = origin?.replace(/\/$/, '');
    const isAllowedVercelOrigin = normalizedOrigin && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(normalizedOrigin);

    if (!origin || configuredOrigins.includes(normalizedOrigin) || isAllowedVercelOrigin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(passport.initialize());
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'frame-src': ['*'],
      'child-src': ['*'],
      'form-action': ['*'],
      'frame-ancestors': ["'self'", 'http://localhost:5173', 'http://127.0.0.1:5173', 'https://*.vercel.app'],
    },
  },
  crossOriginOpenerPolicy: { policy: 'unsafe-none' },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  xFrameOptions: false,
}));

// Serve extracted project previews as static files
const path = require('path');
const fs = require('fs');
const previewsDir = process.env.VERCEL
  ? path.join('/tmp', 'marketplace-previews')
  : path.join(__dirname, 'previews');
try {
  if (!fs.existsSync(previewsDir)) {
    fs.mkdirSync(previewsDir, { recursive: true });
  }
} catch (err) {
  console.warn(`Preview directory unavailable: ${err.message}`);
}
app.use('/previews', express.static(previewsDir, {
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('X-Content-Type-Options', 'nosniff');
  },
}));

// Proxy endpoint for external screenshots/thumbnails (avoid CORS/mixed content)
app.get('/api/thumbnail-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ message: 'Missing url parameter' });
  try {
    const response = await fetch(url);
    if (!response.ok) return res.status(response.status).json({ message: 'Failed to fetch thumbnail' });
    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = Buffer.from(await response.arrayBuffer());
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    res.status(502).json({ message: 'Failed to proxy thumbnail' });
  }
});

app.use(morgan('dev'));

app.use('/runtime-proxy/:projectId', (req, res, next) => {
  const { createProxyMiddleware } = require('http-proxy-middleware');
  const { getSandbox } = require('./services/sandboxService');
  const sandbox = getSandbox(req.params.projectId);
  if (!sandbox || sandbox.status !== 'running' || !sandbox.port) {
    return res.status(404).json({ message: 'Runtime sandbox not running' });
  }
  sandbox.touch();
  // Rewrite URL: remove /runtime-proxy/:projectId prefix
  req.url = req.url.replace(
    new RegExp(`^/runtime-proxy/${req.params.projectId}`),
    ''
  ) || '/';
  createProxyMiddleware({
    target: `http://localhost:${sandbox.port}`,
    changeOrigin: true,
    ws: true,
    on: {
      proxyReq: (proxyReq) => {
        proxyReq.setHeader('X-Forwarded-Host', req.headers.host || 'localhost:5000');
      },
    },
  })(req, res, next);
});

// Routes
const authRoutes = require('./routes/authRoutes');
const projectRoutes = require('./routes/projectRoutes');
const orderRoutes = require('./routes/orderRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/orders', orderRoutes);

// Vercel catch-all functions can pass /api/auth/google as /auth/google.
app.use('/auth', authRoutes);
app.use('/projects', projectRoutes);
app.use('/orders', orderRoutes);

// Basic route
app.get('/', (req, res) => {
  res.send('Marketplace API is running...');
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'Marketplace API' });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'Marketplace API' });
});

// Global error handler
app.use((err, req, res, next) => {
  const message = err.message || 'Server error';
  if (err.name === 'MongooseError' || err.name === 'MongooseServerSelectionError') {
    return res.status(500).json({ message: 'Server error! Make sure MongoDB is running.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'File too large. Maximum upload size is 50MB.' });
  }
  console.error(err.stack);
  res.status(err.statusCode || 500).json({ message });
});

const PORT = process.env.PORT || 5000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  });
}

module.exports = app;
