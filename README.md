# TalentMate 伴贤

TalentMate 伴贤是一款以**语音交互为核心**的私人关系关怀助手。它帮助你记得联系**家人、朋友和熟人**：通过普通话语音或手动表单维护关系名册、安排关怀日程、预览并微调问候邮件、查看关系热力图和个人互动时间线。

## 功能特性

- **语音关怀日程**：一句话安排聊聊近况、生日祝福、节日问候、见面拜访、道谢回礼等事项。
- **关系名册**：维护家人 / 朋友 / 熟人信息，联系人必填姓名、邮箱、关系圈，支持 CSV 导入。
- **联系人歧义选择**：遇到同名联系人时，右侧关怀助手会列出候选对象，点击后完成绑定。
- **关怀热力图**：按关系圈（家人更紧、熟人更松）与关注等级自动标记正常、已安排、需关注、高优先级等状态。
- **互动时间线**：按联系人查看创建日程、取消安排、邮件草稿、邮件发送等历史记录。
- **邮件实时预览**：对绑定联系人的事件生成 TalentMate HTML 关怀邮件，支持在线微调主题和正文。
- **邮件触达**：后端定时任务通过 SMTP 发送提醒邮件或联系人关怀邮件。
- **账号与数据隔离**：注册、登录、JWT 鉴权，所有名册、日程、日志都按 `user_id` 隔离。

## 技术栈

| 层面 | 技术 / 服务 |
|------|-------------|
| 前端 | React 18, Vite, JavaScript, Ant Design 5, Tailwind CSS, Axios |
| 后端 | Node.js, Express |
| 数据库 | MySQL 8.0 |
| 语音识别 | 腾讯云 ASR（一句话识别） |
| 意图解析 | DeepSeek API (`deepseek-chat`) |
| 时间解析 | chrono-node 辅助兜底 |
| 邮件发送 | nodemailer + SMTP |
| 定时任务 | node-cron |
| 包管理器 | pnpm |
| 部署 | Docker, docker-compose |

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm >= 8
- MySQL 8.0
- 腾讯云 ASR 服务账号
- DeepSeek API Key
- 可用于发送邮件的 SMTP 账号

### 配置环境变量

在项目根目录创建 `.env`：

```dotenv
PORT=3001

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=voice_calendar

JWT_SECRET=your_jwt_secret

TENCENT_SECRET_ID=your_tencent_secret_id
TENCENT_SECRET_KEY=your_tencent_secret_key

DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_MODEL=deepseek-chat

SMTP_HOST=smtp.qq.com
SMTP_PORT=587
SMTP_USER=your_email@qq.com
SMTP_PASS=your_smtp_authorization_code
SMTP_FROM=your_email@qq.com
```

### 安装依赖

```bash
cd server
pnpm install

cd ../client
pnpm install
```

### 初始化数据库

```bash
mysql -u root -p < server/db/init.sql
```

后端启动时也会执行轻量 schema 自检，已有 V1 数据库会自动补齐 V2 所需字段和表。

### 启动开发服务

```bash
# 终端 1
cd server
pnpm run dev

# 终端 2
cd client
pnpm start
```

前端默认运行在 `http://localhost:3000`，后端 API 默认运行在 `http://localhost:3001`。

## 使用流程

1. **注册并登录**  
   注册时填写用户名、邮箱和密码。注册邮箱用于接收普通提醒邮件。

2. **维护关系名册**  
   在左侧切换到“名册”，添加家人、朋友或熟人。必填项为姓名、邮箱、关系圈；怎么认识、称呼、生日、相识日、备注为选填。

3. **安排关怀日程**  
   可以手动添加，也可以用语音说：

   ```text
   周末提醒我给妈妈打电话
   下周五约小王吃饭
   下周一给王芳安排生日祝福
   ```

4. **处理同名联系人**  
   如果名册中存在多个“张伟”，系统会在右侧关怀助手中列出候选联系人，用户点击具体对象后再创建日程。

