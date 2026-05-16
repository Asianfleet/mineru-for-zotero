# Reader overlay 定位性能优化方向

## 目标与边界

本 spec 只列出 MinerU reader overlay 定位逻辑的可实施性能优化方向，并按优化价值排序。不展开具体实现计划，不改变现有交互模型。

现有约束保持不变：

- overlay root 继续挂在 reader document 的 `body` 或 `documentElement`。
- 不把 overlay root 挂入 `#viewerContainer`、`.pdfViewer` 或其他 PDF.js 内部 scroll container。
- PDF scroll container 只用于滚动监听、定位参考和 wheel 转发。
- 保持 overlay 跟随滚动、缩放、split view、same-origin nested iframe reader、modifier selection 和 native PDF text selection 的现有语义。

排序依据：

- 优先降低空闲和长文档下的持续开销。
- 优先选择与当前 body-mounted overlay 模型兼容、回归风险较低的方向。
- 不把同一类“减少重定位次数”的方案拆成多个重复条目。

## 优化方向排序

### 1. 只定位可见页和邻近页

当前 `positionPageLayers()` 遍历所有 page layer。长 PDF 下主要开销来自空闲或滚动时对所有页查询 DOM 并读取 `getBoundingClientRect()`。

最高价值优化是只更新 viewport 内和上下少量 buffer 页。远离 viewport 的 page layer 可以隐藏或跳过定位，等接近 viewport 时再恢复。

价值最高的原因是它直接把定位成本从“总页数”压到“可见页数”，对长文档收益最稳定。

注意事项：

- buffer 需要覆盖快速滚动时的视觉连续性。
- 不能影响当前页附近 box 的 hover、selection 和 copy 操作。
- PDF.js 页面 DOM 可能虚拟化或重建，页面不可见不等于永远不存在。

### 2. 缓存 page element 映射

当前每次定位都会通过 selector 查找对应 PDF page DOM。可以按 page number 缓存 page element，在 element 失效、PDF.js 重建页面、attachment 或 reader 切换时刷新。

价值较高，因为它减少高频 selector 查询。该方向不改变调度模型，风险低于大幅调整滚动监听或 overlay 挂载方式。

注意事项：

- 缓存命中前要确认 element 仍连接在当前 document。
- PDF.js 重建页面后不能继续使用旧 element。
- split view 和 nested iframe 中的缓存必须按 window/document 隔离。

### 3. 让 500ms interval 变成低频 watchdog

当前定位 controller 会每 500ms 兜底 schedule。可以把 interval 改为更低频，或只在最近发生 scroll、resize、page mutation 后短时间启用，空闲稳定后停止。

事件触发仍作为主路径，interval 只负责兜底漏事件。这样能降低用户不滚动、不缩放时的常驻开销。

注意事项：

- 不应完全移除兜底，因为 Zotero/PDF.js 某些重排可能没有可靠事件。
- watchdog 停止和恢复逻辑必须与 cleanup 路径一致，避免 pane 关闭后残留 timer。
- 调整频率时要优先保护缩放、页面加载完成和 split pane 切换后的对齐。

### 4. 定位前做轻量状态门控

在执行 page layer 更新前记录轻量状态，例如 scroll position、viewport 尺寸、root 连接状态、页面数量或 viewer 尺寸。状态未变化时跳过 `getBoundingClientRect()` 和 style 写入。

价值中等，适合配合 watchdog 使用。它能避免空闲 tick 做重活，但单独使用不如“只定位可见页”有效。

注意事项：

- 状态门控不能只看 window scroll，因为 Zotero reader 可能使用内部 scroll container。
- 缩放或 PDF.js page layout 变化可能在 scroll position 不变时发生。
- 门控条件应保守，宁可多定位一次，也不要留下错位 overlay。

### 5. 避免无变化 style 写入

即使读取到了 page rect，也只在 `left`、`top`、`width`、`height` 实际变化时写入 page layer style。

价值中等偏低。它可以减少 style invalidation，让定位 tick 更稳定，但不能解决全页 `getBoundingClientRect()` 读取成本。

注意事项：

- 比较时要处理浮点值和字符串格式，避免因为格式抖动导致每次都写。
- 不要为了比较引入比直接写入更重的逻辑。

### 6. 用 observer 辅助替代部分轮询

可以对 viewer 或 page container 使用 `ResizeObserver`、`MutationObserver` 监听页面尺寸变化、page DOM 重建和 reader layout 变化，并把这些变化转成 schedule。

该方向适合降低 watchdog 频率，但不应作为唯一触发机制。

注意事项：

- 需要确认 Zotero/Firefox runtime 下 observer 可用且行为稳定。
- observer callback 仍需节流到 `requestAnimationFrame`。
- cleanup 必须覆盖 reader pane 关闭、iframe 销毁和 overlay mode 切换。

### 7. 增加开发诊断计数

增加可临时启用的诊断信息，例如定位 tick 次数、参与定位页数、跳过页数、单次耗时、watchdog 触发次数。

它不直接降低性能开销，但能验证前面优化是否有效，避免只凭主观感觉调整。

注意事项：

- 诊断默认关闭，不能污染正常控制台。
- 统计代码本身不能成为新的高频开销来源。
- 输出应方便定位 split view、nested iframe 和长 PDF 场景下的差异。
