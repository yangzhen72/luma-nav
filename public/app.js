'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const SVG = {
  arrow: '<svg viewBox="0 0 24 24"><path d="M7 17 17 7M8 7h9v9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="m14.5 5.5 4 4M5 19l3.4-.7L19 7.7a1.4 1.4 0 0 0 0-2l-.7-.7a1.4 1.4 0 0 0-2 0L5.7 15.6 5 19Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  grip: '<svg viewBox="0 0 24 24"><circle cx="8" cy="7" r="1.3" fill="currentColor"/><circle cx="16" cy="7" r="1.3" fill="currentColor"/><circle cx="8" cy="12" r="1.3" fill="currentColor"/><circle cx="16" cy="12" r="1.3" fill="currentColor"/><circle cx="8" cy="17" r="1.3" fill="currentColor"/><circle cx="16" cy="17" r="1.3" fill="currentColor"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
};
const ENGINES = {
  google: { label: 'Google', url: 'https://www.google.com/search?q={q}' },
  bing: { label: 'Bing', url: 'https://www.bing.com/search?q={q}' },
  baidu: { label: '百度', url: 'https://www.baidu.com/s?wd={q}' },
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={q}' }
};
const COLORS = new Set(['amber', 'blue', 'cyan', 'green', 'violet', 'rose', 'slate']);
const COLOR_HEX = {
  amber: '#f6b45c',
  blue: '#72a7ff',
  cyan: '#55d9d0',
  green: '#71d39c',
  violet: '#b49aff',
  rose: '#ff92b1',
  slate: '#b8c1cf'
};