5. **查看关怀热力图**  
   日历上方展示高优先级、需关注、已安排数量，并优先显示风险联系人。点击“查看全部”可打开完整状态总览。

6. **预览和微调邮件**  
   绑定联系人后的事件会出现邮件入口。用户可以查看 HTML 邮件效果，修改主题和正文，并保存草稿。

7. **查看互动时间线**  
   从名册或热力图点击联系人，即可查看与该对象相关的日程、取消记录、邮件草稿和邮件发送历史。

## 项目结构

```text
voice-calendar/
├── client/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── HomePage/
│   │   │   │   ├── CalendarPanel.jsx
│   │   │   │   ├── ChatPanel.jsx
│   │   │   │   ├── DirectoryPanel.jsx
│   │   │   │   ├── HeatmapStrip.jsx
│   │   │   │   ├── MailPreviewModal.jsx
│   │   │   │   └── TimelinePanel.jsx
│   │   │   ├── LoginPage/
│   │   │   └── RegisterPage/
│   │   ├── services/
│   │   └── App.jsx
│   └── package.json
├── server/
│   ├── db/
│   │   └── init.sql
│   ├── middleware/
│   ├── routes/
│   │   ├── auth.js
│   │   ├── contacts.js
│   │   ├── events.js
│   │   ├── insights.js
│   │   ├── mail.js
│   │   └── voice.js
│   ├── services/
│   │   ├── asr.js
│   │   ├── emailService.js
│   │   ├── interactions.js
│   │   ├── intentParser.js
│   │   ├── reminder.js
│   │   └── schema.js
│   └── app.js
├── docker-compose.yml
├── Dockerfile
├── PRD.md
└── README.md
```

## API 概览

| 端点 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `/api/auth/register` | POST | 用户注册 | 否 |
| `/api/auth/login` | POST | 用户登录 | 否 |
| `/api/events` | GET | 获取当前用户事件 | 是 |
| `/api/events` | POST | 创建事件 | 是 |
| `/api/events/:id` | PUT | 更新事件 | 是 |
| `/api/events/:id` | DELETE | 删除事件并记录取消历史 | 是 |
| `/api/contacts` | GET | 获取关系名册 | 是 |
| `/api/contacts` | POST | 创建联系人 | 是 |
| `/api/contacts/import-csv` | POST | CSV 文本导入联系人 | 是 |
| `/api/contacts/:id` | PUT | 更新联系人 | 是 |
| `/api/contacts/:id` | DELETE | 删除联系人 | 是 |
| `/api/contacts/:id/timeline` | GET | 获取个人互动时间线 | 是 |
| `/api/insights/relationship-heatmap` | GET | 获取关怀热力图 | 是 |
| `/api/mail/preview` | POST | 生成邮件预览 | 是 |
| `/api/mail/events/:id/draft` | PUT | 保存邮件草稿 | 是 |
| `/api/voice/recognize` | POST | 上传音频并执行语音意图 | 是 |
| `/api/voice/resolve-contact` | POST | 同名联系人选择后继续执行 | 是 |

## 数据模型概览

- `users`：用户账号、邮箱、密码、引导状态。
- `contacts`：关系名册，包含姓名、邮箱、关系圈、怎么认识、称呼、生日、相识日等。
- `events`：关怀日程，支持联系人绑定、事件类型、邮件状态、邮件草稿。
- `interaction_logs`：互动历史，记录创建、更新、取消、邮件草稿、邮件发送等行为。

## 当前说明

- 桌面浏览器通知功能已移除，当前触达方式为 SMTP 邮件。
- 若事件绑定联系人并且联系人有邮箱，到提醒时间时优先发送 TalentMate 关怀邮件。
- 若事件未绑定联系人，则发送普通提醒邮件到当前用户注册邮箱。
- 当前前端构建存在 Vite 大包体提示，但不影响运行。

## 许可证

本项目仅用于学习与参赛，未开放额外许可证。
