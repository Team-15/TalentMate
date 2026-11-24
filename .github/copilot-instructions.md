# Copilot 指令 – TalentMate 私人关系关怀助手

## 项目概述
这是一个以语音交互为核心的私人关系关怀助手（TalentMate 伴贤）：维护家人/朋友/熟人名册，安排关怀日程，生成问候邮件，并展示关系热力图。采用前后端分离架构，React 18 + Ant Design 5 + Capacitor（Android），Node.js + Express，MySQL 8.0。

## 通用约定
- 所有代码注释和标识符使用英文，用户可见的 UI 文本使用中文。
- 尽可能使用 async/await 而非回调或 .then() 链。
- 错误处理必须完善，后端接口返回统一 JSON 格式 `{ success: boolean, message: string, data?: any }`。
- 环境变量通过 `dotenv` 加载，所有密钥和配置不得硬编码。

## 包管理器
- 使用 **pnpm**，所有安装命令必须为 `pnpm install`，Lock 文件为 `pnpm-lock.yaml`。
- 在 monorepo 风格的对话中，如果要为多个子包安装依赖，也统一使用 `pnpm --filter ...`。

## 前端 (client/)
### 技术栈
- React 18，JavaScript（非 TypeScript）
- Ant Design 5 (antd)
- Axios
- React Router v6（用于页面路由）

### 项目结构
- `client/src/components/` – 可复用组件（如 VoiceButton, EventDrawer, ConfirmModal 等）
- `client/src/pages/` – 页面组件，每页面一个文件夹含 `.jsx` + `.module.css`（如 `LoginPage/LoginPage.jsx`）
- `client/src/services/` – API 请求封装（api.js，配置基础 URL 和拦截器）
- `client/src/styles/` – 全局样式（`global.css` 定义 CSS 变量和基础样式）
- `client/src/App.jsx` – 路由配置
- `client/index.html` – Vite 入口 HTML
- `client/vite.config.js` – Vite 配置（含 `/api` 代理到 `localhost:3001`）
- 构建工具使用 Vite 5.x，入口为 `src/main.jsx`，所有含 JSX 的文件使用 `.jsx` 扩展名

### 编码规范
- 组件使用函数组件 + Hooks，避免类组件。
- 含 JSX 的文件必须使用 `.jsx` 扩展名（Vite 要求）。
- 每个页面组件放在独立文件夹中，配对应的 `.module.css` CSS Module 文件。
- 使用 Ant Design 组件时，优先按项目 UI 风格定制：亮蓝主色 (#1677FF)，渐变 (#1677FF → #0052D9)，白色圆角卡片 (16px)，浅阴影。所有按钮、输入框等均使用 antd 组件，避免原生 HTML 控件。
- CSS 变量定义在 `styles/global.css` 的 `:root` 中，CSS Module 通过 `var(--xxx)` 引用。
- 所有网络请求必须通过 `services/api.js` 中创建的 Axios 实例，该实例已配置 baseURL 和 JWT 拦截器。
- JWT token 存储在 localStorage 中，键名为 `token`，用户名键名为 `username`。
- 日期处理使用 dayjs。

### 关键组件生成要求
- **语音按钮 (VoiceButton)**：使用 `@ant-design/icons` 的 `AudioOutlined` 或类似图标，悬浮在右下角，点击开始/停止录音，录音时添加 CSS 动画。支持上传 Blob 到后端 `/api/voice/recognize`。
- **日历 (HomePage 中的 Calendar)**：使用 antd 的 `Calendar` 组件，通过 `dateCellRender` 自定义单元格，根据 events 数据渲染彩色小圆点和事件标题。点击日期弹出右侧 `Drawer` 显示当天事件。
- **事件抽屉 (EventDrawer)**：包含当天事件列表，每个事件项可编辑、删除。顶部“添加事件”按钮打开 `Modal` 手动添加。
- **删除确认弹窗**：当语音意图为删除且匹配多个事件时显示，允许用户勾选一个或多个事件进行删除。

## 后端 (server/)
### 技术栈
- Node.js + Express
- mysql2 (promise 模式)
- jsonwebtoken (JWT)
- bcryptjs
- multer (处理音频上传)
- tencentcloud-sdk-nodejs (腾讯云 ASR)
- openai (用于调用 DeepSeek API，也可使用 fetch)
- nodemailer
- node-cron
- dotenv, cors

### 项目结构
- `server/routes/` – 路由模块 (auth.js, events.js, voice.js)
- `server/middleware/` – 中间件 (auth.js 鉴权)
- `server/services/` – 业务服务 (asr.js, intentParser.js, emailService.js, reminder.js)
- `server/db/` – 数据库初始化脚本 (init.sql)
- `server/app.js` – 入口文件

### 数据库表
- `users` 表：id, username, email (必填), password, created_at
- `events` 表：id, user_id, title, start_time, end_time, reminder (分钟), reminded (0/1), created_at
- 所有查询必须使用参数化查询防止 SQL 注入。

### API 规范
- 前缀 `/api`
- 鉴权中间件验证 JWT，从 `req.user.id` 中取得当前用户 ID。
- 所有事件操作（增删改查）必须添加 `WHERE user_id = ?` 实现数据隔离。
- 语音识别全流程接口 `POST /api/voice/recognize` 主要步骤：
  1. 接收音频文件（multer 处理）
  2. 调用 `asrService` 获取文本
  3. 调用 `intentParser` 解析意图和实体（调用 DeepSeek）
  4. 根据 intent 执行相应数据库操作
  5. 返回处理结果和提示信息

### 意图解析器 (intentParser.js)
- 使用 DeepSeek API (`deepseek-chat` 模型)，系统提示词已固定为输出如下 JSON：
  ```json
  {
    "intent": "add" | "delete" | "query" | "unknown",
    "title": "事件标题",
    "startTime": "YYYY-MM-DD HH:mm",
    "endTime": "YYYY-MM-DD HH:mm",
    "reminderMinutes": 10,
    "queryKeywords": "",
    "queryDate": ""
  }
  ```
- 函数必须返回解析后的对象，若 API 调用失败或 intent 为 unknown 则抛出错误或返回 null，由路由处理。
- 如果 DeepSeek 返回的时间格式不正确，可降级使用 `chrono-node` 重新解析。

### 邮件发送 (emailService.js)
- 使用 nodemailer，SMTP 配置从环境变量读取。
- 邮件模板简单，主题为 `[语音日历提醒] {事件标题}`，正文包含事件时间和备注。

### 定时提醒 (reminder.js)
- 使用 node-cron，每分钟查询 `events WHERE reminded=0 AND start_time - INTERVAL reminder MINUTE <= NOW()`。
- 对每个事件：发送邮件，然后更新 `reminded=1`。浏览器通知由前端自行实现或通过 WebSocket 通知，后端只发邮件。
- 服务启动时立即执行一次检查，避免重启期间遗漏提醒。

## 部署
- 提供 `Dockerfile` 和 `docker-compose.yml`，容器化部署前端、后端和 MySQL。
- 使用 `.env` 文件管理环境变量，不提交到版本库。

## 其他
- 所有生成的代码不要包含敏感信息（如真实的 API Key）。
- 如需使用 GitHub Copilot 辅助开发，遵守以上所有规范。
- 代码注释简洁清晰，解释关键逻辑。