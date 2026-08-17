# Issue Governance Agent

GitHub Issue 智能治理服务原型，第一版目标是支持：

```text
GitHub Issue 评论 /issue-govern
  ↓
GitHub App Webhook
  ↓
IssueGovernanceService
  ↓
Bot 评论回当前 Issue
```

## 当前阶段

当前已完成 P0：

1. Node.js / TypeScript 项目骨架。
2. 环境变量模板。
3. 治理结果 Schema。
4. Schema 单元测试样例。

当前已完成 P1 仓库上下文初始化：

1. CodeGraph 初始化或同步检查。
2. 项目知识图谱读取和刷新。
3. Issue 关键词提取和相关源码上下文查询。
4. `IssueGovernanceService` 输入准备阶段接入仓库上下文。

当前已完成 MVP 本地代码闭环：

1. GitHub webhook 路由：`POST /webhooks/github`。
2. GitHub 评论指令解析：`/issue-govern`、`/issue-dedupe`、`/issue-clarify`、`/issue-split`、`/issue-tests`、`/issue-risk`。
3. GitHub App 客户端封装：Issue 拉取、候选 Issue 拉取、Bot 评论回写。
4. 规则版 `IssueGovernanceService`：去重、澄清、拆任务、测试点和风险报告。
5. GitHub Markdown 评论渲染。
6. UUMIT 能力 API：`POST /api/v1/github/issues/govern`，通过 GitHub App 拉取真实 Issue，缺少 GitHub 上下文时返回 `GITHUB_CONTEXT_UNAVAILABLE`。
7. MCP stdio Server：支持 `initialize`、`tools/list`、`tools/call`，复用同一套 GitHub Issue 治理能力。
8. 生产入口接入仓库上下文：配置 `REPOSITORY_CONTEXT_MAP` 或 `REPOSITORY_CONTEXT_PATH` 后，Webhook、UUMIT 和 MCP 调用都会把本地仓库上下文传给治理服务。

## 本地环境变量

复制 `.env.example` 为 `.env` 后填写真实值。

```text
PORT=3000
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
GITHUB_TRIGGER_USERS=
GITHUB_TRIGGER_ASSOCIATIONS=OWNER,MEMBER,COLLABORATOR
UUMIT_API_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
REPOSITORY_CONTEXT_MAP=
REPOSITORY_CONTEXT_PATH=
LOG_LEVEL=info
```

## 仓库上下文配置

多仓库场景优先配置 `REPOSITORY_CONTEXT_MAP`：

```env
REPOSITORY_CONTEXT_MAP=owner1/repo1=D:\project\repo1,owner2/repo2=D:\project\repo2
```

解析优先级：

```text
REPOSITORY_CONTEXT_MAP 精确命中
  -> REPOSITORY_CONTEXT_PATH fallback
  -> 无仓库上下文，基础治理继续执行
```

当前版本不会自动 clone GitHub 仓库。需要先把目标仓库 clone 到本机，再把 `owner/repo` 映射到对应本地目录。

## 常用命令

依赖安装后可执行：

```powershell
npm run dev
npm --silent run mcp
npm test
npm run typecheck
npm run lint
```

## 文档

| 用途                  | 链接                                            |
| --------------------- | ----------------------------------------------- |
| GitHub App 安装与指令 | [github-app.md](docs/github-app.md)             |
| UUMIT 能力上架说明    | [uumit-capability.md](docs/uumit-capability.md) |
| MCP 工具说明          | [mcp-tools.md](docs/mcp-tools.md)               |

## P0 验收说明

当前依赖已安装在 `service/node_modules`，并已具备本地测试、类型检查、lint 和构建脚本。`node_modules`、`dist` 和真实 `.env` 均不会提交。
