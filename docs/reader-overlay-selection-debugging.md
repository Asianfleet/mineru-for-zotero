# Reader Overlay 多选触发原生选区问题调试记录

本文记录 MinerU reader overlay 在 Shift/Ctrl 多选 box 时触发
Zotero/PDF.js 原生文字选区或拖选视觉状态的问题。记录目标是保留证据链，
避免把已经排除的假设反复当作根因。

## 问题现象

- 按住 Shift 点击 overlay box 进行多选时，会触发类似 PDF 文字选中的视觉状态。
- Ctrl 点击没有触发同样的选择问题，但拖动时也会触发多选相关状态。
- 用户补充的关键现象：Shift 点击一次后，如果不点击外部，似乎会持续处于
  “选中/拖选”状态；即使鼠标左键已经松开，移动鼠标仍可选中新内容。
- 提交 `5844a78014d537546d94f991d23ecf912741cb74` 正式引入 box 多选。
  在此之前，box 会覆盖下层内容，不能划选底层文字。

## 已采集到的关键证据

### 1. DOM Selection 不是当前直接证据

多轮日志中，box 事件里的 `documentSelection` 均为：

- `type: "None"`
- `isCollapsed: true`
- `rangeCount: 0`
- `anchorNode: null`
- `focusNode: null`
- `textLength: 0`

这说明通过 `document.getSelection()` 观察不到真实 Range。继续只围绕
`removeAllRanges()` 修复，证据不足。

### 2. CSS 注入和 `.textLayer` selector 已被验证

新增 DOM 诊断后，日志证明：

- overlay root 和 text layer 在同一个 reader document。
- `styleElementPresent: true`，style 已注入到 `head`。
- `documentElement` 存在 `mineru-copy-overlay-mounted`。
- 多选后存在 `mineru-copy-box-selection-active`。
- `selectorCounts` 能找到 `.textLayer`、`.textLayer *`、`.page`、
  `.pdfViewer`。

早期日志里，隐藏 overlay 后的 `elementFromPoint` 显示 `underlying` 是
`.textLayer` 下的 `span`，且：

- `underlyingStyle.userSelect: "none"`
- `underlyingStyle.mozUserSelect: "none"`
- `underlyingStyle.pointerEvents: "auto"`

因此增加了 `.textLayer` / `.textLayer *` 的
`pointer-events: none !important`。后续日志显示 `underlying` 已变成
`canvas`，说明 text layer hit-test 已被排除为当前剩余问题。

### 3. overlay box/root 阶段 preventDefault 太晚

日志证明 box 事件处理器中 `mousedown`、`mousemove`、`mouseup` 等确实执行了
`preventDefault()`。但这只能说明事件到达 overlay box 后被处理，不能证明
Zotero/PDF.js 在更早的 `window/document` capture 阶段没有先处理。

后来加入 reader `window/document` capture guard 后，日志出现：

- `captureGuard: "reader-document"`
- `eventType: "mousedown"` 时 `defaultPrevented: true`
- `selectedRawIndexes` 随后变为 `[122]`

这说明 document 级 capture guard 确实能先于 overlay root/box 运行。

### 4. release 事件被吞的问题已单独修正

一轮日志显示：`pointerup` / `mouseup` 在 document capture guard 中被
`stopImmediatePropagation` 吞掉，之后无按键 `mousemove` 仍因
`selectedRawIndexes: [122]` 被持续拦截。这与“松手后仍像处于拖选状态”的
现象吻合。

对应修正：

- `pointerup` / `mouseup` 仍执行 `preventDefault()` 和清理 selection，但不再
  `stopPropagation()` / `stopImmediatePropagation()`。
- `mousemove` / `pointermove` 只有在 `buttons != 0` 时才按拖拽 guard 处理。
  `selectedRawIndexes.size > 0` 只表示已有 box 被选中，不能单独说明鼠标仍在
  拖拽。

后续日志已验证：

- release 事件出现 `allowReaderRelease: true`。
- 松手后 `buttons: 0` 的 `mousemove` 不再刷
  `captureGuard: "reader-document"`，且 `defaultPrevented: false`。

因此，“release 被我们吞掉”已不是当前剩余问题。

### 5. `pointermove` 已补入 guard，但最新日志显示多为松手移动

曾发现真实复现中存在 pointer event 链，而代码只覆盖了 `mousemove`，缺少
`pointermove`。因此已把 `pointermove` 加入：

- root/box 事件日志。
- root/box selection guard。
- document/window capture guard。
- `isBoxSelectionGuardEvent()` 的拖拽判断。

最新日志中确实出现 `pointermove`，但多为：

- `buttons: 0`
- `defaultPrevented: false`
- `eventPhase: 2`

这类事件按当前逻辑不应被吞。需要继续区分“正常松手移动”和“真正按键拖动”。

### 6. `click` capture 漏口已补

最新日志显示 `click` 到达 box handler 前仍是：

- `eventType: "click"`
- `defaultPrevented: false`
- `shiftKey: true`

此前 document/window capture guard 没有监听 `click`，因此 reader/PDF.js 的
capture click handler 仍可能先看到 Shift-click。已把 `click` 加入
document/window capture guard，并增加回归测试覆盖。

### 7. 当前最值得解释的异常：`pointerdown.defaultPrevented`

最新日志里最异常的点是：

- `pointerdown` 已进入 `captureGuard: "reader-document"`。
- 但日志里的 `defaultPrevented` 仍为 `false`。
- 同一轮 `mousedown.defaultPrevented` 为 `true`。

