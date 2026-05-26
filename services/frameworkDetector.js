const fs = require('fs');
const path = require('path');

const FRAMEWORK_PATTERNS = [
  {
    name: 'nextjs',
    detect: (files) =>
      files.has('next.config.js') || files.has('next.config.mjs') || files.has('next.config.ts'),
    entry: ['out/index.html', '.next/server/pages/index.html'],
  },
  {
    name: 'gatsby',
    detect: (files) => files.has('gatsby-config.js') || files.has('gatsby-config.ts'),
    entry: ['public/index.html'],
  },
  {
    name: 'react',
    detect: (files) =>
      (files.has('package.json') && files.has('vite.config.js')) ||
      (files.has('package.json') && files.has('vite.config.ts')) ||
      (files.has('package.json') && /react/.test(files.get('package.json') || '')) ||
      files.has('src/App.jsx') ||
      files.has('src/App.tsx') ||
      files.has('src/App.js'),
    entry: ['dist/index.html', 'build/index.html'],
  },
  {
    name: 'vue',
    detect: (files) =>
      files.has('vue.config.js') ||
      (files.has('package.json') && /vue/.test(files.get('package.json') || '')) ||
      files.has('src/App.vue'),
    entry: ['dist/index.html'],
  },
  {
    name: 'angular',
    detect: (files) =>
      files.has('angular.json') ||
      (files.has('package.json') && /@angular/.test(files.get('package.json') || '')),
    entry: ['dist/index.html'],
  },
  {
    name: 'svelte',
    detect: (files) =>
      files.has('svelte.config.js') ||
      (files.has('package.json') && /svelte/.test(files.get('package.json') || '')),
    entry: ['public/index.html', 'dist/index.html'],
  },
  {
    name: 'static',
    detect: (files) =>
      files.has('index.html') ||
      files.has('public/index.html'),
    entry: ['index.html', 'public/index.html'],
  },
];

const DEPENDENCY_MANAGERS = [
  { name: 'npm', file: 'package-lock.json', lock: 'package-lock.json' },
  { name: 'yarn', file: 'yarn.lock', lock: 'yarn.lock' },
  { name: 'pnpm', file: 'pnpm-lock.yaml', lock: 'pnpm-lock.yaml' },
];

function scanDirectory(dirPath, prefix = '') {
  const entries = {};
  if (!fs.existsSync(dirPath)) return entries;
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      const relativePath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.name.startsWith('.') || item.name === 'node_modules') continue;
      if (item.isDirectory()) {
        Object.assign(entries, scanDirectory(path.join(dirPath, item.name), relativePath));
      } else {
        entries[relativePath] = item.name;
      }
    }
  } catch (e) {
    // skip unreadable
  }
  return entries;
}

function detectFramework(projectDir) {
  const files = scanDirectory(projectDir);
  const fileMap = new Map();
  for (const [relPath, name] of Object.entries(files)) {
    fileMap.set(relPath, name);
  }

  // Read package.json if it exists
  const pkgPath = Object.keys(files).find(
    (p) => p === 'package.json'
  );
  if (pkgPath) {
    try {
      const pkgContent = fs.readFileSync(path.join(projectDir, pkgPath), 'utf-8');
      fileMap.set('package.json', pkgContent);
    } catch (_) {}
  }

  // Read index.html if it exists
  const htmlPath = Object.keys(files).find(
    (p) => p.endsWith('index.html') && !p.includes('node_modules')
  );
  if (htmlPath) {
    try {
      const htmlContent = fs.readFileSync(path.join(projectDir, htmlPath), 'utf-8');
      fileMap.set(htmlPath, htmlContent);
    } catch (_) {}
  }

  // Try each framework
  for (const framework of FRAMEWORK_PATTERNS) {
    if (framework.detect(fileMap)) {
      let entryPoint = '';
      for (const candidate of framework.entry) {
        if (files[candidate]) {
          entryPoint = candidate;
          break;
        }
      }
      if (!entryPoint) {
        entryPoint = htmlPath || 'index.html';
      }
      return { framework: framework.name, entryPoint, files };
    }
  }

  // Fallback: look for any HTML file
  const anyHtml = Object.keys(files).find(
    (p) => p.endsWith('.html') && !p.includes('node_modules')
  );
  if (anyHtml) {
    return { framework: 'static', entryPoint: anyHtml, files };
  }

  return { framework: 'unknown', entryPoint: 'index.html', files };
}

function getPackageManager(projectDir) {
  for (const pm of DEPENDENCY_MANAGERS) {
    if (fs.existsSync(path.join(projectDir, pm.file))) {
      return pm;
    }
  }
  return DEPENDENCY_MANAGERS[0];
}

function getStartCommand(framework, pkg = null) {
  if (pkg && pkg.scripts) {
    if (pkg.scripts.dev) return { command: pkg.scripts.dev, type: 'dev' };
    if (pkg.scripts.start) return { command: pkg.scripts.start, type: 'start' };
    if (pkg.scripts.serve) return { command: pkg.scripts.serve, type: 'serve' };
  }
  const defaults = {
    nextjs: { command: 'next dev -p 3000', type: 'dev' },
    gatsby: { command: 'gatsby develop -p 3000', type: 'dev' },
    react: { command: 'vite --port 3000', type: 'dev' },
    vue: { command: 'vite --port 3000', type: 'dev' },
    angular: { command: 'ng serve --port 3000', type: 'dev' },
    svelte: { command: 'vite --port 3000', type: 'dev' },
    static: { command: '', type: 'static' },
  };
  return defaults[framework] || { command: '', type: 'static' };
}

function extractEntryContent(projectDir, entryPoint) {
  if (!entryPoint) return null;
  const fullPath = path.join(projectDir, entryPoint);
  if (fs.existsSync(fullPath)) {
    return fs.readFileSync(fullPath, 'utf-8');
  }
  return null;
}

module.exports = {
  detectFramework,
  getPackageManager,
  getStartCommand,
  extractEntryContent,
  scanDirectory,
};
