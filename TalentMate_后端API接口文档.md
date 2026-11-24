# TalentMate 后端 API 接口文档

> 文档版本：V1.0
> 依据：腾讯云服务器当前部署源码
> 更新时间：2026-09-12
> 当前联调 Base URL：
>
> `http://49.232.160.212`
> API 前缀：
>
> `/api`

***

## 1. 快速开始

### 1.1 服务地址

当前课程联调地址：

```
http://49.232.160.212
```

健康检查：

```
GET http://49.232.160.212/api/health
```

已验证响应：

```
{
  "success": true,
  "message": "Server is running"
}
```

> 当前地址使用 HTTP，只适合课程开发和受控演示。登录凭据、JWT、联系人数据及语音文件会通过明文网络传输，不应承载真实敏感数据。正式发布前应迁移到有效 HTTPS。

### 1.2 Content-Type

普通 JSON 接口：

```
Content-Type: application/json
```

语音上传接口：

```
Content-Type: multipart/form-data
```

上传时不要手动固定 multipart boundary，应交给浏览器、Axios 或网络库生成。

### 1.3 鉴权方式

除注册、登录和健康检查外，其余接口都需要 JWT：

```
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.demo.signature
```

Token 由注册或登录接口返回，有效期为 7 天。

缺少 Token：

```
HTTP/1.1 401 Unauthorized
```

```
{
  "success": false,
  "message": "未登录，请先登录"
}
```

Token 无效或过期：

```
{
  "success": false,
  "message": "登录已过期，请重新登录"
}
```

### 1.4 通用响应结构

成功响应通常为：

```
{
  "success": true,
  "message": "操作成功",
  "data": {}
}
```

部分查询接口不返回 `message`：

```
{
  "success": true,
  "data": []
}
```

错误响应通常为：

```
{
  "success": false,
  "message": "错误说明"
}
```

### 1.5 常见状态码

| 状态码 | 含义                          | Android 客户端建议     |
| --- | --------------------------- | ----------------- |
| 200 | 查询、更新、删除成功；部分业务未识别也可能返回 200 | 同时检查 `success` 字段 |
| 201 | 注册、创建联系人或创建日程成功             | 读取 `data`         |
| 204 | CORS 预检成功                   | 无响应正文             |
| 400 | 缺少字段或字段不合法                  | 展示后端 `message`    |
| 401 | 未登录、Token 无效或已过期            | 清理登录态并跳转登录页       |
| 404 | 当前用户的数据不存在                  | 提示并刷新本地列表         |
| 409 | 用户名已被注册                     | 提示更换用户名           |
| 500 | 数据库、ASR、AI、邮件预览或服务器异常       | 保留现有页面数据并允许重试     |

> 当前后端没有统一的 `errorCode` 字段，客户端应以 HTTP 状态码、`success` 和 `message` 联合判断。

***

## 2. 接口总览

| 模块   | 方法     | 路径                                   | 鉴权 | 说明              |
| ---- | ------ | ------------------------------------ | -- | --------------- |
| 健康检查 | GET    | `/api/health`                        | 否  | 检查服务状态          |
| 认证   | POST   | `/api/auth/register`                 | 否  | 注册并自动登录         |
| 认证   | POST   | `/api/auth/login`                    | 否  | 登录              |
| 认证   | PUT    | `/api/auth/complete-tour`            | 是  | 标记已完成新手引导       |
| 日程   | GET    | `/api/events`                        | 是  | 查询当前用户日程        |
| 日程   | POST   | `/api/events`                        | 是  | 手动创建日程          |
| 日程   | PUT    | `/api/events/:id`                    | 是  | 部分更新日程          |
| 日程   | DELETE | `/api/events/:id`                    | 是  | 删除日程            |
| 联系人  | GET    | `/api/contacts`                      | 是  | 查询名册            |
| 联系人  | POST   | `/api/contacts`                      | 是  | 添加联系人           |
| 联系人  | POST   | `/api/contacts/import-csv`           | 是  | 通过 CSV 文本批量导入   |
| 联系人  | GET    | `/api/contacts/:id/timeline`         | 是  | 获取联系人互动时间线      |
| 联系人  | PUT    | `/api/contacts/:id`                  | 是  | 更新联系人           |
| 联系人  | DELETE | `/api/contacts/:id`                  | 是  | 删除联系人           |
| 洞察   | GET    | `/api/insights/relationship-heatmap` | 是  | 获取关系关怀状态        |
| 邮件   | POST   | `/api/mail/preview`                  | 是  | 生成邮件预览          |
| 邮件   | PUT    | `/api/mail/events/:id/draft`         | 是  | 保存邮件草稿          |
| 语音   | POST   | `/api/voice/recognize`               | 是  | 上传音频并识别、解析、执行意图 |
| 语音   | POST   | `/api/voice/resolve-contact`         | 是  | 选择同名联系人后继续创建日程  |

共 19 个端点。

***

## 3. 数据模型与枚举

## 3.1 User

```
interface UserSession {
  token: string;
  userId: number;
  username: string;
  email: string;
  has_seen_tour: 0 | 1;
}
```

## 3.2 Contact

