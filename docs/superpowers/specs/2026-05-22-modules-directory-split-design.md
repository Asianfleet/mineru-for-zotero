# src/modules 目录化拆分设计

## 背景

`src/modules` 中目前有三个文件超过 1000 行：

- `readerOverlay.ts`：约 1600 行，混合了 overlay 状态、跨窗口同步、DOM 渲染、定位、选择、复制、样式注入、wheel 转发和诊断。
- `mineruClient.ts`：约 1100 行，混合了 MinerU v4 API 编排、HTTP/XHR 适配、下载重试、ZIP 读取、结果提取和路径处理。
- `readerToolbar.ts`：约 1000 行，混合了 toolbar 注册、按钮绑定、图标加载、菜单 DOM、命令执行和诊断。

这次重构采用目录入口方案：把上述单文件模块改成同名目录，并通过 `index.ts` 暴露原有公开 API。目标是在保持用户可见行为一致的前提下，让核心入口文件低于 300 行，并让拆分后的每个 TypeScript 文件低于 500 行。

## 目标

- 将 `src/modules/mineruClient.ts` 拆为 `src/modules/mineruClient/index.ts` 及同目录子模块。
- 将 `src/modules/readerOverlay.ts` 拆为 `src/modules/readerOverlay/index.ts` 及同目录子模块。
- 将 `src/modules/readerToolbar.ts` 拆为 `src/modules/readerToolbar/index.ts` 及同目录子模块。
- 保持现有 import 语义可用，例如 `from "./modules/readerOverlay"`、`from "../src/modules/mineruClient"`。
- 保持现有公开导出、locale key、DOM class、存储格式、错误类型和用户可见行为不变。
- 拆分后的每个 TypeScript 文件低于 500 行；如果某个文件接近上限，优先继续按职责拆分，而不是通过压缩格式减少行数。
- 在拆分时允许清理明显重复或边界不清的内部逻辑，但不引入与本次拆分无关的新功能。

## 非目标

- 不改变 MinerU API 业务流程、请求参数或结果存储结构。
- 不改变 reader overlay 的交互语义，例如 modifier-key selection、hover/all/off mode、复制顺序和缺失结果处理。
- 不改变 reader toolbar 的用户界面结构、按钮文案、图标语义或菜单命令。
- 不把内部子模块变成新的公开 API，除非现有测试或运行时代码已经依赖对应函数。
- 不进行大范围格式化，避免产生无关 diff。

## 架构

### mineruClient

目录结构：

- `index.ts`：保留 `createMinerUClient`，导出 `MinerUClient`、`MinerURequestError`、`MinerUFileAccessError`、`MinerUTaskError`。
- `types.ts`：存放 `MinerUClient`、client options、batch response、ZIP entry 等内部类型。
- `errors.ts`：存放三类 MinerU error。
- `api.ts`：封装 submit/poll/download 使用的 MinerU v4 batch API 请求。
- `http.ts`：封装 fetch、Zotero HTTP、XHR、request body/header normalization。
- `download.ts`：封装 ZIP/Markdown 下载、重试、fallback 和下载诊断。
- `zip.ts`：封装 ZIP 读取、central directory 解析、entry bytes 解码。
- `result.ts`：封装 raw result、markdown、image entries 提取。
- `path.ts`：封装 basename、native path 和 safe URL/path 等小工具。

`index.ts` 只负责编排 `submitPdf`、`pollTask`、`downloadResult` 三个公开方法。HTTP 细节、ZIP 细节和结果解析不留在入口文件里。

### readerOverlay

目录结构：

- `index.ts`：导出并编排当前公开 overlay API。
- `types.ts`：存放 `ReaderOverlayKey`、`ReaderOverlayState`、box style、positioning/selection options。
- `state.ts`：管理 `addon.data.readerOverlays`、state 创建、root 设置、cleanup。
- `windows.ts`：管理 reader window、same-origin iframe、reader view 枚举和 attachment key 解析。
- `render.ts`：构建 overlay root、page layer、box element、label、actions 和 box type label。
- `positioning.ts`：管理 page layer 定位、scroll/resize observer、wheel forwarding、fallback page rect。
- `selection.ts`：管理 hover、single/range/multi selection、selected class 同步和 modifier active state。
- `styles.ts`：管理 overlay CSS 注入和 Zotero reader theme 变量桥接。
- `copy.ts`：管理 selected boxes/full box copy、formula copy button 和 clipboard 写入。
- `notice.ts`：管理 overlay 缺失结果等用户提示文案。
- `diagnostics.ts`：封装 `ztoolkit.log`、`Zotero.debug` 和 window console 诊断输出。

`index.ts` 保留现有公开函数，例如 `applyReaderOverlayMode`、`renderReaderOverlayForReader`、`clearReaderOverlaySelectionForReader`、`copySelectedBoxesForReader`、`buildReaderOverlayRoot`、`createReaderOverlayPositioningController`、`ensureReaderOverlayStyles`、`positionPageLayers` 和 `findPageElement`。

### readerToolbar

目录结构：

