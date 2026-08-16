# GitHub App 安装与指令说明

## GitHub App 权限

第一版只需要：

| 权限 | 范围 | 用途 |
|---|---|---|
| Metadata | Read | 读取仓库基础信息 |
| Issues | Read | 拉取 Issue、评论和候选 Issue |
| Issues | Write | 只用于回复 Bot 评论 |

安全边界：

- 不自动关闭 Issue。
- 不自动分配负责人。
- 不自动创建子 Issue。

## Webhook

Webhook URL：

```text
POST /webhooks/github
```

需要配置 `GITHUB_WEBHOOK_SECRET`，服务会校验 `x-hub-signature-256`。

当前只处理：

```text
issue_comment.created
```

Bot 自己发出的评论会被忽略，重复的 `x-github-delivery` 会被忽略。

## 支持的指令

| 指令 | 说明 |
|---|---|
| `/issue-govern` | 完整治理 |
| `/issue-govern tasks=dedupe,clarify,risk` | 指定治理任务 |
| `/issue-dedupe` | 只做去重 |
| `/issue-clarify` | 只生成澄清问题 |
| `/issue-split` | 只拆任务 |
| `/issue-tests` | 只生成测试点 |
| `/issue-risk` | 只生成风险报告 |

默认只有 `OWNER`、`MEMBER`、`COLLABORATOR` 可以触发。可用 `GITHUB_TRIGGER_USERS` 和 `GITHUB_TRIGGER_ASSOCIATIONS` 调整。