```
interface Contact {
  id: number;
  user_id: number;
  name: string;
  email: string | null;
  contact_type: 'family' | 'friend' | 'acquaintance';
  department: string | null;
  role: string | null;
  birthday: string | null;
  onboard_date: string | null;
  avatar_color: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
```

虽然数据库中的 `email` 可以为空，但当前创建和更新接口会校验邮箱必填。

## 3.3 Event

```
interface Event {
  id: number;
  user_id: number;
  title: string;
  start_time: string;
  end_time: string | null;
  reminder: number;
  reminded: 0 | 1;
  contact_id: number | null;
  event_type: EventType;
  mail_status: MailStatus;
  mail_subject: string | null;
  mail_body_override: string | null;
  created_at: string;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_department?: string | null;
  contact_role?: string | null;
  contact_avatar_color?: string | null;
  contact_type?: ContactType | null;
}
```

## 3.4 InteractionLog

```
interface InteractionLog {
  id: number;
  user_id: number;
  contact_id: number | null;
  event_id: number | null;
  action_type: InteractionAction;
  title: string;
  detail: string | null;
  occurred_at: string;
  created_at: string;
}
```

## 3.5 枚举

### ContactType

```
family         家人
friend         朋友
acquaintance   熟人
```

联系人接口也接受中文值 `家人` / `朋友` / `熟人`，服务端会进行转换。旧职场值 `employee`/`candidate`（及中文「员工」「候选人」）会分别映射为 `friend` / `acquaintance`。Android 端建议始终发送英文值。

### EventType

```
general       普通日程
catch_up      聊聊近况
birthday      生日祝福
anniversary   纪念日
festival      节日问候
visit         见面/拜访
thanks        道谢/回礼
```

旧职场事件值 `one_on_one` / `interview` / `onboarding` / `offer` / `followup` 在读写时会映射到上表对应类型。新建请使用新枚举。

### MailStatus

```
none   无邮件
draft  草稿
sent   已发送
```

> 实际值是 
>
> `draft`
>
> ，请求时不得带前导空格。

### InteractionAction

```
event_created
event_updated
event_cancelled
mail_draft
mail_sent
```

> 实际值分别为 
>
> `event_created`
>
> 、
>
> `event_updated`
>
> 、
>
> `event_cancelled`
>
> 、
>
> `mail_draft`
>
> 、
>
> `mail_sent`
>
> ，请求端通常不需要直接提交这些值。

### RelationshipStatus

```
new        新联系人
healthy    正常
warning    需关注
danger     高优先级
scheduled  已安排
```

> 实际值是 
>
> `danger`
>
> ，不得带前导空格。

***

## 4. 健康检查

## 4.1 检查服务状态

```
GET /api/health
```

鉴权：否。

请求示例：

```
curl http://49.232.160.212/api/health
```

成功响应：

```
{
  "success": true,
  "message": "Server is running"
}
```

***

## 5. 认证接口

## 5.1 注册

```
POST /api/auth/register
Content-Type: application/json
```

鉴权：否。

请求体：

| 字段         | 类型     | 必填 | 规则         |
| ---------- | ------ | -- | ---------- |
| `username` | string | 是  | 非空；数据库唯一   |
| `email`    | string | 是  | 必须通过邮箱格式校验 |
| `password` | string | 是  | 最少 6 个字符   |

请求示例：

```
{
  "username": "demo_user",
  "email": "demo_user@example.com",
  "password": "sample-pass-2026"
}
```

成功状态：`201 Created`

```
{
  "success": true,
  "message": "注册成功",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiJ9.demo.signature",
    "userId": 3,
    "username": "demo_user",
    "email": "demo_user@example.com",
    "has_seen_tour": 0
  }
}
```

错误：

| 状态  | 条件       | message       |
| --- | -------- | ------------- |
| 400 | 缺少必填字段   | `请填写所有必填字段`   |
| 400 | 邮箱格式错误   | `邮箱格式不正确`     |
| 400 | 密码少于 6 位 | `密码至少需要6位`    |
| 409 | 用户名已存在   | `用户名已被注册`     |
| 500 | 服务器异常    | `服务器错误，请稍后重试` |

## 5.2 登录

```
POST /api/auth/login
Content-Type: application/json
```

鉴权：否。

请求体：

| 字段         | 类型     | 必填 |
| ---------- | ------ | -- |
| `username` | string | 是  |
| `password` | string | 是  |

请求示例：

```
{
  "username": "demo_user",
  "password": "sample-pass-2026"
}
```

成功响应：

```
{
  "success": true,
  "message": "登录成功",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiJ9.demo.signature",
    "userId": 3,
    "username": "demo_user",
    "email": "demo_user@example.com",
    "has_seen_tour": 0
  }
}
```

错误：

| 状态  | 条件         | message       |
| --- | ---------- | ------------- |
| 400 | 缺少用户名或密码   | `请填写用户名和密码`   |
| 401 | 用户不存在或密码错误 | `用户名或密码错误`    |
| 500 | 服务器异常      | `服务器错误，请稍后重试` |

## 5.3 完成新手引导

```
PUT /api/auth/complete-tour
Authorization: Bearer \$TOKEN
```

请求体：无。

成功响应：

