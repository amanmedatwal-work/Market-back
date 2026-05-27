const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { detectFramework, getPackageManager, extractEntryContent } = require('./frameworkDetector');

const PREVIEWS_DIR = process.env.VERCEL
  ? path.join('/tmp', 'marketplace-previews')
  : path.join(__dirname, '..', 'previews');

function getPreviewDir(projectId) {
  return path.join(PREVIEWS_DIR, projectId.toString());
}

function extractProject(projectId, fileData) {
  const previewDir = getPreviewDir(projectId);
  const extractedFlag = path.join(previewDir, '.extracted');

  if (fs.existsSync(extractedFlag)) {
    return { previewDir, alreadyExtracted: true };
  }

  if (fs.existsSync(previewDir)) {
    fs.rmSync(previewDir, { recursive: true, force: true });
  }
  fs.mkdirSync(previewDir, { recursive: true });

  const base64Data = fileData.includes(';base64,')
    ? fileData.split(';base64,').pop()
    : fileData;
  const zipBuffer = Buffer.from(base64Data, 'base64');
  const zip = new AdmZip(zipBuffer);
  zip.extractAllTo(previewDir, true);

  // Flatten single-root-folder zips
  const entries = fs.readdirSync(previewDir);
  if (
    entries.length === 1 &&
    entries[0] !== '.extracted' &&
    fs.statSync(path.join(previewDir, entries[0])).isDirectory()
  ) {
    const innerDir = path.join(previewDir, entries[0]);
    const innerFiles = fs.readdirSync(innerDir);
    for (const f of innerFiles) {
      fs.renameSync(path.join(innerDir, f), path.join(previewDir, f));
    }
    fs.rmSync(innerDir, { recursive: true });
  }

  fs.writeFileSync(extractedFlag, '');
  return { previewDir, alreadyExtracted: false };
}

function findEntryPoint(projectId) {
  const previewDir = getPreviewDir(projectId);
  if (!fs.existsSync(previewDir)) return null;

  const entryCandidates = [
    'index.html',
    'public/index.html',
    'dist/index.html',
    'build/index.html',
    'out/index.html',
  ];

  for (const candidate of entryCandidates) {
    if (fs.existsSync(path.join(previewDir, candidate))) {
      return candidate;
    }
  }

  // Fallback: any HTML file
  const files = getAllFiles(previewDir);
  const htmlFile = files.find((f) => f.endsWith('.html') && !f.includes('node_modules'));
  return htmlFile || null;
}

function getAllFiles(dir, base = '') {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const relPath = base ? `${base}/${item.name}` : item.name;
      if (item.name.startsWith('.')) continue;
      if (item.isDirectory()) {
        results.push(...getAllFiles(path.join(dir, item.name), relPath));
      } else {
        results.push(relPath);
      }
    }
  } catch (_) {}
  return results;
}

function analyzeProject(projectId, fileData) {
  const { previewDir } = extractProject(projectId, fileData);
  const analysis = detectFramework(previewDir);
  const pkgManager = getPackageManager(previewDir);

  const fileList = getAllFiles(previewDir);
  const totalFiles = fileList.length;
  const totalSize = getDirectorySize(previewDir);
  const assetFiles = fileList.filter(
    (f) => f.match(/\.(js|css|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot)$/)
  ).length;

  let entryContent = null;
  if (analysis.entryPoint) {
    entryContent = extractEntryContent(previewDir, analysis.entryPoint);
  }

  // Try to read package.json
  let pkg = null;
  const pkgPath = path.join(previewDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch (_) {}
  }

  return {
    framework: analysis.framework,
    entryPoint: '/' + (analysis.entryPoint || 'index.html'),
    totalFiles,
    totalSize,
    assetFiles,
    hasPackageJson: !!pkg,
    hasIndexHtml: fileList.some((f) => f.endsWith('index.html')),
    packageManager: pkgManager.name,
    dependencies: pkg ? Object.keys(pkg.dependencies || {}).length : 0,
    devDependencies: pkg ? Object.keys(pkg.devDependencies || {}).length : 0,
    scripts: pkg ? Object.keys(pkg.scripts || {}) : [],
    entryContentSnippet: entryContent ? entryContent.substring(0, 500) : null,
    analyzedAt: new Date().toISOString(),
  };
}

function getDirectorySize(dir) {
  let size = 0;
  if (!fs.existsSync(dir)) return size;
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const itemPath = path.join(dir, item.name);
      if (item.name.startsWith('.')) continue;
      if (item.isDirectory()) {
        size += getDirectorySize(itemPath);
      } else {
        size += fs.statSync(itemPath).size;
      }
    }
  } catch (_) {}
  return size;
}

function getPreviewStatus(projectId) {
  const previewDir = getPreviewDir(projectId);
  const extractedFlag = path.join(previewDir, '.extracted');

  if (!fs.existsSync(previewDir)) {
    return { status: 'not_extracted', extracted: false };
  }

  const extracted = fs.existsSync(extractedFlag);
  const entryPoint = extracted ? findEntryPoint(projectId) : null;
  const fileCount = extracted ? getAllFiles(previewDir).length : 0;

  return {
    status: extracted ? (entryPoint ? 'ready' : 'no_entry') : 'extracting',
    extracted,
    entryPoint: entryPoint ? `/previews/${projectId}/${entryPoint}` : null,
    fileCount,
    previewUrl: entryPoint
      ? `/api/projects/preview/${projectId}`
      : null,
  };
}

module.exports = {
  extractProject,
  findEntryPoint,
  analyzeProject,
  getPreviewStatus,
  getAllFiles,
  getPreviewDir,
};
