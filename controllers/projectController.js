const Project = require('../models/Project');
const { getConnectionStatus } = require('../config/db');
const { analyzeProject, getPreviewStatus } = require('../services/previewService');
const { generateThumbnailDataUrl, generateGitHubThumbnailUrl } = require('../services/thumbnailService');
const path = require('path');
const fs = require('fs');

const PREVIEWS_DIR = process.env.VERCEL
  ? path.join('/tmp', 'marketplace-previews')
  : path.join(__dirname, '..', 'previews');

const UPLOADS_DIR = process.env.VERCEL
  ? path.join('/tmp', 'marketplace-uploads')
  : path.join(__dirname, '..', 'uploads');

const getProjectFileData = (projectId, fileData) => {
  if (fileData === 'file_stored_on_disk') {
    const filePath = path.join(UPLOADS_DIR, `${projectId.toString()}.txt`);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
  }
  return fileData;
};

const getApiBaseUrl = () => (process.env.API_URL || 'http://localhost:5000').replace(/\/$/, '');

// @desc    Fetch all approved projects
// @route   GET /api/projects
// @access  Public
const getProjects = async (req, res) => {
  try {
    const projects = await Project.find({ isApproved: true })
      .select('-fileData')
      .populate('seller', 'name email')
      .sort({ createdAt: -1 });
    res.json(projects);
  } catch (error) {
    if (!getConnectionStatus()) {
      return res.status(500).json({ message: 'Server error! Make sure MongoDB is running.' });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Fetch single project
// @route   GET /api/projects/:id
// @access  Public
const getProjectById = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .select('-fileData')
      .populate('seller', 'name bio');

    if (project) {
      res.json(project);
    } else {
      res.status(404).json({ message: 'Project not found' });
    }
  } catch (error) {
    if (!getConnectionStatus()) {
      return res.status(500).json({ message: 'Server error! Make sure MongoDB is running.' });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a project
// @route   POST /api/projects
// @access  Private/Seller
const createProject = async (req, res) => {
  try {
    const {
      title,
      shortDescription,
      detailedDescription,
      techStack,
      category,
      price,
      demoUrl,
      uploadMethod,
      githubRepoUrl,
      fileUrl,
      fileData,
      fileOriginalName,
      thumbnail,
    } = req.body;

    const project = new Project({
      title,
      shortDescription,
      detailedDescription,
      techStack,
      category,
      price,
      demoUrl,
      uploadMethod,
      githubRepoUrl,
      fileUrl,
      fileData: fileData ? 'file_stored_on_disk' : '',
      fileOriginalName,
      thumbnail,
      seller: req.user._id,
      isApproved: true,
      previewStatus: fileData ? 'extracting' : 'pending',
    });

    const createdProject = await project.save();

    // Store fileData to disk if present
    if (fileData) {
      if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      }
      const filePath = path.join(UPLOADS_DIR, `${createdProject._id}.txt`);
      fs.writeFileSync(filePath, fileData, 'utf-8');

      // Auto-analyze
      analyzeAndUpdateProject(createdProject._id, fileData).catch((err) => {
        console.error('Auto-analysis failed:', err.message);
      });
    }

    res.status(201).json(createdProject);
  } catch (error) {
    if (!getConnectionStatus()) {
      return res.status(500).json({ message: 'Server error! Make sure MongoDB is running.' });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Analyze uploaded project files
// @route   POST /api/projects/analyze/:id
// @access  Private/Seller
const analyzeProjectFiles = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }
    if (!project.fileData) {
      return res.status(400).json({ message: 'No uploaded file data to analyze' });
    }

    const analysis = analyzeProject(req.params.id, getProjectFileData(project._id, project.fileData));

    // Auto-generate thumbnail from project files
    const previewDir = path.join(PREVIEWS_DIR, req.params.id);
    const entryPath = analysis.entryPoint.replace(/^\//, '');
    let entryContent = null;
    const fullEntryPath = path.join(previewDir, entryPath);
    if (fs.existsSync(fullEntryPath)) {
      entryContent = fs.readFileSync(fullEntryPath, 'utf-8');
    }

    const autoThumbnail = generateThumbnailDataUrl(previewDir, entryContent);

    // Update project with analysis results
    project.analysis = {
      framework: analysis.framework,
      entryPoint: analysis.entryPoint,
      totalFiles: analysis.totalFiles,
      totalSize: analysis.totalSize,
      assetFiles: analysis.assetFiles,
      hasPackageJson: analysis.hasPackageJson,
      hasIndexHtml: analysis.hasIndexHtml,
      packageManager: analysis.packageManager,
      dependencies: analysis.dependencies,
      devDependencies: analysis.devDependencies,
      scripts: analysis.scripts,
      analyzedAt: new Date(),
    };
    project.previewStatus = analysis.entryPoint ? 'ready' : 'no_entry';
    if (autoThumbnail && !project.thumbnail) {
      project.thumbnail = autoThumbnail;
    }
    await project.save();

    res.json({
      message: 'Project analyzed successfully',
      analysis: project.analysis,
      previewStatus: project.previewStatus,
      thumbnailGenerated: !!autoThumbnail,
    });
  } catch (error) {
    if (!getConnectionStatus()) {
      return res.status(500).json({ message: 'Server error! Make sure MongoDB is running.' });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get preview status for a project
// @route   GET /api/projects/preview/:id/status
// @access  Public
const getPreviewStatusEndpoint = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const status = project.fileData
      ? getPreviewStatus(req.params.id)
      : { status: 'no_files', extracted: false };

    res.json({
      projectId: project._id,
      title: project.title,
      uploadMethod: project.uploadMethod,
      hasDemoUrl: !!project.demoUrl,
      hasGithubUrl: !!project.githubRepoUrl,
      hasFileData: !!project.fileData,
      framework: project.analysis?.framework || null,
      analysis: project.analysis || null,
      previewStatus: project.previewStatus,
      previewUrl: status.previewUrl || '',
      extracted: status.extracted,
      entryPoint: status.entryPoint || '',
      fileCount: status.fileCount || 0,
    });
  } catch (error) {
    if (!getConnectionStatus()) {
      return res.status(500).json({ message: 'Server error! Make sure MongoDB is running.' });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Regenerate thumbnail for a project
// @route   POST /api/projects/thumbnail/:id
// @access  Private/Seller
const regenerateThumbnail = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    let thumbnail = null;

    if (project.fileData) {
      const previewDir = path.join(PREVIEWS_DIR, req.params.id);
      const entryPath = project.analysis?.entryPoint?.replace(/^\//, '') || 'index.html';
      let entryContent = null;
      const fullEntryPath = path.join(previewDir, entryPath);
      if (fs.existsSync(fullEntryPath)) {
        entryContent = fs.readFileSync(fullEntryPath, 'utf-8');
      }
      thumbnail = generateThumbnailDataUrl(previewDir, entryContent);
    } else if (project.githubRepoUrl) {
      const match = project.githubRepoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (match) {
        thumbnail = generateGitHubThumbnailUrl(match[1], match[2].replace(/\.git$/, ''));
      }
    } else if (project.demoUrl) {
      thumbnail = `https://api.microlink.io/?url=${encodeURIComponent(project.demoUrl)}&screenshot=true&meta=false`;
    }

    if (thumbnail) {
      project.thumbnail = thumbnail;
      await project.save();
      res.json({ message: 'Thumbnail regenerated', thumbnail });
    } else {
      res.status(400).json({ message: 'Could not generate thumbnail' });
    }
  } catch (error) {
    if (!getConnectionStatus()) {
      return res.status(500).json({ message: 'Server error! Make sure MongoDB is running.' });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Fetch logged in seller's projects
// @route   GET /api/projects/myprojects
// @access  Private/Seller
const getMyProjects = async (req, res) => {
  try {
    const projects = await Project.find({ seller: req.user._id })
      .select('-fileData')
      .sort({ createdAt: -1 });
    res.json(projects);
  } catch (error) {
    if (!getConnectionStatus()) {
      return res.status(500).json({ message: 'Server error! Make sure MongoDB is running.' });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Serve extracted preview for ZIP-uploaded projects
// @route   GET /api/projects/preview/:id
// @access  Public
const getProjectPreview = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }
    if (!project.fileData) {
      return res.status(400).json({ message: 'No uploaded file data for this project' });
    }

    const { getPreviewStatus } = require('../services/previewService');
    const status = getPreviewStatus(req.params.id);

    // Extract if not yet extracted
    if (!status.extracted) {
      try {
        const { extractProject, findEntryPoint } = require('../services/previewService');
        extractProject(req.params.id, getProjectFileData(project._id, project.fileData));
        const entry = findEntryPoint(req.params.id);
        if (entry) {
          project.previewStatus = 'ready';
        } else {
          project.previewStatus = 'no_entry';
        }
        await project.save();
      } catch (extractErr) {
        project.previewStatus = 'error';
        await project.save();
        return res.status(500).json({ message: 'Failed to extract preview: ' + extractErr.message });
      }
    }

    const AdmZip = require('adm-zip');
    const previewDir = path.join(PREVIEWS_DIR, req.params.id);

    // Detect entry point
    const entryCandidates = [
      'index.html',
      'public/index.html',
      'dist/index.html',
      'build/index.html',
      'out/index.html',
    ];

    let relativeEntry = 'index.html';
    for (const candidate of entryCandidates) {
      if (fs.existsSync(path.join(previewDir, candidate))) {
        relativeEntry = candidate;
        break;
      }
    }

    const staticUrl = `/previews/${req.params.id}/${relativeEntry}`;
    return res.redirect(302, staticUrl);
  } catch (error) {
    const { getConnectionStatus } = require('../config/db');
    if (!getConnectionStatus()) {
      return res.status(500).json({ message: 'Server error! Make sure MongoDB is running.' });
    }
    res.status(500).json({ message: error.message });
  }
};

// Internal helper
async function analyzeAndUpdateProject(projectId, fileData) {
  try {
    const projIdStr = projectId.toString();
    const analysis = analyzeProject(projIdStr, fileData);
    const previewDir = path.join(PREVIEWS_DIR, projIdStr);
    const entryPath = analysis.entryPoint.replace(/^\//, '');
    let entryContent = null;
    const fullEntryPath = path.join(previewDir, entryPath);
    if (fs.existsSync(fullEntryPath)) {
      entryContent = fs.readFileSync(fullEntryPath, 'utf-8');
    }
    const autoThumbnail = generateThumbnailDataUrl(previewDir, entryContent);

    const updateData = {
      analysis: {
        framework: analysis.framework,
        entryPoint: analysis.entryPoint,
        totalFiles: analysis.totalFiles,
        totalSize: analysis.totalSize,
        assetFiles: analysis.assetFiles,
        hasPackageJson: analysis.hasPackageJson,
        hasIndexHtml: analysis.hasIndexHtml,
        packageManager: analysis.packageManager,
        dependencies: analysis.dependencies,
        devDependencies: analysis.devDependencies,
        scripts: analysis.scripts,
        analyzedAt: new Date(),
      },
      previewStatus: analysis.entryPoint ? 'ready' : 'no_entry',
    };

    const project = await Project.findById(projectId);
    if (project && autoThumbnail && !project.thumbnail) {
      updateData.thumbnail = autoThumbnail;
    }

    await Project.findByIdAndUpdate(projectId, updateData);
    console.log(`Auto-analysis complete for project ${projectId}: ${analysis.framework}`);
  } catch (err) {
    console.error(`Auto-analysis failed for ${projectId}:`, err.message);
    await Project.findByIdAndUpdate(projectId, { previewStatus: 'error' });
  }
}

// ─── Runtime Sandbox Endpoints ────────────────────────────────────────────

// @desc    Start runtime sandbox for a project
// @route   POST /api/projects/runtime/start/:id
// @access  Public
const startRuntimePreview = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });
    if (!project.fileData) return res.status(400).json({ message: 'No file data to run' });

    const { startSandbox } = require('../services/sandboxService');
    const result = await startSandbox(req.params.id, getProjectFileData(project._id, project.fileData));
    res.json(result);
  } catch (error) {
    if (error.message.includes('Maximum')) {
      return res.status(429).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Stop runtime sandbox
// @route   POST /api/projects/runtime/stop/:id
// @access  Public
const stopRuntimePreview = async (req, res) => {
  try {
    const { stopSandbox } = require('../services/sandboxService');
    const result = await stopSandbox(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get runtime sandbox status
// @route   GET /api/projects/runtime/status/:id
// @access  Public
const getRuntimeStatus = async (req, res) => {
  try {
    const { getSandboxStatus } = require('../services/sandboxService');
    const status = getSandboxStatus(req.params.id);
    res.json(status);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Generate AI screenshot thumbnail via Puppeteer
// @route   POST /api/projects/ai-thumbnail/:id
// @access  Private/Seller
const generateAiThumbnail = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const { captureScreenshotBase64 } = require('../services/thumbnailService');
    const previewUrl = `${getApiBaseUrl()}/api/projects/preview/${req.params.id}`;

    const thumbnail = await captureScreenshotBase64(previewUrl);
    if (thumbnail) {
      project.thumbnail = thumbnail;
      await project.save();
      return res.json({ message: 'AI thumbnail generated', thumbnail });
    }

    // Fallback to hero image detection
    const previewDir = path.join(PREVIEWS_DIR, req.params.id);
    const entryPath = project.analysis?.entryPoint?.replace(/^\//, '') || 'index.html';
    let entryContent = null;
    if (fs.existsSync(path.join(previewDir, entryPath))) {
      entryContent = fs.readFileSync(path.join(previewDir, entryPath), 'utf-8');
    }
    const fallback = generateThumbnailDataUrl(previewDir, entryContent);
    if (fallback) {
      project.thumbnail = fallback;
      await project.save();
      return res.json({ message: 'Fallback thumbnail generated', thumbnail: fallback });
    }

    res.status(400).json({ message: 'Could not generate thumbnail' });
  } catch (error) {
    const { getConnectionStatus } = require('../config/db');
    if (!getConnectionStatus()) {
      return res.status(500).json({ message: 'Server error! Make sure MongoDB is running.' });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Generate public temporary preview link
// @route   POST /api/projects/temp-preview-link/:id
// @access  Public
const generateTempPreviewLink = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    // Try running sandbox to get a live preview URL
    if (project.fileData) {
      const { getSandboxStatus, startSandbox } = require('../services/sandboxService');
      const status = getSandboxStatus(req.params.id);
      if (status.status === 'running' && status.previewUrl) {
        return res.json({ url: status.previewUrl, type: 'runtime' });
      }
      try {
        const result = await startSandbox(req.params.id, getProjectFileData(project._id, project.fileData));
        if (result.status === 'running' && result.previewUrl) {
          return res.json({ url: result.previewUrl, type: 'runtime' });
        }
        if (result.status === 'static') {
          return res.json({
            url: `${getApiBaseUrl()}/api/projects/preview/${req.params.id}`,
            type: 'static',
          });
        }
      } catch (_) {}
    }

    // Fallback to demo URL or GitHub URL
    if (project.demoUrl) {
      return res.json({ url: project.demoUrl, type: 'demo' });
    }
    if (project.githubRepoUrl) {
      return res.json({ url: project.githubRepoUrl, type: 'github' });
    }

    res.status(400).json({ message: 'No preview link could be generated' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Helper to fetch URL following redirects (useful for GitHub repository downloads)
const fetchUrlWithRedirects = (url, callback, redirectCount = 0) => {
  const https = require('https');
  if (redirectCount > 5) {
    return callback(new Error('Too many redirects'));
  }
  https.get(url, { headers: { 'User-Agent': 'Node.js' } }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      fetchUrlWithRedirects(res.headers.location, callback, redirectCount + 1);
    } else if (res.statusCode === 200) {
      callback(null, res);
    } else {
      callback(new Error(`Failed to fetch: ${res.statusCode}`));
    }
  }).on('error', (err) => {
    callback(err);
  });
};

const getExtensionFromMime = (mime) => {
  if (!mime) return '.zip';
  if (mime.includes('pdf')) return '.pdf';
  if (mime.includes('png')) return '.png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  if (mime.includes('text/plain')) return '.txt';
  if (mime.includes('text/html')) return '.html';
  return '.zip';
};

// @desc    Download purchased project file
// @route   GET /api/projects/:id/download
// @access  Private
const downloadProjectFile = async (req, res) => {
  try {
    const Order = require('../models/Order');
    const projectId = req.params.id;
    const project = await Project.findById(projectId);

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Check if user is the seller or an admin, or has purchased this project
    const isSeller = project.seller.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    
    let isPurchased = false;
    if (!isSeller && !isAdmin) {
      const order = await Order.findOne({
        buyer: req.user._id,
        project: projectId,
        isPaid: true
      });
      if (order) {
        isPurchased = true;
      }
    }

    if (!isSeller && !isAdmin && !isPurchased) {
      return res.status(403).json({ message: 'You have not purchased this project.' });
    }

    if (!project.fileData) {
      // If it is a GitHub repository project, stream the zip from GitHub
      if (project.githubRepoUrl) {
        const cleanUrl = project.githubRepoUrl.replace(/\.git$/, '');
        const match = cleanUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
        if (match) {
          const owner = match[1];
          const repo = match[2];
          const fileName = project.fileOriginalName || `${repo.toLowerCase()}_project.zip`;
          
          const mainZipUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`;
          const masterZipUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/master.zip`;
          
          const streamZip = (url, fallbackUrl) => {
            fetchUrlWithRedirects(url, (err, fetchRes) => {
              if (err) {
                if (fallbackUrl) {
                  // Fallback to master branch zip
                  return streamZip(fallbackUrl, null);
                }
                return res.status(500).json({ message: `Failed to download from GitHub: ${err.message}` });
              }
              res.set({
                'Content-Type': fetchRes.headers['content-type'] || 'application/zip',
                'Content-Disposition': `attachment; filename="${fileName}"`
              });
              fetchRes.pipe(res);
            });
          };
          
          return streamZip(mainZipUrl, masterZipUrl);
        }
      }
      return res.status(400).json({ message: 'No file data available for this project' });
    }

    const fileData = getProjectFileData(project._id, project.fileData);
    // Parse base64
    const matches = fileData.match(/^data:(.+);base64,(.+)$/);
    let buffer;
    let contentType = 'application/octet-stream';
    let extension = '.zip';

    if (matches && matches.length === 3) {
      contentType = matches[1];
      buffer = Buffer.from(matches[2], 'base64');
      extension = getExtensionFromMime(contentType);
    } else {
      buffer = Buffer.from(fileData, 'base64');
    }

    const fileName = project.fileOriginalName || `${project.title.toLowerCase().replace(/\s+/g, '_')}_project${extension}`;

    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': buffer.length
    });

    res.send(buffer);
  } catch (error) {
    const { getConnectionStatus } = require('../config/db');
    if (!getConnectionStatus()) {
      return res.status(500).json({ message: 'Server error! Make sure MongoDB is running.' });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Rate a project
// @route   POST /api/projects/:id/rate
// @access  Private
const rateProject = async (req, res) => {
  try {
    const { rating } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Please provide a rating between 1 and 5' });
    }

    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const currentTotalRating = project.ratings * project.numReviews;
    const newNumReviews = project.numReviews + 1;
    const newAverageRating = (currentTotalRating + Number(rating)) / newNumReviews;

    project.ratings = Math.round(newAverageRating * 10) / 10;
    project.numReviews = newNumReviews;

    await project.save();

    res.json({
      message: 'Rating submitted successfully',
      ratings: project.ratings,
      numReviews: project.numReviews
    });
  } catch (error) {
    if (!getConnectionStatus()) {
      return res.status(500).json({ message: 'Server error! Make sure MongoDB is running.' });
    }
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getProjects,
  getProjectById,
  createProject,
  getMyProjects,
  getProjectPreview,
  analyzeProjectFiles,
  getPreviewStatusEndpoint,
  regenerateThumbnail,
  startRuntimePreview,
  stopRuntimePreview,
  getRuntimeStatus,
  generateAiThumbnail,
  generateTempPreviewLink,
  downloadProjectFile,
  rateProject,
};
