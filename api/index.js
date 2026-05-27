const app = require('../server');

const normalizeApiPath = (req) => {
  if (req.url.startsWith('/api')) {
    req.url = req.url.replace(/^\/api/, '') || '/';
  }
};

module.exports = (req, res) => {
  normalizeApiPath(req);
  return app(req, res);
};