- `index.ts`：导出并编排当前公开 toolbar API。
- `types.ts`：存放 toolbar state、store、anchor、registration、binding 类型。
- `store.ts`：管理 per-reader panel open state。
- `registration.ts`：管理 main window 注册、unregister、MutationObserver 和 interval 生命周期。
- `binding.ts`：管理 toolbar button 创建、更新、绑定、销毁和 reader sync。
- `assets.ts`：管理 toolbar SVG、mode SVG、action SVG 的加载、注入和 data URI。
- `panel.ts`：管理 menu panel、action row、selection label、mode group、command button DOM。
- `commands.ts`：管理 all/hover/off、copy selected/full markdown、clear selection 等命令分发。
- `diagnostics.ts`：封装 toolbar 诊断输出。

`index.ts` 保留现有公开函数，例如 `registerReaderToolbar`、`unregisterReaderToolbar`、`findReaderToolbarAnchor`、`createReaderToolbarPanel`、`createReaderToolbarActionRow`、`createReaderToolbarModeButton`、`createReaderToolbarCommandButton` 和 SVG setter。

## 数据流

`mineruClient` 继续保持三段式流程：

1. `submitPdf(filePath)` 请求 `/api/v4/file-urls/batch`，读取本地 PDF，并用 presigned URL 上传。
2. `pollTask(taskID)` 请求 batch result 并把 MinerU state 归一为 `running`、`succeeded` 或 `failed`。
3. `downloadResult(taskID)` 优先下载 `full_zip_url`，解析 ZIP 中的 `full.md`、raw result 和 images；没有 ZIP 时回退 `md_url`。

`readerOverlay` 继续从 reader 获取 attachment key，读取 storage boxes，按 mode 构建 overlay root，将 root 挂到 reader document body 或 documentElement，并对同源嵌套 reader iframe 建立对应 root。selection 只通过 `rawIndex` 维护状态，复制时按原始 MinerU `rawIndex` 顺序输出。

`readerToolbar` 继续注册 reader window，按 reader instance 维护一个按钮绑定和一个 panel open state。按钮点击切换 panel，panel 命令调用 overlay 公开 API，命令完成后同步按钮和 panel 状态。

## 错误处理

- `mineruClient` 的错误类型和错误消息保持兼容。HTTP 失败仍抛 `MinerURequestError`，文件读取失败仍抛 `MinerUFileAccessError`，业务状态、下载、ZIP 解析等失败仍抛 `MinerUTaskError`。
- ZIP 下载失败继续记录 URL、byte count、response headers、ZIP reader diagnostics 和 fallback 路径相关信息。
- overlay 缺失结果或读取失败时，继续显示用户可见 notice，将 mode 重置为 `off`，并清理 stale root。
- toolbar 命令失败时继续通过现有诊断路径输出，不改变菜单关闭和状态同步语义。

## 测试计划

- 保持现有测试 import 路径不变，用它验证目录入口解析兼容性。
- 优先复用现有 `mineruClient.test.ts`、`readerOverlay.test.ts`、`readerToolbar.test.ts` 覆盖行为不变。
- 对拆分时清理的内部重复逻辑，只在行为风险明显时补 focused test。
- 每个实现检查点完成后，先运行该检查点相关验证并汇报结果，然后暂停等待用户手动验收；用户确认后再进入下一个检查点。
- 最终验证优先运行：

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

- 如果 scaffold 测试因 Zotero 运行环境阻塞，至少运行 TypeScript 检查，并在结果中说明阻塞原因。

## 风险与缓解

- 目录入口解析风险：现有 import 依赖 `from "./modules/readerOverlay"` 解析到 `readerOverlay/index.ts`。通过 TypeScript 检查和 scaffold 测试确认。
- 循环依赖风险：`readerOverlay` 和 `readerToolbar` 内部拆分后容易产生 state/render/positioning 循环依赖。通过让 `index.ts` 编排主流程、子模块只依赖更底层模块来控制方向。
- DOM 行为漂移风险：overlay 和 toolbar 测试大量断言 class、style、event 行为。拆分时保留 DOM class 和用户可见文案，避免重写 UI 结构。
- Windows 文件移动风险：先按目录创建新文件，再删除旧单文件；避免用大段正则替换或基于乱码中文 patch。

## 实施边界

实施应按模块分成三个检查点，每个检查点都要保持可编译，并在完成后暂停等待用户手动验收：

1. Checkpoint 1：拆 `mineruClient`。它对 DOM 和 reader window 依赖最少，适合作为目录入口解析和内部模块边界的第一轮验证。完成后运行 `mineruClient` 相关测试或 TypeScript 检查，汇报 diff 与验证结果，然后停下等待用户验收。
2. Checkpoint 2：拆 `readerToolbar`。保留对 overlay 公开 API 的依赖，重点验证 toolbar 注册、按钮绑定、panel DOM、图标和命令行为。完成后运行 `readerToolbar` 相关测试或 TypeScript 检查，汇报 diff 与验证结果，然后停下等待用户验收。
3. Checkpoint 3：拆 `readerOverlay`。这是状态、DOM、定位、跨窗口同步和测试面最复杂的部分。完成后运行 `readerOverlay` 相关测试和最终完整 scaffold 测试，汇报 diff 与验证结果，然后停下等待用户最终验收。

如果某个检查点发现前序设计边界不合理，先汇报原因和调整建议，等待用户确认后再继续实施。
