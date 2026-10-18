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
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-nav-test-'));
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      DATA_DIR: path.join(tempDir, 'data'),
      UPLOAD_DIR: path.join(tempDir, 'uploads'),
      SESSION_SECRET: 'test-session-secret',
      ADMIN_PASSWORD: 'testpass123'
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

test('private multi-user navigation flow', async () => {
  const guest = client();
  const admin = client();
  const alice = client();
  const bob = client();

  const health = await guest('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);

  const locked = await guest('/api/bootstrap');
  assert.equal(locked.status, 200);
  assert.equal(locked.body.authRequired, true);
  assert.equal(locked.body.user, null);
  assert.equal(locked.body.groups.length, 0);
  assert.equal(locked.body.items.length, 0);

  const guestImport = await guest('/api/import/bookmarks', { method: 'POST', body: { groups: [{ name: 'x', items: [{ title: 'x', url: 'https://example.com' }] }] } });
  assert.equal(guestImport.status, 401);

  const denied = await guest('/api/settings', { method: 'PUT', body: { siteName: 'Nope' } });
  assert.equal(denied.status, 403);

  const adminLogin = await admin('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'testpass123' } });
  assert.equal(adminLogin.status, 200);
  const adminBootstrap = await admin('/api/bootstrap');
  assert.equal(adminBootstrap.body.groups.length, 4);
  assert.equal(adminBootstrap.body.items.length, 12);

  const createAlice = await admin('/api/users', {
    method: 'POST',
    body: { username: 'alice', displayName: 'Alice', password: 'alicepass123', role: 'user', copyNavigation: false }
  });
  assert.equal(createAlice.status, 201);
  assert.equal(createAlice.body.user.navigation.groups, 1);

  const createBob = await admin('/api/users', {
    method: 'POST',
    body: { username: 'bob', displayName: 'Bob', password: 'bobpass123', role: 'user', copyNavigation: true }
  });
  assert.equal(createBob.status, 201);
  assert.equal(createBob.body.user.navigation.groups, 4);

  const aliceLogin = await alice('/api/auth/login', { method: 'POST', body: { username: 'alice', password: 'alicepass123' } });
  assert.equal(aliceLogin.status, 200);
  const aliceBootstrap = await alice('/api/bootstrap');
  assert.equal(aliceBootstrap.body.user.username, 'alice');
  assert.equal(aliceBootstrap.body.canEdit, true);
  assert.equal(aliceBootstrap.body.groups.length, 1);

  const aliceGroup = await alice('/api/groups', { method: 'POST', body: { name: 'Alice 私有分组', description: '仅自己可见', color: 'blue' } });
  assert.equal(aliceGroup.status, 201);
  const aliceItem = await alice('/api/items', {
    method: 'POST',
    body: { groupId: aliceGroup.body.group.id, title: 'Alice 服务', url: 'https://example.com/alice' }
  });
  assert.equal(aliceItem.status, 201);

  const imported = await alice('/api/import/bookmarks', {
    method: 'POST',
    body: {
      groups: [
        { name: '书签 / 媒体', icon: '🎬', color: '#ff3366', items: [
          { title: '媒体 A', url: 'https://example.com/a' },
          { title: '媒体 A 重复', url: 'https://example.com/a#section' }
        ] },
        { name: '书签 / 工具', icon: '🧰', color: 'cyan', items: [
          { title: '工具 B', url: 'https://example.com/b' },
          { title: '危险链接', url: 'javascript:alert(1)' }
        ] }
      ]
    }
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.importedGroups, 2);
  assert.equal(imported.body.importedItems, 2);

  const aliceWithImports = await alice('/api/bootstrap');
  assert.equal(aliceWithImports.body.groups.length, 4);
  assert.equal(aliceWithImports.body.items.length, 3);
  assert.ok(aliceWithImports.body.groups.some((group) => group.icon === '🎬' && group.color === '#ff3366'));
  const adminAfter = await admin('/api/bootstrap');
  assert.equal(adminAfter.body.groups.some((group) => group.name === 'Alice 私有分组'), false);
  assert.equal(adminAfter.body.items.some((item) => item.title === 'Alice 服务'), false);
  assert.equal(adminAfter.body.groups.some((group) => group.name === '书签 / 媒体'), false);

  const adminCannotEditAlice = await admin(`/api/groups/${aliceGroup.body.group.id}`, { method: 'PUT', body: { name: 'hijack' } });
  assert.equal(adminCannotEditAlice.status, 404);
  const aliceCannotDeleteAdmin = await alice('/api/groups/g-common', { method: 'DELETE' });
  assert.equal(aliceCannotDeleteAdmin.status, 404);
  const aliceCannotListUsers = await alice('/api/users');
  assert.equal(aliceCannotListUsers.status, 403);

  const bobLogin = await bob('/api/auth/login', { method: 'POST', body: { username: 'bob', password: 'bobpass123' } });
  assert.equal(bobLogin.status, 200);
  const bobBootstrap = await bob('/api/bootstrap');
  assert.equal(bobBootstrap.body.groups.length, 4);
  assert.equal(bobBootstrap.body.groups.some((group) => group.name === 'Alice 私有分组'), false);

  const bobRename = await bob(`/api/groups/${bobBootstrap.body.groups[0].id}`, { method: 'PUT', body: { name: 'Bob 的独立分组' } });
  assert.equal(bobRename.status, 200);
  const adminUnchanged = await admin('/api/bootstrap');
  assert.notEqual(adminUnchanged.body.groups[0].name, 'Bob 的独立分组');

  const listUsers = await admin('/api/users');
  assert.equal(listUsers.status, 200);
  assert.equal(listUsers.body.users.length, 3);
  const aliceSummary = listUsers.body.users.find((user) => user.username === 'alice').navigation;
  assert.equal(aliceSummary.items, 3);
  assert.equal(aliceSummary.groups, 4);

  const resetPassword = await admin(`/api/users/${createAlice.body.user.id}/password`, { method: 'PUT', body: { password: 'newalice123' } });
  assert.equal(resetPassword.status, 200);
  const aliceOldSession = await alice('/api/bootstrap');
  assert.equal(aliceOldSession.status, 200);
  assert.equal(aliceOldSession.body.authRequired, true);

  const aliceNewLogin = await alice('/api/auth/login', { method: 'POST', body: { username: 'alice', password: 'newalice123' } });
  assert.equal(aliceNewLogin.status, 200);

  const deleteAlice = await admin(`/api/users/${createAlice.body.user.id}`, { method: 'DELETE' });
  assert.equal(deleteAlice.status, 200);
  const finalUsers = await admin('/api/users');
  assert.equal(finalUsers.body.users.some((user) => user.username === 'alice'), false);
});





