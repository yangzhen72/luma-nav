'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

let app;
let feed;
let baseUrl;
let tempDir;

function client() {
  let cookie = '';
  return async function request(pathname, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (cookie) headers.Cookie = cookie;
    let body = options.body;
    if (body && typeof body !== 'string') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const response = await fetch(`${baseUrl}${pathname}`, { method: options.method || 'GET', headers, body });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const type = response.headers.get('content-type') || '';
    return {
      status: response.status,
      body: type.includes('application/json') ? await response.json() : await response.text()
    };
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

before(async () => {
  feed = http.createServer((req, res) => {
    if (req.url === '/CHANGELOG.md') {
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      res.end(`# 更新日志\n\n## [9.9.9] - 2026-12-01\n\n### 新增\n\n- 远程版本测试功能\n- 更新源检查能力\n\n### 修复\n\n- 修复示例问题\n\n## [9.9.8] - 2026-11-01\n\n### 新增\n\n- 旧版本功能\n`);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  const feedPort = await listen(feed);

  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-nav-update-'));
  app = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      DATA_DIR: path.join(tempDir, 'data'),
      UPLOAD_DIR: path.join(tempDir, 'uploads'),
      SESSION_SECRET: 'update-test-secret',
      ADMIN_PASSWORD: 'updatepass123',
      UPDATE_FEED_URL: `http://127.0.0.1:${feedPort}/CHANGELOG.md`,
      UPDATE_COMMAND: 'echo update-test-ok'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  app.stderr.on('data', (chunk) => { stderr += chunk; });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Server start timeout: ${stderr}`)), 8000);
    app.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    app.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited with ${code}: ${stderr}`));
    });
  });
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (app && !app.killed) {
    await new Promise((resolve) => {
      app.once('exit', resolve);
      app.kill('SIGTERM');
      setTimeout(resolve, 3000).unref();
    });
  }
  if (feed) await new Promise((resolve) => feed.close(resolve));
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test('version center checks configured update feed', async () => {
  const guest = client();
  const admin = client();

  const denied = await guest('/api/update');
  assert.equal(denied.status, 403);

  const login = await admin('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'updatepass123' } });
  assert.equal(login.status, 200);

  const info = await admin('/api/update');
  assert.equal(info.status, 200);
  assert.equal(info.body.ok, true);
  assert.match(info.body.currentVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(info.body.feed.configured, true);
  assert.ok(info.body.changelog.length >= 5);
  assert.ok(Array.isArray(info.body.deployment.updateCommands));
  assert.equal(info.body.deployment.mode, 'node');

  const check = await admin('/api/update/check', { method: 'POST' });
  assert.equal(check.status, 200);
  assert.equal(check.body.latestVersion, '9.9.9');
  assert.equal(check.body.updateAvailable, true);
  assert.equal(check.body.releasedAt, '2026-12-01');
  assert.deepEqual(check.body.notes, ['远程版本测试功能', '更新源检查能力', '修复示例问题']);
  assert.ok(check.body.releaseUrl);

  const afterCheck = await admin('/api/update');
  assert.equal(afterCheck.body.lastCheck.latestVersion, '9.9.9');
  assert.equal(afterCheck.body.lastCheck.updateAvailable, true);

  const applied = await admin('/api/update/apply', { method: 'POST', body: { confirm: 'UPDATE' } });
  assert.equal(applied.status, 200);
  assert.equal(applied.body.ok, true);
  assert.match(applied.body.output, /update-test-ok/);
  assert.equal(applied.body.requiresRestart, true);
  assert.ok(applied.body.backupFile.includes('updates'));
  assert.ok(applied.body.backupFile.includes('pre-update-'));
});
