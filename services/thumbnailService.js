const fs = require('fs');
const path = require('path');

let puppeteer = null;
try {
  puppeteer = require('puppeteer');
} catch (_) {}

function detectHeroImage(projectDir) {
  const candidates = [];
  try {
    const items = fs.readdirSync(projectDir, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory() || item.name.startsWith('.')) continue;
      const name = item.name.toLowerCase();
      if (!name.match(/\.(png|jpg|jpeg|webp|svg)$/)) continue;
      const score = scoreImageAsHero(name, item.name);
      const filePath = path.join(projectDir, item.name);
      const stats = fs.statSync(filePath);
      candidates.push({ name: item.name, path: filePath, score, size: stats.size });
    }
  } catch (_) {}
  candidates.sort((a, b) => b.score - a.score);
  return candidates.length > 0 ? candidates[0] : null;
}

const HERO_KEYWORDS = [
  'screenshot', 'preview', 'thumbnail', 'hero', 'cover',
  'screenshot-1', 'screenshot1', 'home', 'landing',
  'banner', 'showcase', 'demo', 'app',
];
const GOOD_KEYWORDS = ['ui', 'homepage', 'main', 'og-image', 'social'];

function scoreImageAsHero(lowerName, originalName) {
  let score = 0;
  for (const kw of HERO_KEYWORDS) {
    if (lowerName.includes(kw)) score += 10;
  }
  for (const kw of GOOD_KEYWORDS) {
    if (lowerName.includes(kw)) score += 5;
  }
  if (originalName === 'screenshot.png') score += 20;
  if (originalName === 'preview.png') score += 20;
  if (originalName === 'thumbnail.png') score += 20;
  if (originalName === 'hero.png') score += 20;
  return score;
}

function extractThumbnailFromEntry(entryContent) {
  if (!entryContent) return null;
  const ogMatch = entryContent.match(
    /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/
  );
  if (ogMatch) return ogMatch[1];
  const twMatch = entryContent.match(
    /<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/
  );
  if (twMatch) return twMatch[1];
  const imgMatch = entryContent.match(
    /<img[^>]+src=["']([^"']+)["'][^>]*(?:class|id)[^>]*(?:hero|banner|main|header|logo)/i
  );
  if (imgMatch) return imgMatch[1];
  const heroClassMatch = entryContent.match(
    /<img[^>]+class=["'][^"']*(?:hero|banner|preview|thumbnail)[^"']*["'][^>]*src=["']([^"']+)["']/
  );
  if (heroClassMatch) return heroClassMatch[1];
  return null;
}

function generateThumbnailDataUrl(projectDir, entryContent) {
  const heroImage = detectHeroImage(projectDir);
  if (heroImage) {
    try {
      const ext = path.extname(heroImage.name).toLowerCase().replace('.', '');
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      const data = fs.readFileSync(heroImage.path);
      return `data:${mime};base64,${data.toString('base64')}`;
    } catch (_) {}
  }
  const metaThumbnail = extractThumbnailFromEntry(entryContent);
  if (metaThumbnail) return metaThumbnail;
  try {
    const allImages = [];
    const walkDir = (dir) => {
      try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          if (item.name.startsWith('.') || item.name === 'node_modules') continue;
          const fullPath = path.join(dir, item.name);
          if (item.isDirectory()) {
            walkDir(fullPath);
          } else if (item.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
            const stats = fs.statSync(fullPath);
            allImages.push({ path: fullPath, name: item.name, size: stats.size });
          }
        }
      } catch (_) {}
    };
    walkDir(projectDir);
    allImages.sort((a, b) => b.size - a.size);
    if (allImages.length > 0) {
      const img = allImages[0];
      const ext = path.extname(img.name).toLowerCase().replace('.', '');
      const mime = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      const data = fs.readFileSync(img.path);
      return `data:${mime};base64,${data.toString('base64')}`;
    }
  } catch (_) {}
  return null;
}

function generateGitHubThumbnailUrl(owner, repo) {
  return `https://opengraph.githubassets.com/1/${owner}/${repo}`;
}

// ─── AI-powered screenshot via Puppeteer ─────────────────────────────────

async function captureScreenshot(url, outputPath) {
  if (!puppeteer) {
    throw new Error('Puppeteer not available. Install it with: npm install puppeteer');
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,800',
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Navigate and wait for content to load
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    // Wait a bit for any lazy-loaded content
    await new Promise((r) => setTimeout(r, 2000));

    // Scroll to capture the full page content
    const fullHeight = await page.evaluate(() => document.body.scrollHeight);
    const viewportHeight = 800;

    // Find the best section: try to detect the hero section
    let clipRect = null;
    try {
      clipRect = await page.evaluate(() => {
        // Look for hero section
        const heroSelectors = [
          'section[id*="hero"]', 'section[class*="hero"]',
          'header', '[class*="hero"]', '[id*="hero"]',
          '[class*="banner"]', '[class*="landing"]',
          'main > section:first-child', 'main > div:first-child',
        ];
        for (const sel of heroSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const rect = el.getBoundingClientRect();
            return { x: 0, y: rect.top, width: 1280, height: Math.min(rect.height, 600) };
          }
        }
        // No hero found, capture the top portion
        return { x: 0, y: 0, width: 1280, height: Math.min(fullHeight, 600) };
      });
    } catch (_) {
      clipRect = { x: 0, y: 0, width: 1280, height: 600 };
    }

    await page.screenshot({
      path: outputPath,
      clip: clipRect,
      type: 'jpeg',
      quality: 85,
    });

    return outputPath;
  } catch (err) {
    throw new Error(`Screenshot capture failed: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function captureScreenshotBase64(url) {
  if (!puppeteer) return null;

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,800',
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 25000 });
    await new Promise((r) => setTimeout(r, 1500));

    const clipRect = await page.evaluate(() => {
      const heroSelectors = [
        'section[id*="hero"]', 'section[class*="hero"]',
        'header', '[class*="hero"]', '[id*="hero"]',
        '[class*="banner"]', '[class*="landing"]',
        'main > section:first-child', 'main > div:first-child',
      ];
      for (const sel of heroSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const rect = el.getBoundingClientRect();
          return { x: 0, y: Math.max(0, rect.top), width: 1280, height: Math.min(rect.height, 600) };
        }
      }
      return { x: 0, y: 0, width: 1280, height: 600 };
    }).catch(() => ({ x: 0, y: 0, width: 1280, height: 600 }));

    const base64 = await page.screenshot({
      clip: clipRect,
      type: 'jpeg',
      quality: 80,
      encoding: 'base64',
    });

    return `data:image/jpeg;base64,${base64}`;
  } catch (_) {
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = {
  detectHeroImage,
  extractThumbnailFromEntry,
  generateThumbnailDataUrl,
  generateGitHubThumbnailUrl,
  captureScreenshot,
  captureScreenshotBase64,
};
