# Box 复制胶囊工具栏设计

## 背景

当前 reader overlay 在每个 MinerU box 内渲染文字复制按钮。普通 box 只有 `Copy`，公式类 box 直接显示 `Copy with $` 与 `Copy without $` 两个按钮。新设计只替换原来的复制按钮区域，保留现有 box 边框、box 类型标签、hover/selected 样式、overlay mode、Shift/Ctrl 多选逻辑和 reader root 挂载方式。

## 目标

- 把原有 box 复制按钮替换为悬浮胶囊工具栏。
- 不论 box 类型，工具栏都有两个主按钮：复制、选择复制。
- 复制按钮使用 `addon/content/box-toolbar-copy.svg`。
- 选择复制按钮使用 `addon/content/box-toolbar-select-copy.svg`。
- 按钮之间显示分割线，hover 效果对齐 Zotero reader toolbar 的轻量高亮风格。
- 保留现有 box 类型标签，不移动、不重设语义。
- 避免扩大范围到 overlay selection state、reader toolbar、storage、normalizer 或跨 iframe root 架构。

## 非目标

- 不重做 reader overlay 的整体定位架构。
- 不改现有 box 选择、多选、复制全文、reader toolbar 面板等行为。
- 不引入全局 floating toolbar controller。
- 不改变 MinerU box 归一化或 copyFormatter 的现有普通复制语义。

## 结构设计

采用最小替换方案。`createBoxActions()` 仍为每个 box 创建 actions 节点，但输出从多个文字按钮变为一个 `mineru-copy-box-toolbar` 胶囊工具栏。

工具栏仍挂在当前 box 内部，避免新增 root-level controller。工具栏默认显示在 box 下方，水平居中；当下方空间不足时翻转到 box 上方。翻转逻辑只服务于工具栏位置，不改变 box layer、page layer 或 root mount。

选择复制面板也由当前 box actions 管理。面板默认隐藏，点击选择复制按钮后显示。面板优先放在 box 上方；如果上方空间不足，则翻转到 box 下方。面板位置不要求贴紧工具栏，因为工具栏默认在 box 下方，而面板应优先减少对当前 box 下方正文的遮挡。

## 复制行为

普通 box 的复制按钮点击后继续复制 `formatBoxesForCopy([box])` 的结果，保持现有语义。

公式类 box 的复制按钮有 hover dropdown：

- 主按钮 hover 时显示菜单。
- 点击主按钮本身不执行复制。
- 菜单项包含“带 `$` 复制”和“不带 `$` 复制”。
- 菜单项仍调用 `formatFormulaForCopy(box.formula, mode)`。

非公式类 box 不显示 dropdown。

## 选择复制行为

点击选择复制按钮后显示一个只读文本面板。关闭规则：

- 点击面板和工具栏之外关闭。
- 按 Esc 关闭。
- 切换到其他 box 关闭。
- overlay 关闭或重渲染时关闭。
- 鼠标移出 box、工具栏或面板不关闭。

面板内容优先展示 MinerU 原始 `box.markdown`。公式类内容必须保留 `$`：

- 如果 `box.markdown` 已经包含 `$` 包裹，则直接使用。
- 如果 `box.markdown` 没有 `$`，但 `box.formula` 存在，则使用带 `$` 的公式文本。
- 如果上述内容都缺失，再回退到 `formatBoxesForCopy([box])`。

面板必须允许用户划选复制，但不能修改内容。实现上优先使用 `textarea readonly` 或等价的可选择只读控件，以兼容 Zotero/Firefox reader runtime 的文本选择和 Ctrl/Cmd+A、Ctrl/Cmd+C 行为。

## 视觉设计

胶囊工具栏是一个整体圆角容器，内部两个 icon button 尺寸固定。按钮之间用 1px 分割线隔开。按钮 hover 只做轻量背景变化，不改变布局，也不沿用当前按钮 hover 时加重阴影的样式。

样式优先使用现有 reader overlay 已桥接的 Zotero theme 变量：

- `--material-toolbar` 控制工具栏背景。
- `--fill-primary` 控制图标颜色。

如需匹配 Zotero hover，可补充读取安全的 hover 背景变量，或使用接近 Zotero reader toolbar 的 fallback 颜色。选择复制 SVG 当前硬编码黑色；实现时允许把颜色改为 `currentColor`，但不改变图形路径。

## 错误与边界

- 空文本不应抛错，选择复制面板可以显示空白或回退文本。
- 公式缺少 `box.formula` 时，菜单项不应复制空异常；可回退到 `box.markdown` 或禁用不可用菜单项。
- 点击 dropdown、toolbar、textarea 时必须阻止事件冒泡到 PDF.js，避免触发底层 reader 选择或滚动行为。
- 新浮层不能破坏默认 overlay 的 `pointer-events: none` 策略；只有工具栏、菜单和面板本身允许 pointer events。
- 关闭面板不改变现有 `selectedRawIndexes` 或 selection anchor。

## 测试策略

更新 `test/readerOverlay.test.ts`，覆盖以下行为：

- 普通 box 渲染胶囊工具栏，包含复制按钮、选择复制按钮和分割线。
- 公式 box 渲染复制 dropdown，主按钮 click 不复制，菜单项 click 才复制。
- 非公式 box 不渲染公式 dropdown。
- 选择复制面板使用 `box.markdown`；公式类文本保留 `$`，且不会重复包裹。
- 样式注入包含胶囊工具栏、按钮 hover、分割线、只读选择面板。
- Esc 和外部 click 可关闭选择复制面板。

验证仍以 `pnpm lint:check` 和 scaffold test 为最终门槛。实现完成后的完整验证使用：

```powershell
pnpm lint:check
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```
