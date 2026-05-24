# MinerU 解析列设计

## 背景

当前插件已经支持精准解析和轻量解析两类 MinerU 结果。精准解析写入 `manifest.json`、`content.md`、`mineru-result.json` 和 `boxes.normalized.json`；轻量解析写入 `lite-manifest.json` 和 `lite-content.md`。用户目前需要进入 Reader 或触发复制、重解析等操作，才能间接知道某个 PDF attachment 是否已有 MinerU 结果。

新增功能需要在 Zotero 条目列表中增加一列，直接标识 PDF attachment 是否已有可用解析结果，并在解析任务运行期间显示对应模式正在解析。

## 目标

- 在 Zotero main item tree 注册一列 `MinerU 解析`。
- 只在 PDF attachment 行显示状态；普通条目、非 PDF 附件和其他行留空。
- 用 badge 显示可用解析结果：`精准`、`轻量`。
- 当 precise/lite 正在解析时，对应 badge 显示为 `精准(解析中)` 或 `轻量(解析中)`。
- precise 和 lite 可以同时出现，顺序固定为 `精准` 在前、`轻量` 在后。
- failed、损坏文件和非 ready manifest 不显示。

## 非目标

- 不汇总普通条目下多个 PDF attachment 的解析状态。
- 不把状态写入 Zotero item 字段、tag、extra 或数据库。
- 不在列中显示失败状态。
- 不改变现有解析入口、Reader overlay、复制逻辑或存储目录结构。

## 用户可见行为

列标题为 `MinerU 解析`。列内容按照 attachment 当前状态组合：

| 状态                            | 显示                    |
| ------------------------------- | ----------------------- |
| 无 ready 结果且未解析           | 留空                    |
| precise ready                   | `精准`                  |
| lite ready                      | `轻量`                  |
| precise 与 lite 都 ready        | `精准` + `轻量`         |
| precise 正在解析，无 ready 结果 | `精准(解析中)`          |
| lite 正在解析，无 ready 结果    | `轻量(解析中)`          |
| precise ready，lite 正在解析    | `精准` + `轻量(解析中)` |
| lite ready，precise 正在解析    | `精准(解析中)` + `轻量` |

如果解析失败、下载失败、写入失败、precise 结果缺少 boxes，或者 lite Markdown 为空，运行中 badge 会被清除。清除时需要重新读取该 attachment 的磁盘 ready 状态，避免误删已有的 ready badge。

## 方案选择

采用 Zotero 自定义列 API 加运行时缓存：

- 使用 `Zotero.ItemTreeManager.registerColumn()` 注册列。
- 使用同步 `dataProvider` 和 `renderCell` 渲染单元格。
- 运行时状态缓存在 `addon.data` 中，不写入磁盘。
- 启动时扫描插件结果目录，建立 ready 状态缓存。
- 解析开始、成功、失败时更新对应 attachment 的缓存并刷新列。
- 自定义列是 Zotero 全局注册项，注册函数必须 idempotent，避免多个 main window load 时重复注册。

不采用单元格实时读磁盘方案，因为 `dataProvider` 是同步接口，滚动条目列表时反复 IO 会影响大库性能。也不采用 tag/extra 字段方案，因为这会污染用户库数据，并且状态会与插件结果目录产生双写一致性问题。

## 运行时缓存

缓存放在 `addon.data.itemTreeColumn` 下：

```ts
type ParseColumnModeState = "none" | "ready" | "running";

type ParseColumnStatus = {
  precise: ParseColumnModeState;
  lite: ParseColumnModeState;
};

type ItemTreeColumnState = {
  registeredDataKey?: string;
  statuses: Map<string, ParseColumnStatus>;
};
```

缓存 key 使用存储目录同款稳定键：`${libraryID}-${attachmentKey}`。

ready 的真实来源仍然是磁盘结果目录。缓存只是为了满足 Zotero item tree 同步渲染要求。running 是当前会话内状态，Zotero 重启后不应继续显示 `解析中`。

## 模块边界

新增 `src/modules/itemTreeColumn.ts`，集中处理列注册、状态缓存和渲染。

公开函数建议：

- `registerItemTreeColumn()`: 注册 `MinerU 解析` 列，初始化运行时缓存，并触发 ready 状态扫描。
- `unregisterItemTreeColumn()`: shutdown 时注销列并清理缓存。
- `markAttachmentParseRunning(ref, mode)`: 将指定 attachment 的指定模式标为 `running`。
- `markAttachmentParseReady(ref, mode)`: 将指定 attachment 的指定模式标为 `ready`。
- `clearAttachmentParseRunning(ref, mode)`: 清除指定模式的 running 状态，并重新读取该 attachment 的磁盘 ready 状态。
- `createMinerUParseColumnRegistration(...)`: 返回可测试的 column options。
- `getMinerUParseColumnToken(item)`: 根据 item 和 cache 返回渲染 token。
- `renderMinerUParseCell(...)`: 将 token 渲染为 badge DOM。

`hooks.ts` 只负责 lifecycle 调度：

