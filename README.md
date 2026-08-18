# issue-governance-agent

## Repository Context

Issue 分析会按当前 Issue 所属仓库解析本地源码上下文，并在分析前触发已有 CodeGraph 初始化链路。

解析优先级：

1. `REPOSITORY_CONTEXT_MAP`：显式指定 `owner/repo=本地路径`，多个仓库用英文逗号分隔。
2. `REPOSITORY_CONTEXT_AUTO_CLONE=true` + `REPOSITORY_CONTEXT_ROOT`：未命中 map 时，自动将当前 Issue 的 `owner/repo` clone 到 `REPOSITORY_CONTEXT_ROOT\owner\repo`。
3. `REPOSITORY_CONTEXT_PATH`：兼容旧配置的单仓库兜底路径。

推荐自动 clone 配置：

```env
REPOSITORY_CONTEXT_MAP=
REPOSITORY_CONTEXT_PATH=
REPOSITORY_CONTEXT_ROOT=D:\project\issue-governance-agent-repos
REPOSITORY_CONTEXT_AUTO_CLONE=true
```

自动 clone 使用 GitHub App installation token，因此目标仓库必须已安装该 GitHub App，并至少授予 `Contents: Read` 权限。
