# 解析任务提示优化设计

## 背景

当前 `parseManager` 在提交解析时统一提示 `parse-started`，精准解析完成时提示 `parse-finished`，轻量解析完成时提示 `parse-lite-finished`。提示没有体现当前 API 来源，也没有在批量解析时显示任务总数和完成进度。

项目已经支持两个独立配置维度：

- API 来源：在线 API、本地 API。
- 解析模式：精准解析、轻量解析。

因此用户在不同组合下触发解析时，需要从提示中明确知道当前使用的是哪一种 API 和解析模式。批量解析时，还需要知道本轮一共提交了几个任务，以及完成通知对应第几个已完成任务。

## 目标

- 提交解析和解析完成提示区分 API 来源与解析模式。
- 单个解析任务使用两行提示：第一行固定说明动作，第二行显示当前配置组合。
- 多个解析任务使用两行提示：第一行固定说明动作或完成状态，第二行显示当前配置组合与总数或完成进度。
- 批量解析保持现有并发行为，完成进度按任务实际完成顺序递增。
- 已跳过的已有结果不计入本轮提交总数。

## 非目标

- 不改变解析 API、存储格式、Reader overlay 或复制逻辑。
- 不把批量解析改为串行。
- 不给每一类错误提示都增加批量进度，错误提示继续沿用现有错误分类。
- 不新增右键菜单或设置项。

## 提示文案

提交提示的主文案固定为：

```text
已提交 MinerU 文档解析任务
```

完成提示的主文案固定为：

```text
MinerU 文档解析任务完成
```

第二行使用方括号显示上下文。中文文案使用中文标点和 `·` 分隔：

```text
[在线 API · 精准]
[在线 API · 精准 · 共 3 个]
[在线 API · 精准 · 1/3]
```

四种组合的中文标签为：

- `online + precise`: `在线 API · 精准`
- `online + lite`: `在线 API · 轻量`
- `local + precise`: `本地 API · 精准`
- `local + lite`: `本地 API · 轻量`

英文 locale 保持相同信息结构，使用英文标签和 `·` 分隔：

```text
MinerU document parse task submitted
[Online API · Precise]

MinerU document parse task submitted
[Online API · Precise · 3 total]

MinerU document parse task finished
[Online API · Precise · 1/3]
```

## 单个任务流程

单个 attachment 解析时，`parseAttachmentWithDependencies()` 在读取当前 `source` 与 `mode` 后生成提示上下文。

提交阶段显示：

```text
已提交 MinerU 文档解析任务
[API 来源 · 解析模式]
```

完成阶段显示：

```text
MinerU 文档解析任务完成
[API 来源 · 解析模式]
```

轻量解析与精准解析使用同一套提示结构，只通过第二行标签区分模式。这样可以避免主文案继续分裂为 `parse-finished` 与 `parse-lite-finished` 两套语义。

## 批量任务流程

`parseAttachmentsWithDependencies()` 在确认本轮实际需要解析的 `attachmentsToParse` 后创建批量提示上下文：

- `total`: 本轮实际提交解析的 PDF 数量。
- `completed`: 初始为 `0`，每个任务成功写入结果后递增。

提交阶段每个实际提交的任务都显示本轮总数：

```text
已提交 MinerU 文档解析任务
[API 来源 · 解析模式 · 共 N 个]
```

完成阶段按实际完成顺序递增：

```text
MinerU 文档解析任务完成
[API 来源 · 解析模式 · K/N]
```

如果已有解析结果被用户选择“使用已有结果”，这些 attachment 不计入 `total`。如果过滤后没有需要重新解析的任务，则只保留现有“使用已有解析结果”提示，不额外显示提交提示。

批量解析继续使用并发执行。`K/N` 表示第 `K` 个完成的任务，而不是选中列表中的第 `K` 个 attachment。

## 架构边界

新增小型提示 helper，集中处理提示文案选择和参数：

- 根据 `source` 与 `mode` 生成组合标签。
- 根据是否存在 `total` 生成单任务或批量任务上下文。
- 根据提交或完成阶段生成 Fluent message id 与参数。

`parseManager` 的主体流程只传递上下文，不直接拼接大量提示字符串。这样可以保持解析流程代码聚焦在任务提交、轮询、下载和写入。

`showMessage()` 仍然接收 Fluent message id 与参数，并使用 `ztoolkit.ProgressWindow` 展示。多行文案由 Fluent message 本身或参数组合生成，避免在业务代码中硬编码中英文字符串。

## 错误处理

错误提示保持当前行为：

- 缺少 API Key、文件不可读、上传失败、MinerU 解析失败、下载失败、写入覆盖失败等提示继续使用现有分类。
- 批量解析中单个任务失败时，不递增完成计数。
- 失败任务不阻止其他并发任务继续完成。
- 如果某个任务失败后其他任务完成，后续完成提示继续按成功完成数量递增。

## Locale 设计

新增或调整 `mainWindow.ftl` 中的解析提示 key。实现时优先使用结构化 key，避免在 TypeScript 中硬编码用户可见文案。

中文 locale 需要表达：

- 已提交 MinerU 文档解析任务
- MinerU 文档解析任务完成
- 在线 API
- 本地 API
- 精准
- 轻量
- 共 `{ $total }` 个
- `{ $completed }/{ $total }`

英文 locale 需要表达对应信息：

- MinerU document parse task submitted
- MinerU document parse task finished
- Online API
- Local API
- Precise
- Lite
- `{ $total } total`
- `{ $completed }/{ $total }`

`typings/i10n.d.ts` 由 scaffold 生成流程更新，不手写长期维护。

## 测试范围

更新 `test/parseManager.test.ts`：

- 单个 `online + precise` 提交和完成提示包含正确 message id 与参数。
- 单个 `online + lite` 提交和完成提示包含正确 message id 与参数。
- 单个 `local + precise` 提交和完成提示包含正确 message id 与参数。
- 单个 `local + lite` 提交和完成提示包含正确 message id 与参数。
- 批量解析提交提示包含实际提交总数。
- 批量解析完成提示按完成顺序显示 `1/N`、`2/N`。
- 用户选择使用已有结果时，跳过的 attachment 不计入批量总数。
- 批量中某个任务失败时，成功任务完成计数只统计成功完成的任务。

更新 locale 相关测试时，只验证 key 和参数语义，不依赖 Zotero 真实窗口渲染。

## 验证

实现后运行：

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

如改动触发格式检查问题，再运行项目已有 lint 检查或针对受影响文件做最小格式修复。