```
{
  "success": true,
  "message": "导览已完成"
}
```

***

## 6. 日程接口

以下接口全部需要 JWT。

## 6.1 查询日程

```
GET /api/events
Authorization: Bearer \$TOKEN
```

查询参数：

| 参数          | 类型     | 必填 | 说明                            |
| ----------- | ------ | -- | ----------------------------- |
| `startDate` | string | 否  | 与 `endDate` 同时提供时生效           |
| `endDate`   | string | 否  | 查询条件是 `start_time <= endDate` |

推荐格式：

```
YYYY-MM-DD HH:mm:ss
```

月范围示例：

```
GET /api/events?startDate=2026-09-01%2000:00:00\&endDate=2026-10-01%2000:00:00
```

注意：当前实现使用闭区间 `start_time >= startDate AND start_time <= endDate`。如果用下个月 1 日作为 `endDate`，恰好在下个月 1 日 00:00 的事件也会被包含。更严谨的后端实现应改成 `< endDate`。

成功响应：

```
{
  "success": true,
  "data": [
    {
      "id": 18,
      "user_id": 3,
      "title": "和张伟进行 1 对 1 沟通",
      "start_time": "2026-09-15 15:00:00",
      "end_time": "2026-09-15 16:00:00",
      "reminder": 10,
      "reminded": 0,
      "contact_id": 8,
      "event_type": "catch_up",
      "mail_status": "draft",
      "mail_subject": null,
      "mail_body_override": null,
      "contact_name": "张伟",
      "contact_email": "zhangwei@example.com",
      "contact_department": "产品部",
      "contact_role": "产品经理",
      "contact_avatar_color": "#1677FF",
      "contact_type": "friend"
    }
  ]
}
```

## 6.2 创建日程

```
POST /api/events
Authorization: Bearer \$TOKEN
Content-Type: application/json
```

请求体：

| 字段                 | 类型          | 必填 | 默认值 / 说明              |
| ------------------ | ----------- | -- | --------------------- |
| `title`            | string      | 是  | 事项标题                  |
| `startTime`        | string      | 是  | 推荐 `YYYY-MM-DD HH:mm` |
| `endTime`          | string/null | 否  | 结束时间                  |
| `reminder`         | number      | 否  | 默认 10 分钟              |
| `contactId`        | number/null | 否  | 当前用户下的联系人 ID          |
| `eventType`        | EventType   | 否  | 默认 `general`          |
| `mailStatus`       | MailStatus  | 否  | 默认 `none`             |
| `mailSubject`      | string/null | 否  | 邮件主题                  |
| `mailBodyOverride` | string/null | 否  | 邮件正文草稿                |

请求示例：

```
{
  "title": "和张伟进行 1 对 1 沟通",
  "startTime": "2026-09-15 15:00",
  "endTime": "2026-09-15 16:00",
  "reminder": 10,
  "contactId": 8,
  "eventType": "catch_up",
  "mailStatus": "draft"
}
```

成功状态：`201 Created`

```
{
  "success": true,
  "message": "事件创建成功",
  "data": {
    "id": 18
  }
}
```

注意：当前后端使用 `reminder || 10`，所以传入 `0` 会被改成 `10`。如果产品需要 “不要提前提醒”，应把后端改为 `reminder ?? 10`。

错误：

| 状态  | 条件        | message       |
| --- | --------- | ------------- |
| 400 | 缺少标题或开始时间 | `标题和开始时间为必填项` |
| 500 | 创建失败      | `创建事件失败`      |

## 6.3 更新日程

```
PUT /api/events/:id
Authorization: Bearer \$TOKEN
Content-Type: application/json
```

该接口支持部分更新。

可提交字段：

```
interface UpdateEventRequest {
  title?: string;
  startTime?: string;
  endTime?: string | null;
  reminder?: number;
  reminded?: 0 | 1;
  contactId?: number | null;
  eventType?: EventType;
  mailStatus?: MailStatus;
  mailSubject?: string | null;
  mailBodyOverride?: string | null;
}
```

示例：

```
{
  "startTime": "2026-09-15 16:00",
  "endTime": "2026-09-15 17:00"
}
```

成功响应会返回完整更新记录：

```
{
  "success": true,
  "message": "已将「和张伟进行 1 对 1 沟通」的时间修改为 16:00 - 17:00",
  "data": {
    "id": 18,
    "title": "和张伟进行 1 对 1 沟通",
    "start_time": "2026-09-15 16:00:00",
    "end_time": "2026-09-15 17:00:00",
    "reminder": 10,
    "contact_id": 8,
    "event_type": "catch_up",
    "mail_status": "draft",
    "contact_name": "张伟"
  }
}
```

错误：

| 状态  | 条件            | message      |
| --- | ------------- | ------------ |
| 404 | 事件不存在或不属于当前用户 | `事件不存在或无权操作` |
| 500 | 更新失败          | `更新事件失败`     |

## 6.4 删除日程

```
DELETE /api/events/:id
Authorization: Bearer \$TOKEN
```

成功响应：

```
{
  "success": true,
  "message": "事件已删除"
}
```

如果事件绑定联系人，服务端会：

1. 删除该事件相关的创建、更新和邮件草稿日志；

