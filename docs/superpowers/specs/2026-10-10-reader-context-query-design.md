# CLI 与 MCP 阅读上下文查询设计

## 已确认需求

支持查询所有打开 tab 或当前激活 tab 对应条目的 ID、标题和 MinerU 解析情况；支持读取所有 PDF Reader 或当前激活 tab 的全部已选 MinerU box 的 Markdown。当前激活 tab 的选择不受屏幕可视区域限制。

## 命令与工具

| 能力         | CLI 子命令                           | MCP 工具                             |
| ------------ | ------------------------------------ | ------------------------------------ |
| 查询条目 tab | `tabs list --scope all\|active`      | `zotero_list_tabs({scope})`          |
| 查询已选 box | `boxes selected --scope all\|active` | `mineru_get_selected_boxes({scope})` |

两者默认 `scope=active`。CLI 沿用端口、token、超时和 `--format text|json` 参数，无需 `--library-id` 或 `--key`。MCP 参数使用 camelCase，scope 枚举为 `all`、`active`。

HTTP 新增 `GET /mineru-for-zotero/tabs?scope=...` 与 `GET /mineru-for-zotero/boxes/selected?scope=...`。复用现有 API 开关和鉴权，不改变现有查询路径或参数。

## 范围与标识

- `tabs all` 枚举所有主窗口中的条目 tab，包括未加载 tab；每个窗口内按 tab 顺序返回，窗口按运行时枚举顺序返回。同一文献的不同 tab 分别保留。
- 排除没有单一对应条目的图书馆 tab，保留非 PDF 条目 tab。
- `active` 使用最近活动的 Zotero 主窗口中选中的 tab。切换到终端后仍使用该主窗口。独立 Reader 窗口不替代主窗口的激活 tab。
- 无主窗口或当前为图书馆 tab 时返回正常空结果，不回退到其他论文。
- `boxes all` 枚举仍存活的 PDF Reader，包括主窗口后台 tab 和独立 Reader 窗口；不包含关闭后的残留 overlay state。
- 同一附件在不同 Reader 中的选择分别返回。按主窗口及 tab 顺序排列对应 Reader，独立 Reader 按运行时枚举顺序排列。
- `itemId/itemKey/title` 对应父文献；独立附件对应附件自身。附件标识始终对应实际打开的附件，不重新自动选择 PDF。

## tab 响应

服务响应为 `{scope, tabs}`，空结果为 `tabs: []`。每条记录包含：

| 字段                                      | 含义                                                   |
| ----------------------------------------- | ------------------------------------------------------ |
| `tabId`                                   | Zotero tab 标识                                        |
| `active`                                  | 是否为该 tab 所属主窗口的选中 tab                      |
| `libraryId`、`itemId`、`itemKey`、`title` | 父文献或独立附件标识与标题                             |
| `attachmentId`、`attachmentKey`           | 实际打开的附件标识；非附件条目为 null                  |
| `tabTitle`                                | tab 自身标题                                           |
| `status`                                  | `ok`、`item-unavailable` 或 `parse-status-unavailable` |
| `parseStatus`                             | PDF 的解析情况；非 PDF 或无法读取时为 null             |

`item-unavailable` 时保留 tabId、active、tabTitle，可解析的标识保留，其余条目标识与标题为 null，不能使整个列表失败。

`parseStatus` 包含 `preciseReady`、`liteReady`、`preciseRunning`、`liteRunning` 四个布尔字段，以及 `preferredMode: precise|lite|null`。就绪信息来自 storage 的 `readParseStatus()`；运行信息来自现有按 libraryID 和 attachmentKey 索引的解析状态。精确结果就绪时优先 precise，否则轻量结果就绪时为 lite，两者均未就绪时为 null。

Ready 与 Running 可同时为 true，表示重新解析期间旧结果仍可读取。读取失败标记 `parse-status-unavailable`，不能伪装成未解析。非 PDF 的 status 为 ok，parseStatus 为 null。

CLI text 输出每个 tab 的条目标识、标题、附件 key、激活标记和两种模式的就绪/运行情况。CLI JSON 沿用现有成功 envelope；MCP 返回 structuredContent 和可读 text。

