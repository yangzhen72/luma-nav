'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

let child;
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
      headers: response.headers,
      body: type.includes('application/json') ? await response.json() : await response.text()
    };
  };
}

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-nav-settings-'));
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      DATA_DIR: path.join(tempDir, 'data'),
      UPLOAD_DIR: path.join(tempDir, 'uploads'),
      SESSION_SECRET: 'settings-test-secret',
      ADMIN_PASSWORD: 'settingspass123'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Server start timeout: ${stderr}`)), 8000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited with ${code}: ${stderr}`));
    });
  });
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (child && !child.killed) {
    await new Promise((resolve) => {
      child.once('exit', resolve);
      child.kill('SIGTERM');
      setTimeout(resolve, 3000).unref();
    });
  }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test('system settings, backup export and restore', async () => {
  const guest = client();
  const admin = client();

  const login = await admin('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'settingspass123' } });
  assert.equal(login.status, 200);

  const updated = await admin('/api/settings', {
    method: 'PUT',
    body: {
      siteName: 'Settings Verify',
      siteSubtitle: 'Verification Subtitle',
      footerText: 'Verification Footer',
      searchEngine: 'custom',
      customSearchUrl: 'https://search.example.com/find?q={q}',
      themeDefault: 'light',
      wallpaper: 'ocean',
      accent: 'cyan',
      cardStyle: 'glass',
      showClock: false,
      startInLanMode: true,
      openInNewTab: false,
      requireLogin: true
    }
  });
  assert.equal(updated.status, 200);

  const bootstrap = await admin('/api/bootstrap');
  assert.equal(bootstrap.body.settings.siteName, 'Settings Verify');
  assert.equal(bootstrap.body.settings.siteSubtitle, 'Verification Subtitle');
  assert.equal(bootstrap.body.settings.footerText, 'Verification Footer');
  assert.equal(bootstrap.body.settings.searchEngine, 'custom');
  assert.equal(bootstrap.body.settings.customSearchUrl, 'https://search.example.com/find?q={q}');
  assert.equal(bootstrap.body.settings.themeDefault, 'light');
  assert.equal(bootstrap.body.settings.wallpaper, 'ocean');
  assert.equal(bootstrap.body.settings.accent, 'cyan');
  assert.equal(bootstrap.body.settings.cardStyle, 'glass');
  assert.equal(bootstrap.body.settings.showClock, false);
  assert.equal(bootstrap.body.settings.startInLanMode, true);
  assert.equal(bootstrap.body.settings.openInNewTab, false);

  const publicSystem = await guest('/api/system');
  assert.equal(publicSystem.status, 404);

  const invalidSearch = await admin('/api/settings', { method: 'PUT', body: { customSearchUrl: 'https://search.example.com/find' } });
  assert.equal(invalidSearch.status, 400);

  const backup = await admin('/api/backup');
  assert.equal(backup.status, 200);
  assert.equal(backup.body.app, 'luma-nav');
  assert.equal(backup.body.data.settings.siteName, 'Settings Verify');
  assert.equal(backup.body.data.users.length, 1);
  assert.equal(backup.body.data.groups.length, 4);
  assert.equal(backup.body.data.items.length, 12);

  const changedAgain = await admin('/api/settings', { method: 'PUT', body: { siteName: 'Will Be Replaced' } });
  assert.equal(changedAgain.status, 200);

  const restore = await admin('/api/restore', { method: 'POST', body: { confirm: 'RESTORE', data: backup.body } });
  assert.equal(restore.status, 200);
  assert.equal(restore.body.relogin, true);
  const loggedOut = await admin('/api/bootstrap');
  assert.equal(loggedOut.body.authRequired, true);

  const relogin = await admin('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'settingspass123' } });
  assert.equal(relogin.status, 200);
  const restored = await admin('/api/bootstrap');
  assert.equal(restored.body.settings.siteName, 'Settings Verify');
  assert.equal(restored.body.groups.length, 4);
  assert.equal(restored.body.items.length, 12);
  const removedSystem = await guest('/api/system');
  assert.equal(removedSystem.status, 404);
});
