# 考核项目

GitHub 仓库：https://github.com/py678/git1

## 版本控制要求

- 使用 GitHub 管理代码，默认分支为 `main`。
- 每个开发日结束前提交并推送当天的有效变更；无变更时不创建空提交。
- 提交遵循 Conventional Commits，并在正文记录变更原因、主要内容和验证结果。
- 首次推送成功后，将仓库地址发送给周勇（Leo.Zhou）和黄锐（Bruce.Huang）。

## 首次配置

安装 Git，并使用自己的真实提交身份配置当前仓库：

```powershell
git config user.name "你的姓名"
git config user.email "你的邮箱"
git config core.hooksPath .githooks
git add README.md .gitignore .githooks
git commit -m "chore(repo): 初始化项目版本控制规范" -m "建立项目说明、忽略规则和提交信息校验。验证：检查文档与钩子配置。"
git remote add origin https://github.com/py678/git1.git
git push -u origin main
```

首次推送前确认远程仓库的现有内容；若已有提交，应先同步历史。通过 Git Credential Manager 或 SSH 完成认证，不要把访问令牌写进项目文件。

## 每日提交流程

```powershell
git status
git diff
# 运行与本次变更相关的检查，再逐个暂存需要提交的文件。
git add <文件路径>
git diff --cached
git commit -m "feat(scope): 简述本次功能" -m "原因：说明需求。变更：说明实现。验证：记录实际检查及结果。"
git push
```

提交标题格式：`type(scope): description`，其中 scope 可省略。允许类型：`feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert`。破坏性变更使用 `!`，并在正文中说明 `BREAKING CHANGE:`。

首次推送后发送：

> @周勇(Leo.Zhou) @黄锐(Bruce.Huang) 我的考核项目已完成首次推送，仓库地址：https://github.com/py678/git1 。后续将在每个开发日提交并推送代码，便于查看开发过程。

每日提交需要持续执行；本文档不代表已经配置自动提交或提醒。
