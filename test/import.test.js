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
      body: type.includes('application/json') ? await response.json() : await response.text()
    };
  };
}

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-nav-import-'));
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      DATA_DIR: path.join(tempDir, 'data'),
      UPLOAD_DIR: path.join(tempDir, 'uploads'),
      SESSION_SECRET: 'import-test-secret',
      ADMIN_PASSWORD: 'importpass123'
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

test('Sun-Panel compatible navigation import', async () => {
  const guest = client();
  const admin = client();

  const denied = await guest('/api/import/navigation', {
    method: 'POST',
    body: { groups: [{ name: 'x', items: [{ title: 'x', url: 'https://example.com' }] }] }
  });
  assert.equal(denied.status, 401);

  const login = await admin('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'importpass123' } });
  assert.equal(login.status, 200);

  const imported = await admin('/api/import/navigation', {
    method: 'POST',
    body: {
      groups: [
        {
          name: 'Sun / 个人',
          description: '从 Sun-Panel 导入',
          icon: '📂',
          color: 'blue',
          items: [
            {
              title: '入口 A',
              url: 'https://example.com/a',
              lanUrl: 'http://192.168.1.10:8080',
              iconUrl: 'https://sun-panel.example.com/uploads/a.ico',
              openMode: 'window'
            },
            { title: '入口 A 重复', url: 'https://example.com/a#hash' },
            { title: '入口 B', url: 'https://example.com/b' },
            { title: '危险链接', url: 'javascript:alert(1)' }
          ]
        },
        {
          name: 'Sun / 工具',
          icon: '🧰',
          color: 'cyan',
          items: [
            { title: '入口 A 其他分组', url: 'https://example.com/a' }
          ]
        }
      ]
    }
  });

  assert.equal(imported.status, 201);
  assert.equal(imported.body.importedGroups, 2);
  assert.equal(imported.body.importedItems, 3);
  assert.equal(imported.body.skipped, 2);

  const bootstrap = await admin('/api/bootstrap');
  const itemA = bootstrap.body.items.find((item) => item.title === '入口 A');
  assert.equal(itemA.iconUrl, 'https://sun-panel.example.com/uploads/a.ico');
  assert.equal(itemA.lanUrl, 'http://192.168.1.10:8080/');
  assert.equal(itemA.openMode, 'window');
  assert.equal(bootstrap.body.items.filter((item) => item.url === 'https://example.com/a').length, 2);
  assert.equal(bootstrap.body.groups.length, 6);
  assert.equal(bootstrap.body.items.length, 15);
});
