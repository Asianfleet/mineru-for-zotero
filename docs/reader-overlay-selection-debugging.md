# Reader Overlay 多选触发原生选区问题调试记录

本文记录 MinerU reader overlay 在 Shift/Ctrl 多选 box 时触发
Zotero/PDF.js 原生文字选区或拖选视觉状态的问题。记录目标是保留证据链，
避免把已经排除的假设反复当作根因。

## 问题现象

- 默认状态下，overlay box 不能遮挡底层 PDF 文字，鼠标应能直接拖动划选文字。
- 按住 `Shift` 或 `Ctrl` 时，overlay box 要恢复旧逻辑，接管鼠标命中，用于
  box 多选和复制操作。
- 曾出现的问题是：按住 `Shift` 点击 box 后，PDF.js 仍进入类似文字拖选的视觉
  状态，box 多选和底层文字选择互相干扰。
- 旧提交 `f46c934c02a361cef4ca594a9c8fa07422c1617d` 中 box 直接覆盖底层文字，
  鼠标不能划选底层文字；这个旧行为可作为 modifier 模式的参考。

## 最终结论

最终根因不是 DOM Selection、`.textLayer` CSS、`pointerdown.defaultPrevented`
或继续扩大 capture guard，而是 overlay root 的挂载位置。

旧可工作逻辑把 overlay root 直接挂到 reader document 的 `body`：

```ts
doc.body?.append(root);
```

后续实现改成优先挂到 PDF.js 内部 scroll container，例如 `#viewerContainer` 或
`.pdfViewer`。真实 Zotero/PDF.js reader 中，即使 overlay root 已渲染、已连接、
pageCount 正常，如果 root 挂在 PDF.js 内部容器下，pointer/mouse down 仍可能不按
预期进入我们的 overlay/window/document 处理链，导致 Shift 多选无法稳定恢复旧的
遮挡逻辑。

修复方式：

- overlay root 挂载位置恢复为 `doc.body ?? doc.documentElement`。
- `#viewerContainer` 等 scroll container 只用于滚动定位、滚轮转发等用途，不作为
  overlay root 的首选挂载父节点。
- 保留 modifier 状态下才启用 `.mineru-copy-box` / `.mineru-copy-page-layer`
  `pointer-events: auto` 的行为；默认状态仍让鼠标事件穿透到底层 PDF。
- 保留 reader window/document capture 下按坐标命中 box 的兜底选择逻辑，用于处理
  keydown 遗漏或跨 iframe/window 的事件状态。

## 已排除路径

### DOM Selection

多轮日志中，box 事件里的 `document.getSelection()` 基本都是：

- `type: "None"`
- `isCollapsed: true`
- `rangeCount: 0`
- `anchorNode: null`
- `focusNode: null`
- `textLength: 0`

因此继续围绕 `removeAllRanges()` 修复证据不足。PDF.js 的视觉拖选状态不一定体现为
普通 DOM Selection Range。

### `.textLayer` CSS 和 hit-test

曾验证 overlay root 与 text layer 在同一个 reader document，CSS 注入正常，
`.textLayer`、`.page`、`.pdfViewer` selector 都能命中。

也尝试过对 `.textLayer` / `.textLayer *` 增加 `user-select: none` 和
`pointer-events: none`。后续日志显示隐藏 overlay 后的 underlying 从 text layer
span 变成 canvas，但问题仍可复现。因此 text layer hit-test 不是最终根因。

### box/root 局部 preventDefault

box/root 局部事件处理器确实能执行 `preventDefault()`，但这只说明事件已经到达
overlay。若 PDF.js 在更早的窗口、document 或内部容器事件链中处理 pointer/mouse
状态，局部处理会太晚。

### 继续扩大 capture guard

reader window/document capture guard 对阻断部分事件有帮助，也修复过 release
事件被吞后持续处于拖选状态的问题。但最终实测显示，仅扩大 capture guard 不能解决
“事件没有进入我们的处理链”的场景。

这类场景应优先检查：

- overlay root 是否真的挂到 reader document 的 `body`；
- 是否只挂到了 PDF.js 内部 scroll container；
- 多 pane / nested iframe 下是否渲染到了实际 PDF.js viewer document。

## 保留行为

当前应保留的关键行为：

- 默认状态下 `.mineru-copy-box` 和 `.mineru-copy-page-layer` 为
  `pointer-events: none`，允许拖选底层 PDF 文字。
- 按住 `Shift` 或 `Ctrl` 时 root 添加
  `mineru-copy-overlay-modifier-active`，box/layer 恢复 `pointer-events: auto`。
- 默认 hover 通过鼠标坐标维护 `.mineru-copy-box-hovered`，避免依赖 box 自身
  `:hover`，因为默认状态 box 不接收 pointer events。
- reader window 和 parent window 都监听 modifier key 状态。
- reader window/document capture 下按坐标查找 box，防止 keydown 状态遗漏时
  modifier pointerdown 仍落到底层 reader。
- overlay root 必须挂在 `body` 或 `documentElement`，不要优先挂到
  `#viewerContainer`、`.pdfViewer` 等 PDF.js 内部容器。

## 回归测试要点

当前已有或应保留的自动测试包括：

- 默认 hover 控件隐藏，`.mineru-copy-box-hovered` 可触发 label/actions 显示。
- stale injected style 会被刷新，避免热重载后旧 CSS 仍生效。
- transient blur 不会立即清掉按住 modifier 时的 pointer-events 激活状态。
- modifier keydown 来自 parent reader window 时，也能启用 overlay pointer events。
- modifier keydown 遗漏时，reader window/document capture 可按坐标选中 box。
- 鼠标移动时按坐标维护 `.mineru-copy-box-hovered`。
- same-origin nested iframe windows 会被纳入 overlay 渲染窗口集合。
- 即使存在 `#viewerContainer`，overlay root 也挂到 document `body`，不挂到 scroll
  container。

## 调试建议

真实 Zotero 复现 overlay 事件问题时，优先临时采集以下信息：

- overlay render 日志应包含 window location、document title、pageCount 和
  `mountContainer`。这类日志只用于定位问题，修复确认后不要保留。
- 如果 overlay 已渲染但 pointer/mouse down 没有进入处理器，先检查
  `mountContainer` 是否为 `body`。
- 若 root 已在 `body`，再检查跨 iframe/window 的 keydown 来源、pointer 坐标命中
  和 selectedRawIndexes 状态。

确认修复后，应删除或降级高频日志，避免 reader 切模式、移动鼠标、blur 时刷屏。

## 验证命令

代码修改后至少运行：

```powershell
.\node_modules\.bin\tsc.CMD --noEmit
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
npm run lint:check
git diff --check
```