2. 写入一条 `event_cancelled` 互动记录；

3. 删除事件。

错误：

| 状态  | 条件            | message      |
| --- | ------------- | ------------ |
| 404 | 事件不存在或不属于当前用户 | `事件不存在或无权操作` |
| 500 | 删除失败          | `删除事件失败`     |

***

## 7. 联系人接口

以下接口全部需要 JWT。

## 7.1 查询联系人

```
GET /api/contacts
Authorization: Bearer \$TOKEN
```

查询参数：

| 参数        | 类型     | 必填 | 说明                             |
| --------- | ------ | -- | ------------------------------ |
| `keyword` | string | 否  | 模糊匹配姓名、邮箱、部门或岗位                |
| `type`    | string | 否  | `all`、`family`、`friend` 或 `acquaintance` |

示例：

```
GET /api/contacts?keyword=妈\&type=family
```

成功响应：

```
{
  "success": true,
  "data": [
    {
      "id": 8,
      "user_id": 3,
      "name": "张伟",
      "email": "zhangwei@example.com",
      "contact_type": "friend",
      "department": "产品部",
      "role": "产品经理",
      "birthday": "1995-05-18",
      "onboard_date": "2025-01-10",
      "avatar_color": "#1677FF",
      "notes": "每月安排一次沟通",
      "created_at": "2026-09-01 10:00:00",
      "updated_at": "2026-09-12 09:00:00"
    }
  ]
}
```

排序：`updated_at DESC, id DESC`。

## 7.2 添加联系人

```
POST /api/contacts
Authorization: Bearer \$TOKEN
Content-Type: application/json
```

请求体：

| 字段            | 类型          | 必填 | 说明                       |
| ------------- | ----------- | -- | ------------------------ |
| `name`        | string      | 是  | 姓名                       |
| `email`       | string      | 是  | 邮箱                       |
| `contactType` | ContactType | 是  | `family` / `friend` / `acquaintance` |
| `department`  | string/null | 否  | 部门                       |
| `role`        | string/null | 否  | 岗位或求职岗位                  |
| `birthday`    | string/null | 否  | `YYYY-MM-DD`             |
| `onboardDate` | string/null | 否  | `YYYY-MM-DD`             |
| `avatarColor` | string/null | 否  | 例如 `#1677FF`             |
| `notes`       | string/null | 否  | 备注                       |

请求示例：

```
{
  "name": "张伟",
  "email": "zhangwei@example.com",
  "contactType": "friend",
  "department": "产品部",
  "role": "产品经理",
  "birthday": "1995-05-18",
  "onboardDate": "2025-01-10",
  "avatarColor": "#1677FF",
  "notes": "每月安排一次沟通"
}
```

成功状态：`201 Created`

```
{
  "success": true,
  "message": "联系人已添加",
  "data": {
    "id": 8,
    "name": "张伟",
    "email": "zhangwei@example.com",
    "contact_type": "friend"
  }
}
```

验证错误：

| 状态  | 条件     | message       |
| --- | ------ | ------------- |
| 400 | 姓名为空   | `姓名为必填项`      |
| 400 | 邮箱为空   | `邮箱为必填项`      |
| 400 | 邮箱格式错误 | `邮箱格式不正确`     |
| 400 | 类型非法   | `类型必须是家人、朋友或熟人` |
| 500 | 创建失败   | `添加联系人失败`     |

## 7.3 更新联系人

```
PUT /api/contacts/:id
Authorization: Bearer \$TOKEN
Content-Type: application/json
```

请求字段与 “添加联系人” 一致。

> 该接口当前不是严格的部分更新。服务端会重新规范化全部字段，而且仍要求 
>
> `name`
>
> 、
>
> `email`
>
> 、
>
> `contactType`
>
>  有效。因此 Android 编辑页应提交完整联系人表单，而不是只传变化字段。

成功响应：

```
{
  "success": true,
  "message": "联系人已更新",
  "data": {
    "id": 8,
    "name": "张伟",
    "email": "zhangwei@example.com",
    "contact_type": "friend",
    "department": "研发部",
    "role": "产品经理"
  }
}
```

错误：

| 状态  | 条件             | message   |
| --- | -------------- | --------- |
| 400 | 字段校验失败         | 对应校验提示    |
| 404 | 联系人不存在或不属于当前用户 | `联系人不存在`  |
| 500 | 更新失败           | `更新联系人失败` |

## 7.4 删除联系人

```
DELETE /api/contacts/:id
Authorization: Bearer \$TOKEN
```

成功响应：

```
{
  "success": true,
  "message": "联系人已删除"
}
```

删除联系人之前，服务端会将当前用户所有关联日程的 `contact_id` 设为 `NULL`，日程本身不会被删除。

错误：

| 状态  | 条件     | message   |
| --- | ------ | --------- |
| 404 | 联系人不存在 | `联系人不存在`  |
| 500 | 删除失败   | `删除联系人失败` |

## 7.5 CSV 文本导入

```
POST /api/contacts/import-csv
Authorization: Bearer \$TOKEN
Content-Type: application/json
```

请求体：

