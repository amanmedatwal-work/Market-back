const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    title: {
      type: String,
      required: true,
    },
    shortDescription: {
      type: String,
      required: true,
    },
    detailedDescription: {
      type: String,
      required: true,
    },
    techStack: [String],
    category: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
      default: 0,
    },
    screenshots: [String],
    demoUrl: {
      type: String,
    },
    fileUrl: {
      type: String,
    },
    fileData: {
      type: String,
    },
    fileOriginalName: {
      type: String,
    },
    thumbnail: {
      type: String, // Base64 image data or URL to preview image
    },
    uploadMethod: {
      type: String,
      enum: ['local', 'github_link', 'github_import'],
      default: 'local',
    },
    githubRepoUrl: {
      type: String,
    },
    isApproved: {
      type: Boolean,
      default: false,
    },
    // Auto-analysis fields (populated by previewService)
    analysis: {
      framework: { type: String, default: '' },
      entryPoint: { type: String, default: '' },
      totalFiles: { type: Number, default: 0 },
      totalSize: { type: Number, default: 0 },
      assetFiles: { type: Number, default: 0 },
      hasPackageJson: { type: Boolean, default: false },
      hasIndexHtml: { type: Boolean, default: false },
      packageManager: { type: String, default: '' },
      dependencies: { type: Number, default: 0 },
      devDependencies: { type: Number, default: 0 },
      scripts: [String],
      analyzedAt: { type: Date },
    },
    previewStatus: {
      type: String,
      enum: ['pending', 'extracting', 'ready', 'no_entry', 'error'],
      default: 'pending',
    },
    ratings: {
      type: Number,
      default: 0,
    },
    numReviews: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

const Project = mongoose.model('Project', projectSchema);

module.exports = Project;
