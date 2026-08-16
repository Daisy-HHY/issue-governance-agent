# UUMIT 能力上架说明

## 能力名称

GitHub Issue 智能治理

## 能力描述

输入 GitHub 仓库和 Issue 范围，返回 Issue 去重、澄清问题、任务拆分、测试点和风险报告。第一版是可人工采纳的治理建议，不执行自动关闭、自动分配或自动创建子 Issue。

## HTTP API

```text
POST /api/v1/github/issues/govern
```

鉴权：

```text
Authorization: Bearer <UUMIT_API_KEY>
```

也支持：

```text
x-api-key: <UUMIT_API_KEY>
```

## 输入参数

| 字段 | 说明 |
|---|---|
| `source` | 调用来源，建议填 `uumit` |
| `requestId` | 幂等 ID，同一 ID 重试返回同一结果 |
| `repo` | GitHub 仓库，例如 `owner/project` |
| `issueNumber` | 单个 Issue 编号 |
| `issueRange` | 批量范围，支持 `state`、`limit`、`labels`、`since` |
| `tasks` | 治理任务数组 |
| `mode` | 输出模式，默认 `analyze_only` |
| `outputLanguage` | 输出语言，默认 `zh-CN` |

## 输出字段

| 字段 | 说明 |
|---|---|
| `requestId` | 请求 ID |
| `status` | `succeeded` / `failed` / `running` |
| `capability` | 固定为 `github_issue_governance` |
| `repository` | 仓库 |
| `resultMarkdown` | 可直接展示的 Markdown |
| `resultJson` | 结构化治理结果 |
| `usage` | 调用统计，`billingUnit` 支持 `per_issue` 和 `per_batch` |
| `errorCode` | 错误码 |
| `message` | 错误说明 |

## 调用示例

```json
{
  "source": "uumit",
  "requestId": "demo-1",
  "repo": "owner/project",
  "issueNumber": 1842,
  "tasks": ["dedupe", "clarify", "risk_report"],
  "mode": "analyze_only",
  "outputLanguage": "zh-CN"
}
```

## 风险声明

- 当前本地 MVP 未连接真实 GitHub 拉取时，会基于请求参数生成占位 Issue。
- 治理结果是建议，不自动执行 GitHub 写操作。
- 私有仓库数据不应写入日志，API key 和 token 不应出现在响应中。