```
{
  "csv": "姓名,邮箱,类型,关系圈,称呼,生日,相识日,备注\n妈妈,mom@example.com,family,家人,妈妈,1965-05-18,1990-01-10,每周联系"
}
```

支持表头：

| 中文表头  | 对应字段          |
| ----- | ------------- |
| 姓名    | `name`        |
| 邮箱    | `email`       |
| 类型    | `contactType` |
| 部门    | `department`  |
| 岗位、职位 | `role`        |
| 生日    | `birthday`    |
| 入职时间  | `onboardDate` |
| 备注    | `notes`       |

也可使用英文对象字段作为 CSV 表头。

成功响应：

```
{
  "success": true,
  "message": "已导入 5 位联系人，跳过 1 行无效数据",
  "data": {
    "inserted": 5,
    "skipped": 1
  }
}
```

注意：

* 当前 CSV 解析器支持由英文双引号包裹的逗号内容；

* 当前解析器不是完整 RFC 4180 实现；

* 无效行会跳过，不会令整个导入失败；

* 当前实现没有重复联系人去重。

## 7.6 获取联系人时间线

```
GET /api/contacts/:id/timeline
Authorization: Bearer \$TOKEN
```

成功响应：

```
{
  "success": true,
  "data": {
    "contact": {
      "id": 8,
      "name": "张伟",
      "email": "zhangwei@example.com",
      "contact_type": "friend"
    },
    "logs": [
      {
        "id": 31,
        "contact_id": 8,
        "event_id": 18,
        "action_type": "event_created",
        "title": "和张伟进行 1 对 1 沟通",
        "detail": "创建了 catch_up 日程",
        "occurred_at": "2026-09-15 15:00:00",
        "start_time": "2026-09-15 15:00:00",
        "end_time": "2026-09-15 16:00:00",
        "event_type": "catch_up",
        "mail_status": "draft"
      }
    ],
    "events": []
  }
}
```

`events` 用于补充没有对应互动日志的日程记录。客户端通常将 `logs` 与 `events` 合并，并按时间倒序显示。

错误：

| 状态  | 条件             | message   |
| --- | -------------- | --------- |
| 404 | 联系人不存在或不属于当前用户 | `联系人不存在`  |
| 500 | 查询失败           | `获取时间线失败` |

***

## 8. 关系洞察接口

## 8.1 获取关系热力图

```
GET /api/insights/relationship-heatmap
Authorization: Bearer \$TOKEN
```

成功响应：

```
{
  "success": true,
  "data": [
    {
      "id": 8,
      "name": "张伟",
      "email": "zhangwei@example.com",
      "contact_type": "friend",
      "last_event_at": "2026-08-01 10:00:00",
      "last_log_at": "2026-08-03 14:00:00",
      "next_event_at": null,
      "event_count": 3,
      "log_count": 4,
      "last_interaction_at": "2026-08-03 14:00:00",
      "days_since_interaction": 40,
      "status": "warning",
      "reason": "朋友 · 40 天未联系"
    }
  ]
}
```

判定规则：

| 关系圈 | warning | danger  |
| --- | ------- | ------- |
| 家人 family | 14 天未互动 | 21 天未互动 |
| 朋友 friend | 30 天未互动 | 45 天未互动 |
| 熟人 acquaintance | 60 天未互动 | 90 天未互动 |

以上为 `care_level=normal` 的基准；`high`/`low` 会缩放天数，自定义 `care_warn_days` / `care_danger_days` 可覆盖。

状态优先级：

1. 有未来日程：`scheduled`；

2. 没有互动记录：`new`；

3. 达到 danger 阈值：`danger`；

4. 达到 warning 阈值：`warning`；

5. 其他：`healthy`。

错误：

```
{
  "success": false,
  "message": "获取关怀热力图失败"
}
```

***

## 9. 邮件接口

以下接口全部需要 JWT。

## 9.1 生成邮件预览

```
POST /api/mail/preview
Authorization: Bearer \$TOKEN
Content-Type: application/json
```

请求体：

| 字段             | 类型          | 必填 | 说明                   |
| -------------- | ----------- | -- | -------------------- |
| `eventId`      | number      | 否  | 提供后优先从数据库读取当前用户事件    |
| `contactId`    | number      | 否  | 提供后优先从数据库读取当前用户联系人   |
| `event`        | object      | 否  | 没有或未查到 eventId 时使用   |
| `contact`      | object      | 否  | 没有或未查到 contactId 时使用 |
| `bodyOverride` | string/null | 否  | 临时覆盖正文               |

推荐请求：

```
{
  "eventId": 18,
  "contactId": 8
}
```

临时预览用户修改正文：

```
{
  "eventId": 18,
  "contactId": 8,
  "event": {
    "mail_subject": "明天下午的沟通安排"
  },
  "bodyOverride": "张伟，你好：\n我们明天下午进行一次沟通。"
}
```

成功响应：

```
{
  "success": true,
  "data": {
    "subject": "张伟，一次 1对1 沟通安排",
    "body": "想和你做一次轻量的 1对1 沟通……",
    "html": "<div style=\\"max-width:560px\\">邮件 HTML</div>"
  }
}
```

