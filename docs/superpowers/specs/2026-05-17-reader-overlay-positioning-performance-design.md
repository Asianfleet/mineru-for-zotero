# Reader overlay 定位性能优化方向

## 目标与边界

本 spec 只列出 MinerU reader overlay 定位逻辑的可实施性能优化方向，并按优化价值排序。不展开具体实现计划，不改变现有交互模型。

现有约束保持不变：

- overlay root 继续挂在 reader document 的 `body` 或 `documentElement`。
- 不把 overlay root 挂入 `#viewerContainer`、`.pdfViewer` 或其他 PDF.js 内部 scroll container。
- PDF scroll container 只用于滚动监听、定位参考和 wheel 转发。
- 保持 overlay 跟随滚动、缩放、split view、same-origin nested iframe reader、modifier selection 和 native PDF text selection 的现有语义。

## 当前实现补充

截至 2026-05-24，5 月 17 日之后的相关提交主要把 reader overlay 拆成了 `positioning.ts`、`render.ts`、`selection.ts`、`styles.ts`、`windows.ts` 等子模块，并补充了复制全文 Markdown 的 lite 兜底。定位模型本身没有实现本 spec 中的性能优化。

当前定位链路仍是：

- `renderReaderOverlayForReader()` 构建 body-mounted fixed overlay root。
- `positionPageLayers()` 遍历 root 下全部 `.mineru-copy-page-layer`。
- 每个 page layer 通过 `findPageElement()` 查询 PDF.js page DOM。
- 命中后读取 `getBoundingClientRect()`，再写入 layer 的 `left`、`top`、`width`、`height`。
- `createReaderOverlayPositioningController()` 通过 scroll、resize、内部 scroll container、wheel 和 500ms interval 调度 `requestAnimationFrame` 中的 reposition。

因此，原先关于全页定位、page element 查询、空闲 interval 和 observer 辅助的判断仍然有效。

## 问题判断

现在观察到的“滚动鼠标时 box 明显跟随慢一拍”，优先按滚动后的视觉跟随延迟处理，而不只是按长 PDF 下的总定位成本处理。

可能路径是：

- overlay root 在 modifier 交互或 hover 场景下可能接收到 wheel。
- `onWheel()` 会尝试转发 wheel 到底层 PDF 元素，或直接驱动主 scroll container。
- 真正的 scroll 事件、PDF.js 页面位置变化和 overlay reposition 之间至少隔一轮事件与 rAF。
- 如果单次 reposition 还要全量查找 page element、全量读取 rect 并写 style，滚动中就更容易看到 overlay 落后一帧或多帧。

后续实现应把“降低滚动后的首帧延迟”和“降低长文档定位成本”作为两个相关但不同的目标。

排序依据：

- 优先降低 wheel/scroll 后 overlay 跟随 PDF 页面的可见延迟。
- 优先降低空闲和长文档下的持续开销。
- 优先选择与当前 body-mounted overlay 模型兼容、回归风险较低的方向。
- 不把同一类“减少重定位次数”的方案拆成多个重复条目。

## 优化方向排序

### 1. 优化滚轮后的跟随路径

当前慢一拍最直接发生在 wheel/scroll 后。可以先让 wheel fallback 和普通 scroll 共享一个更明确的“滚动后立即调度”路径：wheel 直接驱动 scroll container 后立即 schedule；转发 wheel 后也可以保守 schedule 一次，作为底层 PDF 元素滚动事件未及时冒泡时的兜底。

如果只靠额外 schedule 仍有明显延迟，可以进一步记录最近一次 scroll container 的 scroll offset delta，对已定位的可见 page layer 先做轻量 transform 级别的临时补偿，再在下一帧通过 `getBoundingClientRect()` 精确校准。这样能减少用户感知到的落后一拍，但需要严格限制在滚动中、可见页、短时间内生效。

价值最高的原因是它直接针对当前用户可见问题，而不是只降低总开销。

注意事项：

- 临时 transform 补偿不能改变最终定位数据来源，最终仍以 PDF.js page DOM 的 rect 为准。
- wheel 转发、scroll fallback、普通 scroll container scroll 都要覆盖，避免只修一个入口。
- 补偿逻辑必须在缩放、页面重排、split pane 切换、nested iframe reader 切换时立即失效。
- 默认 native PDF text selection 和 modifier selection 语义不能改变。

### 2. 只定位可见页和邻近页

当前 `positionPageLayers()` 遍历所有 page layer。长 PDF 下主要开销来自空闲或滚动时对所有页查询 DOM 并读取 `getBoundingClientRect()`。

最高价值优化是只更新 viewport 内和上下少量 buffer 页。远离 viewport 的 page layer 可以隐藏或跳过定位，等接近 viewport 时再恢复。

