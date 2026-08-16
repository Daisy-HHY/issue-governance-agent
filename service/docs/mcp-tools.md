# MCP 工具说明

当前版本不新增 MCP SDK 依赖，只提供 SDK 无关的工具定义和处理函数：

| 文件 | 说明 |
|---|---|
| [mcpServer.ts](../src/mcp/mcpServer.ts) | `issueGovernanceTools` 和 `handleIssueGovernanceTool` |

## 工具列表

| 工具 | 说明 |
|---|---|
| `github_issue_list` | 返回请求范围，真实 GitHub 拉取待接入 |
| `github_issue_govern` | 完整治理 |
| `issue_dedupe` | 去重 |
| `issue_clarify` | 澄清 |
| `issue_split_tasks` | 拆任务 |
| `issue_generate_tests` | 生成测试点 |
| `issue_risk_report` | 风险报告 |
| `issue_governance_digest` | 治理摘要 |

后续确认引入 MCP SDK 后，再把这些定义注册为真正的 MCP Server 工具。
