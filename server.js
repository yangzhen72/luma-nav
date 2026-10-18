'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3002);
const VERSION = '0.4.2';
const MAX_BODY = 2 * 1024 * 1024;
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(48).toString('base64url');
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
    return secret;
  }
}
const SESSION_SECRET = loadSecret();

function signSessionToken(token) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('base64url');
}

function createSessionToken() {
  const random = crypto.randomBytes(32).toString('base64url');
  return `${random}.${signSessionToken(random)}`;
}

function isValidSessionToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const actual = Buffer.from(signSessionToken(parts[0]));
  const expected = Buffer.from(parts[1]);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function uid(prefix = '') {
  return `${prefix}${crypto.randomBytes(9).toString('base64url')}`;
}

function isoNow() {
  return new Date().toISOString();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, passwordHash: hash };
}

function verifyPassword(password, user) {
  if (!user?.salt || !user?.passwordHash) return false;
  const actual = Buffer.from(hashPassword(password, user.salt).passwordHash, 'hex');
  const expected = Buffer.from(user.passwordHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

const DEFAULT_SETTINGS = {
  siteName: 'Luma Nav',
  siteSubtitle: '个人数字入口',
  greeting: '晚上好，欢迎回来',
  footerText: 'Luma Nav · 自托管导航中心',
  searchEngine: 'bing',
  customSearchUrl: 'https://www.google.com/search?q={q}',
  themeDefault: 'dark',
  wallpaper: 'aurora',
  accent: 'amber',
  cardStyle: 'glass',
  showClock: true,
  showSystem: true,
  requireLogin: true,
  startInLanMode: false,
  openInNewTab: true,
  publicOwnerId: 'u-admin',
  updatedAt: isoNow()
};

function seedDatabase() {
  const ownerId = 'u-admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const pass = hashPassword(adminPassword);
  const now = isoNow();
  return {
    version: 3,
    createdAt: now,
    updatedAt: now,
    settings: { ...DEFAULT_SETTINGS },
    users: [{
      id: 'u-admin',
      username: 'admin',
      displayName: '管理员',
      role: 'admin',
      enabled: true,
      ...pass,
      createdAt: now
    }],
    groups: [
      { id: 'g-common', ownerId, name: '常用服务', description: '每天都会打开的入口', color: 'amber', order: 0, createdAt: now },
      { id: 'g-ops', ownerId, name: '运维控制台', description: '监控、容器与基础设施', color: 'cyan', order: 1, createdAt: now },
      { id: 'g-ai', ownerId, name: 'AI 与效率', description: '让工作和灵感更快一步', color: 'violet', order: 2, createdAt: now },
      { id: 'g-life', ownerId, name: '影音生活', description: '家庭媒体与休闲内容', color: 'rose', order: 3, createdAt: now }
    ],
    items: [
      { id: 'i-homeassistant', ownerId, groupId: 'g-common', title: 'Home Assistant', description: '家庭自动化控制中心', icon: '⌂', iconUrl: '', url: 'https://www.home-assistant.io', lanUrl: 'http://homeassistant.local:8123', openMode: 'tab', order: 0, createdAt: now },
      { id: 'i-panel', ownerId, groupId: 'g-common', title: '1Panel', description: 'Linux 服务器运维面板', icon: '1', iconUrl: '', url: 'https://1panel.cn', lanUrl: 'http://192.168.1.10:8080', openMode: 'tab', order: 1, createdAt: now },
      { id: 'i-nextcloud', ownerId, groupId: 'g-common', title: 'Nextcloud', description: '私有云盘与协作空间', icon: '☁', iconUrl: '', url: 'https://nextcloud.com', lanUrl: 'http://192.168.1.10:8081', openMode: 'tab', order: 2, createdAt: now },
      { id: 'i-gitlab', ownerId, groupId: 'g-ops', title: 'GitLab', description: '代码托管与 CI/CD', icon: '◆', iconUrl: '', url: 'https://gitlab.com', lanUrl: 'http://192.168.1.10:8929', openMode: 'tab', order: 0, createdAt: now },
      { id: 'i-grafana', ownerId, groupId: 'g-ops', title: 'Grafana', description: '指标可视化与告警', icon: '◒', iconUrl: '', url: 'https://grafana.com', lanUrl: 'http://192.168.1.10:3000', openMode: 'tab', order: 1, createdAt: now },
      { id: 'i-uptime', ownerId, groupId: 'g-ops', title: 'Uptime Kuma', description: '服务可用性监测', icon: '↗', iconUrl: '', url: 'https://github.com/louislam/uptime-kuma', lanUrl: 'http://192.168.1.10:3001', openMode: 'tab', order: 2, createdAt: now },
      { id: 'i-portainer', ownerId, groupId: 'g-ops', title: 'Portainer', description: 'Docker 容器管理', icon: '▣', iconUrl: '', url: 'https://www.portainer.io', lanUrl: 'http://192.168.1.10:9443', openMode: 'tab', order: 3, createdAt: now },
      { id: 'i-chatgpt', ownerId, groupId: 'g-ai', title: 'ChatGPT', description: '通用 AI 助手', icon: '✦', iconUrl: '', url: 'https://chatgpt.com', lanUrl: '', openMode: 'tab', order: 0, createdAt: now },
      { id: 'i-claude', ownerId, groupId: 'g-ai', title: 'Claude', description: '长文本写作与分析', icon: '✺', iconUrl: '', url: 'https://claude.ai', lanUrl: '', openMode: 'tab', order: 1, createdAt: now },
      { id: 'i-notion', ownerId, groupId: 'g-ai', title: 'Notion', description: '知识库与团队文档', icon: 'N', iconUrl: '', url: 'https://www.notion.so', lanUrl: '', openMode: 'tab', order: 2, createdAt: now },
      { id: 'i-jellyfin', ownerId, groupId: 'g-life', title: 'Jellyfin', description: '家庭影音服务器', icon: '▶', iconUrl: '', url: 'https://jellyfin.org', lanUrl: 'http://192.168.1.10:8096', openMode: 'tab', order: 0, createdAt: now },
      { id: 'i-bilibili', ownerId, groupId: 'g-life', title: '哔哩哔哩', description: '视频与兴趣内容', icon: 'B', iconUrl: '', url: 'https://www.bilibili.com', lanUrl: '', openMode: 'tab', order: 1, createdAt: now }
    ]
  };
}

function normalizeDatabase(input) {
  const base = seedDatabase();
  if (!input || typeof input !== 'object') return base;

  const rawSettings = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const settings = { ...DEFAULT_SETTINGS };
  for (const [key, max] of Object.entries({ siteName: 40, siteSubtitle: 80, greeting: 80, footerText: 120 })) {
    if (rawSettings[key] !== undefined) settings[key] = cleanString(rawSettings[key], max);
  }
  for (const key of ['showClock', 'showSystem', 'requireLogin', 'startInLanMode', 'openInNewTab']) {
    if (rawSettings[key] !== undefined) settings[key] = Boolean(rawSettings[key]);
  }
  const choices = {
    searchEngine: ['google', 'bing', 'baidu', 'duckduckgo', 'custom'],
    themeDefault: ['dark', 'light', 'system'],
    wallpaper: ['aurora', 'ocean', 'sunset', 'forest', 'graphite', 'paper'],
    accent: ['amber', 'blue', 'cyan', 'green', 'violet', 'rose', 'slate'],
    cardStyle: ['glass', 'solid', 'outline']
  };
  for (const [key, allowed] of Object.entries(choices)) {
    if (allowed.includes(rawSettings[key])) settings[key] = rawSettings[key];
  }
  const customSearchUrl = cleanString(rawSettings.customSearchUrl, 1000);
  if (customSearchUrl.includes('{q}') && validUrl(customSearchUrl.replace('{q}', 'test'), false)) {
    settings.customSearchUrl = customSearchUrl;
  }

  const rawUsers = Array.isArray(input.users) ? input.users : [];
  const users = rawUsers.map((user) => ({
    id: String(user.id || uid('u-')),
    username: cleanString(user.username, 80),
    displayName: cleanString(user.displayName || user.username || '', 60),
    role: user.role === 'admin' ? 'admin' : 'user',
    enabled: user.enabled !== false,
    salt: String(user.salt || ''),
    passwordHash: String(user.passwordHash || ''),
    createdAt: user.createdAt || isoNow()
  })).filter((user) => user.username && /^[a-f0-9]{32}$/i.test(user.salt) && /^[a-f0-9]{128}$/i.test(user.passwordHash));
  const safeUsers = users.length ? users : base.users;
  const userIds = new Set(safeUsers.map((user) => user.id));
  const firstAdmin = safeUsers.find((user) => user.role === 'admin') || safeUsers[0];
  settings.publicOwnerId = userIds.has(rawSettings.publicOwnerId) ? rawSettings.publicOwnerId : firstAdmin.id;

  const rawGroups = Array.isArray(input.groups) ? input.groups : base.groups;
  const groups = rawGroups.map((group, index) => ({
    id: String(group.id || uid('g-')),
    ownerId: userIds.has(group.ownerId) ? group.ownerId : firstAdmin.id,
    name: cleanString(group.name || '未命名分组', 40),
    description: cleanString(group.description || '', 100),
    color: validColor(String(group.color || 'amber')),
    icon: validGroupIcon(group.icon || ''),
    order: Number.isFinite(Number(group.order)) ? Number(group.order) : index,
    createdAt: group.createdAt || isoNow()
  }));
  const groupOwners = new Map(groups.map((group) => [group.id, group.ownerId]));

  const rawItems = Array.isArray(input.items) ? input.items : base.items;
  const items = rawItems.map((item, index) => {
    const requestedGroup = String(item.groupId || '');
    const groupOwner = groupOwners.get(requestedGroup);
    const ownerId = groupOwner || (userIds.has(item.ownerId) ? item.ownerId : firstAdmin.id);
    return {
      id: String(item.id || uid('i-')),
      ownerId,
      groupId: groupOwner ? requestedGroup : '',
      title: cleanString(item.title || '未命名链接', 60),
      description: cleanString(item.description || '', 120),
      icon: cleanString(item.icon || '', 12),
      iconUrl: validIconUrl(item.iconUrl || '') || '',
      url: validUrl(item.url || '', true) || '',
      lanUrl: validUrl(item.lanUrl || '', true) || '',
      openMode: item.openMode === 'window' ? 'window' : 'tab',
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
      createdAt: item.createdAt || isoNow()
    };
  }).filter((item) => item.groupId);

  return {
    version: 3,
    createdAt: input.createdAt || base.createdAt,
    updatedAt: input.updatedAt || base.updatedAt,
    settings,
    users: safeUsers,
    groups,
    items
  };
}

let db;
try {
  db = normalizeDatabase(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
} catch {
  db = seedDatabase();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let saveChain = Promise.resolve();
function persist() {
  const payload = JSON.stringify(db, null, 2);
  saveChain = saveChain.then(async () => {
    const temp = `${DB_FILE}.${process.pid}.tmp`;
    await fsp.writeFile(temp, payload);
    await fsp.rename(temp, DB_FILE);
  });
  return saveChain;
}

const sessions = new Map();
const loginAttempts = new Map();

function pruneSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}
setInterval(pruneSessions, 60 * 60 * 1000).unref();

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function getSession(req) {
  const token = parseCookies(req.headers.cookie)[ 'nav_session'];
  if (!token || !isValidSessionToken(token)) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  const user = db.users.find((entry) => entry.id === session.userId);
  if (!user) return null;
  return { token, session, user };
}

function sessionCookie(token, maxAge = SESSION_MAX_AGE) {
  return `nav_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${COOKIE_SECURE ? '; Secure' : ''}`;
}

function send(res, status, body, contentType = 'application/json; charset=utf-8', extraHeaders = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...securityHeaders(),
    ...extraHeaders
  });
  res.end(payload);
}

function fail(res, status, message, code = 'ERROR') {
  send(res, status, { ok: false, error: message, code });
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https: http:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src https: http:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'"
  };
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('JSON 格式无效'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function cleanString(value, max = 200) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function validUrl(value, allowEmpty = true) {
  const text = cleanString(value, 1000);
  if (!text && allowEmpty) return '';
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function validIconUrl(value) {
  const text = cleanString(value, 500);
  if (!text) return '';
  if (/^\/uploads\/[a-zA-Z0-9._-]+$/.test(text)) return text;
  return validUrl(text, false);
}

function validColor(value) {
  const allowed = new Set(['amber', 'blue', 'cyan', 'green', 'violet', 'rose', 'slate']);
  const text = String(value || '').trim().toLowerCase();
  if (allowed.has(text)) return text;
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  return 'amber';
}

function validGroupIcon(value) {
  return cleanString(value || '', 12);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.host === req.headers.host;
  } catch {
    return false;
  }
}

function requireUser(req, res) {
  if (!sameOrigin(req)) {
    fail(res, 403, '来源校验失败', 'BAD_ORIGIN');
    return null;
  }
  const current = getSession(req);
  if (!current || current.user.enabled === false) {
    fail(res, 401, '请先登录', 'AUTH_REQUIRED');
    return null;
  }
  return current.user;
}

function requireAdmin(req, res) {
  if (!sameOrigin(req)) {
    fail(res, 403, '来源校验失败', 'BAD_ORIGIN');
    return null;
  }
  const current = getSession(req);
  if (!current || current.user.role !== 'admin' || current.user.enabled === false) {
    fail(res, 403, '需要管理员权限', 'ADMIN_REQUIRED');
    return null;
  }
  return current.user;
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function checkLoginRate(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, resetAt: now + 10 * 60 * 1000 };
  if (record.resetAt <= now) {
    record.count = 0;
    record.resetAt = now + 10 * 60 * 1000;
  }
  if (record.count >= 8) return { ok: false, retryAfter: Math.ceil((record.resetAt - now) / 1000) };
  loginAttempts.set(ip, record);
  return { ok: true, record };
}

function markLoginFailure(record) {
  record.count += 1;
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    role: user.role,
    enabled: user.enabled !== false,
    createdAt: user.createdAt
  };
}

function userNavigationCounts(userId) {
  return {
    groups: db.groups.filter((group) => group.ownerId === userId).length,
    items: db.items.filter((item) => item.ownerId === userId).length
  };
}

function publicBootstrap(user) {
  if (!user) {
      return {
        authRequired: true,
        settings: { ...db.settings },
        user: null,
        groups: [],
        items: [],
        ownerId: null,
        personal: false,
        canEdit: false,
      version: VERSION
    };
  }
  const ownerId = user.id;
  const groups = db.groups
    .filter((group) => group.ownerId === ownerId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'));
  const groupIds = new Set(groups.map((group) => group.id));
  const items = db.items
    .filter((item) => item.ownerId === ownerId && groupIds.has(item.groupId))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-CN'));
  return {
    authRequired: false,
    settings: { ...db.settings },
    user: publicUser(user),
    groups,
    items,
    ownerId,
    personal: true,
    canEdit: user.role === 'admin' || user.role === 'user',
    version: VERSION
  };
}

function createStarterNavigation(ownerId) {
  const now = isoNow();
  const groupId = uid('g-');
  db.groups.push({
    id: groupId,
    ownerId,
    name: '我的导航',
    description: '从这里开始整理常用服务',
    color: 'amber',
    order: 0,
    createdAt: now
  });
  return { groups: 1, items: 0 };
}

function cloneNavigation(sourceOwnerId, targetOwnerId) {
  const sourceGroups = db.groups.filter((group) => group.ownerId === sourceOwnerId).sort((a, b) => a.order - b.order);
  if (!sourceGroups.length) return createStarterNavigation(targetOwnerId);
  const now = isoNow();
  const groupMap = new Map();
  const clonedGroups = sourceGroups.map((group, index) => {
    const id = uid('g-');
    groupMap.set(group.id, id);
    return { ...group, id, ownerId: targetOwnerId, order: index, createdAt: now };
  });
  const sourceGroupIds = new Set(sourceGroups.map((group) => group.id));
  const clonedItems = db.items
    .filter((item) => item.ownerId === sourceOwnerId && sourceGroupIds.has(item.groupId))
    .sort((a, b) => a.order - b.order)
    .map((item) => ({ ...item, id: uid('i-'), ownerId: targetOwnerId, groupId: groupMap.get(item.groupId), createdAt: now }));
  db.groups.push(...clonedGroups);
  db.items.push(...clonedItems);
  return { groups: clonedGroups.length, items: clonedItems.length };
}

function removeUserNavigation(ownerId) {
  db.groups = db.groups.filter((group) => group.ownerId !== ownerId);
  db.items = db.items.filter((item) => item.ownerId !== ownerId);
}

function clearUserSessions(userId) {
  for (const [token, session] of sessions) {
    if (session.userId === userId) sessions.delete(token);
  }
}

function adminCount() {
  return db.users.filter((user) => user.role === 'admin' && user.enabled !== false).length;
}

let previousCpu = sampleCpu();
function sampleCpu() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const value of Object.values(cpu.times)) total += value;
    idle += cpu.times.idle;
  }
  return { idle, total };
}

