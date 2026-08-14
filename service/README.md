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

## 本地环境变量

复制 `.env.example` 为 `.env` 后填写真实值。

```text
PORT=3000
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
UUMIT_API_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
LOG_LEVEL=info
```

## 常用命令

依赖安装后可执行：

```powershell
npm run dev
npm test
npm run typecheck
npm run lint
```

## P0 验收说明

当前未安装 `node_modules`，因此脚本已配置但尚未运行。安装依赖前需要确认依赖安装位置，避免占用不必要的 C 盘空间。
