# Zapier 内置 Luna：全仓库审查与 Issue 修复

> 费用结论更正（2026-09-23）：已将 `LUNA_ENABLED=false`，暂停新 Issue 的模型执行。官方写明 SDK Beta 动作免费，也另列原生 AI 步骤 1/3/5 tasks；尚未找到明确说明经 SDK 调用 Zapier 托管模型是否免除模型 task 费用的条款。因此不能承诺 0 tasks 或全仓低于 50 tasks。设置时账号 0/1,000 仅证明尚未扣任务，不能证明模型免费。`plan.json` 中 `expectedZapierTasks: 0` 是此前推算，不是账单实测；价格页面文本检查也不能证实具体 AI 动作获豁免。实际费用确认前保持停用。

模型固定为 Zapier 托管的 `openai/gpt-5.6-luna`，通过官方 SDK 的 `AI by Zapier / Analyze and Return Data` 动作调用，`authentication_id=0`。GitHub Actions 只运行清单、分块、SDK 调度、校验和提交程序，不运行本地模型，不调用外部模型供应商 API。

## 使用

启用后，仓库所有者 `Glace678` 新建 Issue，正文就是要求。标题含 `[review]` 时只生成审查报告；普通 Issue 生成修改草稿 PR，不自动合并。其他人的 Issue 不触发模型。每个新任务覆盖全部可识别文本，包括 vendor、生成目录和大文件。

- 真实 Zap：https://zapier.com/editor/381096178
- 结果表：`3-Luna-review-results`（`01M36XPZ65N821F3AN8FZCW045`）。
- 报告、清单、覆盖证明与建议修改：对应 Actions 运行的 `luna-review` artifact。
- 手动 Actions 运行设 `plan_only=true`：只输出全量清单和调用估算，无模型、无 SDK 动作。

## 实际流程与 task 费用

GitHub Issue → GitHub Actions 全量清单和分块 → 本 Zap 的 Catch Hook → 仓库/内容/密钥过滤 → Tables 查重 → 未重复才写入 queued 记录 → GitHub Actions 通过官方 SDK 调用 Zapier 内置 Luna → SDK 保存结果 → 校验全部覆盖 → 报告或草稿 PR。

Zap 只有触发器、Filter、普通 Tables，已移除 Zap 中的 AI 节点。官方计费页写明 **SDK 动作在 Beta 期间免费**，但另有 AI 模型档位计费规则；两者在 SDK 调用原生托管 AI 时如何组合，当前证据不足。此前预计 0 tasks 的推断不能作为运行预算。试用账户结束后仍需具备所用 Zap 功能与原生模型的访问权限。

每个任务及每次新模型派发前读取官方计费页；无法确认 SDK 仍处于免费 Beta 就停止。没有收费模型步骤、BYOK、外部模型或付费自动降级路线。`LUNA_MAX_TASKS` 默认 49，程序拒绝配置成 50 及以上；**它不是 Zapier 平台的实际账单硬限额**，避免收费的措施是仅允许免费 SDK 路线、条款不明即停止。账号总用量受其他自动化影响，不能用这个变量约束整个账号。

- 官方计费：https://zapier.com/pricing/rates
- SDK 免费 Beta 说明：https://zapier.com/sdk
- 免费内置步骤：https://help.zapier.com/hc/en-us/articles/8496196837261-How-is-task-usage-measured-in-Zapier

GitHub 无模型验证清单（提交 `a9fb4263`）：42,337 个文件，其中 18,877 个文本路径、23,460 个二进制文件。相同内容去重并按大小装块，初始模型调用估算为 112。**模型调用数与免费 Beta 的计费 tasks 不是同一个数量**。追加上下文、拆分、输入限制会影响实际模型调用数。SDK 对超大输入的实际接收能力和模型端到端行为尚未运行验证。

## 凭证、开关和保护

四项凭证已加密保存到 GitHub Actions Secrets：`ZAPIER_HOOK_URL`、`ZAPIER_CALLBACK_AUTH`、`ZAPIER_SDK_CLIENT_ID`、`ZAPIER_SDK_CLIENT_SECRET`。密钥不进仓库。SDK 凭证可访问其他账户资产，用户已批准其范围，不能宣称仅限本表。

- `LUNA_ENABLED=true` 才处理新 Issue；免费 plan_only 手动验证不受该开关影响。
- `LUNA_MAX_TASKS=49`：仅作为低于 50 的策略门槛，不启用任何收费备用通道。
- `LUNA_MAX_MODEL_CALLS=1000`：免费 SDK 调用的防循环上限，包含追加分块；不是 task 预算。
- `LUNA_CHUNK_TOKENS=650000`：初始输入上限，可调小；追加上下文总输入超过 900000 tokens 时停止。这些不是已实测的 Zapier 输入上限。
- 同一提交、Issue 内容和代码块复用结果。SDK 执行 ID 先持久化再轮询，超时可恢复同一个执行；提交状态不明确时停止，禁止自动创建另一个模型执行。
- 覆盖证明使用 manifest 的 SHA256 和连续索引范围，避免重复输出大量路径造成表字段超限；校验全部索引和对应文件行范围。它证明模型声明的范围完整，不证明模型没有漏掉缺陷。

## 全量和修改边界

枚举固定 SHA 的全部 Git 跟踪文件，不按文件夹过滤。空文件登记，二进制独立登记，不把二进制称为源码审查。源码未知编码、LFS 指针、符号链接、submodule 和超限单行明确停止，不跳过后声称完成。

严格 UTF-8 和 BOM UTF-16 可读；已核对的韩文源码按 CP949，指定第三方源码按 Windows-1252，声明 ISO-8859-1 的 HTML 按其声明解码并验证无损往返。未知非源码数据使用字节转义保留内容；BMD 依据仓库说明登记为加密游戏资源。

修改仅支持已有文件的精确、唯一原文替换；拒绝路径穿越、冲突、无法无损写回的编码及 `.github/` 修改。审查仍覆盖 `.github/`。暂不支持新建/删除文件或 UTF-16 自动修改。不会自动执行模型生成的代码；草稿 PR 标明项目构建和运行测试尚未执行。

## 设置验证

16 项工作器检查通过，包括分块、编码、覆盖、补丁、免费条款失效、SDK 执行 ID 恢复与禁止重复提交。[GitHub Actions 无模型验证](https://github.com/Glace678/3/actions/runs/35882289525) 已成功完成全仓库清单和分块，并保存 artifact。SDK 表读写、字段映射、已发布 Zap 的认证队列及重复请求去重已实际验证，测试记录已清理。设置期间没有调用模型；没有完成实际仓库代码审查，也没有模型端到端或账单实测。

```sh
cd .github/zapier-review
npm ci --ignore-scripts --no-audit --no-fund
npm test
```