> 当前 
>
> `loadMailContext`
>
>  在指定 ID 不存在时不会返回 404，而可能继续使用请求体对象或空对象生成默认邮件。Android 端应优先从可信事件详情调用；后端后续建议增加明确的 400/404 校验。

## 9.2 保存邮件草稿

```
PUT /api/mail/events/:id/draft
Authorization: Bearer \$TOKEN
Content-Type: application/json
```

请求体：

```
{
  "subject": "张伟，一次 1 对 1 沟通安排",
  "body": "张伟，你好：\n我们明天下午进行一次沟通。"
}
```

成功响应：

```
{
  "success": true,
  "message": "邮件草稿已保存"
}
```

服务端同时会：

* 更新 `mail_subject`；

* 更新 `mail_body_override`；

* 将 `mail_status` 设置为 `draft`；

* 写入 `mail_draft` 互动记录。

错误：

| 状态  | 条件            | message    |
| --- | ------------- | ---------- |
| 404 | 事件不存在或不属于当前用户 | `事件不存在`    |
| 500 | 保存失败          | `保存邮件草稿失败` |

***

## 10. 语音接口

以下接口全部需要 JWT。

## 10.1 上传语音并执行意图

```
POST /api/voice/recognize
Authorization: Bearer \$TOKEN
Content-Type: multipart/form-data
```

表单字段：

| 字段      | 类型   | 必填 | 说明            |
| ------- | ---- | -- | ------------- |
| `audio` | file | 是  | 音频文件，最大 10 MB |

允许 MIME：

```
audio/webm
audio/wav
audio/mpeg
audio/mp3
audio/ogg
```

Android 当前推荐上传：

```
文件名：recording.wav
MIME：audio/wav
格式：16 kHz、16-bit、单声道 PCM WAV
```

Axios 示例：

```
const formData = new FormData();
formData.append('audio', wavBlob, 'recording.wav');
const response = await voiceApi.post(
  '/api/voice/recognize',
  formData
);
```

不要手动设置 multipart boundary。

### 通用成功响应

```
{
  "success": true,
  "message": "已添加1个事件：『和张伟1对1』9月15日 15:00，已绑定『张伟』",
  "data": {
    "transcript": "下周二下午三点安排和张伟的一对一沟通",
    "intent": {
      "intent": "add",
      "events": [
        {
          "title": "和张伟1对1",
          "startTime": "2026-09-15 15:00",
          "endTime": "2026-09-15 16:00",
          "reminderMinutes": 10
        }
      ],
      "queryKeywords": "",
      "queryDate": "2026-09-15",
      "contactName": "张伟",
      "eventType": "catch_up",
      "rawTranscript": "下周二下午三点安排和张伟的一对一沟通"
    },
    "eventIds": [18],
    "events": [
      {
        "id": 18,
        "title": "和张伟1对1",
        "start_time": "2026-09-15 15:00",
        "end_time": "2026-09-15 16:00",
        "reminder": 10,
        "contact_id": 8,
        "event_type": "catch_up",
        "mail_status": "draft",
        "contact_name": "张伟"
      }
    ],
    "queryDate": null,
    "deleted": false,
    "modified": false,
    "needsConfirm": false,
    "needsContactDisambiguation": false,
    "contactCandidates": [],
    "pendingIntent": null,
    "contact": {
      "id": 8,
      "name": "张伟"
    }
  }
}
```

### 业务意图枚举

```
add      添加事件
query    查询事件
modify   修改事件
delete   删除事件
unknown  无法识别
```

### 同名联系人响应

HTTP 状态仍为 200，`success` 为 true，但客户端必须继续让用户选择：

```
{
  "success": true,
  "message": "找到2位『张伟』，请选择具体对象",
  "data": {
    "transcript": "明天下午三点安排和张伟的一对一",
    "intent": {
      "intent": "add",
      "contactName": "张伟",
      "eventType": "catch_up",
      "events": [
        {
          "title": "和张伟一对一",
          "startTime": "2026-09-13 15:00"
        }
      ]
    },
    "eventIds": null,
    "events": null,
    "queryDate": null,
    "deleted": false,
    "modified": false,
    "needsConfirm": false,
    "needsContactDisambiguation": true,
    "contactCandidates": [
      {
        "id": 8,
        "name": "张伟",
        "email": "zhangwei@example.com",
        "department": "产品部",
        "role": "产品经理"
      },
      {
        "id": 12,
        "name": "张伟",
        "email": "zhangwei2@example.com",
        "department": "研发部",
        "role": "工程师"
      }
    ],
    "pendingIntent": {
      "intent": "add",
      "contactName": "张伟",
      "eventType": "catch_up",
      "events": [
        {
          "title": "和张伟一对一",
          "startTime": "2026-09-13 15:00"
        }
      ]
    },
    "contact": null
  }
}
```

### 多条匹配待确认

语音修改或删除匹配到多条事件时：

```
{
  "success": true,
  "message": "找到2个匹配事件，请选择删除",
  "data": {
    "needsConfirm": true,
    "deleted": false,
    "modified": false,
    "events": [
      {
        "id": 18,
        "title": "和张伟沟通",
        "start_time": "2026-09-15 15:00:00"
      }
    ]
  }
}
```

客户端选择后：

