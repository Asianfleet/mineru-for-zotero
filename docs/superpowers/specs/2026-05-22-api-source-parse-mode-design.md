# API 来源与解析模式设计

## 背景

当前插件只支持在线 MinerU 精准解析 API。精准解析会产出 Markdown、原始 JSON、normalized boxes 和可选图片，并支持 Reader overlay 与框选复制。

新功能需要把 API 调用拆成两个独立维度：

- 来源：在线 API、本地部署 API。
- 模式：精准解析、轻量解析。

默认组合为“在线 API + 精准解析”。所有解析入口继续使用现有命令，不在右键菜单或 Reader 工具栏中增加临时模式选择。用户点击“解析”时，插件始终读取偏好设置中的当前来源与模式。

## 目标

- 支持在线 API 与本地部署 API 两种来源。
- 支持精准解析与轻量解析两种模式。
- 轻量解析只保存 Markdown，不生成 boxes，不影响精准解析结果。
- 本地 API 调用也使用异步任务流程，与当前在线精准解析的调用形态保持一致。
- “复制全文 markdown”优先使用精准解析结果；只有轻量解析结果时才使用轻量结果。

## 非目标

- 不新增右键菜单或 Reader 工具栏中的解析模式选择。
- 不把轻量解析结果用于 Reader overlay。
- 不让轻量解析结果覆盖 `content.md`、`mineru-result.json` 或 `boxes.normalized.json`。
- 第一版不暴露本地 API 的高级产物开关。

## 偏好设置

新增偏好项：

- `parseSource`: `online` 或 `local`，默认 `online`。
- `parseMode`: `precise` 或 `lite`，默认 `precise`。
- `localApiBaseURL`: 默认 `http://127.0.0.1:8000`。

偏好页新增：

- API 来源选择：在线 API、本地部署 API。
- 解析模式选择：精准解析、轻量解析。
- 本地 API 地址输入框。

现有 API Key 输入框保留。只有“在线 API + 精准解析”时，解析前才要求 API Key。在线轻量解析使用 Agent 轻量解析 API，不要求 API Key。本地部署 API 不要求 API Key。

现有 `saveImages` 只对精准解析生效。轻量解析只保存 Markdown，不保存图片。

## Client 架构

保留现有 `MinerUClient` 三段式抽象：

- `submitPdf(filePath) -> { taskID }`
- `pollTask(taskID) -> running | succeeded | failed`
- `downloadResult(taskID) -> result`

`downloadResult` 的结果类型扩展为两类：

- `precise`: 包含 `rawResult`、`markdown` 和可选 `images`。
- `lite`: 只包含 `markdown`。

新增 client factory，根据 `parseSource` 和 `parseMode` 创建具体 client。`parseManager` 不关心来源，只根据结果类型决定写完整结果还是轻量结果。

## 四种组合

### 在线 API + 精准解析

沿用当前官方 v4 batch flow：

1. `POST /api/v4/file-urls/batch` 获取 batch ID 和 presigned upload URL。
2. PUT PDF bytes 到 presigned URL。
3. `GET /api/v4/extract-results/batch/{batch_id}` 轮询。
4. 下载 `full_zip_url`，回退 `md_url`。

产物写入现有完整解析结果。

### 在线 API + 轻量解析

新增在线 Agent 轻量解析 client。该 API 免 Token，只有 Markdown，没有 box 数据。结果类型为 `lite`，只写入 `lite-content.md`。

在线本地文件走 Agent 文件上传异步流程：

1. `POST https://mineru.net/api/v1/agent/parse/file`，传入 `file_name` 等 JSON 参数，获取 `task_id` 和 `file_url`。
2. PUT PDF bytes 到返回的 `file_url`。
3. `GET https://mineru.net/api/v1/agent/parse/{task_id}` 轮询。
4. `state=done` 后下载 `markdown_url`。

提交参数固定为轻量语义：

- `language=ch`
- `enable_table=false`
- `enable_formula=false`
- `is_ocr=false`

### 本地部署 API + 精准解析

使用本地 MinerU 异步任务 API：

1. `GET {localApiBaseURL}/health` 做健康检查。
2. `POST {localApiBaseURL}/tasks` 提交 multipart 任务。
3. `GET {localApiBaseURL}/tasks/{task_id}` 轮询。
4. `GET {localApiBaseURL}/tasks/{task_id}/result` 下载结果。

提交参数固定为：

- `return_md=true`
- `return_middle_json=true`
- `return_model_output=false`
- `return_content_list=true`
- `return_images=<saveImages>`
- `response_format_zip=true`
- `formula_enable=true`
- `table_enable=true`
- `parse_method=auto`
- `backend=hybrid-auto-engine`

结果优先用 `middle_json` 作为 `rawResult`，用于 `normalizeMinerUBoxes()`。如果 ZIP 或 JSON 响应中只有 `content_list` 可用，可作为后备 raw result。

### 本地部署 API + 轻量解析

同样使用本地异步任务 API，并在提交前做 `/health` 检查。

提交参数固定为：

