# Luma Nav 产品与架构设计

## 1. 产品定位

Luma Nav 是一个可自托管的个人数字入口，面向：

- 拥有 NAS、家庭服务器或小型云主机的个人用户
- 需要统一管理公网/内网服务入口的开发者与运维人员
- 希望用浏览器新标签页作为工作台的用户
- 不希望维护 MySQL、Redis 等额外基础设施的小型部署场景

核心价值：**打开即用、部署轻、入口集中、内外网无感切换、数据掌握在自己手中。**

## 2. 目标与边界

### 2.1 本阶段目标

1. 完成导航面板闭环：浏览、搜索、登录、管理、排序、备份。
2. 不依赖外部数据库和前端构建链，降低部署与二次开发成本。
3. 默认强制登录，导航数据按用户隔离，管理员只拥有系统管理权限。
4. 在桌面和手机上保持一致的信息层级与可用性。

### 2.3 本阶段不包含

- Docker 容器生命周期管理
- 主机进程/计划任务管理
- 多租户、多角色与团队协作
- 服务在线探测与历史监控图表
- 插件市场与第三方主题运行时

这些能力可在当前数据模型上继续扩展。

## 3. 核心用户故事

| 编号 | 用户故事 |
| --- | --- |
| U1 | 作为用户，我登录后可以浏览并搜索自己的分组入口。 |
| U2 | 作为管理员，我可以登录后新增、编辑、删除入口。 |
| U3 | 作为管理员，我可以拖拽入口和分组完成排序。 |
| U4 | 作为家庭服务器用户，我可以在公网与内网地址之间一键切换。 |
| U5 | 作为管理员，我可以上传图标，或使用文字和 Emoji 作为图标。 |
| U6 | 未登录访问时只能看到登录页，不能读取任何用户或导航数据。 |
| U7 | 作为运维用户，我可以看到当前主机的 CPU、内存、磁盘和运行时间。 |
| U8 | 作为管理员，我可以导出和恢复完整配置。 |
| U9 | 作为手机用户，我可以通过底部导航快速跳转分组。 |
| U10 | 作为用户，我可以切换主题、背景和强调色。 |

## 4. 信息架构

```text
首页
├── 侧栏
│   ├── 品牌区
│   ├── 分组快捷导航
│   ├── 本机状态
│   └── 登录 / 设置 / 退出
├── 顶栏
│   ├── 网络状态
│   ├── 公网 / 内网切换
│   ├── 主题切换
│   └── 编辑 / 添加入口 / 账户
├── Hero
│   ├── 日期、时钟、欢迎语
│   ├── 本地入口搜索
│   └── 搜索引擎回退
├── 系统概览
│   ├── CPU
│   ├── 内存
│   ├── 磁盘
│   └── 运行时间
├── 分组导航
│   ├── 分组标题与操作
│   └── 入口卡片网格
└── 管理弹窗
    ├── 登录
    ├── 入口编辑
    ├── 分组编辑
    ├── 系统设置
    ├── 页面内窗口
    └── 操作确认
```

## 5. 功能矩阵

| Sun-Panel 类能力 | 当前实现 | 说明 |
| --- | --- | --- |
| 分组与拖拽排序 | 已实现 | 入口可在分组内/跨分组拖动，分组可排序 |
| 自定义分组 | 已实现 | 名称、说明、Emoji/图标、任意十六进制颜色、排序均可自定义 |
| 浏览器书签导入 | 已实现 | HTML 书签按文件夹转换为自定义分组，支持预览、去重和过滤 |
| 内外网链接切换 | 已实现 | 入口同时保存默认地址与内网地址 |
| 图标自由搭配 | 已实现 | 文字、Emoji、图片 URL、本地上传 |
| 浏览器首页 | 已实现 | PWA manifest + 离线应用壳 |
| 页面内小窗口 | 已实现 | iframe 预览，受目标站 `X-Frame-Options` / CSP 限制 |
| 访客访问 | 不开放 | 未登录只显示登录页，不返回导航数据 |
| 数据导入导出 | 已实现 | 完整 JSON 备份与恢复 |
| 服务器监控 | 已实现 | CPU、内存、磁盘、负载、运行时间 |
| 多语言 | 部分 | 当前界面为简体中文，文案已集中，可继续抽取 i18n |
| 多用户与权限 | 已实现 | 管理员/普通用户，每个账号拥有独立导航 |
| 计划任务 | 未实现 | 需要更严格的主机权限模型 |

## 6. 技术架构

```text
Browser
  ├── public/index.html
  ├── public/styles.css
  ├── public/app.js
  └── Service Worker
        │ fetch /api/*
        ▼
Node.js HTTP Server (server.js)
  ├── Static assets
  ├── REST API
  ├── Session auth + HMAC token
  ├── scrypt password hashing
  ├── Atomic JSON persistence
  ├── Upload handling
  └── System metrics (os / fs.statfs)
        │
        ├── data/db.json
        ├── data/.session-secret
        └── uploads/*
```

### 6.1 技术选型理由

- **Node.js 内置模块**：没有 npm 依赖，降低供应链、镜像体积和离线安装成本。
- **JSON 数据库**：个人与小团队导航的数据量很小，原子写入即可满足；避免引入数据库进程。
- **原生前端**：页面交互以卡片、表单和拖拽为主，无需框架运行时；首屏更直接。
- **进程内会话**：重启后强制重新登录，减少持久化令牌带来的风险；会话令牌仍做 HMAC 签名。

### 6.2 扩展方向

数据量或用户数增长后，可将持久层替换为 SQLite，同时保留现有 API 契约。后续可扩展：

