# Luma Nav

一个面向 NAS、家庭服务器和小型团队的私有导航中心。未登录时不展示任何导航内容；每个账号登录后拥有完全独立的个人导航，可自行管理分组和链接。

## 版本与更新日志

当前版本：`0.4.1`。完整版本历史与每个版本的具体改动见 [CHANGELOG.md](CHANGELOG.md)。发布新版本时，必须同步更新版本号、前端静态资源版本和更新日志。

## 核心特性

- **强制登录**：未登录只显示登录页，API 不返回用户或导航数据。
- **个人导航隔离**：每个用户拥有独立分组、链接、排序和图标。
- **用户管理**：管理员可创建、删除用户，调整角色，重置密码，并选择新用户的初始导航。
- **导航编辑**：新增、编辑、删除、拖拽排序分组和入口。
- **自定义分组模式**：每个分组可自定义名称、说明、Emoji/图标、任意十六进制颜色和顺序；独立“管理分组”面板无需进入编辑模式即可维护。
- **浏览器书签导入**：导入 Chrome、Edge、Firefox 等浏览器导出的 HTML 书签，自动将文件夹转换为自定义分组，支持预览、去重和无效链接过滤。
- **双地址切换**：公网与内网地址一键切换。
- **搜索**：入口实时搜索，回退至 Bing、Google、百度、DuckDuckGo 或自定义搜索。
- **图标**：文字、Emoji、图片 URL、本地图片上传。
- **打开方式**：新标签页、当前窗口、页面内小窗口。
- **系统概览**：CPU、内存、磁盘和运行时间。
- **个性化**：深浅主题、6 套背景、7 种强调色、3 种卡片风格。
- **备份恢复**：管理员可导出/恢复全部用户、导航和设置。
- **轻量部署**：Node.js 单进程，无第三方运行时依赖，无外部数据库。

## 权限模型

| 能力 | 普通用户 | 管理员 |
| --- | --- | --- |
| 查看自己的导航 | 是 | 是 |
| 编辑自己的导航 | 是 | 是 |
| 查看其他用户导航 | 否 | 否 |
| 修改自己的显示名称/密码 | 是 | 是 |
| 系统设置 | 否 | 是 |
| 创建/删除用户、重置密码 | 否 | 是 |
| 备份恢复 | 否 | 是 |

管理员与其他用户一样，只能编辑自己的导航。管理员身份不会获得读取其他用户导航的接口权限。

## 快速开始

环境要求：Node.js 20 或更高版本。无需 `npm install`。

```bash
npm start
```

打开 <http://localhost:3002>。

首次启动默认账号：

- 用户名：`admin`
- 密码：`admin123`

登录后请立即打开“账户与密码”修改密码。

开发模式：

```bash
npm run dev
```

自动化验收：

```bash
npm test
```

## 创建用户

1. 管理员登录。
2. 打开“系统设置 → 用户管理”。
3. 填写用户名、显示名称、初始密码和角色。
4. 可选择“复制当前管理员的导航”作为初始内容；复制后的数据与原导航完全独立。
5. 创建后把用户名和初始密码交给对应用户。

用户登录后会自动获得自己的导航空间。若用户没有任何分组，可使用“管理分组 → 新建自定义分组”开始整理。

## 导入浏览器书签

浏览器导出书签：

- Chrome：打开 `chrome://bookmarks` → 右上角菜单 → 导出书签
- Edge：打开 `edge://favorites` → 更多操作 → 导出收藏夹
- Firefox：书签管理器 → 导入和备份 → 导出书签到 HTML

然后：

1. 登录任意拥有编辑权限的账号。
2. 点击“导入书签”。
3. 选择书签 HTML 文件，或展开“粘贴书签 HTML”直接粘贴内容。
4. 检查自动生成的分组和书签数量，可取消不需要的分组。
5. 点击“导入 N 个书签”。

导入规则：

- 每个书签文件夹转换为一个自定义分组。
- 嵌套文件夹使用 `父级 / 子级` 作为分组名称。
- “书签栏”“收藏夹”“其他书签”等浏览器根容器会被展开，不单独建组。
- 文件夹外的零散书签放入“导入的书签”分组。
- 只接受 http/https 地址，无效链接和同批重复链接会自动跳过。
- 单次最多导入 100 个分组、1500 个书签。
- 导入只影响当前登录账号的个人导航，不修改浏览器原数据。

## Docker 部署

修改 `docker-compose.yml` 中的 `SESSION_SECRET` 和 `ADMIN_PASSWORD`，然后：

```bash
docker compose up -d --build
```

持久化目录：

- `./data`：JSON 数据库和会话签名密钥
- `./uploads`：上传的图标

`ADMIN_PASSWORD` 只在数据库第一次初始化时生效。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `3002` | 监听端口 |
| `DATA_DIR` | `./data` | 数据库与会话密钥目录 |
| `UPLOAD_DIR` | `./uploads` | 图标上传目录 |
| `ADMIN_PASSWORD` | `admin123` | 首次初始化管理员密码 |
| `SESSION_SECRET` | 自动生成 | 会话令牌签名密钥 |
| `COOKIE_SECURE` | 未设置 | HTTPS 部署时设为 `1` |

## 数据结构

`data/db.json` 保存：

- `settings`：站点设置
- `users`：账号、角色、密码哈希
- `groups`：分组，带 `ownerId`
- `items`：入口，带 `ownerId` 和 `groupId`

所有导航读写接口都会依据当前登录用户过滤 `ownerId`，即使用户猜到其他用户的 ID 也无法读取或修改对方数据。

## API 概览

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| `GET` | `/api/health` | 公开 |
| `GET` | `/api/bootstrap` | 未登录返回登录状态，登录后返回本人导航 |
| `POST` | `/api/auth/login` | 公开 |
| `POST` | `/api/auth/logout` | 登录用户 |
| `PUT` | `/api/auth/profile` | 登录用户，修改自己的显示名称 |
| `PUT` | `/api/auth/password` | 登录用户，修改自己的密码 |
| `GET/POST` | `/api/users` | 管理员 |
| `PUT/DELETE` | `/api/users/:id` | 管理员 |
| `PUT` | `/api/users/:id/password` | 管理员重置密码 |
| `POST/PUT/DELETE` | `/api/groups...` | 登录用户，仅操作自己的分组 |
| `POST/PUT/DELETE` | `/api/items...` | 登录用户，仅操作自己的入口 |
| `PUT` | `/api/settings` | 管理员 |
| `GET` | `/api/system` | 登录用户 |
| `POST` | `/api/import/bookmarks` | 登录用户，批量导入自己的书签 |
| `POST` | `/api/upload` | 登录用户 |
| `GET` | `/api/backup` | 管理员 |
| `POST` | `/api/restore` | 管理员 |

## 安全说明

- 密码使用 `scrypt` 加盐哈希。
- 会话 Cookie 使用 `HttpOnly`、`SameSite=Strict` 和 HMAC 签名令牌。
- 登录失败按 IP 限流。
- 写接口校验同源来源。
- 导航接口按 `ownerId` 强制隔离数据。
- 上传仅支持 PNG、JPEG、WebP、GIF，限制 1MB。
- 页面启用 CSP、`nosniff` 和 `frame-ancestors`。
- 公网部署请启用 HTTPS，并设置 `COOKIE_SECURE=1`。

## 项目结构

```text
.
├── server.js
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── sw.js
│   ├── manifest.webmanifest
│   └── favicon.svg
├── test/smoke.test.js
├── docs/design.md
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## License

MIT


