const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

const { detectFramework, getPackageManager, getStartCommand } = require('./frameworkDetector');

const PREVIEWS_DIR = process.env.VERCEL
  ? path.join('/tmp', 'marketplace-previews')
  : path.join(__dirname, '..', 'previews');
const MAX_SANDBOXES = 3;
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 min
const INSTALL_TIMEOUT_MS = 120 * 1000; // 2 min
const STARTUP_TIMEOUT_MS = 60 * 1000; // 1 min
const HEALTH_CHECK_INTERVAL_MS = 10 * 1000; // 10 sec
const PORT_RANGE_START = 4000;
const PORT_RANGE_END = 4999;

const sandboxes = new Map(); // projectId -> Sandbox instance

class Sandbox {
  constructor(projectId) {
    this.projectId = projectId;
    this.workDir = path.join(PREVIEWS_DIR, projectId);
    this.port = null;
    this.process = null;
    this.status = 'idle'; // idle | installing | installing_deps | starting | running | error | stopped
    this.errorMessage = '';
    this.lastActivity = Date.now();
    this.healthInterval = null;
    this.inactivityTimer = null;
    this.metadata = {
      framework: '',
      packageManager: '',
      startCommand: '',
      dependencies: 0,
      hasPackageJson: false,
      startedAt: null,
    };
  }

  getPreviewUrl() {
    if (this.status === 'running' && this.port) {
      return `http://localhost:${this.port}`;
    }
    return null;
  }

  getRuntimeProxyPath() {
    if (this.status === 'running' && this.port) {
      return `/runtime-proxy/${this.projectId}`;
    }
    return null;
  }