- main window load 后调用 `registerItemTreeColumn()`；该函数内部检测是否已经注册。
- shutdown 调用 `unregisterItemTreeColumn()`。

`parseManager.ts` 只在解析状态边界调用 column 模块：

- 文件可读且即将提交任务前标记 running。
- precise/lite 成功写入后标记 ready。
- 所有失败或提前返回路径清理 running。

## Storage 扩展

`storage.ts` 新增窄接口，避免 column 模块直接解析 manifest 文件：

```ts
readParseStatus(ref): Promise<{
  preciseReady: boolean;
  liteReady: boolean;
}>;

listParseStatuses(): Promise<
  Map<string, { preciseReady: boolean; liteReady: boolean }>
>;
```

判定规则：

- `preciseReady`: `manifest.json` 存在且 `status === "ready"`。
- `liteReady`: `lite-manifest.json` 存在、`status === "ready"`、`mode === "lite"`，且 `lite-content.md` 非空。
- failed、损坏 JSON、缺失 Markdown、空 lite Markdown 都按 not ready 处理。

`listParseStatuses()` 只扫描 `ProfD/mineru-copy/attachments/` 下的插件结果目录，忽略 `.tmp-*` 和 `.bak-*` transient 目录。

## 数据流

启动数据流：

1. 插件完成 Zotero 初始化和 locale 初始化。
2. main window load 时注册 `MinerU 解析` 自定义列。
3. 调用 `storage.listParseStatuses()` 扫描已有结果。
4. 将 ready 状态写入 `addon.data.itemTreeColumn.statuses`。
5. 调用 `Zotero.ItemTreeManager.refreshColumns()` 刷新条目列表列数据。

解析数据流：

1. `parseManager` 确认 attachment 是 PDF 且文件可读。
2. 根据当前 `parseMode` 调用 `markAttachmentParseRunning(ref, mode)`。
3. 提交、轮询、下载 MinerU 任务。
4. precise 成功写入 `writeResult()` 后调用 `markAttachmentParseReady(ref, "precise")`。
5. lite 成功写入 `writeLiteResult()` 后调用 `markAttachmentParseReady(ref, "lite")`。
6. 任何错误路径调用 `clearAttachmentParseRunning(ref, mode)`。
7. 每次状态变化后调用 `Zotero.ItemTreeManager.refreshColumns()`。

批量解析中，每个 attachment 独立更新状态，不等待整个 batch 完成。

## 渲染设计

`dataProvider` 只做同步计算：

- 非 PDF attachment 返回空 token。
- PDF attachment 根据 `libraryID-key` 查缓存。
- 输出紧凑 token，例如 `precise`, `lite`, `precise-running|lite`。

`renderCell` 根据 token 创建 badge：

- `precise`: `精准`
- `lite`: `轻量`
- `precise-running`: `精准(解析中)`
- `lite-running`: `轻量(解析中)`

样式写入 `addon/content/zoteroPane.css`。单元格容器使用横向 flex 和固定 gap。badge 不依赖颜色表达语义，文字必须完整可读。列宽使用固定或静态初始宽度，优先保证两个 badge 同时出现时仍可扫描；列属性持久化 `width` 和 `hidden`。

列标题和 badge 文案继续走 Fluent locale。本设计中的 `MinerU 解析`、`精准`、`轻量` 和 `解析中` 是 zh-CN 文案；en-US 需要提供对应英文文案，避免新增硬编码 UI 字符串。

## 错误处理

- 列注册失败只记录日志，不阻止插件其他功能启动。
- 启动扫描失败时按空状态处理，不弹用户提示。
- 单个 attachment 状态读取失败只影响该行。
- `clearAttachmentParseRunning()` 重新读取磁盘状态失败时，将对应 running 模式清为 `none`，保留其他模式已有缓存。
- shutdown 时注销列失败只记录日志，继续执行现有清理流程。

## 测试范围

新增或更新测试：

- `storage.test.ts`
  - `readParseStatus()` 覆盖 precise ready、lite ready、二者都有、无结果。
  - failed precise manifest 不显示。
  - 损坏 manifest、缺失 lite Markdown、空 lite Markdown 不显示。
  - `listParseStatuses()` 忽略 `.tmp-*` 与 `.bak-*` 目录。
- `itemTreeColumn.test.ts`
  - 普通条目、非 PDF 附件留空。
  - PDF attachment 按 cache 返回 token。
  - precise/lite badge 顺序固定。
  - running 与 ready 正确合并。
  - clear running 后重新读取磁盘 ready 状态。
  - renderCell 生成 badge DOM 和 CSS class。
- `parseManager.test.ts`
  - 解析开始标记当前模式 running。
  - precise 成功后标记 precise ready。
  - lite 成功后标记 lite ready。
  - submit/poll/download/write 失败后清理 running。
  - empty boxes 与 empty lite Markdown 清理 running。
- `startup.test.ts`
  - 启动注册自定义列。
  - shutdown 注销自定义列。

最终验证使用：

```powershell
pnpm lint:check
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```