价值最高的原因是它直接把定位成本从“总页数”压到“可见页数”，对长文档收益最稳定。

注意事项：

- buffer 需要覆盖快速滚动时的视觉连续性。
- 不能影响当前页附近 box 的 hover、selection 和 copy 操作。
- PDF.js 页面 DOM 可能虚拟化或重建，页面不可见不等于永远不存在。

### 3. 缓存 page element 映射

当前每次定位都会通过 selector 查找对应 PDF page DOM。可以按 page number 缓存 page element，在 element 失效、PDF.js 重建页面、attachment 或 reader 切换时刷新。

价值较高，因为它减少高频 selector 查询。该方向不改变调度模型，风险低于大幅调整滚动监听或 overlay 挂载方式。

注意事项：

- 缓存命中前要确认 element 仍连接在当前 document。
- PDF.js 重建页面后不能继续使用旧 element。
- split view 和 nested iframe 中的缓存必须按 window/document 隔离。

### 4. 让 500ms interval 变成低频 watchdog

当前定位 controller 会每 500ms 兜底 schedule。可以把 interval 改为更低频，或只在最近发生 scroll、resize、page mutation 后短时间启用，空闲稳定后停止。

事件触发仍作为主路径，interval 只负责兜底漏事件。这样能降低用户不滚动、不缩放时的常驻开销。

注意事项：

- 不应完全移除兜底，因为 Zotero/PDF.js 某些重排可能没有可靠事件。
- watchdog 停止和恢复逻辑必须与 cleanup 路径一致，避免 pane 关闭后残留 timer。
- 调整频率时要优先保护缩放、页面加载完成和 split pane 切换后的对齐。

### 5. 定位前做轻量状态门控

在执行 page layer 更新前记录轻量状态，例如 scroll position、viewport 尺寸、root 连接状态、页面数量或 viewer 尺寸。状态未变化时跳过 `getBoundingClientRect()` 和 style 写入。

价值中等，适合配合 watchdog 使用。它能避免空闲 tick 做重活，但单独使用不如“只定位可见页”有效。

注意事项：

- 状态门控不能只看 window scroll，因为 Zotero reader 可能使用内部 scroll container。
- 缩放或 PDF.js page layout 变化可能在 scroll position 不变时发生。
- 门控条件应保守，宁可多定位一次，也不要留下错位 overlay。

### 6. 避免无变化 style 写入

即使读取到了 page rect，也只在 `left`、`top`、`width`、`height` 实际变化时写入 page layer style。

价值中等偏低。它可以减少 style invalidation，让定位 tick 更稳定，但不能解决全页 `getBoundingClientRect()` 读取成本。

注意事项：

- 比较时要处理浮点值和字符串格式，避免因为格式抖动导致每次都写。
- 不要为了比较引入比直接写入更重的逻辑。

### 7. 用 observer 辅助替代部分轮询

可以对 viewer 或 page container 使用 `ResizeObserver`、`MutationObserver` 监听页面尺寸变化、page DOM 重建和 reader layout 变化，并把这些变化转成 schedule。

该方向适合降低 watchdog 频率，但不应作为唯一触发机制。

注意事项：

- 需要确认 Zotero/Firefox runtime 下 observer 可用且行为稳定。
- observer callback 仍需节流到 `requestAnimationFrame`。
- cleanup 必须覆盖 reader pane 关闭、iframe 销毁和 overlay mode 切换。

### 8. 增加开发诊断计数

增加可临时启用的诊断信息，例如定位 tick 次数、参与定位页数、跳过页数、单次耗时、watchdog 触发次数、wheel 入口类型、scroll 后首帧 reposition 延迟、临时 transform 补偿次数。

它不直接降低性能开销，但能验证前面优化是否有效，避免只凭主观感觉调整。

注意事项：

- 诊断默认关闭，不能污染正常控制台。
- 统计代码本身不能成为新的高频开销来源。
- 输出应方便定位 split view、nested iframe 和长 PDF 场景下的差异。

## 验证场景

后续实现计划至少应覆盖这些场景：

- 长 PDF 中连续滚轮滚动，观察 box 是否仍明显落后一拍。
- overlay hover 或 modifier 交互开启时，wheel 落在 overlay box 上的转发路径。
- wheel 无法转发时，直接 scroll fallback 路径。
- 快速滚动到远页后，可见页和 buffer 页是否恢复正确定位。
- Zotero split view、same-origin nested iframe reader、reader pane 关闭后的 cleanup。
- 缩放、主题变化、PDF.js page DOM 重建后，缓存与状态门控是否失效并重新校准。