* 删除：调用 `DELETE /api/events/:id`；

* 修改：调用 `PUT /api/events/:id`。

### 未识别语音

HTTP 状态可能仍为 200：

```
{
  "success": false,
  "message": "未识别到语音内容，请再说一遍"
}
```

或：

```
{
  "success": false,
  "message": "没理解您的意思，请再说一遍",
  "data": {
    "transcript": "识别到但无法解析的文本"
  }
}
```

因此客户端不能只依赖 HTTP 200，必须检查 `success`。

### 错误

| 状态  | 条件          | message         |
| --- | ----------- | --------------- |
| 400 | 未上传 `audio` | `未收到音频文件`       |
| 401 | Token 缺失或失效 | 对应鉴权错误          |
| 500 | ASR 调用失败    | `语音识别失败，请重试`    |
| 500 | AI 解析异常     | `网络延迟，请重试`      |
| 500 | 其他异常        | `处理请求时出错，请稍后重试` |

上传超过 10 MB 或 MIME 不受支持时会进入全局错误处理，当前通常返回 500 和错误信息。后端后续建议将这两类明确映射为 413 和 415。

部署版本会在响应结束或连接关闭后删除临时音频文件。

## 10.2 选择同名联系人并继续执行

```
POST /api/voice/resolve-contact
Authorization: Bearer \$TOKEN
Content-Type: application/json
```

请求体：

```
{
  "contactId": 8,
  "pendingIntent": {
    "intent": "add",
    "contactName": "张伟",
    "eventType": "catch_up",
    "events": [
      {
        "title": "和张伟一对一",
        "startTime": "2026-09-13 15:00",
        "endTime": "2026-09-13 16:00",
        "reminderMinutes": 10
      }
    ]
  }
}
```

成功响应：

```
{
  "success": true,
  "message": "已添加1个事件：『和张伟一对一』9月13日 15:00，已绑定『张伟』",
  "data": {
    "intent": {
      "intent": "add",
      "contactName": "张伟",
      "eventType": "catch_up",
      "events": []
    },
    "eventIds": [18],
    "events": [],
    "contact": {
      "id": 8,
      "name": "张伟",
      "email": "zhangwei@example.com"
    }
  }
}
```

错误：

| 状态  | 条件                               | message       |
| --- | -------------------------------- | ------------- |
| 400 | 缺少 `contactId` 或 `pendingIntent` | `缺少联系人或待处理意图` |
| 404 | 联系人不存在或不属于当前用户                   | `联系人不存在`      |
| 500 | 绑定或业务执行失败                        | `联系人绑定失败`     |

> `pendingIntent`
>
>  应直接使用 
>
> `/api/voice/recognize`
>
>  返回的数据，不要由客户端自行重新构造或信任用户输入。

***

## 11. Android/Axios 对接示例

## 11.1 API 实例

```
import axios from 'axios';
const API_BASE_URL = 'http://49.232.160.212';
export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});
export const voiceApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 90000,
});
const attachToken = (config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = \`Bearer \${token}\`;
  return config;
};
api.interceptors.request.use(attachToken);
voiceApi.interceptors.request.use(attachToken);
```

## 11.2 登录

```
const { data } = await api.post('/api/auth/login', {
  username,
  password,
});
if (!data.success) {
  throw new Error(data.message);
}
localStorage.setItem('token', data.data.token);
localStorage.setItem('username', data.data.username);
```

## 11.3 获取联系人和洞察

```
const [contactsResponse, heatmapResponse] = await Promise.all([
  api.get('/api/contacts'),
  api.get('/api/insights/relationship-heatmap'),
]);
const contacts = contactsResponse.data.data;
const heatmap = heatmapResponse.data.data;
```

## 11.4 创建日程

```
const response = await api.post('/api/events', {
  title: '和张伟进行 1 对 1 沟通',
  startTime: '2026-09-15 15:00',
  endTime: '2026-09-15 16:00',
  reminder: 10,
  contactId: 8,
  eventType: 'catch_up',
  mailStatus: 'draft',
});
const eventId = response.data.data.id;
```

## 11.5 上传语音

```
const formData = new FormData();
formData.append('audio', wavBlob, 'recording.wav');
const { data } = await voiceApi.post(
  '/api/voice/recognize',
  formData
);
if (!data.success) {
  throw new Error(data.message);
}
if (data.data.needsContactDisambiguation) {
  showContactPicker(
    data.data.contactCandidates,
    data.data.pendingIntent
  );
} else if (data.data.needsConfirm) {
  showEventPicker(data.data.events, data.data.intent);
} else {
  refreshEvents();
  refreshContacts();
  refreshHeatmap();
}
```

## 11.6 统一错误处理

```
function getApiErrorMessage(error) {
  if (!navigator.onLine) return '当前没有网络连接';
  if (error.code === 'ECONNABORTED') return '请求超时，请稍后重试';
  if (error.response?.status === 401) return '登录已过期，请重新登录';
  return error.response?.data?.message || '服务器暂时不可用';
}
```

***

## 12. Curl 调试示例

登录并提取 Token：

