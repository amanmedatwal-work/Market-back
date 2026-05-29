const express = require('express');
const router = express.Router();
const {
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
} = require('../controllers/projectController');
const { protect, seller } = require('../middleware/authMiddleware');

router.get('/', getProjects);
router.post('/', protect, seller, createProject);
router.get('/myprojects', protect, seller, getMyProjects);

// Preview endpoints
router.get('/preview/:id', getProjectPreview);
router.get('/preview/:id/status', getPreviewStatusEndpoint);

// Analysis & Thumbnail
router.post('/analyze/:id', protect, seller, analyzeProjectFiles);
router.post('/thumbnail/:id', protect, seller, regenerateThumbnail);
router.post('/ai-thumbnail/:id', protect, seller, generateAiThumbnail);

// Runtime sandbox
router.post('/runtime/start/:id', startRuntimePreview);
router.post('/runtime/stop/:id', stopRuntimePreview);
router.get('/runtime/status/:id', getRuntimeStatus);

// Temp preview link
router.post('/temp-preview-link/:id', generateTempPreviewLink);

// Download purchased project
router.get('/:id/download', protect, downloadProjectFile);

// Submit rating
router.post('/:id/rate', protect, rateProject);

router.get('/:id', getProjectById);

module.exports = router;
