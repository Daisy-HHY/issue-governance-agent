# UUMIT 能力上架说明

## 能力名称

GitHub Issue 智能治理

## 能力描述

输入 GitHub 仓库和 Issue 范围，通过 GitHub App 拉取真实 Issue 后返回去重、澄清问题、任务拆分、测试点和风险报告。第一版是可人工采纳的治理建议，不执行自动关闭、自动分配或自动创建子 Issue。

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

| 字段             | 说明                                               |
| ---------------- | -------------------------------------------------- |
| `source`         | 调用来源，建议填 `uumit`                           |
| `requestId`      | 幂等 ID，同一 ID 重试返回同一结果                  |
| `repo`           | GitHub 仓库，例如 `owner/project`                  |
| `issueNumber`    | 单个 Issue 编号                                    |
| `issueRange`     | 批量范围，支持 `state`、`limit`、`labels`、`since` |
| `tasks`          | 治理任务数组                                       |
| `mode`           | 输出模式，默认 `analyze_only`                      |
| `outputLanguage` | 输出语言，默认 `zh-CN`                             |

## 输出字段

| 字段             | 说明                                                    |
| ---------------- | ------------------------------------------------------- |
| `requestId`      | 请求 ID                                                 |
| `status`         | `succeeded` / `failed` / `running`                      |
| `capability`     | 固定为 `github_issue_governance`                        |
| `repository`     | 仓库                                                    |
| `resultMarkdown` | 可直接展示的 Markdown                                   |
| `resultJson`     | 结构化治理结果                                          |
| `usage`          | 调用统计，`billingUnit` 支持 `per_issue` 和 `per_batch` |
| `errorCode`      | 错误码                                                  |
| `message`        | 错误说明                                                |

## GitHub 上下文要求

服务需要 GitHub App 已安装到目标仓库，并能通过 `repo` 获取 installation token。缺少可用 GitHub 上下文时不会生成占位 Issue，而是返回失败响应：

```json
{
  "status": "failed",
  "errorCode": "GITHUB_CONTEXT_UNAVAILABLE",
  "message": "UUMIT 请求缺少可用 GitHub App 上下文，无法真实拉取 Issue。"
}
```

## 本地仓库上下文

请求中的 `repo` 会用于解析本地源码目录：

```text
REPOSITORY_CONTEXT_MAP 精确命中
  -> REPOSITORY_CONTEXT_PATH fallback
  -> 无仓库上下文，基础治理继续执行
```

当前版本不会自动 clone GitHub 仓库。需要先把目标仓库 clone 到本机，再配置 `REPOSITORY_CONTEXT_MAP`。服务不会把本地路径返回给外部调用方。

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

- 当前不会用请求参数生成占位 Issue；无法真实拉取 GitHub Issue 时直接失败。
- 治理结果是建议，不自动执行 GitHub 写操作。
- 私有仓库数据不应写入日志，API key 和 token 不应出现在响应中。