当前代码是在 `preventDefault()` 之后记录 `defaultPrevented`，因此这不是单纯的
日志顺序问题。已新增诊断字段：

- `beforePreventDefault`
- `afterPreventDefault`
- `cancelBubble`
- `eventPhase`
- `composedPath`
- `domState.eventComposedPath`

下一轮日志需要确认 `pointerdown` 上 `preventDefault()` 是否真的未生效，还是
事件路径/监听顺序仍让 PDF.js 更早处理了 pointerdown。

## 已尝试方案与结论

### CSS 禁止 text layer 选中和 hit-test

做法：

- overlay root、page layer、box 设置 `user-select: none`。
- reader document 添加 `mineru-copy-overlay-mounted` 和
  `mineru-copy-box-selection-active`。
- 对 `.textLayer` 和 `.textLayer *` 设置 `user-select: none !important`。
- 对 `.textLayer` 和 `.textLayer *` 设置 `pointer-events: none !important`。

结论：

- CSS 命中并生效。
- `underlying` 已从 text layer span 变成 canvas。
- 用户仍可复现，因此 text layer hit-test 不是当前剩余根因。

### box/root 局部事件拦截

做法：

- 在 root 和 box 上捕获 `pointerdown`、`pointermove`、`mousedown`、
  `mousemove`、`pointerup`、`mouseup`、`selectstart`。
- 对 Shift 或 active selection 下的真实拖拽事件执行 `preventDefault()`。
- 清理 `document.getSelection()`。

结论：

- 日志证明 box/root 处理器确实执行。
- 但 reader 的 `window/document` capture handler 可能更早运行。
- 局部拦截只能作为辅助保护。

### reader window/document capture guard

做法：

- 对 reader `window` 和 `document` 安装 capture 阶段 guard。
- 处理目标位于 overlay root 内的 Shift/Ctrl 或 active-selection 拖拽事件。
- 在 `mousedown` 阶段完成 box selection，`click` 阶段只消费和去重。
- 放行 `pointerup` / `mouseup` 给 reader。
- `click` 也加入 document/window capture guard。

结论：

- `mousedown` 已能提前完成 selection。
- release 不再被吞。
- `click` 漏口已补。
- 当前仍需解释 `pointerdown.defaultPrevented: false`。

## 当前工作假设

问题更像是 PDF.js/Zotero reader 在 pointer/mouse/click 事件序列中维护了内部
选择或拖选状态，而不只是 DOM Range 被创建。由于 DOM Selection 一直是
`None`，视觉状态可能来自 PDF.js 内部 selection controller 或 canvas/text layer
相关状态。

当前最有证据的下一步不是继续扩大 CSS，而是确认：

- `pointerdown` 上 `preventDefault()` 前后状态是否变化。
- `pointerdown` 的 `composedPath` 是否经过 PDF.js 关键容器。
- 是否还有 reader/PDF.js 在我们之前处理 pointerdown。
- 加入 `click` capture guard 后，`click` 是否出现
  `captureGuard: "reader-document"`，并在 reader 之前被吞掉。

## 建议保留的诊断字段

排查期间建议保留以下日志字段，直到真实 Zotero 中确认：

- `eventType`
- `button` / `buttons`
- `defaultPrevented`
- `cancelable`
- `cancelBubble`
- `eventPhase`
- `shiftKey` / `ctrlKey`
- `selectedRawIndexes`
- `captureGuard`
- `allowReaderRelease`
- `beforePreventDefault`
- `afterPreventDefault`
- `composedPath`
- `documentSelection`
- `domState.documentClassName`
- `domState.eventComposedPath`
- `domState.rootOwnerSameDocument`
- `domState.selectorCounts`
- `domState.elementAtPoint.underlying`
- `domState.elementAtPoint.underlyingClosest`
- `domState.elementAtPoint.underlyingStyle`

确认修复后，应删除或降级这些高频日志，避免 reader 移动鼠标时刷屏。

## 回归测试要点

当前已有或应保留的自动测试包括：

- Shift `mousedown` 在原生选择前被 preventDefault。
- overlay root capture 先于 box handler 时能阻止默认行为。
- reader document capture guard 能在 overlay root handler 前阻断事件。
- reader capture guard 在 `mousedown` 阶段就完成 Shift box selection。
- reader capture guard 能提前拦截 Shift `click`。
- `pointerup` / `mouseup` 不再被 document capture guard 隐藏。
- 松手后 `buttons: 0` 的 `mousemove` 不再因 active selection 被吞。
- active selection 下 `buttons: 1` 的 `mousemove` 会被阻断并清理 selection。
- active selection 下 `buttons: 1` 的 `pointermove` 会被阻断并清理 selection。
- selection 清空后 document guard class 被移除。
- overlay root 移除时 document/window capture guard 被清理。

## 验证命令

代码修改后至少运行：

```powershell
.\node_modules\.bin\tsc.CMD --noEmit
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish
git diff --check
```

真实 Zotero 复现时，重点观察：

- `pointerdown.beforePreventDefault.defaultPrevented`。
- `pointerdown.afterPreventDefault.defaultPrevented`。
- `pointerdown.composedPath` / `domState.eventComposedPath`。
- `click` 是否出现 `captureGuard: "reader-document"`。
- `mousedown` 后 `selectedRawIndexes` 是否已经更新。
- `documentSelection` 是否仍为 `None`。
- 松手后 `buttons: 0` 的移动是否仍被 guard 吞掉。