  async start(fileData) {
    this.lastActivity = Date.now();
    this.status = 'installing';

    try {
      // 1. Extract project files
      const { extractProject } = require('./previewService');
      extractProject(this.projectId, fileData);

      // 2. Detect framework
      const analysis = detectFramework(this.workDir);
      const pkgManager = getPackageManager(this.workDir);

      this.metadata.framework = analysis.framework;
      this.metadata.packageManager = pkgManager.name;

      // 3. Read package.json if exists
      let pkg = null;
      const pkgPath = path.join(this.workDir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          this.metadata.hasPackageJson = true;
          this.metadata.dependencies = Object.keys(pkg.dependencies || {}).length +
            Object.keys(pkg.devDependencies || {}).length;
        } catch (_) {}
      }

      // 4. Static sites don't need runtime
      if (analysis.framework === 'static') {
        this.status = 'running';
        this.port = 0; // static sites are served via static files
        this.metadata.startCommand = 'static';
        this.startHealthCheck();
        return { status: 'static', message: 'Static site - served via file server' };
      }

      // 5. Install dependencies
      if (pkg && (this.metadata.dependencies > 0)) {
        this.status = 'installing_deps';
        await this.runInstall();
      }

      // 6. Find available port
      this.port = await this.findAvailablePort(PORT_RANGE_START, PORT_RANGE_END);

      // 7. Get start command and start the server
      const startCmd = getStartCommand(analysis.framework, pkg);
      this.metadata.startCommand = startCmd.command || (pkg?.scripts?.start || '');
      this.status = 'starting';

      await this.startDevServer(pkg);

      this.status = 'running';
      this.metadata.startedAt = new Date().toISOString();
      this.startHealthCheck();
      this.resetInactivityTimer();

      return {
        status: 'running',
        port: this.port,
        previewUrl: this.getPreviewUrl(),
        proxyPath: this.getRuntimeProxyPath(),
        framework: this.metadata.framework,
        command: this.metadata.startCommand,
      };
    } catch (err) {
      this.status = 'error';
      this.errorMessage = err.message;
      this.cleanup();
      throw err;
    }
  }

  async runInstall() {
    return new Promise((resolve, reject) => {
      const pm = this.metadata.packageManager;
      const cmd = pm === 'yarn' ? 'yarn' : (pm === 'pnpm' ? 'pnpm' : 'npm');
      const args = ['install', '--no-audit', '--no-fund', '--loglevel=error'];

      const child = spawn(cmd, args, {
        cwd: this.workDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        windowsHide: true,
      });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`npm install timed out after ${INSTALL_TIMEOUT_MS / 1000}s`));
      }, INSTALL_TIMEOUT_MS);

      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`npm install failed (exit ${code}): ${stderr.slice(0, 300)}`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to start npm install: ${err.message}`));
      });
    });
  }

  async startDevServer(pkg) {
    return new Promise((resolve, reject) => {
      const startCmd = getStartCommand(this.metadata.framework, pkg);

      // Parse the command and args
      const cmdStr = startCmd.command || 'npm start';
      const parts = cmdStr.split(/\s+/);
      const cmd = parts[0];
      const args = parts.slice(1);

      // Add --port flag for common frameworks if not specified
      const noPort = !args.some(a => a.startsWith('--port') || a.startsWith('-p'));
      if (noPort && cmdStr.includes('vite')) {
        args.push('--port', String(this.port));
      } else if (noPort && cmdStr.includes('react-scripts')) {
        process.env.PORT = String(this.port);
      } else if (noPort && (cmdStr.includes('next') || cmdStr === 'npm start' || cmdStr === 'node server.js')) {
        process.env.PORT = String(this.port);
      }

      // For npm/yarn/pnpm, we need to handle the script call
      let finalCmd = cmd;
      let finalArgs = args;
      if (cmd === 'npm' || cmd === 'yarn' || cmd === 'pnpm') {
        // Using package manager command
      }

      const child = spawn(finalCmd, finalArgs, {
        cwd: this.workDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        windowsHide: true,
        env: {
          ...process.env,
          PORT: String(this.port),
          NODE_ENV: 'development',
          HOST: 'localhost',
          BROWSER: 'none',
          FAST_REFRESH: 'false',
        },
      });

      this.process = child;

      const timer = setTimeout(() => {
        // Even if the server hasn't printed ready, try to connect
        this.checkPortReady(this.port, 3000).then((ready) => {
          if (ready) resolve();
          else {
            child.kill('SIGTERM');
            reject(new Error(`Dev server failed to start within ${STARTUP_TIMEOUT_MS / 1000}s`));
          }
        });
      }, STARTUP_TIMEOUT_MS);

      let output = '';
      child.stdout.on('data', (d) => {
        output += d.toString();
        // Many frameworks print a "ready" or "Local:" message
        if (
          output.includes('Local:') ||
          output.includes('localhost') ||
          output.includes('ready') ||
          output.includes('compiled successfully') ||
          output.includes('listening') ||
          output.includes('started')
        ) {
          clearTimeout(timer);
          resolve();
        }
      });

      child.stderr.on('data', (d) => {
        // Some frameworks log to stderr
        const msg = d.toString();
        if (
          msg.includes('Local:') ||
          msg.includes('localhost') ||
          msg.includes('listening') ||
          msg.includes('started')
        ) {
          clearTimeout(timer);
          resolve();
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to start dev server: ${err.message}`));
      });

      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code !== 0 && code !== null) {
          reject(new Error(`Dev server exited with code ${code}`));
        }
      });
    });
  }

  checkPortReady(port, timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tryConnect = () => {
        const sock = new net.Socket();
        sock.setTimeout(1000);
        sock.on('connect', () => {
          sock.destroy();
          resolve(true);
        });
        sock.on('error', () => {
          sock.destroy();
          if (Date.now() - start < timeoutMs) {
            setTimeout(tryConnect, 500);
          } else {
            resolve(false);
          }
        });
        sock.on('timeout', () => {
          sock.destroy();
          if (Date.now() - start < timeoutMs) {
            setTimeout(tryConnect, 500);
          } else {
            resolve(false);
          }
        });
        sock.connect(port, 'localhost');
      };
      tryConnect();
    });
  }

  findAvailablePort(min, max) {
    return new Promise((resolve, reject) => {
      const tryPort = (port) => {
        if (port > max) return reject(new Error('No available ports'));
        const server = net.createServer();
        server.listen(port, 'localhost', () => {
          server.close(() => resolve(port));
        });
        server.on('error', () => tryPort(port + 1));
      };
      tryPort(min);
    });
  }

  startHealthCheck() {
    this.stopHealthCheck();
    this.healthInterval = setInterval(() => {
      const isStatic = this.metadata.framework === 'static';
      if (!isStatic && this.port && this.port > 0) {
        this.checkPortReady(this.port, 2000).then((ready) => {
          if (!ready) {
            this.status = 'error';
            this.errorMessage = 'Dev server process died';
            this.cleanup();
          }
        });
      }
      // Reset inactivity timer on health check
      this.resetInactivityTimer();
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  stopHealthCheck() {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  resetInactivityTimer() {
    this.lastActivity = Date.now();
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => {
      if (Date.now() - this.lastActivity >= INACTIVITY_TIMEOUT_MS) {
        this.stop();
      }
    }, INACTIVITY_TIMEOUT_MS);
  }

  touch() {
    this.lastActivity = Date.now();
  }

  stop() {
    this.stopHealthCheck();
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    if (this.process) {
      try {
        // Kill process tree
        if (process.platform === 'win32') {
          execSync(`taskkill /PID ${this.process.pid} /T /F 2>nul`, { stdio: 'ignore' });
        } else {
          this.process.kill('SIGTERM');
          setTimeout(() => {
            try { this.process.kill('SIGKILL'); } catch (_) {}
          }, 3000);
        }
      } catch (_) {}
      this.process = null;
    }
    this.status = 'stopped';
    this.port = null;
  }

  cleanup() {
    this.stop();
    sandboxes.delete(this.projectId);
  }

  getStatus() {
    return {
      projectId: this.projectId,
      status: this.status,
      errorMessage: this.errorMessage,
      port: this.port,
      previewUrl: this.getPreviewUrl(),
      proxyPath: this.getRuntimeProxyPath(),
      metadata: this.metadata,
      lastActivity: this.lastActivity,
      framework: this.metadata.framework,
    };
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

function getSandbox(projectId) {
  return sandboxes.get(projectId) || null;
}

function getSandboxStatus(projectId) {
  const sb = sandboxes.get(projectId);
  if (!sb) return { projectId, status: 'not_started' };
  return sb.getStatus();
}

async function startSandbox(projectId, fileData) {
  // Check existing
  const existing = sandboxes.get(projectId);
  if (existing) {
    if (existing.status === 'running') {
      existing.touch();
      return existing.getStatus();
    }
    existing.cleanup();
  }

  // Check max sandboxes
  const runningCount = Array.from(sandboxes.values()).filter(
    (s) => s.status === 'running' || s.status === 'starting' || s.status === 'installing_deps'
  ).length;

  if (runningCount >= MAX_SANDBOXES) {
    // Auto-stop the oldest inactive sandbox
    let oldest = null;
    let oldestKey = null;
    for (const [key, sb] of sandboxes.entries()) {
      if (sb.status === 'running' || sb.status === 'starting') {
        if (!oldest || sb.lastActivity < oldest.lastActivity) {
          oldest = sb;
          oldestKey = key;
        }
      }
    }
    if (oldest && oldestKey) {
      oldest.cleanup();
    } else {
      throw new Error(`Maximum ${MAX_SANDBOXES} concurrent sandboxes reached. Stop one first.`);
    }
  }

  const sandbox = new Sandbox(projectId);
  sandboxes.set(projectId, sandbox);
  return await sandbox.start(fileData);
}

async function stopSandbox(projectId) {
  const sb = sandboxes.get(projectId);
  if (sb) {
    sb.cleanup();
    return { projectId, status: 'stopped' };
  }
  return { projectId, status: 'not_found' };
}

function stopAllSandboxes() {
  for (const [key, sb] of sandboxes.entries()) {
    sb.cleanup();
  }
  return { stopped: true };
}

function getActiveSandboxes() {
  const result = [];
  for (const [key, sb] of sandboxes.entries()) {
    result.push(sb.getStatus());
  }
  return result;
}

module.exports = {
  Sandbox,
  getSandbox,
  getSandboxStatus,
  startSandbox,
  stopSandbox,
  stopAllSandboxes,
  getActiveSandboxes,
};