function cpuUsage() {
  const current = sampleCpu();
  const idleDelta = current.idle - previousCpu.idle;
  const totalDelta = current.total - previousCpu.total;
  previousCpu = current;
  if (totalDelta <= 0) return 0;
  return Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
}

function systemMetrics() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  let disk = null;
  try {
    const stat = fs.statfsSync(DATA_DIR);
    const total = stat.blocks * stat.bsize;
    const free = stat.bavail * stat.bsize;
    disk = { total, free, used: total - free, percent: total ? ((total - free) / total) * 100 : 0 };
  } catch {
    disk = null;
  }
  return {
    cpu: { percent: cpuUsage(), cores: os.cpus().length },
    memory: { total: totalMem, free: freeMem, used: totalMem - freeMem, percent: totalMem ? ((totalMem - freeMem) / totalMem) * 100 : 0 },
    disk,
    load: os.loadavg(),
    uptime: os.uptime(),
    processUptime: process.uptime(),
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.arch()}`,
    node: process.version,
    timestamp: isoNow()
  };
}

function safeGroup(group) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    color: group.color,
    icon: group.icon || '',
    order: group.order,
    createdAt: group.createdAt
  };
}

function safeItem(item) {
  return {
    id: item.id,
    groupId: item.groupId,
    title: item.title,
    description: item.description,
    icon: item.icon,
    iconUrl: item.iconUrl,
    url: item.url,
    lanUrl: item.lanUrl,
    openMode: item.openMode,
    order: item.order,
    createdAt: item.createdAt
  };
}

function buildItem(body, user, existing = null) {
  const title = cleanString(body.title ?? existing?.title, 60);
  if (!title) return { error: '请填写链接名称' };
  const groupId = cleanString(body.groupId ?? existing?.groupId, 80);
  const group = db.groups.find((entry) => entry.id === groupId && entry.ownerId === user.id);
  if (!group) return { error: '分组不存在或不属于当前账号' };
  const url = validUrl(body.url ?? existing?.url ?? '', false);
  const lanUrl = validUrl(body.lanUrl ?? existing?.lanUrl ?? '', true);
  const iconUrl = validIconUrl(body.iconUrl ?? existing?.iconUrl ?? '');
  if (url === null) return { error: '访问地址必须是 http 或 https URL' };
  if (lanUrl === null) return { error: '内网地址必须是 http 或 https URL' };
  if (iconUrl === null) return { error: '图标地址无效' };
  return {
    id: existing?.id || uid('i-'),
    ownerId: user.id,
    groupId,
    title,
    description: cleanString(body.description ?? existing?.description, 120),
    icon: cleanString(body.icon ?? existing?.icon, 12),
    iconUrl,
    url,
    lanUrl,
    openMode: (body.openMode ?? existing?.openMode) === 'window' ? 'window' : 'tab',
    order: existing?.order ?? db.items.filter((item) => item.ownerId === user.id && item.groupId === groupId).length,
    createdAt: existing?.createdAt || isoNow()
  };
}

function normalizeOrder(values) {
  return [...values].sort((a, b) => a - b).map((value, index) => value === index ? value : index);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

async function serveStatic(req, res, pathname) {
  let relative = decodeURIComponent(pathname);
  if (relative === '/' || relative === '') relative = '/index.html';
  if (relative === '/admin') relative = '/index.html';
  const isUpload = relative.startsWith('/uploads/');
  const base = isUpload ? UPLOAD_DIR : PUBLIC_DIR;
  const cleanRelative = isUpload ? relative.slice('/uploads/'.length) : relative.replace(/^\/+/, '');
  const target = path.resolve(base, cleanRelative);
  if (!target.startsWith(path.resolve(base) + path.sep) && target !== path.resolve(base)) {
    return fail(res, 403, '禁止访问');
  }
  let stat;
  try {
    stat = await fsp.stat(target);
  } catch {
    if (!isUpload && !path.extname(relative) && !path.basename(relative).startsWith('.') && String(req.headers.accept || '').includes('text/html')) {
      return serveStatic(req, res, '/index.html');
    }
    return fail(res, 404, '页面不存在');
  }
  if (!stat.isFile()) return fail(res, 404, '页面不存在');
  const ext = path.extname(target).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const headers = {
    ...securityHeaders(),
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Cache-Control': ['.html', '.css', '.js', '.webmanifest'].includes(ext) ? 'no-cache' : 'public, max-age=3600'
  };
  if (isUpload) headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'";
  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    return res.end();
  }
  res.writeHead(200, headers);
  fs.createReadStream(target).pipe(res);
}

function ownGroup(user, id) {
  return db.groups.find((group) => group.id === id && group.ownerId === user.id) || null;
}

function ownItem(user, id) {
  return db.items.find((item) => item.id === id && item.ownerId === user.id) || null;
}

function ownGroups(user) {
  return db.groups.filter((group) => group.ownerId === user.id);
}

function ownItems(user) {
  return db.items.filter((item) => item.ownerId === user.id);
}

function normalizeUsername(value) {
  return cleanString(value, 80);
}

function validUsername(value) {
  return /^[\p{L}\p{N}_.@-]{3,40}$/u.test(value);
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  if (method === 'GET' && pathname === '/api/health') {
    return send(res, 200, { ok: true, name: 'Luma Nav', version: VERSION, time: isoNow() });
  }

  if (method === 'GET' && pathname === '/api/bootstrap') {
    const session = getSession(req);
    return send(res, 200, publicBootstrap(session?.user || null));
  }

  if (method === 'GET' && pathname === '/api/system') {
    const session = getSession(req);
    if (!db.settings.showSystem && !session?.user) return fail(res, 403, '系统状态未公开');
    return send(res, 200, { ok: true, metrics: systemMetrics() });
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    if (!sameOrigin(req)) return fail(res, 403, '来源校验失败', 'BAD_ORIGIN');
    const limit = checkLoginRate(req);
    if (!limit.ok) {
      return send(res, 429, { ok: false, error: '登录尝试过多，请稍后再试', retryAfter: limit.retryAfter }, 'application/json; charset=utf-8', { 'Retry-After': String(limit.retryAfter) });
    }
    const body = await readJson(req);
    const username = normalizeUsername(body.username);
    const password = String(body.password || '');
    const user = db.users.find((entry) => entry.username.toLowerCase() === username.toLowerCase());
    if (!user || user.enabled === false || !verifyPassword(password, user)) {
      markLoginFailure(limit.record);
      return fail(res, 401, '账号或密码错误', 'INVALID_CREDENTIALS');
    }
    loginAttempts.delete(clientIp(req));
    const token = createSessionToken();
    sessions.set(token, { userId: user.id, createdAt: Date.now(), expiresAt: Date.now() + SESSION_MAX_AGE * 1000 });
    return send(res, 200, { ok: true, user: publicUser(user) }, 'application/json; charset=utf-8', {
      'Set-Cookie': sessionCookie(token)
    });
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    if (!sameOrigin(req)) return fail(res, 403, '来源校验失败', 'BAD_ORIGIN');
    const current = getSession(req);
    if (current) sessions.delete(current.token);
    return send(res, 200, { ok: true }, 'application/json; charset=utf-8', {
      'Set-Cookie': sessionCookie('', 0)
    });
  }

  if (method === 'PUT' && pathname === '/api/auth/password') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    if (!verifyPassword(String(body.currentPassword || ''), user)) return fail(res, 400, '当前密码不正确');
    const password = String(body.newPassword || '');
    if (password.length < 8) return fail(res, 400, '新密码至少需要 8 位');
    Object.assign(user, hashPassword(password));
    db.updatedAt = isoNow();
    await persist();
    clearUserSessions(user.id);
    return send(res, 200, { ok: true, relogin: true });
  }

  if (method === 'PUT' && pathname === '/api/auth/profile') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const displayName = cleanString(body.displayName, 60);
    if (!displayName) return fail(res, 400, '请填写显示名称');
    user.displayName = displayName;
    db.updatedAt = isoNow();
    await persist();
    return send(res, 200, { ok: true, user: publicUser(user) });
  }

  if (method === 'PUT' && pathname === '/api/settings') {
    const user = requireAdmin(req, res);
    if (!user) return;
    const body = await readJson(req);
    const next = { ...db.settings };
    const stringFields = { siteName: 40, siteSubtitle: 80, greeting: 80, footerText: 120 };
    for (const [key, max] of Object.entries(stringFields)) {
      if (body[key] !== undefined) next[key] = cleanString(body[key], max);
    }
    const boolFields = ['showClock', 'showSystem', 'requireLogin', 'startInLanMode', 'openInNewTab'];
    for (const key of boolFields) {
      if (body[key] !== undefined) next[key] = Boolean(body[key]);
    }
    const allowed = {
      searchEngine: ['google', 'bing', 'baidu', 'duckduckgo', 'custom'],
      themeDefault: ['dark', 'light', 'system'],
      wallpaper: ['aurora', 'ocean', 'sunset', 'forest', 'graphite', 'paper'],
      accent: ['amber', 'blue', 'cyan', 'green', 'violet', 'rose', 'slate'],
      cardStyle: ['glass', 'solid', 'outline']
    };
    for (const [key, values] of Object.entries(allowed)) {
      if (body[key] !== undefined && values.includes(body[key])) next[key] = body[key];
    }
    if (body.customSearchUrl !== undefined) {
      const candidate = cleanString(body.customSearchUrl, 1000);
      const checked = validUrl(candidate.replace('{q}', 'test'), false);
      if (!checked || !candidate.includes('{q}')) return fail(res, 400, '自定义搜索地址必须包含 {q} 且为有效 URL');
      next.customSearchUrl = candidate;
    }
    next.updatedAt = isoNow();
    db.settings = { ...DEFAULT_SETTINGS, ...next };
    db.updatedAt = isoNow();
    await persist();
    return send(res, 200, { ok: true, settings: db.settings });
  }

  if (method === 'GET' && pathname === '/api/users') {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const users = db.users.map((user) => ({
      ...publicUser(user),
      navigation: userNavigationCounts(user.id),
      isCurrent: user.id === admin.id
    }));
    return send(res, 200, { ok: true, users });
  }

  if (method === 'POST' && pathname === '/api/users') {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const body = await readJson(req);
    const username = normalizeUsername(body.username);
    const displayName = cleanString(body.displayName || username, 60);
    const password = String(body.password || '');
    const role = body.role === 'admin' ? 'admin' : 'user';
    if (!validUsername(username)) return fail(res, 400, '用户名需为 3-40 位，可使用中文、字母、数字、点、下划线、@ 或 -');
    if (!displayName) return fail(res, 400, '请填写显示名称');
    if (password.length < 8) return fail(res, 400, '密码至少需要 8 位');
    if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) return fail(res, 409, '用户名已存在');
    const user = {
      id: uid('u-'),
      username,
      displayName,
      role,
      enabled: true,
      ...hashPassword(password),
      createdAt: isoNow()
    };
    db.users.push(user);
    const navigation = body.copyNavigation ? cloneNavigation(admin.id, user.id) : createStarterNavigation(user.id);
    db.updatedAt = isoNow();
    await persist();
    return send(res, 201, { ok: true, user: { ...publicUser(user), navigation } });
  }

  const userPasswordMatch = pathname.match(/^\/api\/users\/([^/]+)\/password$/);
  if (method === 'PUT' && userPasswordMatch) {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const target = db.users.find((user) => user.id === decodeURIComponent(userPasswordMatch[1]));
    if (!target) return fail(res, 404, '用户不存在');
    const body = await readJson(req);
    const password = String(body.password || '');
    if (password.length < 8) return fail(res, 400, '新密码至少需要 8 位');
    Object.assign(target, hashPassword(password));
    db.updatedAt = isoNow();
    await persist();
    clearUserSessions(target.id);
    return send(res, 200, { ok: true });
  }

  const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && (method === 'PUT' || method === 'DELETE')) {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const target = db.users.find((user) => user.id === decodeURIComponent(userMatch[1]));
    if (!target) return fail(res, 404, '用户不存在');
    if (method === 'DELETE') {
      if (target.id === admin.id) return fail(res, 400, '不能删除当前登录账号');
      if (target.role === 'admin' && adminCount() <= 1) return fail(res, 400, '至少需要保留一个管理员');
      db.users = db.users.filter((user) => user.id !== target.id);
      removeUserNavigation(target.id);
      if (db.settings.publicOwnerId === target.id) {
        db.settings.publicOwnerId = db.users.find((user) => user.role === 'admin')?.id || db.users[0].id;
      }
      db.updatedAt = isoNow();
      await persist();
      clearUserSessions(target.id);
      return send(res, 200, { ok: true });
    }
    const body = await readJson(req);
    const nextRole = body.role === 'admin' ? 'admin' : 'user';
    if (target.role === 'admin' && nextRole !== 'admin' && adminCount() <= 1) {
      return fail(res, 400, '至少需要保留一个管理员');
    }
    target.displayName = cleanString(body.displayName ?? target.displayName, 60) || target.displayName;
    target.role = nextRole;
    target.enabled = body.enabled === undefined ? target.enabled : Boolean(body.enabled);
    if (target.enabled === false) clearUserSessions(target.id);
    db.updatedAt = isoNow();
    await persist();
    return send(res, 200, { ok: true, user: publicUser(target) });
  }

  if (method === 'POST' && pathname === '/api/groups') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const name = cleanString(body.name, 40);
    if (!name) return fail(res, 400, '请填写分组名称');
    const group = {
      id: uid('g-'),
      ownerId: user.id,
      name,
      description: cleanString(body.description, 100),
      color: validColor(body.color),
      icon: validGroupIcon(body.icon),
      order: ownGroups(user).length,
      createdAt: isoNow()
    };
    db.groups.push(group);
    db.updatedAt = isoNow();
    await persist();
    return send(res, 201, { ok: true, group: safeGroup(group) });
  }

  if (method === 'PUT' && pathname === '/api/groups/reorder') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    const groups = ownGroups(user);
    const existing = new Set(groups.map((group) => group.id));
    if (ids.length !== groups.length || ids.some((id) => !existing.has(id))) return fail(res, 400, '分组排序数据不完整');
    ids.forEach((id, index) => {
      const group = groups.find((entry) => entry.id === id);
      group.order = index;
    });
    db.updatedAt = isoNow();
    await persist();
    return send(res, 200, { ok: true });
  }

  const groupMatch = pathname.match(/^\/api\/groups\/([^/]+)$/);
  if (groupMatch && (method === 'PUT' || method === 'DELETE')) {
    const user = requireUser(req, res);
    if (!user) return;
    const group = ownGroup(user, decodeURIComponent(groupMatch[1]));
    if (!group) return fail(res, 404, '分组不存在');
    if (method === 'DELETE') {
      db.groups = db.groups.filter((entry) => entry.id !== group.id);
      db.items = db.items.filter((entry) => !(entry.groupId === group.id && entry.ownerId === user.id));
      ownGroups(user).sort((a, b) => a.order - b.order).forEach((entry, index) => { entry.order = index; });
      db.updatedAt = isoNow();
      await persist();
      return send(res, 200, { ok: true });
    }
    const body = await readJson(req);
    const name = cleanString(body.name ?? group.name, 40);
    if (!name) return fail(res, 400, '请填写分组名称');
    group.name = name;
    group.description = cleanString(body.description ?? group.description, 100);
    group.color = validColor(body.color ?? group.color);
    group.icon = validGroupIcon(body.icon ?? group.icon);
    db.updatedAt = isoNow();
    await persist();
    return send(res, 200, { ok: true, group: safeGroup(group) });
  }

  if (method === 'POST' && pathname === '/api/items') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const item = buildItem(body, user);
    if (item.error) return fail(res, 400, item.error);
    item.order = db.items.filter((entry) => entry.ownerId === user.id && entry.groupId === item.groupId).length;
    db.items.push(item);
    db.updatedAt = isoNow();
    await persist();
    return send(res, 201, { ok: true, item: safeItem(item) });
  }

  if (method === 'PUT' && pathname === '/api/items/reorder') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const entries = Array.isArray(body.items) ? body.items : [];
    const groupIds = new Set(ownGroups(user).map((group) => group.id));
    for (const entry of entries) {
      const item = ownItem(user, String(entry.id));
      if (!item) continue;
      if (entry.groupId && groupIds.has(String(entry.groupId))) item.groupId = String(entry.groupId);
      if (Number.isFinite(Number(entry.order))) item.order = Number(entry.order);
    }
    const fallbackGroups = [...new Set(ownItems(user).map((item) => item.groupId))];
    for (const groupId of fallbackGroups) {
      ownItems(user).filter((item) => item.groupId === groupId)
        .sort((a, b) => a.order - b.order)
        .forEach((item, index) => { item.order = index; });
    }
    db.updatedAt = isoNow();
    await persist();
    return send(res, 200, { ok: true });
  }

  const itemMatch = pathname.match(/^\/api\/items\/([^/]+)$/);
  if (itemMatch && (method === 'PUT' || method === 'DELETE')) {
    const user = requireUser(req, res);
    if (!user) return;
    const item = ownItem(user, decodeURIComponent(itemMatch[1]));
    if (!item) return fail(res, 404, '链接不存在');
    if (method === 'DELETE') {
      db.items = db.items.filter((entry) => entry.id !== item.id);
      ownItems(user).filter((entry) => entry.groupId === item.groupId)
        .sort((a, b) => a.order - b.order)
        .forEach((entry, index) => { entry.order = index; });
      db.updatedAt = isoNow();
      await persist();
      return send(res, 200, { ok: true });
    }
    const body = await readJson(req);
    const updated = buildItem(body, user, item);
    if (updated.error) return fail(res, 400, updated.error);
    Object.assign(item, updated);
    db.updatedAt = isoNow();
    await persist();
    return send(res, 200, { ok: true, item: safeItem(item) });
  }

  if (method === 'GET' && pathname === '/api/backup') {
    const user = requireAdmin(req, res);
    if (!user) return;
    return send(res, 200, {
      ok: true,
      exportedAt: isoNow(),
      app: 'luma-nav',
      version: db.version,
      data: db
    }, 'application/json; charset=utf-8', {
      'Content-Disposition': `attachment; filename="luma-nav-backup-${new Date().toISOString().slice(0, 10)}.json"`
    });
  }

  if (method === 'POST' && pathname === '/api/restore') {
    const user = requireAdmin(req, res);
    if (!user) return;
    const body = await readJson(req);
    if (body.confirm !== 'RESTORE') return fail(res, 400, '缺少恢复确认');
    const source = body.data?.data || body.data;
    if (!source || !Array.isArray(source.groups) || !Array.isArray(source.items)) return fail(res, 400, '备份文件结构无效');
    const restored = normalizeDatabase(source);
    const hasAdmin = restored.users.some((entry) => entry.role === 'admin' && entry.salt && /^[a-f0-9]{128}$/i.test(entry.passwordHash));
    if (!hasAdmin) return fail(res, 400, '备份中缺少有效的管理员账号');
    db = restored;
    db.updatedAt = isoNow();
    await persist();
    sessions.clear();
    return send(res, 200, { ok: true, relogin: true });
  }

  if (method === 'POST' && pathname === '/api/import/bookmarks') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const incomingGroups = Array.isArray(body.groups) ? body.groups : [];
    if (!incomingGroups.length) return fail(res, 400, '没有可导入的书签分组');
    if (incomingGroups.length > 100) return fail(res, 400, '单次最多导入 100 个分组');
    const totalIncoming = incomingGroups.reduce((sum, group) => sum + (Array.isArray(group?.items) ? group.items.length : 0), 0);
    if (totalIncoming > 1500) return fail(res, 400, '单次最多导入 1500 个书签');

    const existingGroups = ownGroups(user);
    const seen = new Set();
    const groupsToAdd = [];
    const itemsToAdd = [];
    let skipped = 0;
    let order = existingGroups.length;

    for (const sourceGroup of incomingGroups) {
      const name = cleanString(sourceGroup?.name, 40);
      if (!name) {
        skipped += 1;
        continue;
      }
      const validItems = [];
      const rawItems = Array.isArray(sourceGroup?.items) ? sourceGroup.items : [];
      for (const sourceItem of rawItems) {
        const url = validUrl(sourceItem?.url, false);
        const title = cleanString(sourceItem?.title, 60);
        if (!url || !title) {
          skipped += 1;
          continue;
        }
        let dedupeKey = url;
        try {
          const parsed = new URL(url);
          parsed.hash = '';
          dedupeKey = parsed.toString();
        } catch {
          skipped += 1;
          continue;
        }
        if (seen.has(dedupeKey)) {
          skipped += 1;
          continue;
        }
        seen.add(dedupeKey);
        validItems.push({
          title,
          url,
          description: cleanString(sourceItem?.description, 120),
          icon: cleanString(sourceItem?.icon, 12),
          iconUrl: '',
          lanUrl: '',
          openMode: 'tab'
        });
      }
      if (!validItems.length) continue;
      const groupId = uid('g-');
      groupsToAdd.push({
        id: groupId,
        ownerId: user.id,
        name,
        description: cleanString(sourceGroup?.description || '从浏览器书签导入', 100),
        color: validColor(sourceGroup?.color),
        icon: validGroupIcon(sourceGroup?.icon || '📁'),
        order: order,
        createdAt: isoNow()
      });
      order += 1;
      validItems.forEach((item, index) => {
        itemsToAdd.push({
          id: uid('i-'),
          ownerId: user.id,
          groupId,
          ...item,
          order: index,
          createdAt: isoNow()
        });
      });
    }

    if (!groupsToAdd.length) return fail(res, 400, '没有找到可导入的有效书签');
    db.groups.push(...groupsToAdd);
    db.items.push(...itemsToAdd);
    db.updatedAt = isoNow();
    await persist();
    return send(res, 201, {
      ok: true,
      importedGroups: groupsToAdd.length,
      importedItems: itemsToAdd.length,
      skipped
    });
  }

  if (method === 'POST' && pathname === '/api/upload') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const match = String(body.dataUrl || '').match(/^data:(image\/(png|jpeg|webp|gif));base64,([a-zA-Z0-9+/=\s]+)$/);
    if (!match) return fail(res, 400, '仅支持 PNG、JPEG、WebP、GIF 图片');
    const mime = match[1];
    const extensionMap = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
    const buffer = Buffer.from(match[3].replace(/\s/g, ''), 'base64');
    if (!buffer.length || buffer.length > 1024 * 1024) return fail(res, 400, '图片大小需小于 1MB');
    const filename = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${extensionMap[mime]}`;
    await fsp.writeFile(path.join(UPLOAD_DIR, filename), buffer, { mode: 0o644 });
    return send(res, 200, { ok: true, url: `/uploads/${filename}` });
  }

  return fail(res, 404, '接口不存在', 'NOT_FOUND');
}

async function requestHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, securityHeaders());
    return res.end();
  }
  try {
    if (url.pathname.startsWith('/api/')) {
      if (!['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(req.method)) return fail(res, 405, '不支持的请求方法');
      return await handleApi(req, res, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, '不支持的请求方法');
    return await serveStatic(req, res, url.pathname);
  } catch (error) {
    if (!error.status) console.error(`[${new Date().toISOString()}]`, error);
    if (!res.headersSent) return fail(res, error.status || 500, error.status ? error.message : '服务器内部错误');
    res.destroy();
  }
}

function start() {
  const server = http.createServer(requestHandler);
  server.listen(PORT, HOST, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : PORT;
    console.log(`Luma Nav ${VERSION} listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${actualPort}`);
    console.log(`Data: ${DATA_DIR}`);
  });
  const shutdown = () => {
    server.close(() => {
      persist().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}

if (require.main === module) start();

module.exports = { start, requestHandler, hashPassword, verifyPassword, normalizeDatabase };


