const state = {
  settings: {},
  groups: [],
  items: [],
  user: null,
  authRequired: true,
  canEdit: false,
  personal: false,
  ownerId: null,
  version: '0.1.0',
  editMode: false,
  lanMode: null,
  searchResults: [],
  searchIndex: -1,
  clockTimer: null,
  updateInfo: null,
  bookmarkImportGroups: [],
  bookmarkImportKind: 'bookmarks'
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function getStored(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function setStored(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage may be disabled */ }
}

function removeStored(key) {
  try { localStorage.removeItem(key); } catch { /* storage may be disabled */ }
}

async function api(url, options = {}) {
  const init = { credentials: 'same-origin', ...options, headers: { ...(options.headers || {}) } };
  if (init.body && typeof init.body !== 'string' && !(init.body instanceof Blob)) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(init.body);
  }
  const response = await fetch(url, init);
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json().catch(() => ({})) : await response.text();
  if (!response.ok) {
    const error = new Error(payload?.error || `请求失败 (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function toast(message, type = 'success') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  $('#toastStack').append(item);
  setTimeout(() => {
    item.classList.add('leaving');
    setTimeout(() => item.remove(), 240);
  }, 3200);
}

function isAdmin() {
  return state.user?.role === 'admin';
}

function canEditNavigation() {
  return Boolean(state.user && state.canEdit);
}

function safeColor(value) {
  return COLORS.has(value) ? value : 'amber';
}

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || ''));
}

function safeGroupColor(value) {
  const text = String(value || '').trim().toLowerCase();
  if (COLORS.has(text) || isHexColor(text)) return text;
  return 'amber';
}

function groupColorHex(value) {
  const color = safeGroupColor(value);
  return isHexColor(color) ? color : (COLOR_HEX[color] || COLOR_HEX.amber);
}

function groupColorStyle(value) {
  const hex = groupColorHex(value);
  return `--group-color:${hex};--dot:${hex};--card-color:${hex};--card-tint:color-mix(in srgb, ${hex} 12%, transparent);--card-line:color-mix(in srgb, ${hex} 25%, transparent)`;
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function groupFor(item) {
  return state.groups.find((group) => group.id === item.groupId);
}

function itemUrl(item) {
  return state.lanMode && item.lanUrl ? item.lanUrl : item.url;
}

function hostLabel(url) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return '未设置地址'; }
}

function iconMarkup(item) {
  const iconUrl = item.iconUrl && (item.iconUrl.startsWith('/uploads/') ? item.iconUrl : safeExternalUrl(item.iconUrl));
  if (iconUrl) return `<img src="${escapeHtml(iconUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  const fallback = (item.title || '?').trim().charAt(0).toUpperCase();
  return `<span>${escapeHtml(item.icon || fallback)}</span>`;
}

function applyAppearance(useStored = true) {
  const settings = state.settings;
  let theme = useStored ? getStored('luma-theme') : null;
  if (!theme) theme = settings.themeDefault || 'dark';
  if (theme === 'system') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.body.dataset.theme = theme === 'light' ? 'light' : 'dark';
  document.body.dataset.wallpaper = settings.wallpaper || 'aurora';
  document.body.dataset.accent = safeColor(settings.accent);
  document.body.dataset.cardStyle = settings.cardStyle || 'glass';
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = document.body.dataset.theme === 'light' ? '#edf0f4' : '#0c1018';
}

function updateChrome() {
  const settings = state.settings;
  const admin = isAdmin();
  const currentUser = Boolean(state.user);
  const canEdit = canEditNavigation();
  document.title = `${settings.siteName || 'Luma Nav'} · ${settings.siteSubtitle || '个人数字入口'}`;
  $('#brandName').textContent = settings.siteName || 'Luma Nav';
  $('#greetingText').textContent = settings.greeting || '欢迎回来';
  $('#siteSubtitle').textContent = state.user
    ? `欢迎，${state.user.displayName || state.user.username}。这里是你独立维护的导航空间。`
    : '请登录后访问你的个人导航。';
  if ($('#footerText')) $('#footerText').textContent = settings.footerText || 'Luma Nav · 自托管导航中心';
  $('#versionLabel').textContent = state.version;
  $('#avatarText').textContent = (state.user?.displayName || state.user?.username || '访').charAt(0).toUpperCase();
  $('#loginButton').hidden = currentUser;
  $('#accountButton').hidden = !currentUser;
  $('#settingsButton').hidden = !admin;
  $('#versionButton').disabled = !admin;
  $('#logoutButton').hidden = !currentUser;
  $('#editButton').hidden = !canEdit;
  $('#addItemButton').hidden = !canEdit;
  $('#emptyAddButton').hidden = !canEdit;
  $('#importBookmarksButton').hidden = !canEdit;
  $('#manageGroupsButton').hidden = !canEdit;
  $('#addGroupButton').hidden = !(canEdit && state.editMode);
  $('#editButton').classList.toggle('is-active', state.editMode);
  $('#editButton span').textContent = state.editMode ? '完成编辑' : '编辑导航';
  document.body.classList.toggle('edit-mode', state.editMode);
  document.body.classList.toggle('auth-locked', !currentUser);
  $('#authGate').hidden = currentUser;
  const engine = settings.searchEngine === 'custom' ? { label: '自定义' } : (ENGINES[settings.searchEngine] || ENGINES.bing);
  $('#searchEngineLabel').textContent = engine.label;
  const date = new Date();
  $('#dateLabel').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(date);
  $('#clockLabel').hidden = !settings.showClock;
  updateNetworkControl();
}

function updateNetworkControl() {
  const control = $('.segmented-control');
  control.dataset.active = state.lanMode ? 'lan' : 'wan';
  $$('[data-network]', control).forEach((button) => button.classList.toggle('active', button.dataset.network === (state.lanMode ? 'lan' : 'wan')));
  const label = $('#networkLabel');
  if (label) label.textContent = navigator.onLine ? (state.lanMode ? '内网模式' : '公网模式') : '离线';
}

function renderSideNav() {
  const items = state.groups.map((group) => {
    const count = state.items.filter((item) => item.groupId === group.id).length;
    const iconMarkup = group.icon
      ? `<span class="nav-group-icon">${escapeHtml(group.icon)}</span>`
      : `<span class="nav-dot" data-dot="${safeColor(group.color)}"></span>`;
    return `<a class="side-link" href="#group-${escapeHtml(group.id)}" data-group-id="${escapeHtml(group.id)}" style="${escapeHtml(groupColorStyle(group.color))}">${iconMarkup}<span>${escapeHtml(group.name)}</span><span class="nav-count">${count}</span></a>`;
  }).join('');
  $('#sideNav').innerHTML = `<p class="nav-label">自定义分组</p>${items || '<p class="nav-label nav-empty-label">暂无分组</p>'}`;
  const mobileGroups = state.groups.slice(0, 4).map((group) => {
    const count = state.items.filter((item) => item.groupId === group.id).length;
    const iconMarkup = group.icon
      ? `<span class="nav-group-icon">${escapeHtml(group.icon)}</span>`
      : `<span class="nav-dot" data-dot="${safeColor(group.color)}">${count}</span>`;
    return `<a href="#group-${escapeHtml(group.id)}" data-group-id="${escapeHtml(group.id)}" style="${escapeHtml(groupColorStyle(group.color))}">${iconMarkup}<span>${escapeHtml(group.name.slice(0, 4))}</span></a>`;
  }).join('');
  $('#mobileNavItems').innerHTML = mobileGroups;
}

function cardMarkup(item, group) {
  const url = itemUrl(item);
  const host = hostLabel(url);
  const tag = item.openMode === 'window' ? '小窗' : (state.lanMode && item.lanUrl ? '内网' : '公网');
  return `<article class="nav-card" data-item-id="${escapeHtml(item.id)}" data-color="${safeColor(group?.color)}" style="${escapeHtml(groupColorStyle(group?.color))}" data-open-mode="${item.openMode}" tabindex="0" role="link" draggable="${state.editMode ? 'true' : 'false'}" aria-label="打开 ${escapeHtml(item.title)}">
    <div class="nav-icon">${iconMarkup(item)}</div>
    <div class="nav-card-body"><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.description || '常用服务入口')}</p></div>
    <span class="card-arrow" aria-hidden="true">${SVG.arrow}</span>
    <div class="nav-meta"><span class="meta-tag">${tag}</span><span class="meta-url">${escapeHtml(host)}</span></div>
    <div class="card-edit-tools">
      <button class="card-tool" type="button" data-action="edit-item" data-id="${escapeHtml(item.id)}" title="编辑">${SVG.edit}</button>
      <button class="card-tool" type="button" data-action="delete-item" data-id="${escapeHtml(item.id)}" title="删除">${SVG.trash}</button>
    </div>
  </article>`;
}

function renderGroups() {
  const root = $('#groupsRoot');
  const empty = $('#emptyState');
  $('#itemCount').textContent = `${state.items.length} 个入口`;
  if (!state.groups.length) {
    root.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = state.items.length > 0;
  root.innerHTML = state.groups.map((group) => {
    const groupItems = state.items.filter((item) => item.groupId === group.id).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-CN'));
    const cards = groupItems.map((item) => cardMarkup(item, group)).join('');
    return `<section class="group-section" id="group-${escapeHtml(group.id)}" data-group-id="${escapeHtml(group.id)}" data-color="${safeColor(group.color)}" style="${escapeHtml(groupColorStyle(group.color))}">
      <div class="group-head">
        <div class="group-title-wrap"><span class="group-symbol${group.icon ? ' has-icon' : ''}" aria-hidden="true">${escapeHtml(group.icon || '')}</span><h3>${escapeHtml(group.name)}</h3><p class="group-desc">${escapeHtml(group.description || '')}</p></div>
        <span class="group-count">${groupItems.length.toString().padStart(2, '0')}</span>
        <span class="group-line"></span>
        <div class="group-tools">
          <button type="button" class="drag-handle" data-drag-group="${escapeHtml(group.id)}" draggable="true" title="拖拽分组排序">${SVG.grip}</button>
          <button type="button" data-action="edit-group" data-id="${escapeHtml(group.id)}" title="编辑分组">${SVG.edit}</button>
          <button type="button" data-action="add-item-to-group" data-id="${escapeHtml(group.id)}" title="添加链接">${SVG.plus}</button>
        </div>
      </div>
      <div class="group-grid" data-group-id="${escapeHtml(group.id)}">${cards || (state.editMode ? '<div class="group-empty">拖动入口到这里，或点击右上角 + 添加</div>' : '')}</div>
    </section>`;
  }).join('');
}

function renderAll() {
  applyAppearance();
  updateChrome();
  renderSideNav();
  renderGroups();
}

async function loadData(options = {}) {
  const data = await api('/api/bootstrap');
  state.settings = data.settings || {};
  state.groups = data.groups || [];
  state.items = data.items || [];
  state.user = data.user || null;
  state.authRequired = Boolean(data.authRequired);
  state.canEdit = Boolean(data.canEdit);
  state.personal = Boolean(data.personal);
  state.ownerId = data.ownerId || null;
  if (!state.user) state.editMode = false;
  state.version = data.version || '0.1.0';
  if (state.lanMode === null) {
    const stored = getStored('luma-lan');
    state.lanMode = stored === null ? Boolean(state.settings.startInLanMode) : stored === '1';
  }
  const counts = new Map(state.groups.map((group) => [group.id, []]));
  state.items = state.items.map((item, index) => ({ ...item, order: Number.isFinite(Number(item.order)) ? Number(item.order) : index }));
  for (const item of state.items) if (!counts.has(item.groupId)) item.groupId = state.groups[0]?.id || '';
  renderAll();
  if (!options.silent) startClock();
}

function startClock() {
  if (state.clockTimer) clearInterval(state.clockTimer);
  const tick = () => {
    const now = new Date();
    $('#dateLabel').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(now);
    $('#clockLabel').textContent = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    $('#clockLabel').hidden = !state.settings.showClock;
  };
  tick();
  state.clockTimer = setInterval(tick, 15000);
}

function normalized(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN');
}

function findSearchResults(query) {
  const q = normalized(query);
  if (!q) return [];
  return state.items
    .map((item) => {
      const group = groupFor(item);
      const haystack = normalized([item.title, item.description, item.url, item.lanUrl, group?.name].join(' '));
      let score = 0;
      if (normalized(item.title).startsWith(q)) score += 10;
      else if (normalized(item.title).includes(q)) score += 7;
      if (normalized(group?.name).includes(q)) score += 3;
      if (haystack.includes(q)) score += 1;
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, 'zh-CN'))
    .slice(0, 8)
    .map((entry) => entry.item);
}

function renderSearchResults(query) {
  const panel = $('#searchResults');
  const results = findSearchResults(query);
  state.searchResults = results;
  state.searchIndex = results.length ? 0 : -1;
  if (!query.trim()) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }
  if (!results.length) {
    panel.innerHTML = '<div class="search-empty">没有匹配的导航入口，按回车使用搜索引擎</div>';
    panel.hidden = false;
    return;
  }
  panel.innerHTML = results.map((item, index) => {
    const group = groupFor(item);
    const icon = iconMarkup(item).replace(/^<img/, '<img');
    return `<button type="button" class="search-result${index === 0 ? ' active' : ''}" data-result-index="${index}">
      <span class="mini-icon">${icon}</span>
      <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(group?.name || '未分组')} · ${escapeHtml(hostLabel(itemUrl(item)))}</small></span>
      <span class="result-arrow">${SVG.arrow}</span>
    </button>`;
  }).join('');
  panel.hidden = false;
}

function refreshSearchSelection() {
  $$('.search-result').forEach((element, index) => element.classList.toggle('active', index === state.searchIndex));
  const active = $$('.search-result')[state.searchIndex];
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function openSearchItem(item) {
  $('#searchResults').hidden = true;
  $('#searchInput').value = '';
  openItem(item);
}

function searchUrl(query) {
  const engine = state.settings.searchEngine || 'bing';
  const template = engine === 'custom' ? state.settings.customSearchUrl : ENGINES[engine]?.url;
  if (!template) return '';
  return template.replace('{q}', encodeURIComponent(query));
}

function submitSearch() {
  const query = $('#searchInput').value.trim();
  if (!query) return;
  if (state.searchIndex >= 0 && state.searchResults[state.searchIndex]) {
    openSearchItem(state.searchResults[state.searchIndex]);
    return;
  }
  const url = searchUrl(query);
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

function openDialog(id) {
  const dialog = document.getElementById(id);
  if (!dialog) return;
  if (!dialog.open) dialog.showModal();
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog?.open) dialog.close();
}

function confirmAction(title, message) {
  const dialog = $('#confirmDialog');
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  dialog.returnValue = '';
  if (dialog.open) dialog.close();
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
  });
}

function openLogin() {
  $('#loginError').textContent = '';
  $('#loginForm').elements.namedItem('password').value = '';
  openDialog('loginDialog');
  setTimeout(() => $('#loginForm').elements.namedItem('username').focus(), 50);
}

async function performLogin(username, password, form, errorElement) {
  errorElement.textContent = '';
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  try {
    await api('/api/auth/login', { method: 'POST', body: { username, password } });
    closeDialog('loginDialog');
    await loadData();
    const name = state.user?.displayName || state.user?.username || username;
    toast(`欢迎回来，${name}`);
    form.reset();
    return true;
  } catch (err) {
    errorElement.textContent = err.message;
    return false;
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  await performLogin(
    form.elements.namedItem('username').value,
    form.elements.namedItem('password').value,
    form,
    $('#loginError')
  );
}

async function handleAuthGateLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  await performLogin(
    form.elements.namedItem('username').value,
    form.elements.namedItem('password').value,
    form,
    $('#authGateError')
  );
}

async function handleLogout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
    state.editMode = false;
    await loadData();
    toast('已退出登录');
    setTimeout(() => $('#authGateForm').elements.namedItem('username').focus(), 100);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openAccountDialog() {
  if (!state.user) return;
  const form = $('#accountForm');
  form.reset();
  form.elements.namedItem('username').value = state.user.username;
  form.elements.namedItem('displayName').value = state.user.displayName || state.user.username;
  $('#accountError').textContent = '';
  openDialog('accountDialog');
}

async function handleAccountSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = $('#accountError');
  error.textContent = '';
  const displayName = form.elements.namedItem('displayName').value.trim();
  const currentPassword = form.elements.namedItem('currentPassword').value;
  const newPassword = form.elements.namedItem('newPassword').value;
  if ((currentPassword && !newPassword) || (!currentPassword && newPassword)) {
    error.textContent = '修改密码时，请同时填写当前密码和新密码';
    return;
  }
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    await api('/api/auth/profile', { method: 'PUT', body: { displayName } });
    if (newPassword) {
      await api('/api/auth/password', { method: 'PUT', body: { currentPassword, newPassword } });
      closeDialog('accountDialog');
      toast('密码已修改，请重新登录');
      await loadData();
      return;
    }
    closeDialog('accountDialog');
    await loadData({ silent: true });
    toast('账户信息已保存');
  } catch (err) {
    error.textContent = err.message;
  } finally {
    submit.disabled = false;
  }
}