```
TOKEN=\$(curl -sS \\
  -X POST \\
  -H 'Content-Type: application/json' \\
  -d '{"username":"demo_user","password":"sample-pass-2026"}' \\
  http://49.232.160.212/api/auth/login \\
  \| python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["token"])')
```

获取联系人：

```
curl -sS \\
  -H "Authorization: Bearer \$TOKEN" \\
  http://49.232.160.212/api/contacts
```

获取日程：

```
curl -sS \\
  -H "Authorization: Bearer \$TOKEN" \\
  'http://49.232.160.212/api/events?startDate=2026-09-01%2000:00:00\&endDate=2026-10-01%2000:00:00'
```

上传语音：

```
curl -sS \\
  -X POST \\
  -H "Authorization: Bearer \$TOKEN" \\
  -F 'audio=@recording.wav;type=audio/wav' \\
  http://49.232.160.212/api/voice/recognize
```

***

## 13. 当前接口实现注意事项

这些内容是根据当前部署源码确认的，不是理想化设计。

1. **HTTP 200 不一定代表业务成功**

   语音未识别或意图未知时可能返回 HTTP 200、`success: false`。

2. **事件创建的 reminder=0 当前不会生效**

   服务端使用 `reminder || 10`，零会被替换为 10。

3. **事件日期范围使用闭区间**

   当前为 `start_time >= startDate AND start_time <= endDate`。

4. **联系人更新应提交完整表单**

   更新接口会重新规范化字段，并要求姓名、邮箱、类型有效。

5. **CSV 导入不是文件上传**

   接口接收 JSON 中的 CSV 字符串。

6. **邮件预览参数校验较宽松**

   不存在的 ID 可能退回到传入对象或默认内容，而不是明确返回 404。

7. **语音上传只接受当前白名单 MIME**

   如果 Android 未来改传 M4A，需要同步增加 `audio/mp4` 或 `audio/x-m4a`。

8. **所有业务表按 user_id 隔离**

   事件、联系人、洞察、时间线和邮件草稿均使用当前 JWT 用户范围。

9. **删除联系人不会删除日程**

   相关日程的 `contact_id` 会被置空。

10. **语音临时文件已自动清理**

    当前部署版本在响应结束或连接关闭后删除上传文件。

***

## 14. 建议后端后续改进

| 优先级 | 改进项          | 建议                            |
| --- | ------------ | ----------------------------- |
| P0  | HTTPS        | 正式发布前切换到有效 HTTPS              |
| P0  | 限流           | 登录、注册、语音和邮件预览增加限流             |
| P0  | 邮件 HTML 安全   | 固定模板、文本转义、前端再次净化              |
| P1  | `reminder=0` | 将 \`reminder                  |
| P1  | 日期范围         | 将月范围结束条件改为 `< endDate`        |
| P1  | 邮件预览校验       | 无效 eventId/contactId 返回明确 404 |
| P1  | 上传错误码        | 超大文件返回 413，错误 MIME 返回 415     |
| P1  | 时间格式         | 统一为带时区 ISO 8601               |
| P1  | 数据库账号        | 使用权限受限的业务账户而非 root            |
| P2  | OpenAPI      | 建立可自动生成客户端的 OpenAPI 3.1 文档    |

***

## 15. Android 联调检查清单

* [ ] `GET /api/health` 成功；

* [ ] 注册成功并拿到 Token；

* [ ] 登录成功并保存 Token；

* [ ] 请求自动附加 Bearer Token；

* [ ] 401 时清理 Token 并跳转登录页；

* [ ] 联系人增删改查；

* [ ] 联系人搜索和筛选；

* [ ] CSV 文本导入；

* [ ] 日程增删改查；

* [ ] 日程关联联系人；

* [ ] 关系热力图；

* [ ] 联系人时间线；

* [ ] 邮件预览；

* [ ] 邮件草稿保存；

* [ ] WAV 录音上传；

* [ ] 语音普通成功分支；

* [ ] 同名联系人分支；

* [ ] 多事件待确认分支；

* [ ] 语音未识别分支；

* [ ] 超时、断网和服务器错误；

* [ ] Android 允许当前 HTTP API；

* [ ] Release 包真机测试通过。

***

## 16. 当前服务器验证状态

已验证：

```
GET http://49.232.160.212/api/health
→ 200
→ {"success":true,"message":"Server is running"}
```

已验证 Capacitor 来源预检：

```
Origin: https://localhost
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://localhost
Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS
Access-Control-Allow-Headers: Content-Type,Authorization
```

服务器端口状态：

```
80    Nginx 公网 API
3001  仅绑定 127.0.0.1
3306  未映射到宿主机
```

公网探测结果：

```
3001 closed_or_filtered
3306 closed_or_filtered
```

***

## 17. 文档范围

本文档描述的是当前后端实际已实现并部署的接口。以下能力不属于现有公开 API：

* 获取当前用户资料的独立接口；

* 修改密码；

* 找回密码；

* 单独获取一个事件详情；

* 单独获取一个联系人详情；

* 直接发送邮件的手动接口；

* 分页；

* OpenAPI/Swagger 在线页面；

* FCM 远程推送；

* 刷新 Token；

* 注销账号。

Android 客户端如需要这些能力，应先扩展后端接口，不要根据前端需要假设端点已经存在。
