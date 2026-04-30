# MinerU PDF Box 快速复制插件设计

## 背景

目标是在 Zotero 插件中为 PDF attachment 增加 MinerU 解析入口，并在 Zotero PDF reader tab 中基于 MinerU 输出的 box 信息实现快速复制。插件面向 Zotero 7，必须兼容最新版 Zotero reader 的 split view：同一个 tab 内可能同时存在多个 PDF reader pane，每个 pane 都需要独立的 overlay 状态。

当前仓库基于 `zotero-plugin-template`，已有 Zotero 7 生命周期、右键菜单、reader item pane、设置页和 `zotero-plugin-toolkit` 示例。实现时应沿用模板结构，但不能继续把业务逻辑塞进 `examples.ts`，需要拆分为独立模块。

## 已确认范围

- MinerU 对接方式：官方 MinerU API。
- 设置项：MVP 只暴露 API Key，不暴露模型、语言、OCR 等高级解析参数。
- 解析入口：条目或附件右键菜单中的“使用 MinerU 解析 PDF”。
- Reader 入口：PDF tab 工具栏按钮，用于切换 overlay 模式和执行已选 box 复制。
- 未解析时：PDF tab 中提示“当前 PDF 尚未解析”，并提供“立即解析”按钮。
- 已解析时重复解析：弹出确认，让用户选择“使用已有结果”或“重新解析并覆盖”。
- 解析结果存储：插件数据目录，按 attachment 隔离；外部程序可通过稳定文件路径读取解析内容。
- 设置页：提供 API Key 输入框和“打开数据文件夹”按钮。
- 复制格式：默认复制 Markdown。
- 公式 box：复制按钮拆成“带 $ 复制”和“不带 $ 复制”。
- 多选：支持 `Shift` 或 `Ctrl` 点击多个 box。
- 多选复制入口：PDF tab 工具栏按钮菜单中的“复制已选 box”。
- 多选合并顺序：按 MinerU JSON 原始顺序。

不纳入 MVP：

- 本地 HTTP 服务。
- 解析历史版本管理。
- 每次解析时的高级参数选择。
- 底部浮动多选工具条。
- 拖拽框选多个 box。

## 架构

插件拆为五个核心模块：

1. `mineruClient`
   - 负责 MinerU 官方 API 调用。
   - 包含上传 URL 获取、PDF 上传、任务提交、任务轮询、结果下载。
   - 对外只暴露面向业务的接口，例如 `submitPdf(filePath)`、`pollTask(taskID)`、`downloadResult(taskID)`。

2. `parseManager`
   - 编排 Zotero attachment 到 MinerU 解析任务的完整流程。
   - 检查 attachment 是否为 PDF、是否已有解析结果、是否配置 API Key。
   - 负责“使用已有结果 / 重新解析并覆盖”的确认对话框。
   - 负责进度提示和错误提示。

3. `storage`
   - 管理插件数据目录布局。
   - 将 MinerU 原始结果、Markdown、normalized box 数据和 manifest 写入稳定路径。
   - 使用临时目录写入和原子替换策略，避免重新解析失败时破坏旧结果。

4. `readerOverlay`
   - 在 PDF reader pane 上挂载 overlay。
   - 按 `reader instance + attachment key` 管理状态，不能用全局 current tab 状态替代。
   - 负责 box 坐标映射、hover 命中、多选、复制按钮、模式切换和销毁。

5. `settings`
   - 提供 API Key 配置。
   - 提供“打开数据文件夹”按钮。
   - 显示数据目录路径和已保存解析结果数量。

`hooks.ts` 只做生命周期和入口注册：主窗口加载时注册右键菜单、reader 工具栏按钮、设置页脚本；主窗口卸载和插件关闭时注销所有 UI 与 overlay。

## 数据流

1. 用户在 Zotero 条目或 PDF attachment 上右键，点击“使用 MinerU 解析 PDF”。
2. `parseManager` 获取选中的 attachment，确认它是 PDF 且本地文件可读。
3. `storage` 检查该 attachment 是否已有解析结果。
4. 如果已有结果，弹出确认：
   - 使用已有结果：直接结束，并提示可在 PDF tab 中启用 overlay。
   - 重新解析并覆盖：进入解析流程。
5. `mineruClient` 使用 API Key 调用 MinerU 官方 API。
6. 上传、解析、轮询完成后，下载 Markdown 和含 box 信息的 JSON。
7. `storage` 写入临时目录，生成 normalized box 数据，校验 manifest 后替换正式目录。
8. 用户打开 PDF reader tab，点击工具栏按钮切换 overlay 模式。
9. `readerOverlay` 从 `storage` 读取当前 reader instance 对应 attachment 的 normalized box 数据并渲染。
10. 用户复制单个 box 或工具栏菜单中的已选 box 集合。

## 存储布局

数据根目录为插件数据目录下的 `mineru-copy/`：

```text
mineru-copy/
  attachments/
    <libraryID>-<attachmentKey>/
      manifest.json
      mineru-result.json
      content.md
      boxes.normalized.json
```

文件含义：