async function loadUsers() {
  if (!isAdmin()) return;
  const list = $('#usersList');
  try {
    const data = await api('/api/users');
    if (!data.users.length) {
      list.innerHTML = '<p class="form-hint">暂无用户。</p>';
      return;
    }
    list.innerHTML = data.users.map((user) => {
      const counts = user.navigation || { groups: 0, items: 0 };
      return `<article class="user-row" data-user-id="${escapeHtml(user.id)}">
        <div class="user-identity"><span class="user-avatar">${escapeHtml((user.displayName || user.username).charAt(0).toUpperCase())}</span><span><b>${escapeHtml(user.displayName || user.username)}</b><small>@${escapeHtml(user.username)} · ${counts.groups} 个分组 · ${counts.items} 个入口</small></span></div>
        <div class="user-actions">
          <select class="user-role" data-user-role="${escapeHtml(user.id)}" ${user.isCurrent ? 'disabled' : ''}><option value="user" ${user.role === 'user' ? 'selected' : ''}>普通用户</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>管理员</option></select>
          ${user.isCurrent ? '<span class="user-self-label">当前账号</span>' : `<button class="button button-quiet" type="button" data-user-password="${escapeHtml(user.id)}" data-user-name="${escapeHtml(user.displayName || user.username)}">重置密码</button><button class="button button-danger" type="button" data-user-delete="${escapeHtml(user.id)}">删除</button>`}
        </div>
      </article>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
  }
}

async function handleCreateUser() {
  const error = $('#userAdminError');
  error.textContent = '';
  const username = $('#newUserUsername').value.trim();
  const displayName = $('#newUserDisplayName').value.trim();
  const password = $('#newUserPassword').value;
  const role = $('#newUserRole').value;
  const copyNavigation = $('#newUserCopy').checked;
  const button = $('#createUserButton');
  button.disabled = true;
  try {
    await api('/api/users', { method: 'POST', body: { username, displayName, password, role, copyNavigation } });
    $('#newUserUsername').value = '';
    $('#newUserDisplayName').value = '';
    $('#newUserPassword').value = '';
    $('#newUserCopy').checked = false;
    await loadUsers();
    toast('用户已创建，可独立编辑自己的导航');
  } catch (err) {
    error.textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

async function updateUserRole(userId, role) {
  const row = document.querySelector(`[data-user-id="${CSS.escape(userId)}"]`);
  const displayName = row?.querySelector('b')?.textContent || '';
  try {
    await api(`/api/users/${encodeURIComponent(userId)}`, { method: 'PUT', body: { role, displayName } });
    await loadUsers();
    if (userId === state.user?.id) await loadData({ silent: true });
    toast('用户角色已更新');
  } catch (err) {
    toast(err.message, 'error');
    await loadUsers();
  }
}

function openPasswordDialog(userId, name) {
  const form = $('#passwordForm');
  form.reset();
  form.elements.namedItem('userId').value = userId;
  $('#passwordTarget').textContent = `为 ${name} 设置新密码。该用户的所有登录会话将失效。`;
  $('#passwordError').textContent = '';
  openDialog('passwordDialog');
  setTimeout(() => form.elements.namedItem('password').focus(), 50);
}

async function handlePasswordReset(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const userId = form.elements.namedItem('userId').value;
  const password = form.elements.namedItem('password').value;
  const error = $('#passwordError');
  error.textContent = '';
  try {
    await api(`/api/users/${encodeURIComponent(userId)}/password`, { method: 'PUT', body: { password } });
    closeDialog('passwordDialog');
    toast('用户密码已重置');
  } catch (err) {
    error.textContent = err.message;
  }
}

async function deleteUser(userId) {
  const row = document.querySelector(`[data-user-id="${CSS.escape(userId)}"]`);
  const name = row?.querySelector('b')?.textContent || '该用户';
  const confirmed = await confirmAction('删除用户', `确定删除“${name}”吗？该用户的全部个人导航数据也会被永久删除。`);
  if (!confirmed) return;
  try {
    await api(`/api/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
    await loadUsers();
    toast('用户及其导航已删除');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function fillSelect(select, selectedId) {
  select.innerHTML = state.groups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`).join('');
  if (selectedId && state.groups.some((group) => group.id === selectedId)) select.value = selectedId;
}

function updateIconPreview() {
  const form = $('#itemForm');
  const preview = $('#iconPreview');
  const icon = form.elements.namedItem('icon').value.trim();
  const rawUrl = form.elements.namedItem('iconUrl').value.trim();
  const iconUrl = rawUrl.startsWith('/uploads/') ? rawUrl : safeExternalUrl(rawUrl);
  if (iconUrl) {
    preview.innerHTML = `<img src="${escapeHtml(iconUrl)}" alt="">`;
  } else {
    preview.textContent = icon || form.elements.namedItem('title').value.trim().charAt(0).toUpperCase() || '✦';
  }
}

function openItemDialog(item = null, preferredGroupId = '') {
  if (!state.groups.length) {
    toast('请先创建一个分组', 'error');
    openGroupDialog();
    return;
  }
  const form = $('#itemForm');
  form.reset();
  fillSelect(form.elements.namedItem('groupId'), item?.groupId || preferredGroupId || state.groups[0]?.id);
  form.elements.namedItem('id').value = item?.id || '';
  form.elements.namedItem('title').value = item?.title || '';
  form.elements.namedItem('description').value = item?.description || '';
  form.elements.namedItem('url').value = item?.url || '';
  form.elements.namedItem('lanUrl').value = item?.lanUrl || '';
  form.elements.namedItem('icon').value = item?.icon || '';
  form.elements.namedItem('iconUrl').value = item?.iconUrl || '';
  form.elements.namedItem('openMode').value = item?.openMode || 'tab';
  $('#itemDialogTitle').textContent = item ? '编辑入口' : '添加入口';
  $('#itemError').textContent = '';
  updateIconPreview();
  openDialog('itemDialog');
  setTimeout(() => form.elements.namedItem('title').focus(), 50);
}

async function handleItemSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.elements.namedItem('id').value;
  const body = {
    groupId: form.elements.namedItem('groupId').value,
    title: form.elements.namedItem('title').value,
    description: form.elements.namedItem('description').value,
    icon: form.elements.namedItem('icon').value,
    iconUrl: form.elements.namedItem('iconUrl').value,
    url: form.elements.namedItem('url').value,
    lanUrl: form.elements.namedItem('lanUrl').value,
    openMode: form.elements.namedItem('openMode').value
  };
  const error = $('#itemError');
  error.textContent = '';
  try {
    await api(id ? `/api/items/${encodeURIComponent(id)}` : '/api/items', { method: id ? 'PUT' : 'POST', body });
    closeDialog('itemDialog');
    await loadData({ silent: true });
    toast(id ? '入口已更新' : '入口已添加');
  } catch (err) {
    error.textContent = err.message;
  }
}

function updateGroupDialogPreview() {
  const form = $('#groupForm');
  const name = form.elements.namedItem('name').value.trim();
  const icon = form.elements.namedItem('icon').value.trim();
  const selected = form.querySelector('input[name="color"]:checked')?.value || 'amber';
  const color = selected === 'custom' ? $('#groupColorPicker').value : selected;
  const hex = groupColorHex(color);
  $('#groupIconPreview').textContent = icon || '★';
  $('#groupPreviewName').textContent = name || '自定义分组';
  $('#groupDialogPreview').style.setProperty('--group-color', hex);
  $('#groupCustomSwatch').style.background = $('#groupColorPicker').value;
  $('#groupColorValue').textContent = $('#groupColorPicker').value;
}

function openGroupDialog(group = null) {
  if (document.getElementById('groupsDialog')?.open) closeDialog('groupsDialog');
  const form = $('#groupForm');
  form.reset();
  form.elements.namedItem('id').value = group?.id || '';
  form.elements.namedItem('name').value = group?.name || '';
  form.elements.namedItem('description').value = group?.description || '';
  form.elements.namedItem('icon').value = group?.icon || '';
  const color = safeGroupColor(group?.color || 'amber');
  const token = COLORS.has(color) ? color : 'custom';
  const radio = form.querySelector(`input[name="color"][value="${token}"]`);
  if (radio) radio.checked = true;
  const picker = $('#groupColorPicker');
  picker.value = groupColorHex(color);
  $('#groupCustomSwatch').style.background = picker.value;
  $('#groupDialogTitle').textContent = group ? '编辑自定义分组' : '新建自定义分组';
  $('#groupError').textContent = '';
  $('#deleteGroupButton').hidden = !group;
  updateGroupDialogPreview();
  openDialog('groupDialog');
  setTimeout(() => form.elements.namedItem('name').focus(), 50);
}

function renderGroupManager() {
  const list = $('#groupManagerList');
  if (!state.groups.length) {
    list.innerHTML = '<div class="group-manager-empty">还没有分组。创建第一个自定义分组开始整理入口。</div>';
    return;
  }
  list.innerHTML = state.groups.map((group, index) => {
    const count = state.items.filter((item) => item.groupId === group.id).length;
    return `<article class="group-manager-row" style="${escapeHtml(groupColorStyle(group.color))}">
      <span class="group-manager-icon">${escapeHtml(group.icon || '·')}</span>
      <span class="group-manager-copy"><b>${escapeHtml(group.name)}</b><small>${escapeHtml(group.description || '未填写说明')} · ${count} 个入口</small></span>
      <span class="group-manager-actions">
        <button type="button" class="card-tool" data-manager-action="up" data-id="${escapeHtml(group.id)}" title="上移" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="card-tool" data-manager-action="down" data-id="${escapeHtml(group.id)}" title="下移" ${index === state.groups.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="button button-quiet" data-manager-action="edit" data-id="${escapeHtml(group.id)}">编辑</button>
        <button type="button" class="button button-quiet" data-manager-action="add" data-id="${escapeHtml(group.id)}">添加入口</button>
        <button type="button" class="button button-danger" data-manager-action="delete" data-id="${escapeHtml(group.id)}">删除</button>
      </span>
    </article>`;
  }).join('');
}

function openGroupsManager() {
  renderGroupManager();
  openDialog('groupsDialog');
}

async function moveGroup(id, direction) {
  const index = state.groups.findIndex((group) => group.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.groups.length) return;
  [state.groups[index], state.groups[target]] = [state.groups[target], state.groups[index]];
  state.groups.forEach((group, order) => { group.order = order; });
  renderSideNav();
  renderGroups();
  renderGroupManager();
  await saveGroupOrder();
}

const BOOKMARK_ROOT_CONTAINERS = new Set([
  'bookmarks bar', 'bookmarks toolbar', 'bookmark bar', 'bookmarks', 'favorites bar',
  '书签栏', '书签工具栏', '收藏夹栏', '收藏夹', '其他书签', '其它书签', 'other bookmarks'
]);
const BOOKMARK_COLOR_CYCLE = ['blue', 'violet', 'cyan', 'green', 'rose', 'amber', 'slate'];

function bookmarkSafeName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function bookmarkIconForName(name) {
  const text = String(name || '').toLowerCase();
  if (/收藏|favorite|star/.test(text)) return '⭐';
  if (/工作|work|office|business|公司/.test(text)) return '💼';
  if (/开发|dev|code|github|gitlab|program|技术/.test(text)) return '💻';
  if (/影视|电影|剧集|媒体|video|movie|music|audio/.test(text)) return '🎬';
  if (/学习|阅读|read|book|study|doc|考试/.test(text)) return '📚';
  if (/工具|tool|utility|it/.test(text)) return '🧰';
  if (/游戏|game|play/.test(text)) return '🎮';
  if (/购物|shop|buy/.test(text)) return '🛍';
  if (/社交|social|chat|friend/.test(text)) return '💬';
  if (/ai|智能/.test(text)) return '🤖';
  if (/设备|nas|server|服务器/.test(text)) return '🖥';
  if (/求职|招聘|job/.test(text)) return '🧭';
  if (/其他|其它|other|misc|个人/.test(text)) return '📂';
  return '📁';
}

function normalizeSunPanelBaseUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function resolveSunPanelIcon(icon, baseUrl) {
  const text = String(icon?.text || '').trim().slice(0, 12);
  if (text) return { icon: text, iconUrl: '' };
  const src = String(icon?.src || '').trim();
  if (!src || src.startsWith('data:')) return { icon: '', iconUrl: '' };
  try {
    if (/^https?:\/\//i.test(src)) {
      const url = new URL(src);
      return { icon: '', iconUrl: url.toString() };
    }
    if (!baseUrl) return { icon: '', iconUrl: '' };
    return { icon: '', iconUrl: new URL(src, `${baseUrl}/`).toString() };
  } catch {
    return { icon: '', iconUrl: '' };
  }
}

function parseSunPanelJson(text, baseUrl = '') {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Sun-Panel 文件不是有效的 JSON');
  }
  if (!data || !Array.isArray(data.icons)) {
    throw new Error('没有找到 Sun-Panel 配置中的 icons 分组');
  }
  const isSunPanel = String(data.appName || '').toLowerCase().includes('sun-panel');
  if (!isSunPanel && !Array.isArray(data.icons)) {
    throw new Error('不是可识别的 Sun-Panel 配置');
  }
  const groups = [];
  let totalItems = 0;
  let skipped = 0;

  const sourceGroups = data.icons
    .map((group, index) => ({ group, index }))
    .sort((a, b) => (Number(a.group?.sort) || 0) - (Number(b.group?.sort) || 0) || a.index - b.index);

  for (const { group: sourceGroup } of sourceGroups) {
    const name = bookmarkSafeName(sourceGroup?.title);
    if (!name) {
      skipped += 1;
      continue;
    }
    const items = [];
    const seen = new Set();
    const children = Array.isArray(sourceGroup?.children) ? sourceGroup.children : [];
    const sortedChildren = children
      .map((item, index) => ({ item, index }))
      .sort((a, b) => (Number(a.item?.sort) || 0) - (Number(b.item?.sort) || 0) || a.index - b.index);

    for (const { item: sourceItem } of sortedChildren) {
      const title = String(sourceItem?.title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      let url = '';
      try {
        const parsed = new URL(sourceItem?.url || '');
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol');
        url = parsed.toString();
      } catch {
        skipped += 1;
        continue;
      }
      let lanUrl = '';
      if (sourceItem?.lanUrl) {
        try {
          const parsed = new URL(sourceItem.lanUrl);
          if (parsed.protocol === 'http:' || parsed.protocol === 'https:') lanUrl = parsed.toString();
        } catch { /* leave blank */ }
      }
      let dedupeKey = url;
      try {
        const parsed = new URL(url);
        parsed.hash = '';
        dedupeKey = parsed.toString();
      } catch { /* unreachable */ }
      if (seen.has(dedupeKey)) {
        skipped += 1;
        continue;
      }
      seen.add(dedupeKey);
      const icon = resolveSunPanelIcon(sourceItem?.icon, baseUrl);
      items.push({
        title: title || new URL(url).host.replace(/^www\./, ''),
        url,
        lanUrl,
        icon: icon.icon,
        iconUrl: icon.iconUrl,
        description: String(sourceItem?.description || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        openMode: Number(sourceItem?.openMethod) === 3 ? 'window' : 'tab'
      });
    }

    if (!items.length) continue;
    groups.push({
      name,
      description: `从 Sun-Panel 导入 · ${items.length} 个入口`,
      icon: bookmarkIconForName(name),
      color: BOOKMARK_COLOR_CYCLE[groups.length % BOOKMARK_COLOR_CYCLE.length],
      items
    });
    totalItems += items.length;
  }

  if (!groups.length) throw new Error('没有找到可导入的 Sun-Panel 入口');
  return { groups, totalItems, skipped, kind: 'sunpanel' };
}

function parseBookmarkHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const rootDl = doc.querySelector('dl');
  if (!rootDl) throw new Error('没有找到书签结构，请确认文件是浏览器导出的 HTML 书签');
  const groups = [];
  const byName = new Map();
  const seenUrls = new Set();
  let totalItems = 0;
  let skipped = 0;

  function ensureGroup(path) {
    const name = path.length ? path.join(' / ') : '导入的书签';
    const safeName = bookmarkSafeName(name);
    if (!byName.has(safeName)) {
      const group = {
        name: safeName,
        description: path.length ? '来自浏览器书签 · ' + path.join(' / ') : '浏览器书签中的未分类链接',
        icon: path.length ? bookmarkIconForName(path[path.length - 1]) : '🔖',
        color: BOOKMARK_COLOR_CYCLE[groups.length % BOOKMARK_COLOR_CYCLE.length],
        items: []
      };
      byName.set(safeName, group);
      groups.push(group);
    }
    return byName.get(safeName);
  }

  function addAnchors(anchors, path) {
    for (const anchor of anchors) {
      let url = '';
      try {
        const parsed = new URL(anchor.getAttribute('href') || '', 'https://invalid.local');
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          skipped += 1;
          continue;
        }
        url = parsed.toString();
      } catch {
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
      if (seenUrls.has(dedupeKey)) {
        skipped += 1;
        continue;
      }
      seenUrls.add(dedupeKey);
      const title = String(anchor.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
        || new URL(url).host.replace(/^www\./, '');
      const group = ensureGroup(path);
      group.items.push({ title, url, description: new URL(url).host.replace(/^www\./, '') });
      totalItems += 1;
    }
  }

  function directChildren(element, tag) {
    return [...element.children].filter((child) => child.tagName === tag);
  }

  function processDt(dt, path) {
    const headings = directChildren(dt, 'H3');
    const anchors = directChildren(dt, 'A');
    let nested = directChildren(dt, 'DL')[0] || null;
    let siblingNested = null;
    if (!nested && dt.nextElementSibling?.tagName === 'DL') {
      nested = dt.nextElementSibling;
      siblingNested = nested;
    }
    let nextPath = path;
    const heading = headings[0]?.textContent || '';
    if (heading) {
      const name = String(heading).replace(/\s+/g, ' ').trim();
      const rootContainer = path.length === 0 && BOOKMARK_ROOT_CONTAINERS.has(name.toLowerCase());
      nextPath = rootContainer ? [] : [...path, name];
    }
    if (anchors.length) addAnchors(anchors, nextPath);
    if (nested) processDl(nested, nextPath);
    return siblingNested;
  }

  function processDl(dl, path) {
    const children = [...dl.children];
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child.tagName !== 'DT') continue;
      const siblingNested = processDt(child, path);
      if (siblingNested) {
        const nestedIndex = children.indexOf(siblingNested);
        if (nestedIndex > index) index = nestedIndex;
      }
    }
  }

  processDl(rootDl, []);
  const validGroups = groups.filter((group) => group.items.length > 0);
  if (!validGroups.length) throw new Error('没有找到有效的 http/https 书签');
  if (validGroups.length > 100) throw new Error('书签分组超过 100 个，请先整理后再导入');
  if (totalItems > 1500) throw new Error('书签超过 1500 个，请分批导入');
  return { groups: validGroups, totalItems, skipped, kind: 'bookmarks' };
}

function parseImportText(text, fileName = '') {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('请选择文件或粘贴导入内容');
  const jsonLike = /\.json$/i.test(fileName) || trimmed.startsWith('{');
  if (jsonLike) {
    const base = normalizeSunPanelBaseUrl($('#sunPanelBaseUrl').value);
    if (base === null) throw new Error('Sun-Panel 原始地址必须是有效的 http/https URL');
    if (base) setStored('luma-sunpanel-base', base);
    return parseSunPanelJson(trimmed, base);
  }
  return parseBookmarkHtml(trimmed);
}

function openBookmarkImport() {
  if (!canEditNavigation()) return;
  if (document.getElementById('groupsDialog')?.open) closeDialog('groupsDialog');
  state.bookmarkImportGroups = [];
  state.bookmarkImportKind = 'bookmarks';
  $('#bookmarkPreview').hidden = true;
  $('#bookmarkGroupList').innerHTML = '';
  $('#bookmarkImportError').textContent = '';
  $('#bookmarkPaste').value = '';
  $('#bookmarkFile').value = '';
  $('#sunPanelBaseUrl').value = getStored('luma-sunpanel-base') || '';
  $('#importBookmarksConfirm').disabled = true;
  openDialog('bookmarkImportDialog');
}

function renderBookmarkPreview(parsed) {
  state.bookmarkImportGroups = parsed.groups;
  state.bookmarkImportKind = parsed.kind || 'bookmarks';
  const unit = parsed.kind === 'sunpanel' ? '入口' : '书签';
  const list = $('#bookmarkGroupList');
  list.innerHTML = parsed.groups.map((group, index) => {
    const color = groupColorHex(group.color);
    return `<label class="bookmark-group-row" style="--group-color:${escapeHtml(color)}">
      <input type="checkbox" data-bookmark-group="${index}" checked>
      <span class="bookmark-group-icon">${escapeHtml(group.icon || '📁')}</span>
      <span class="bookmark-group-copy"><b>${escapeHtml(group.name)}</b><small>${escapeHtml(group.description)} · ${group.items.length} 个${unit}</small></span>
      <span class="bookmark-group-count">${group.items.length}</span>
    </label>`;
  }).join('');
  $('#bookmarkSummary').textContent = `${parsed.groups.length} 个自定义分组`;
  $('#bookmarkSummaryDetail').textContent = `${parsed.totalItems} 个有效${unit}${parsed.skipped ? ` · 已跳过 ${parsed.skipped} 个无效或重复项` : ''}`;
  $('#bookmarkPreview').hidden = false;
  $('#bookmarkSelectAll').checked = true;
  updateBookmarkImportSelection();
}

function updateBookmarkImportSelection() {
  const boxes = $$('[data-bookmark-group]');
  const selected = boxes.filter((box) => box.checked);
  const count = selected.reduce((sum, box) => sum + (state.bookmarkImportGroups[Number(box.dataset.bookmarkGroup)]?.items.length || 0), 0);
  const unit = state.bookmarkImportKind === 'sunpanel' ? '入口' : '书签';
  $('#bookmarkSelectAll').checked = boxes.length > 0 && selected.length === boxes.length;
  $('#bookmarkSelectAll').indeterminate = selected.length > 0 && selected.length < boxes.length;
  $('#importBookmarksConfirm').disabled = selected.length === 0;
  $('#importBookmarksConfirm').textContent = selected.length ? `导入 ${count} 个${unit}` : '请选择分组';
}

async function handleBookmarkFile(file) {
  if (!file) return;
  const error = $('#bookmarkImportError');
  error.textContent = '';
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('导入文件不能超过 5MB');
    const parsed = parseImportText(await file.text(), file.name);
    renderBookmarkPreview(parsed);
  } catch (err) {
    state.bookmarkImportGroups = [];
    $('#bookmarkPreview').hidden = true;
    error.textContent = err.message;
  }
}

function parseBookmarkPaste() {
  const error = $('#bookmarkImportError');
  error.textContent = '';
  try {
    renderBookmarkPreview(parseImportText($('#bookmarkPaste').value));
  } catch (err) {
    state.bookmarkImportGroups = [];
    $('#bookmarkPreview').hidden = true;
    error.textContent = err.message;
  }
}

async function confirmBookmarkImport() {
  const error = $('#bookmarkImportError');
  error.textContent = '';
  const selected = $$('[data-bookmark-group]')
    .filter((box) => box.checked)
    .map((box) => state.bookmarkImportGroups[Number(box.dataset.bookmarkGroup)])
    .filter(Boolean)
    .map((group) => ({
      name: group.name,
      description: group.description,
      icon: group.icon,
      color: group.color,
      items: group.items
    }));
  if (!selected.length) {
    error.textContent = '请至少选择一个分组';
    return;
  }
  const button = $('#importBookmarksConfirm');
  button.disabled = true;
  try {
    const result = await api('/api/import/navigation', { method: 'POST', body: { groups: selected } });
    const unit = state.bookmarkImportKind === 'sunpanel' ? '入口' : '书签';
    closeDialog('bookmarkImportDialog');
    await loadData({ silent: true });
    toast(`已导入 ${result.importedItems} 个${unit}到 ${result.importedGroups} 个分组`);
  } catch (err) {
    error.textContent = err.message;
    button.disabled = false;
  }
}

async function handleGroupSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.elements.namedItem('id').value;
  const selected = form.querySelector('input[name="color"]:checked')?.value || 'amber';
  const body = {
    name: form.elements.namedItem('name').value,
    description: form.elements.namedItem('description').value,
    icon: form.elements.namedItem('icon').value,
    color: selected === 'custom' ? $('#groupColorPicker').value : selected
  };
  const error = $('#groupError');
  error.textContent = '';
  try {
    await api(id ? `/api/groups/${encodeURIComponent(id)}` : '/api/groups', { method: id ? 'PUT' : 'POST', body });
    closeDialog('groupDialog');
    await loadData({ silent: true });
    toast(id ? '自定义分组已更新' : '自定义分组已创建');
  } catch (err) {
    error.textContent = err.message;
  }
}

async function deleteGroup(id) {
  const group = state.groups.find((entry) => entry.id === id);
  if (!group) return;
  const count = state.items.filter((item) => item.groupId === id).length;
  const confirmed = await confirmAction('删除分组', `确定删除“${group.name}”吗？${count ? `分组内的 ${count} 个入口也会被删除。` : ''}`);
  if (!confirmed) return;
  try {
    await api(`/api/groups/${encodeURIComponent(id)}`, { method: 'DELETE' });
    closeDialog('groupDialog');
    await loadData({ silent: true });
    if (document.getElementById('groupsDialog')?.open) renderGroupManager();
    toast('分组已删除');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteItem(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  const confirmed = await confirmAction('删除入口', `确定删除“${item.title}”吗？此操作无法撤销。`);
  if (!confirmed) return;
  try {
    await api(`/api/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadData({ silent: true });
    toast('入口已删除');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderUpdateMeta(info) {
  const deployment = info.deployment || {};
  $('#updateMeta').innerHTML = `
    <div class="update-meta-item"><span>运行环境</span><b>${escapeHtml(deployment.label || '-')}</b></div>
    <div class="update-meta-item"><span>Node.js</span><b>${escapeHtml(deployment.node || '-')}</b></div>
    <div class="update-meta-item"><span>数据规模</span><b>${info.counts?.users || 0} 用户 · ${info.counts?.groups || 0} 分组 · ${info.counts?.items || 0} 入口</b></div>`;
  $('#updateGuideNote').textContent = deployment.note || '更新前建议先导出备份，更新完成后重启服务。';
  $('#updateCommands').textContent = (deployment.updateCommands || []).join('\n') || '-';
}

function renderChangelog(entries) {
  const root = $('#changelogList');
  if (!entries?.length) {
    root.innerHTML = '<p class="form-hint">没有找到版本记录。</p>';
    return;
  }
  root.innerHTML = entries.map((entry, index) => `
    <details class="changelog-entry" ${index === 0 ? 'open' : ''}>
      <summary>v${escapeHtml(entry.version)}<span>${escapeHtml(entry.date || '')}</span></summary>
      <div class="changelog-body">
        ${entry.sections.map((section) => `<div class="changelog-section"><b>${escapeHtml(section.title)}</b><ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`).join('')}
      </div>
    </details>`).join('');
}

function renderUpdateCheck(state, error = '') {
  const result = $('#updateResult');
  const badge = $('#updateBadge');
  badge.classList.remove('available', 'error', 'pending');
  if (error) {
    badge.textContent = '检查失败';
    badge.classList.add('error');
    result.className = 'update-result error';
    result.innerHTML = `<div class="update-result-head"><b>无法检查更新</b><span>${escapeHtml(state?.checkedAt || '')}</span></div><p>${escapeHtml(error)}</p>`;
    result.hidden = false;
    $('#versionButton').classList.remove('has-update');
    return;
  }
  if (!state?.checkedAt) {
    badge.textContent = '尚未检查';
    badge.classList.add('pending');
    result.hidden = true;
    return;
  }
  if (state.updateAvailable) {
    badge.textContent = '发现新版本';
    badge.classList.add('available');
    $('#versionButton').classList.add('has-update');
  } else {
    badge.textContent = '已是最新';
    $('#versionButton').classList.remove('has-update');
  }
  result.className = `update-result${state.updateAvailable ? ' available' : ''}`;
  result.innerHTML = `
    <div class="update-result-head"><b>${state.updateAvailable ? `可更新到 v${escapeHtml(state.latestVersion)}` : '当前已是最新版本'}</b><span>${escapeHtml(state.checkedAt || '')}</span></div>
    <p>当前版本 v${escapeHtml(state.currentVersion || state.currentVersion || '')} · 最新版本 v${escapeHtml(state.latestVersion || '')}${state.releasedAt ? ` · ${escapeHtml(state.releasedAt)}` : ''}</p>
    ${state.notes?.length ? `<ul>${state.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>` : ''}
    ${state.releaseUrl && safeExternalUrl(state.releaseUrl) ? `<p style="margin-top:8px"><a href="${escapeHtml(state.releaseUrl)}" target="_blank" rel="noopener noreferrer">查看发布页面</a></p>` : ''}`;
  result.hidden = false;
}

async function loadUpdateCenter(forceCheck = false) {
  if (!isAdmin()) return;
  $('#updateCurrentHint').textContent = '正在读取版本信息…';
  try {
    const info = await api('/api/update');
    state.updateInfo = info;
    $('#updateCurrentVersion').textContent = info.currentVersion;
    $('#updateCurrentHint').textContent = `${info.deployment?.label || ''} · 数据目录 ${info.deployment?.dataDir || ''}`;
    $('#updateFeedHint').textContent = info.feed?.configured
      ? `更新源：${info.feed.urlHost || '已配置'}${info.feed.tokenConfigured ? ' · 已启用访问令牌' : ''}`
      : '尚未配置更新源。设置 UPDATE_FEED_URL 后可在界面中检查新版本。';
    renderUpdateMeta(info);
    renderChangelog(info.changelog);
    renderUpdateCheck(info.lastCheck, info.lastCheck?.error || '');
    if (forceCheck && info.feed?.configured) await checkForUpdate();
  } catch (err) {
    $('#updateCurrentHint').textContent = '无法读取版本信息';
    $('#updateResult').hidden = false;
    $('#updateResult').className = 'update-result error';
    $('#updateResult').innerHTML = `<p>${escapeHtml(err.message)}</p>`;
  }
}

async function checkForUpdate() {
  const button = $('#checkUpdateButton');
  const hint = $('#updateFeedHint');
  button.disabled = true;
  const original = button.textContent;
  button.textContent = '检查中…';
  hint.textContent = '正在连接更新源…';
  try {
    const result = await api('/api/update/check', { method: 'POST' });
    renderUpdateCheck({ ...result, checkedAt: result.checkedAt || new Date().toISOString() });
    hint.textContent = result.updateAvailable ? `发现新版本 v${result.latestVersion}` : '当前版本已是最新';
  } catch (err) {
    const last = err.payload?.lastCheck || {};
    renderUpdateCheck({ ...last, currentVersion: last.currentVersion || state.updateInfo?.currentVersion }, err.message);
    hint.textContent = '更新检查失败，请确认更新源配置。';
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function copyUpdateCommands() {
  const text = $('#updateCommands').textContent;
  try {
    await navigator.clipboard.writeText(text);
    toast('更新命令已复制');
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    toast('更新命令已复制');
  }
}

function openUpdateCenter() {
  if (!isAdmin()) return;
  fillSettingsForm();
  openDialog('settingsDialog');
  selectSettingsTab('update');
}

function fillSettingsForm() {
  const form = $('#settingsForm');
  form.reset();
  const settings = state.settings;
  for (const name of ['siteName', 'siteSubtitle', 'greeting', 'searchEngine', 'customSearchUrl', 'themeDefault', 'wallpaper', 'accent', 'cardStyle']) {
    const field = form.elements.namedItem(name);
    if (field && settings[name] !== undefined) field.value = settings[name];
  }
  for (const name of ['showClock', 'startInLanMode', 'openInNewTab']) {
    const field = form.elements.namedItem(name);
    if (field) field.checked = Boolean(settings[name]);
  }
  $('#settingsError').textContent = '';
}

function openSettings() {
  fillSettingsForm();
  selectSettingsTab('general');
  openDialog('settingsDialog');
}

function selectSettingsTab(name) {
  $$('[data-settings-tab]').forEach((button) => button.classList.toggle('active', button.dataset.settingsTab === name));
  $$('[data-settings-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.settingsPanel === name));
  if (name === 'users') loadUsers();
  if (name === 'update') loadUpdateCenter();
}

async function handleSettingsSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = $('#settingsError');
  error.textContent = '';
  const value = (name) => form.elements.namedItem(name)?.value ?? '';
  const checked = (name) => Boolean(form.elements.namedItem(name)?.checked);
  const body = {
    siteName: value('siteName'),
    siteSubtitle: value('siteSubtitle'),
    greeting: value('greeting'),
    searchEngine: value('searchEngine'),
    customSearchUrl: value('customSearchUrl'),
    themeDefault: value('themeDefault'),
    wallpaper: value('wallpaper'),
    accent: value('accent'),
    cardStyle: value('cardStyle'),
    showClock: checked('showClock'),
    startInLanMode: checked('startInLanMode'),
    openInNewTab: checked('openInNewTab'),
    requireLogin: true
  };
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    await api('/api/settings', { method: 'PUT', body });
    if (body.themeDefault === 'system') removeStored('luma-theme');
    else setStored('luma-theme', body.themeDefault);
    closeDialog('settingsDialog');
    await loadData();
    toast('系统设置已保存');
  } catch (err) {
    error.textContent = err.message;
  } finally {
    submit.disabled = false;
  }
}

async function exportBackup() {
  try {
    const response = await fetch('/api/backup', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('导出失败');
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `luma-nav-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast('备份文件已下载');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function restoreBackup(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const confirmed = await confirmAction('恢复备份', '恢复后将覆盖当前全部分组、入口、设置和管理员账号，并需要重新登录。确定继续吗？');
    if (!confirmed) return;
    await api('/api/restore', { method: 'POST', body: { confirm: 'RESTORE', data: parsed } });
    toast('备份已恢复，正在重新加载');
    setTimeout(() => location.reload(), 700);
  } catch (err) {
    toast(err instanceof SyntaxError ? '备份文件不是有效 JSON' : err.message, 'error');
  }
}

async function uploadIcon(file) {
  if (!file) return;
  if (file.size > 1024 * 1024) {
    $('#itemError').textContent = '图片大小需小于 1MB';
    return;
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  try {
    const result = await api('/api/upload', { method: 'POST', body: { dataUrl } });
    $('#itemForm').elements.namedItem('iconUrl').value = result.url;
    updateIconPreview();
    toast('图标已上传');
  } catch (err) {
    $('#itemError').textContent = err.message;
  }
}

function openItem(item) {
  const url = itemUrl(item);
  if (!url) {
    toast('这个入口还没有设置访问地址', 'error');
    return;
  }
  if (item.openMode === 'window') {
    $('#previewTitle').textContent = item.title;
    $('#previewOpenExternal').href = url;
    $('#previewLoading').hidden = false;
    $('#previewFrame').src = 'about:blank';
    openDialog('previewDialog');
    setTimeout(() => { $('#previewFrame').src = url; }, 80);
    setTimeout(() => { $('#previewLoading').hidden = true; }, 6500);
    return;
  }
  if (state.settings.openInNewTab === false) {
    location.href = url;
    return;
  }
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) toast('浏览器拦截了弹窗，请允许此站点打开新窗口', 'error');
}

function toggleEditMode() {
  if (!canEditNavigation()) return;
  state.editMode = !state.editMode;
  updateChrome();
  renderGroups();
  toast(state.editMode ? '编辑模式已开启，可拖拽排序' : '编辑模式已关闭');
}

function setNetworkMode(lan) {
  state.lanMode = Boolean(lan);
  setStored('luma-lan', state.lanMode ? '1' : '0');
  updateNetworkControl();
  renderGroups();
}

function toggleTheme() {
  const next = document.body.dataset.theme === 'light' ? 'dark' : 'light';
  setStored('luma-theme', next);
  document.body.dataset.theme = next;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = next === 'light' ? '#edf0f4' : '#0c1018';
}

function closeMobileSidebar() {
  document.body.classList.remove('sidebar-open');
  $('#mobileOverlay').hidden = true;
  $('#mobileMenuButton').setAttribute('aria-expanded', 'false');
}

function openMobileSidebar() {
  document.body.classList.add('sidebar-open');
  $('#mobileOverlay').hidden = false;
  $('#mobileMenuButton').setAttribute('aria-expanded', 'true');
}

async function saveItemOrder() {
  const payload = [...state.items]
    .sort((a, b) => {
      const groupA = state.groups.findIndex((group) => group.id === a.groupId);
      const groupB = state.groups.findIndex((group) => group.id === b.groupId);
      return groupA - groupB || a.order - b.order;
    })
    .map((item, index) => ({ id: item.id, groupId: item.groupId, order: item.order ?? index }));
  try {
    await api('/api/items/reorder', { method: 'PUT', body: { items: payload } });
    toast('排序已保存');
  } catch (err) {
    toast(err.message, 'error');
    await loadData({ silent: true });
  }
}

async function saveGroupOrder() {
  try {
    await api('/api/groups/reorder', { method: 'PUT', body: { ids: state.groups.map((group) => group.id) } });
    toast('分组顺序已保存');
  } catch (err) {
    toast(err.message, 'error');
    await loadData({ silent: true });
  }
}

function clearDragStyles() {
  $$('.dragging, .drop-target').forEach((element) => element.classList.remove('dragging', 'drop-target'));
}

let draggedItemId = null;
let draggedGroupId = null;

function bindEvents() {
  $('#loginButton').addEventListener('click', openLogin);
  $('#authGateForm').addEventListener('submit', handleAuthGateLogin);
  $('#avatarButton').addEventListener('click', () => isAdmin() ? openSettings() : openAccountDialog());
  $('#loginForm').addEventListener('submit', handleLogin);
  $('#accountButton').addEventListener('click', openAccountDialog);
  $('#accountForm').addEventListener('submit', handleAccountSubmit);
  $('#createUserButton').addEventListener('click', handleCreateUser);
  $('#passwordForm').addEventListener('submit', handlePasswordReset);
  $('#usersList').addEventListener('change', (event) => {
    const select = event.target.closest('[data-user-role]');
    if (select) updateUserRole(select.dataset.userRole, select.value);
  });
  $('#usersList').addEventListener('click', (event) => {
    const passwordButton = event.target.closest('[data-user-password]');
    if (passwordButton) openPasswordDialog(passwordButton.dataset.userPassword, passwordButton.dataset.userName);
    const deleteButton = event.target.closest('[data-user-delete]');
    if (deleteButton) deleteUser(deleteButton.dataset.userDelete);
  });
  $('#logoutButton').addEventListener('click', handleLogout);
  $('#settingsButton').addEventListener('click', openSettings);
  $('#editButton').addEventListener('click', toggleEditMode);
  $('#addItemButton').addEventListener('click', () => openItemDialog());
  $('#emptyAddButton').addEventListener('click', () => openItemDialog());
  $('#addGroupButton').addEventListener('click', () => openGroupDialog());
  $('#versionButton').addEventListener('click', openUpdateCenter);
  $('#checkUpdateButton').addEventListener('click', checkForUpdate);
  $('#updateBackupButton').addEventListener('click', exportBackup);
  $('#copyUpdateCommands').addEventListener('click', copyUpdateCommands);
  $('#manageGroupsButton').addEventListener('click', openGroupsManager);
  $('#importBookmarksButton').addEventListener('click', openBookmarkImport);
  $('#managerImportBookmarksButton').addEventListener('click', openBookmarkImport);
  $('#bookmarkFile').addEventListener('change', async (event) => {
    await handleBookmarkFile(event.target.files?.[0]);
    event.target.value = '';
  });
  $('#parseBookmarkPasteButton').addEventListener('click', parseBookmarkPaste);
  $('#bookmarkGroupList').addEventListener('change', updateBookmarkImportSelection);
  $('#bookmarkSelectAll').addEventListener('change', (event) => {
    $$('[data-bookmark-group]').forEach((box) => { box.checked = event.target.checked; });
    updateBookmarkImportSelection();
  });
  $('#importBookmarksConfirm').addEventListener('click', confirmBookmarkImport);
  const bookmarkDrop = $('#bookmarkDrop');
  for (const eventName of ['dragenter', 'dragover']) {
    bookmarkDrop.addEventListener(eventName, (event) => {
      event.preventDefault();
      bookmarkDrop.classList.add('is-dragging');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    bookmarkDrop.addEventListener(eventName, (event) => {
      event.preventDefault();
      bookmarkDrop.classList.remove('is-dragging');
    });
  }
  bookmarkDrop.addEventListener('drop', (event) => handleBookmarkFile(event.dataTransfer?.files?.[0]));
  $('#managerAddGroupButton').addEventListener('click', () => openGroupDialog());
  $('#groupManagerList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-manager-action]');
    if (!button) return;
    const id = button.dataset.id;
    const action = button.dataset.managerAction;
    if (action === 'up') moveGroup(id, -1);
    if (action === 'down') moveGroup(id, 1);
    if (action === 'edit') openGroupDialog(state.groups.find((group) => group.id === id));
    if (action === 'add') {
      closeDialog('groupsDialog');
      openItemDialog(null, id);
    }
    if (action === 'delete') deleteGroup(id);
  });
  $('#themeButton').addEventListener('click', toggleTheme);
  $('#mobileThemeButton').addEventListener('click', toggleTheme);
  $('#itemForm').addEventListener('submit', handleItemSubmit);
  $('#groupForm').addEventListener('submit', handleGroupSubmit);
  $('#settingsForm').addEventListener('submit', handleSettingsSubmit);
  $('#deleteGroupButton').addEventListener('click', () => deleteGroup($('#groupForm').elements.namedItem('id').value));
  $('#exportButton').addEventListener('click', exportBackup);
  $('#restoreFile').addEventListener('change', (event) => {
    restoreBackup(event.target.files?.[0]);
    event.target.value = '';
  });
  $('#iconUpload').addEventListener('change', (event) => {
    uploadIcon(event.target.files?.[0]);
    event.target.value = '';
  });
  for (const name of ['icon', 'iconUrl', 'title']) {
    $('#itemForm').elements.namedItem(name).addEventListener('input', updateIconPreview);
  }
  for (const name of ['name', 'icon']) {
    $('#groupForm').elements.namedItem(name).addEventListener('input', updateGroupDialogPreview);
  }
  $('#groupColorPicker').addEventListener('input', () => {
    const customRadio = $('#groupForm').querySelector('input[name="color"][value="custom"]');
    if (customRadio) customRadio.checked = true;
    updateGroupDialogPreview();
  });
  $('#groupForm').querySelectorAll('input[name="color"]').forEach((radio) => {
    radio.addEventListener('change', updateGroupDialogPreview);
  });
  $('#previewFrame').addEventListener('load', () => { $('#previewLoading').hidden = true; });
  $('#previewDialog').addEventListener('close', () => { $('#previewFrame').src = 'about:blank'; });

  $$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => closeDialog(button.dataset.closeDialog)));
  $$('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
  $$('[data-settings-tab]').forEach((button) => button.addEventListener('click', () => selectSettingsTab(button.dataset.settingsTab)));
  $$('[data-network]').forEach((button) => button.addEventListener('click', () => setNetworkMode(button.dataset.network === 'lan')));

  $('#mobileMenuButton').addEventListener('click', () => {
    if (document.body.classList.contains('sidebar-open')) closeMobileSidebar();
    else openMobileSidebar();
  });
  $('#mobileOverlay').addEventListener('click', closeMobileSidebar);
  $('#sideNav').addEventListener('click', (event) => {
    if (event.target.closest('a')) closeMobileSidebar();
  });
  $('#mobileNavItems').addEventListener('click', (event) => {
    if (event.target.closest('a')) closeMobileSidebar();
  });

  const searchInput = $('#searchInput');
  searchInput.addEventListener('input', () => renderSearchResults(searchInput.value));
  searchInput.addEventListener('focus', () => { if (searchInput.value.trim()) renderSearchResults(searchInput.value); });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!state.searchResults.length) return;
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      state.searchIndex = (state.searchIndex + direction + state.searchResults.length) % state.searchResults.length;
      refreshSearchSelection();
    } else if (event.key === 'Escape') {
      $('#searchResults').hidden = true;
      searchInput.blur();
    } else if (event.key === 'Enter' && state.searchIndex >= 0) {
      event.preventDefault();
      submitSearch();
    }
  });
  $('#searchForm').addEventListener('submit', (event) => {
    event.preventDefault();
    submitSearch();
  });
  $('#searchResults').addEventListener('click', (event) => {
    const button = event.target.closest('[data-result-index]');
    if (!button) return;
    const item = state.searchResults[Number(button.dataset.resultIndex)];
    if (item) openSearchItem(item);
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.search-form')) $('#searchResults').hidden = true;
  });

  document.addEventListener('keydown', (event) => {
    const tag = event.target.tagName;
    const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target.isContentEditable;
    if (event.key === '/' && !editing) {
      event.preventDefault();
      $('#searchInput').focus();
      $('#searchInput').select();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      $('#searchInput').focus();
      $('#searchInput').select();
    }
  });

  $('#groupsRoot').addEventListener('click', (event) => {
    const actionButton = event.target.closest('[data-action]');
    if (actionButton) {
      event.stopPropagation();
      const { action, id } = actionButton.dataset;
      if (action === 'edit-item') openItemDialog(state.items.find((item) => item.id === id));
      if (action === 'delete-item') deleteItem(id);
      if (action === 'edit-group') openGroupDialog(state.groups.find((group) => group.id === id));
      if (action === 'add-item-to-group') openItemDialog(null, id);
      return;
    }
    const card = event.target.closest('.nav-card');
    if (!card || state.editMode) return;
    const item = state.items.find((entry) => entry.id === card.dataset.itemId);
    if (item) openItem(item);
  });

  $('#groupsRoot').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('[data-action]') || state.editMode) return;
    const card = event.target.closest('.nav-card');
    if (!card) return;
    event.preventDefault();
    const item = state.items.find((entry) => entry.id === card.dataset.itemId);
    if (item) openItem(item);
  });

  $('#groupsRoot').addEventListener('dragstart', (event) => {
    const handle = event.target.closest('[data-drag-group]');
    if (handle && state.editMode) {
      draggedGroupId = handle.dataset.dragGroup;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedGroupId);
      handle.closest('.group-section')?.classList.add('dragging');
      return;
    }
    const card = event.target.closest('.nav-card');
    if (card && state.editMode) {
      draggedItemId = card.dataset.itemId;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedItemId);
      card.classList.add('dragging');
    }
  });

  $('#groupsRoot').addEventListener('dragover', (event) => {
    if (draggedItemId) {
      const grid = event.target.closest('.group-grid');
      if (!grid) return;
      event.preventDefault();
      $$('.group-grid.drop-target').forEach((element) => element.classList.remove('drop-target'));
      grid.classList.add('drop-target');
      const card = event.target.closest('.nav-card');
      $$('.nav-card.drop-target').forEach((element) => element.classList.remove('drop-target'));
      if (card && card.dataset.itemId !== draggedItemId) card.classList.add('drop-target');
    } else if (draggedGroupId) {
      const section = event.target.closest('.group-section');
      if (!section || section.dataset.groupId === draggedGroupId) return;
      event.preventDefault();
    }
  });

  $('#groupsRoot').addEventListener('dragleave', (event) => {
    const grid = event.target.closest('.group-grid');
    if (grid && !grid.contains(event.relatedTarget)) grid.classList.remove('drop-target');
    const card = event.target.closest('.nav-card');
    if (card && !card.contains(event.relatedTarget)) card.classList.remove('drop-target');
  });

  $('#groupsRoot').addEventListener('drop', async (event) => {
    if (draggedItemId) {
      const grid = event.target.closest('.group-grid');
      if (!grid) return;
      event.preventDefault();
      const item = state.items.find((entry) => entry.id === draggedItemId);
      const targetCard = event.target.closest('.nav-card');
      if (!item) return;
      if (targetCard?.dataset.itemId === item.id) return;
      const oldGroupId = item.groupId;
      const newGroupId = grid.dataset.groupId;
      item.groupId = newGroupId;
      const targetItems = state.items
        .filter((entry) => entry.groupId === newGroupId && entry.id !== item.id)
        .sort((a, b) => a.order - b.order);
      const targetIndex = targetCard ? targetItems.findIndex((entry) => entry.id === targetCard.dataset.itemId) : -1;
      if (targetIndex >= 0) targetItems.splice(targetIndex, 0, item);
      else targetItems.push(item);
      targetItems.forEach((entry, index) => { entry.order = index; });
      if (oldGroupId !== newGroupId) {
        state.items.filter((entry) => entry.groupId === oldGroupId)
          .sort((a, b) => a.order - b.order)
          .forEach((entry, index) => { entry.order = index; });
      }
      draggedItemId = null;
      clearDragStyles();
      renderGroups();
      renderSideNav();
      await saveItemOrder();
      return;
    }
    if (draggedGroupId) {
      const targetSection = event.target.closest('.group-section');
      if (!targetSection) return;
      event.preventDefault();
      const sourceIndex = state.groups.findIndex((group) => group.id === draggedGroupId);
      const targetId = targetSection.dataset.groupId;
      if (sourceIndex < 0 || targetId === draggedGroupId) return;
      const [moved] = state.groups.splice(sourceIndex, 1);
      const targetIndex = state.groups.findIndex((group) => group.id === targetId);
      state.groups.splice(targetIndex < 0 ? state.groups.length : targetIndex, 0, moved);
      state.groups.forEach((group, index) => { group.order = index; });
      draggedGroupId = null;
      clearDragStyles();
      renderSideNav();
      renderGroups();
      await saveGroupOrder();
    }
  });

  $('#groupsRoot').addEventListener('dragend', () => {
    draggedItemId = null;
    draggedGroupId = null;
    clearDragStyles();
  });

  window.addEventListener('online', updateNetworkControl);
  window.addEventListener('offline', updateNetworkControl);
}

async function init() {
  bindEvents();
  try {
    await loadData();
    if (state.authRequired && !state.user) setTimeout(() => document.getElementById('authGateForm').elements.namedItem('username').focus(), 150);
  } catch (err) {
    toast(err.message || '初始化失败', 'error');
    $('#groupsRoot').innerHTML = '<div class="empty-state"><div class="empty-mark">!</div><h2>无法加载导航数据</h2><p>请检查服务是否正常运行。</p></div>';
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || refreshing) return;
      refreshing = true;
      location.reload();
    });
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch(() => {});
  }
}

init();
























