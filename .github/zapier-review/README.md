# Zapier Luna：全仓库审查与 Issue 修复

模型只在真实 Zap 的 **AI by Zapier / GPT-5.6 Luna / Standard (1 task)** 步骤中运行。GitHub Actions 和此 Node 程序只做清单、分块、校验、表读取和 GitHub 写入，不调用本地模型或外部模型 API。

## 当前交付状态

- 真实 Zap：https://zapier.com/editor/381096178/draft
- 真实结果表：`3-Luna-review-results`，ID `01M36XPZ65N821F3AN8FZCW045`。
- 已配置 Webhook、入口过滤、免费 Tables 去重、Luna、免费 Tables 保存。
- 免费触发器、过滤器和表查询检查通过；**没有执行收费模型测试**。
- 工作器 12 项本地检查通过；**尚未做端到端运行验证，也没有完成仓库代码审查**。
- 已将 `ZAPIER_HOOK_URL`、`ZAPIER_CALLBACK_AUTH` 加密保存到仓库 Actions secrets。SDK 凭证尚未生成：用户已批准官方 OAuth，2026-09-23 即时授权后令牌交换仍返回 HTTP 500；网页凭证列表也为空。接通 SDK 两项 secrets 后，仍需部署到默认分支、发布 Zap、配置预算并启用仓库变量。
- 用户已确认 SDK 可访问账户内其他资产及官方 OAuth 的凭证管理、离线访问范围；不能宣称仅限一张表。禁止把凭证提交到仓库。

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
- `LUNA_MAX_TASKS`：每个 job 的派发上限，默认 100；初始计划超限时在任何模型调用前停止。当前基准估算 112 个初始调用，因此默认保护上限会阻止收费运行；接通后须将上限明确配置为至少初始计划数量。`plan_only=true` 即使超过上限也会成功输出估算，不调用模型。
- `LUNA_CHUNK_TOKENS`：默认 650000，允许向下调整。该值是保守的实现上限，**不是已实测的 Zapier 最大输入量**。未付费测试前不保证最大尺寸请求被接收。

GitHub 内置 `GITHUB_TOKEN` 用于写分支和草稿 PR。仓库必须允许 Actions 创建 PR，否则程序会报告具体 API 失败；不能把这种失败冒充为已完成。

## Tasks 计算与边界

同一块内的完全相同内容只发送一次，并保留每个文件的路径及独立覆盖要求。按估算大小从大到小装块，尽量填满已有块；不删除 vendor 或生成目录来压低数量。

正常处理为 **N + R** 个 Zapier tasks：N 个代码块；R 为模型返回 incomplete/needs_context 后的必要追加调用。Trigger、Filter、普通 Tables 操作不计 tasks。通过 GitHub 和当前免费 beta 的 Zapier SDK 读取结果，省掉每块一个付费回调。

无模型估算基准 `584068bfa0a97eebb12b01ede20d63c8a63499c2`：42,336 个跟踪文件，18,876 个文本路径（18,622 种文本内容），23,460 个二进制文件，未解析条目 0。相同输入上限下，顺序装块 120 次，去重并调整装块后 **112 次初始调用**。这是输入估算，不是完整审查总价；Tables 输出长度和跨文件上下文可能产生额外调用。当前没有业务模型运行记录来验证这些上限。

这不是“任意大仓库固定 1 task”，也不是已证明的全局最小值。输入上限、输出长度、跨文件关系、失败重试都影响实际数量。SDK 免费 beta 条款可能改变；变更后应停用并复核。不得把模型标称上下文直接当作 Zapier 已验证上限。

参考：
- https://help.zapier.com/hc/en-us/articles/8496196837261-How-is-task-usage-measured-in-Zapier
- https://zapier.com/sdk
- https://help.zapier.com/hc/en-us/articles/15721386410765-Zapier-Tables-usage-limits
- https://help.zapier.com/hc/en-us/articles/45885581698573-How-is-Code-by-Zapier-usage-measured

## 全量含义和限制

固定提交 SHA 后枚举全部 Git 跟踪文件，不按 vendor、生成目录或大文件过滤；所有可识别文本进入审查。大文件按行拆分，输出路径、SHA256 和连续行范围；机械核验模型声明的覆盖。空文本无可审查行；二进制另行列入清单，不宣称对二进制作源码审查。

未知源码编码、Git LFS 指针、符号链接、submodule 或超限的单行会明确停止，而不是跳过后宣称 100%。支持严格 UTF-8、带 BOM 的 UTF-16；本仓库已核对的韩文旧源码按 CP949、5 个第三方源码按 Windows-1252、明确声明 ISO-8859-1 的 HTML 按其声明解码，并验证字节可往返。其余未知编码的非源码文档/测试数据保留每个原始字节，使用显式字节转义表示，不谎称已解码。BMD 按仓库说明登记为加密游戏资源；Git 声明的二进制资产也单独登记。

模型只生成精确替换操作。补丁必须匹配原文且唯一；重复操作去重；冲突、路径穿越、未知文件、无法无损编码的修改和 `.github/` 修改拒绝应用。已支持的旧编码写回原编码，UTF-8 BOM 保留。**审查仍覆盖 `.github/` 文件，但自动修改被保护。** 此版本不支持新建/删除文件或 UTF-16 自动修改，需求涉及它们时需要明确扩展。

没有自动执行模型产生的代码。没有项目级构建/运行测试配置时，草稿 PR 明确注明未测试；12 项工作器测试不等于项目代码测试。覆盖证明只证明范围记录完整，不能证明模型没有漏掉缺陷。部分分块完成不能声称全量完成。

## 本地无模型验证

```sh
cd .github/zapier-review
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

派发标记和结果保存在 Zapier Tables。若请求状态不明，先查看 Zap 运行记录，确认没有已完成/仍运行的模型请求；不要直接删除标记或自动重试，以免重复扣 tasks。