- `return_md=true`
- `return_middle_json=false`
- `return_model_output=false`
- `return_content_list=false`
- `return_images=false`
- `response_format_zip=false`
- `formula_enable=true`
- `table_enable=true`
- `parse_method=auto`
- `backend=hybrid-auto-engine`

结果类型为 `lite`，只写入 `lite-content.md`。

## 存储设计

精准解析结果保持现有文件：

- `manifest.json`
- `mineru-result.json`
- `content.md`
- `boxes.normalized.json`
- `images/`

轻量解析在同一 attachment 目录下新增：

- `lite-content.md`
- `lite-manifest.json`

覆盖规则：

- 精准解析只覆盖精准结果，不删除或覆盖 `lite-content.md`。
- 轻量解析只覆盖 `lite-content.md` 和 `lite-manifest.json`，不修改 `content.md`、`mineru-result.json` 或 `boxes.normalized.json`。
- 在线轻量和本地轻量共用 `lite-content.md`；后一次轻量解析覆盖前一次轻量结果。
- `manifest.json` 只表示精准解析 ready 状态，不被轻量解析修改。

新增 storage 能力：

- `hasLiteResult(ref)`: 判断 `lite-content.md` 是否存在且非空。
- `writeLiteResult(input)`: 写入 `lite-content.md` 和 `lite-manifest.json`。
- `readPreferredMarkdown(ref)`: 先读 ready 精准结果的 `content.md`，没有精准结果时再读 `lite-content.md`。

`readMarkdown(ref)` 保持现有精准解析语义，避免影响 Reader overlay 和精准结果判断。

## 已有结果判断

解析前的“重新解析 / 使用现有结果”按当前模式分别判断：

- 当前模式为精准解析：沿用 `hasReadyResult()`。
- 当前模式为轻量解析：使用 `hasLiteResult()`。

精准结果和轻量结果互不阻塞：

- 已有精准结果不会阻止轻量解析。
- 已有轻量结果不会阻止精准解析。

## 复制全文 Markdown

“复制全文 markdown”语义为精准优先、轻量兜底：

1. 如果当前 attachment 有 ready 精准解析结果，复制 `content.md`。
2. 如果没有 ready 精准解析结果，但有轻量解析结果，复制 `lite-content.md`。
3. 如果两者都没有，按缺少解析结果处理。

如果用户已选中 boxes，则仍复制选中 boxes，不读取轻量结果。

轻量解析结果不会启用 Reader overlay，也不会让 overlay mode 变为可用。

## 错误处理

- “在线 API + 精准解析”缺少 API Key 时，提示配置 API Key。
- “在线 API + 轻量解析”不检查 API Key。
- 本地来源不检查 API Key。
- 本地 API 地址为空或非法时，提示配置本地 API 地址。
- 本地 `/health` 失败时，提示本地 API 服务不可用，并停止提交任务。
- 精准解析返回结果但无法生成 boxes 时，保留现有空 boxes 错误。
- 轻量解析没有 boxes 是正常行为，不触发空 boxes 错误。
- 轻量解析返回空 Markdown 时，不写入 `lite-content.md`，提示轻量解析结果为空。
- 写入轻量结果失败时，只提示轻量结果写入失败，不影响已有精准结果。

## 测试范围

新增或更新测试：

- `prefs`: 默认值为 `online`、`precise`、`http://127.0.0.1:8000`。
- `parseManager`: 只有在线精准解析检查 API Key；在线轻量解析和本地来源不检查 API Key。
- `parseManager`: 精准结果走 normalize 和 `writeResult()`。
- `parseManager`: 轻量结果跳过 normalize，走 `writeLiteResult()`。
- `parseManager`: 当前模式分别使用精准或轻量已有结果判断。
- `storage`: `lite-content.md` 和 `lite-manifest.json` 写入、读取、覆盖。
- `storage`: `readPreferredMarkdown()` 精准优先，轻量兜底。
- `readerOverlay`: 无选中 boxes 时复制全文 Markdown 使用 `readPreferredMarkdown()`。
- `mineruClient`: 在线精准现有测试保持。
- `mineruClient`: 本地精准提交 `/tasks` 的 multipart 参数正确。
- `mineruClient`: 本地轻量只请求 Markdown 产物。
- `mineruClient`: 本地 `/health` 失败会阻止任务提交。
- `mineruClient`: 本地轮询状态映射正确。
- `mineruClient`: 本地结果 ZIP 或 JSON 中提取 Markdown、middle JSON、content list 和 images。
- `mineruClient`: 在线轻量使用 `/api/v1/agent/parse/file`、签名上传和 `/api/v1/agent/parse/{task_id}`，只返回 Markdown，不尝试生成 boxes。

## 实施顺序建议

1. 扩展偏好项、类型声明和偏好页 UI。
2. 扩展 `MinerUClient` 结果类型与 client factory。
3. 增加本地异步 API client。
4. 增加在线轻量 API client。
5. 扩展 storage 的轻量结果与 preferred Markdown 读取。
6. 调整 `parseManager` 按结果类型分支写入。
7. 调整复制全文 Markdown 读取逻辑。
8. 补齐 locale、单元测试和最终 scaffold 测试。
