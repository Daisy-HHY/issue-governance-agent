# MCP 工具说明

当前版本不新增 MCP SDK 依赖，提供一个最小 JSON-RPC stdio MCP Server。客户端可通过 `initialize`、`tools/list`、`tools/call` 发现和调用工具。

| 文件                                    | 说明                                  |
| --------------------------------------- | ------------------------------------- |
| [mcpServer.ts](../src/mcp/mcpServer.ts) | 工具定义、参数校验、JSON-RPC 请求处理 |
| [index.ts](../src/mcp/index.ts)         | stdio MCP Server 启动入口             |

## 启动命令

开发环境：

```powershell
npm --silent run mcp
```

构建后：

```powershell
npm run build
npm run start:mcp
```

## 工具列表

| 工具                      | 说明                       |
| ------------------------- | -------------------------- |
| `github_issue_list`       | 拉取真实 GitHub Issue 列表 |
| `github_issue_govern`     | 完整治理                   |
| `issue_dedupe`            | 去重                       |
| `issue_clarify`           | 澄清                       |
| `issue_split_tasks`       | 拆任务                     |
| `issue_generate_tests`    | 生成测试点                 |
| `issue_risk_report`       | 风险报告                   |
| `issue_governance_digest` | 治理摘要                   |

## GitHub 上下文要求

MCP 工具不会生成占位 Issue。服务需要 GitHub App 已安装到目标仓库，缺少可用 GitHub 上下文时工具调用返回 `GITHUB_CONTEXT_UNAVAILABLE`。

## 本地仓库上下文

工具入参中的 `repo` 会用于解析本地源码目录：

```text
REPOSITORY_CONTEXT_MAP 精确命中
  -> REPOSITORY_CONTEXT_PATH fallback
  -> 无仓库上下文，基础治理继续执行
```

当前版本不会自动 clone GitHub 仓库，也不会把本地路径返回给 MCP 调用方。