- `manifest.json`：记录 attachment id、attachment key、libraryID、PDF 文件名、PDF 修改时间、解析时间、MinerU task id、结果版本、状态。
- `mineru-result.json`：保留 MinerU 原始 JSON，便于调试和外部程序读取完整数据。
- `content.md`：保存整体 Markdown。
- `boxes.normalized.json`：插件内部稳定结构，供 overlay 和外部程序读取。

`boxes.normalized.json` 的每个 box 至少包含：

```json
{
  "rawIndex": 0,
  "page": 1,
  "type": "text",
  "bbox": {
    "x": 0.1,
    "y": 0.2,
    "width": 0.3,
    "height": 0.05
  },
  "markdown": "box 对应的 Markdown 内容",
  "formula": null
}
```

坐标优先归一化到页面宽高的 `0..1` 范围，减少不同 zoom、旋转和 split view pane 尺寸带来的映射复杂度。原始坐标保留在 `mineru-result.json`。

## Reader UI 行为

PDF tab 工具栏增加一个插件按钮。菜单包含：

- `显示全部 box`
- `仅显示鼠标所在 box`
- `关闭插件能力`
- `复制已选 box (N)`
- `清空选择`

未解析时，菜单或 reader 内提示：

- “当前 PDF 尚未解析”
- “立即解析”按钮，触发与右键菜单相同的解析流程

三种模式：

1. 显示全部 box
   - 所有 box 显示边框，内部透明。
   - 鼠标 hover 的 box 内部变为浅蓝色。
   - 不主动显示复制按钮，避免页面过载。

2. 仅显示鼠标所在 box
   - 默认不显示 overlay box。
   - 鼠标 hover 命中 box 时显示蓝色边框和浅蓝色填充。
   - box 左上角显示类型标签。
   - box 下方显示复制按钮。
   - 公式 box 的复制按钮拆成“带 $ 复制”和“不带 $ 复制”。

3. 关闭插件能力
   - 移除 overlay DOM。
   - 不拦截 Zotero reader 原生选择、标注、滚动和快捷键。

多选：

- `Shift + 点击` 或 `Ctrl + 点击` 切换当前 box 的选中状态。
- 已选 box 需要有独立选中样式。
- 工具栏菜单显示 `复制已选 box (N)`。
- 多选复制时按 `rawIndex` 升序合并 Markdown。
- `清空选择` 只清除当前 reader instance 的选择。

Split view：

- 每个 reader pane 独立创建 overlay root。
- overlay 状态键为 `readerInstanceID + attachmentKey`。
- 模式、hover、选择集合都按 reader instance 独立保存。
- 关闭一个 pane 或切换其中一个 pane 的 attachment 时，只销毁对应 overlay，不影响同 tab 内另一个 pane。

## 错误处理

- API Key 缺失：提示先到设置页配置 API Key；不提交解析任务。
- 文件不可读：显示文件访问失败，并记录 attachment id 与文件路径。
- 非 PDF attachment：菜单项置灰或点击后提示仅支持 PDF。
- MinerU 上传失败：显示上传失败，允许重试。
- MinerU 解析失败：显示 MinerU 返回的错误信息，保存失败日志但不标记为可用结果。
- 结果下载失败：显示下载失败，允许重新下载或重新解析。
- JSON 缺少 box：保存原始结果，但 overlay 不启用，提示“解析结果缺少 box 信息”。
- 坐标无法映射：禁用对应页 overlay，记录日志，其他页面继续工作。
- 重新解析覆盖失败：保留旧结果；临时目录清理失败不影响旧结果可用性。

## 测试设计

自动化测试：

- `storage`
  - attachment 目录名生成。
  - `manifest.json` 写入和读取。
  - 已解析结果判断。
  - 临时目录写入和正式目录替换。

- `boxNormalizer`
  - MinerU box 到 normalized box 的字段映射。
  - `rawIndex` 保留。
  - 坐标归一化。
  - Markdown 内容提取。
  - 公式内容提取。

- `copyFormatter`
  - 单个文本 box 复制 Markdown。
  - 多个 box 按 `rawIndex` 合并。
  - 公式带 `$` 和不带 `$` 两种输出。

手动验证：

- 条目右键菜单只对 PDF attachment 可用。
- 未配置 API Key 时解析入口提示正确。
- 已解析 PDF 再次解析时出现“使用已有结果 / 重新解析并覆盖”。
- PDF tab 未解析时显示“立即解析”。
- 三种 overlay 模式切换正确。
- hover box 样式、类型标签、复制按钮符合预期。
- `Shift/Ctrl` 多选和工具栏“复制已选 box”正确。
- Zotero split view 中两个 reader pane 的模式和选择互不影响。

## 实现注意事项

- 实现阶段需要以 MinerU 官方文档为准确认接口路径、请求字段、任务状态字段和结果下载字段，不在设计文档中硬编码未验证字段。
- API Key 应存入 Zotero prefs，不写入日志，不进入导出的数据文件。
- 解析结果目录可被外部程序读取，但插件不承诺外部程序可以写入；如果外部修改文件，插件只做宽容读取和错误提示。
- overlay DOM 必须可销毁，插件 shutdown、tab close、reader pane close 和 attachment change 都要清理。
- 不要依赖全局 current tab 来定位 reader pane，split view 下会产生状态串扰。