## 已选 box 响应

服务响应为 `{scope, readers}`。每组包含 `readerInstanceId`、`tabId`（独立窗口为 null）、条目与附件标识和标题、`status`、`selectedCount`、`boxes`、`markdown`、`missingRawIndexes`。

- `boxes` 每项包含 rawIndex、page、type、markdown，按 rawIndex 升序排列；page 沿用 normalized box 的现有页码约定。
- 单 box 的 markdown 复用 `formatBoxForCopy()`，组 markdown 复用 `formatBoxesForCopy()`，保持公式定界符及空行连接行为一致。
- 图片保持 Markdown 引用，不嵌入图片 base64。来源附件标识可用于后续图片查询。
- 无选择的 Reader 不返回。全部无选择或无目标 Reader 时 readers 为空，CLI/MCP 文本只显示“No selected boxes.”，不附带 tab 或 Reader 信息。
- selectedCount 是查询快照中的选中索引数，不一定等于成功读取的 boxes 数量。
- 部分索引失效返回 `status: stale-selection` 和 missingRawIndexes，同时保留成功读取的内容；解析结果不可用返回 `status: parse-result-unavailable`。
- 单组错误不丢弃其他组的成功结果。HTTP 返回 200 并保留逐组状态；MCP 存在非空选择错误时标记 isError，CLI 对同类情况退出 1。正常空选择退出 0。
- text 输出按 Reader 分组标注来源和状态，不将不同文献内容无标识地拼接。

读取不得写剪贴板、回退全文、清空选择、创建 overlay state、切换 tab、下载或触发解析。选择仅指插件 box 选择，不包括原生 PDF 文本选择或文本面板内的局部选择。

## 实现结构

新增 `src/modules/readerQuery/`，包含 types、运行时适配器、query service 与 apiEndpoint。运行时适配器集中处理窗口、tab、Reader 和父条目解析；service 通过注入依赖组合运行时快照、storage 和格式化函数。

tab 发现基于 Zotero tab 元数据，Reader 实例仅用于补充信息，避免遗漏未加载 tab。官方源码确认 getState 是持久化快照，不含运行时 tab ID，读取 `_tabs` 获取 ID 和 data.itemID。getMainWindow 返回最近活动的主窗口；Reader 的 tabID 与 \_window 用于区分 tab 与独立窗口。已在 scaffold 验证接口可访问性，Zotero 8/9 的多窗口实际交互仍需分别手动验证。

为 overlay 提供只读选择快照接口，为解析状态提供只读运行信息接口，不调用会创建 state 的 getter。请求开始时同步复制目标标识和选中索引，再进行异步 storage 读取；请求中途切换 tab、改变选择或关闭 Reader 不改变已获取的快照范围。

就绪状态启用 storage 的可选 strict 读取，区分不存在的 manifest 与读取或 JSON 损坏。box 内容复用 readBoxes，沿用其必要时刷新旧 normalized 缓存文件的约定；只读指不改变用户选择、UI、剪贴板及解析任务，不承诺完全不更新插件维护的缓存。

CLI 保持 HTTP 薄适配器；MCP 在 McpQueryContext 中接入 service 并直接调用，不经 HTTP 回环。新增 HTTP endpoint 在 startup 注册、shutdown 注销，不在窗口加载时注册；运行时窗口引用随生命周期释放。

## 验证与文档

回归测试覆盖父文献与独立附件、未加载 tab、非 PDF tab、图书馆激活空结果、多主窗口、独立 Reader、同附件多个 Reader、解析就绪与运行并存、跨页 rawIndex 顺序、空选择、失效索引、单组失败和请求期间选择变化。

适配层验证 CLI 参数与输出、鉴权、HTTP 状态、MCP schema 和映射；运行时手动验证 Zotero 8/9 的 tab 元数据与最近活动主窗口语义。同步更新 README.md、README_zh.md、CLI help 和 CLI/MCP 两份 SKILL.md。

实施后运行构建、完整 scaffold 测试、相关独立 Node 测试及最终 lint。当前设计阶段仅格式化和验证本规格文档，不执行会启动 Zotero 的代码测试。
