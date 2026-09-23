# Zapier Luna：全仓库审查与 Issue 修复

模型只在真实 Zap 的 **AI by Zapier / GPT-5.6 Luna / Standard (1 task)** 步骤中运行。GitHub Actions 和此 Node 程序只做清单、分块、校验、表读取和 GitHub 写入，不调用本地模型或外部模型 API。

## 当前交付状态

- 真实 Zap：https://zapier.com/editor/381096178/draft
- 真实结果表：`3-Luna-review-results`，ID `01M36XPZ65N821F3AN8FZCW045`。
- 已配置 Webhook、入口过滤、免费 Tables 去重、Luna、免费 Tables 保存。
- 免费触发器、过滤器和表查询检查通过；**没有执行收费模型测试**。
- 工作器 7 项本地检查通过；**尚未做端到端运行验证，也没有完成仓库代码审查**。
- 尚需创建 Zapier SDK 凭证并保存为 GitHub Actions secrets；然后部署到默认分支、发布 Zap、启用仓库变量。
- SDK 凭证可访问 Zapier 账户资产，不能宣称天然只限一张表；先确认实际权限。禁止把凭证提交到仓库。

## 使用

启用后，由仓库所有者 `Glace678` 新建 Issue 即可。正文是修改要求；标题含 `[review]` 时仅审查、不改代码。普通 Issue 会审查整个文本快照并为所请求的修改创建**草稿 PR**，不自动合并。其他人的 Issue 不触发付费处理。

工作流手动运行可指定 Issue 编号，`plan_only=true` 只做清单和估算，绝不调用 Zapier。再次处理同一基准提交和同一 Issue 内容时复用已保存的块结果；已派发但结果不明的请求只等待，不自动重发。

## 接通配置

仓库 Actions secrets：

- `ZAPIER_HOOK_URL`：真实 Zap 的 Catch Hook URL。
- `ZAPIER_CALLBACK_AUTH`：必须与第 2 步 Filter 中认证值相同。
- `ZAPIER_SDK_CLIENT_ID`、`ZAPIER_SDK_CLIENT_SECRET`：用于结果表和派发标记。

仓库变量：

- `LUNA_ENABLED=true` 才开始响应 Issue；部署期间保持未设置。
- `LUNA_MAX_TASKS`：每个 job 的派发上限，默认 100；初始计划超限时在任何模型调用前停止。
- `LUNA_CHUNK_TOKENS`：默认 650000，允许向下调整。该值是保守的实现上限，**不是已实测的 Zapier 最大输入量**。未付费测试前不保证最大尺寸请求被接收。

GitHub 内置 `GITHUB_TOKEN` 用于写分支和草稿 PR。仓库必须允许 Actions 创建 PR，否则程序会报告具体 API 失败；不能把这种失败冒充为已完成。

## Tasks 计算与边界

正常处理为 **N + R** 个 Zapier tasks：N 个代码块；R 为模型返回 incomplete/needs_context 后的必要追加调用。Trigger、Filter、普通 Tables 操作不计 tasks。通过 GitHub 和当前免费 beta 的 Zapier SDK 读取结果，省掉每块一个付费回调。

这不是“任意大仓库固定 1 task”，也不是已证明的全局最小值。输入上限、输出长度、跨文件关系、失败重试都影响实际数量。SDK 免费 beta 条款可能改变；变更后应停用并复核。不得把模型标称上下文直接当作 Zapier 已验证上限。

参考：
- https://help.zapier.com/hc/en-us/articles/8496196837261-How-is-task-usage-measured-in-Zapier
- https://zapier.com/sdk
- https://help.zapier.com/hc/en-us/articles/15721386410765-Zapier-Tables-usage-limits
- https://help.zapier.com/hc/en-us/articles/45885581698573-How-is-Code-by-Zapier-usage-measured

## 全量含义和限制

固定提交 SHA 后枚举全部 Git 跟踪文件，不按 vendor、生成目录或大文件过滤；所有可识别文本进入审查。大文件按行拆分，输出路径、SHA256 和连续行范围；机械核验模型声明的覆盖。空文本无可审查行；二进制另行列入清单，不宣称对二进制作源码审查。

无法识别编码、Git LFS 指针、符号链接、submodule 或超限的单行会明确停止，而不是跳过后宣称 100%。这些情况可能需要仓库专用处理。编码识别当前仅支持严格 UTF-8 和带 BOM 的 UTF-16，不猜测 GBK。

模型只生成精确替换操作。补丁必须匹配原文且唯一；重复操作去重；冲突、路径穿越、未知文件、非 UTF-8 文件和 `.github/` 修改拒绝应用。**审查仍覆盖 `.github/` 文件，但自动修改被保护。** 此版本不支持新建/删除文件，需求涉及它们时需要明确扩展。

没有自动执行模型产生的代码。没有项目级构建/运行测试配置时，草稿 PR 明确注明未测试；7 项工作器测试不等于项目代码测试。覆盖证明只证明范围记录完整，不能证明模型没有漏掉缺陷。部分分块完成不能声称全量完成。

## 本地无模型验证

```sh
cd .github/zapier-review
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

派发标记和结果保存在 Zapier Tables。若请求状态不明，先查看 Zap 运行记录，确认没有已完成/仍运行的模型请求；不要直接删除标记或自动重试，以免重复扣 tasks。