- `users` 与 `roles` 表
- 分组级可见性
- 入口级 ACL
- 审计日志与操作回滚

## 7. 数据模型

```ts
Settings {
  siteName: string
  siteSubtitle: string
  greeting: string
  footerText: string
  searchEngine: 'google' | 'bing' | 'baidu' | 'duckduckgo' | 'custom'
  customSearchUrl: string
  themeDefault: 'dark' | 'light' | 'system'
  wallpaper: 'aurora' | 'ocean' | 'sunset' | 'forest' | 'graphite' | 'paper'
  accent: 'amber' | 'blue' | 'cyan' | 'green' | 'violet' | 'rose' | 'slate'
  cardStyle: 'glass' | 'solid' | 'outline'
  showClock: boolean
  showSystem: boolean
  requireLogin: boolean
  startInLanMode: boolean
  openInNewTab: boolean
  updatedAt: ISOString
}

Group {
  id: string
  ownerId: string
  name: string
  description: string
  icon: string
  color: string // preset name or #RRGGBB
  order: number
  createdAt: ISOString
}

Item {
  id: string
  ownerId: string
  groupId: string
  title: string
  description: string
  icon: string
  iconUrl: string
  url: string
  lanUrl: string
  openMode: 'tab' | 'window'
  order: number
  createdAt: ISOString
}

User {
  id: string
  username: string
  role: 'admin'
  salt: string
  passwordHash: string
  createdAt: ISOString
}
```

入口排序以 `(groupId, order)` 表达。跨分组拖动时会同时重新编号源分组与目标分组，服务端再次归一化，避免出现重复序号。

## 8. 关键流程

### 8.1 初次部署

1. 服务启动，检查 `data/db.json`。
2. 不存在时生成默认分组、示例入口和管理员密码哈希。
3. 管理员登录后修改密码、删除示例数据并导入自己的入口。
4. 在“用户管理”中创建账号；每个账号自动获得独立的导航空间。

### 8.2 日常访问

1. 浏览器请求 `/api/bootstrap`。
2. 服务端按 `requireLogin` 判断是否返回入口数据。
3. 前端根据浏览器本地偏好应用主题，根据设置应用背景、强调色与卡片风格。
4. 用户点击卡片时，按当前网络模式选择内网或默认地址。
5. 小窗口模式通过 iframe 打开；被目标站拒绝时回退到新标签页。

### 8.3 编辑与排序

1. 管理员登录后开启编辑模式。
2. 卡片或分组拖拽时，前端先更新本地顺序并即时重绘。
3. 前端提交完整排序快照。
4. 服务端校验条目与分组归属，归一化序号并原子写入。
5. 保存失败时前端重新拉取服务端数据，避免本地状态与服务端分叉。

### 8.4 备份恢复

1. 管理员导出包含设置、用户哈希、分组和入口的 JSON。
2. 恢复前进行结构校验与二次确认。
3. 所有 URL、图标地址、颜色和枚举设置重新清洗。
4. 至少存在一个有效管理员账号才允许恢复。
5. 恢复成功后清空全部会话，要求重新登录。

## 9. 安全设计

| 风险 | 对策 |
| --- | --- |
| 密码泄露 | scrypt + 随机盐，不保存明文 |
| 会话伪造 | 随机令牌 + HMAC 签名 + 服务端会话表 |
| CSRF | 写接口校验 `Origin` 与 Host 同源 |
| XSS | 前端统一转义用户数据；CSP 限制脚本来源 |
| 恶意图标 | 禁止 SVG，限制图片类型与大小，响应 `nosniff` |
| 开放重定向/脚本 URL | 服务端仅接受 `http:`、`https:` |
| 暴力登录 | 按 IP 限制失败次数 |
| 备份注入 | 恢复时重新清洗全部字段 |
| 公网明文传输 | 文档要求 HTTPS，并支持 `COOKIE_SECURE=1` |

已知限制：

- `X-Forwarded-For` 的信任策略应由反向代理保证；直连公网时不要伪造该头。
- 页面内小窗口无法绕过目标站主动设置的嵌入限制。
- 管理员与其他用户一样只能编辑自己的导航；这是数据隔离设计，不是权限缺失。

## 10. 非功能指标

- 首屏资源：无第三方 CDN、无前端框架、无字体外链
- 运行依赖：Node.js 20+
- 默认端口：3002
- 数据写入：临时文件 + 原子重命名
- 响应式断点：1180px、820px、560px
- 可访问性：语义化导航、键盘搜索、卡片键盘打开、焦点样式、跳过链接
- 运维：`/api/health` 健康检查、Docker HEALTHCHECK

## 11. 验收清单

- [x] 未登录只显示登录页，API 不返回任何导航数据
- [x] 管理员可登录并进入编辑模式
- [x] 分组和入口可新增、编辑、删除
- [x] 入口可在分组内与跨分组拖拽
- [x] 分组可拖拽排序
- [x] 公网/内网模式切换后卡片地址同步变化
- [x] 本地搜索与外部搜索引擎回退
- [x] 图标上传与大小限制
- [x] 系统指标展示
- [x] 管理员创建用户，用户拥有独立导航
- [x] 备份导出与结构校验恢复
- [x] 桌面与手机无横向溢出
- [x] 自动化 API 验收通过

## 12. 后续路线

### 后续版本

- 服务可用性探测与状态点
- 入口快捷备注与标签
- 可配置页面在局域网内自动选择地址

### V0.3

- SQLite 迁移
- 可选的用户导航分享与只读访问
- 分组级可见性
- 操作审计

### V1.0

- 用户导航模板与批量导入
- 主机服务与计划任务
- 插件 API
- 多语言与主题包
- 监控历史与告警通知





