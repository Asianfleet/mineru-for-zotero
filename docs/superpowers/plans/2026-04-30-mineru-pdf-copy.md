# MinerU PDF Box 快速复制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 若派发子代理，必须按项目规约只选择 `gpt-5.5` 模型，并按任务复杂度选择推理强度。

**Goal:** 在 Zotero 7 插件中接入 MinerU PDF 解析，并在 PDF reader pane 中基于解析出的 box 快速复制 Markdown 内容。

**Architecture:** 先把模板示例代码从生命周期里移除，建立 `storage`、`boxNormalizer`、`copyFormatter`、`mineruClient`、`parseManager`、`readerOverlay`、`settings` 七个边界清晰的模块。纯逻辑模块先用自动化测试锁住行为，Zotero UI 与 reader overlay 按可手动验证的垂直切片推进，每个关键 UI 切片结束后停止等待用户手动测试。

**Tech Stack:** Zotero 7 plugin template、TypeScript、zotero-plugin-toolkit、Zotero prefs、Zotero plugin data directory、MinerU 官方 API、Zotero reader DOM。

## 当前进度（2026-05-05）

- Task 1-7 已完成并已有对应提交；Task 6 的右键菜单解析主链路已跑通，用户重试后已提示“解析成功”。
- 为打通 Task 6，已在 MinerU client 边界补齐 Zotero 运行时下的真实网络兼容：裸 XHR 上传 presigned URL、Zotero HTTP JSON 请求、XHR/Zotero HTTP 下载 fallback、Windows `curl.exe` 文件下载 fallback、`nsIZipReader` 本地 ZIP 读取、空响应重试与诊断信息。
- 为修复“解析结果缺少 box 信息”，`boxNormalizer` 已扩展支持真实 MinerU 结果结构：`pdf_info[].para_blocks`、`pdf_info[].layout_dets`、`page_size`、`poly`、`lines[].spans[].content` 和 `interline_equation`。
- 2026-05-03 再次复现“解析结果缺少 box 信息”后确认新的根因在 `mineruClient`：MinerU full zip 可能同时包含 `content_list.json` 与 `middle.json` 等多个 JSON，旧逻辑会取第一个非 `full.md` 的 JSON，若先读到不含 box geometry 的 JSON，就会让 normalizer 得到 0 个 box。已改为优先选择包含 `pages`/`pdf_info` 且 block 带 `bbox`/`poly` 的 JSON，并补充回归测试。
- Task 8 的 STOP 手动测试检查点 D 已由用户确认全部通过，可以继续 Task 9。
- Task 8 已完成 overlay 渲染、hover 和单 box 复制：`all` 模式显示所有 box 边框，仅 hovered box 显示类型标签和复制按钮；`hover` 模式默认隐藏 box，只在 hover 命中时显示浅蓝填充、标签与复制按钮。
- reader overlay 已支持 split view / new pane 同步现有模式；`off` 会清理 overlay DOM；缺少解析结果时会弹出用户提示并回退到 `off`，恢复此前的未解析提示行为。
- `boxNormalizer` 已保留 MinerU 细分类型，支持 `image_caption`、`page_header`、`page_number`、`footnote` 等类型；reader label 显示中文名称，不再压缩成 `figure`、`text`、`unknown`。
- 已修复存量 `boxes.normalized.json` 迁移问题：即使 box 数量不变，只要从 `mineru-result.json` 重新归一化后的结果不同，也会刷新 normalized boxes；空 raw result 不覆盖旧 boxes。
- 已修复 overlay 交互问题：page selector 收紧为 `.page[...]` 避免左上角异常小 box；CSS cascade 修正复制按钮默认隐藏；wheel 事件转发给底层 PDF 元素；hover box 提升层级；复制按钮改为位于 box 下方水平居中。
- 已修复 split pane 关闭后的 overlay 清理问题：对 Zotero/Firefox dead object 做安全清理，移除 listener、timer、RAF 与 root DOM 时吞掉已销毁 pane 的 dead object TypeError；wheel 事件构造改用目标 document window，避免 `WheelEvent is not defined`。
- 已对齐 MinerU 应用中的 box 标签与引用框：`table_body` 显示为“表格”，`ref_text` 归一化为 `reference` 并显示为“引用”；参考文献父级 `list` 大框在 normalizer 与 overlay 渲染层过滤，避免盖住单条参考文献；窄框标签强制横排显示。
- Task 6 仍有两个计划细项未完全收口：boxes 为空时还未保存 failed manifest；重复解析确认目前使用系统 `confirm` 的 OK/Cancel，而不是计划中的自定义“使用已有结果 / 重新解析并覆盖”按钮。
- Task 9 的多选复制尚未开始；Task 10 仅提前完成了部分真实解析错误处理、存量数据迁移和自动化验证。
- 最近自动化验证：`.\node_modules\.bin\zotero-plugin.cmd test --no-watch --exit-on-finish` 通过 56 个测试；`.\node_modules\.bin\tsc.cmd --noEmit` 通过；针对 Task 8 修改文件的 Prettier check 通过。

---

## 计划执行前约束

- 不创建 git worktree；如果执行者认为需要 worktree，必须先说明使用全局还是项目内 worktree，并征得用户同意。
- 写操作前运行 `git status --short`。只有工作区干净时直接写；若存在未提交变更，先停下来询问用户。
- 最终验证优先使用项目本地二进制，避免 `corepack pnpm ...` 给没有 `packageManager` 字段的 `package.json` 引入无关 diff。
- 中文文档与用户可见文案默认用中文；代码中的类型名、Zotero API 名、MinerU API 名保持英文。
- 开发到本文标记为 `STOP: 手动测试检查点` 的步骤时，必须停下来让用户测试，用户确认后才能继续下一任务。

## 文件结构

- Modify: `src/hooks.ts`
  - 只保留生命周期和入口注册分发；删除模板示例注册调用。
- Modify: `src/addon.ts`
  - 扩展 `addon.data` 类型，保存 overlay manager、reader registry、prefs window 等插件运行态。
- Create: `src/modules/domain.ts`
  - 定义 attachment、manifest、normalized box、copy mode、overlay mode 等共享类型。
- Create: `src/modules/storage.ts`
  - 管理 `mineru-copy/attachments/<libraryID>-<attachmentKey>/` 布局、原子写入、读取和结果统计。
- Create: `src/modules/boxNormalizer.ts`
  - 将 MinerU 原始 JSON 转为稳定的 `boxes.normalized.json` 结构。
- Create: `src/modules/copyFormatter.ts`
  - 生成单 box、多 box、公式带 `$`/不带 `$` 的复制文本。
- Create: `src/modules/mineruClient.ts`
  - 封装 MinerU 官方 API 调用，业务层只依赖 `submitPdf`、`pollTask`、`downloadResult`。
- Create: `src/modules/parseManager.ts`
  - 编排 PDF attachment 校验、API Key 校验、重复解析确认、进度提示、错误提示和存储写入。
- Create: `src/modules/readerOverlay.ts`
  - 管理每个 reader pane 的 overlay root、模式、hover、选择集合、复制交互和销毁。
- Create: `src/modules/readerToolbar.ts`
  - 注册 PDF reader toolbar 按钮和菜单，将命令转给 `readerOverlay` 与 `parseManager`。
- Modify: `src/modules/preferenceScript.ts`
  - 改为设置页脚本：API Key 输入、数据目录路径、解析结果数量、打开数据文件夹按钮。
- Modify: `src/utils/prefs.ts`
  - 继续作为 Zotero prefs wrapper，新增 API Key 读写 helper。
- Modify: `typings/prefs.d.ts`
  - 将 prefs map 改为 `apiKey`。
- Modify: `addon/prefs.js`
  - 默认写入 `apiKey` 空字符串。
- Modify: `addon/content/preferences.xhtml`
  - 设置页 UI 改为 MinerU API Key 和数据文件夹信息。
- Modify: `addon/content/zoteroPane.css`
  - 添加 overlay、hover、selected、copy button、unparsed notice 样式。
- Modify: `addon/locale/zh-CN/preferences.ftl`
  - 添加中文设置页文案。
- Modify: `addon/locale/en-US/preferences.ftl`
  - 添加英文设置页文案。
- Modify: `addon/locale/zh-CN/mainWindow.ftl`
  - 添加右键菜单、reader 菜单、提示、错误文案。
- Modify: `addon/locale/en-US/mainWindow.ftl`
  - 添加英文对应文案。
- Create: `test/domainFixtures.ts`
  - 共享测试 fixture：MinerU 原始 box、normalized box、manifest。
- Create: `test/boxNormalizer.test.ts`
  - 覆盖 box 字段映射、`rawIndex`、坐标归一化、Markdown、公式提取。
- Create: `test/copyFormatter.test.ts`
  - 覆盖单 box、多 box 排序合并、公式复制格式。
- Create: `test/storage.test.ts`
  - 覆盖目录名、manifest 读写、已解析判断、临时目录替换。

## Task 1: 建立领域类型与纯逻辑测试骨架

**Files:**
- Create: `src/modules/domain.ts`
- Create: `test/domainFixtures.ts`
- Create: `test/copyFormatter.test.ts`
- Create: `test/boxNormalizer.test.ts`

- [x] **Step 1: 写共享领域类型**

`src/modules/domain.ts` 内容结构：

```ts
export type MinerUBoxType = "text" | "title" | "list" | "table" | "figure" | "formula" | "unknown";

export interface AttachmentRef {
  id: number;
  key: string;
  libraryID: number;
  fileName: string;
  filePath: string;
  mtime: number;
}

export interface NormalizedBox {
  rawIndex: number;
  page: number;
  type: MinerUBoxType;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  markdown: string;
  formula: string | null;
}

export interface ParseManifest {
  attachmentID: number;
  attachmentKey: string;
  libraryID: number;
  fileName: string;
  pdfMtime: number;
  parsedAt: string;
  mineruTaskID: string;
  resultVersion: 1;
  status: "ready" | "failed";
  error?: string;
}

export type OverlayMode = "all" | "hover" | "off";
export type FormulaCopyMode = "with-dollar" | "without-dollar";
```

- [x] **Step 2: 写 copy formatter 失败测试**

`test/copyFormatter.test.ts` 覆盖：

```ts
import { assert } from "chai";
import { formatBoxesForCopy, formatFormulaForCopy } from "../src/modules/copyFormatter";
import { normalizedBoxes } from "./domainFixtures";

describe("copyFormatter", function () {
  it("copies one text box as markdown", function () {
    assert.equal(formatBoxesForCopy([normalizedBoxes[1]]), "第二段");
  });

  it("merges selected boxes by rawIndex", function () {
    assert.equal(
      formatBoxesForCopy([normalizedBoxes[2], normalizedBoxes[0]]),
      "第一段\n\n公式：E=mc^2",
    );
  });

  it("copies formula with dollars", function () {
    assert.equal(formatFormulaForCopy("E=mc^2", "with-dollar"), "$E=mc^2$");
  });

  it("copies formula without dollars", function () {
    assert.equal(formatFormulaForCopy("E=mc^2", "without-dollar"), "E=mc^2");
  });
});
```

- [x] **Step 3: 写 normalizer 失败测试**

`test/boxNormalizer.test.ts` 覆盖：

```ts
import { assert } from "chai";
import { normalizeMinerUBoxes } from "../src/modules/boxNormalizer";
import { mineruResultFixture } from "./domainFixtures";

describe("boxNormalizer", function () {
  it("keeps rawIndex and normalizes bbox into 0..1", function () {
    const boxes = normalizeMinerUBoxes(mineruResultFixture);
    assert.deepInclude(boxes[0], {
      rawIndex: 0,
      page: 1,
      type: "text",
      markdown: "第一段",
      formula: null,
    });
    assert.deepEqual(boxes[0].bbox, {
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.05,
    });
  });

  it("extracts formula content", function () {
    const boxes = normalizeMinerUBoxes(mineruResultFixture);
    assert.equal(boxes[2].type, "formula");
    assert.equal(boxes[2].formula, "E=mc^2");
  });
});
```

- [x] **Step 4: 运行测试，确认失败**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.cmd test
```

Expected: FAIL，错误包含 `Cannot find module '../src/modules/copyFormatter'` 或 `Cannot find module '../src/modules/boxNormalizer'`。

- [x] **Step 5: Commit**

```powershell
git add src/modules/domain.ts test/domainFixtures.ts test/copyFormatter.test.ts test/boxNormalizer.test.ts
git commit -m "test(mineru): add domain formatter normalizer coverage"
```

## Task 2: 实现 copyFormatter 与 boxNormalizer

**Files:**
- Create: `src/modules/copyFormatter.ts`
- Create: `src/modules/boxNormalizer.ts`
- Modify: `test/domainFixtures.ts`

- [x] **Step 1: 写测试 fixture**

`test/domainFixtures.ts` 放入固定 page 尺寸和三类 box：

```ts
import type { NormalizedBox } from "../src/modules/domain";

export const mineruResultFixture = {
  pages: [
    {
      pageNo: 1,
      width: 1000,
      height: 2000,
      blocks: [
        { type: "text", bbox: [100, 400, 400, 500], markdown: "第一段" },
        { type: "text", bbox: [100, 520, 400, 620], markdown: "第二段" },
        { type: "formula", bbox: [100, 650, 500, 740], markdown: "公式：E=mc^2", formula: "E=mc^2" },
      ],
    },
  ],
};

export const normalizedBoxes: NormalizedBox[] = [
  {
    rawIndex: 0,
    page: 1,
    type: "text",
    bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.05 },
    markdown: "第一段",
    formula: null,
  },
  {
    rawIndex: 1,
    page: 1,
    type: "text",
    bbox: { x: 0.1, y: 0.26, width: 0.3, height: 0.05 },
    markdown: "第二段",
    formula: null,
  },
  {
    rawIndex: 2,
    page: 1,
    type: "formula",
    bbox: { x: 0.1, y: 0.325, width: 0.4, height: 0.045 },
    markdown: "公式：E=mc^2",
    formula: "E=mc^2",
  },
];
```

- [x] **Step 2: 实现 copyFormatter**

`src/modules/copyFormatter.ts`：

```ts
import type { FormulaCopyMode, NormalizedBox } from "./domain";

export function formatBoxesForCopy(boxes: NormalizedBox[]): string {
  return [...boxes]
    .sort((a, b) => a.rawIndex - b.rawIndex)
    .map((box) => box.markdown.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function formatFormulaForCopy(formula: string, mode: FormulaCopyMode): string {
  const value = formula.trim();
  return mode === "with-dollar" ? `$${value}$` : value;
}
```

- [x] **Step 3: 实现 boxNormalizer**

执行补充（2026-05-02）：计划中的初版 normalizer 已完成后，又根据真实 MinerU 返回结果补充了两个回归测试和实现：

- 支持 `pdf_info[].para_blocks`，从 `lines[].spans[].content` 提取 Markdown/公式内容。
- 支持 `pdf_info[].layout_dets`，从 `category_type` 映射类型，从 `poly` 计算 bbox。
- 支持 `page_size` 页尺寸、`page_idx + 1` 页码转换、`interline_equation`/`inline_equation` 到 `formula` 的类型映射。

`src/modules/boxNormalizer.ts` 先兼容计划 fixture 和常见 MinerU JSON 层级：

```ts
import type { MinerUBoxType, NormalizedBox } from "./domain";

interface RawPage {
  pageNo?: number;
  page_idx?: number;
  width?: number;
  height?: number;
  blocks?: RawBlock[];
}

interface RawBlock {
  type?: string;
  block_type?: string;
  bbox?: number[];
  markdown?: string;
  text?: string;
  formula?: string;
}

export function normalizeMinerUBoxes(result: unknown): NormalizedBox[] {
  const pages = extractPages(result);
  const boxes: NormalizedBox[] = [];

  for (const page of pages) {
    const width = Number(page.width || 1);
    const height = Number(page.height || 1);
    const pageNumber = Number(page.pageNo ?? page.page_idx ?? 0) || 1;

    for (const block of page.blocks ?? []) {
      const bbox = block.bbox;
      if (!Array.isArray(bbox) || bbox.length < 4) continue;
      const [x1, y1, x2, y2] = bbox.map(Number);
      boxes.push({
        rawIndex: boxes.length,
        page: pageNumber,
        type: normalizeType(block.type ?? block.block_type),
        bbox: {
          x: clamp01(x1 / width),
          y: clamp01(y1 / height),
          width: clamp01((x2 - x1) / width),
          height: clamp01((y2 - y1) / height),
        },
        markdown: String(block.markdown ?? block.text ?? ""),
        formula: block.formula ? String(block.formula) : null,
      });
    }
  }

  return boxes;
}

function extractPages(result: unknown): RawPage[] {
  const value = result as { pages?: RawPage[]; pdf_info?: RawPage[] };
  return value.pages ?? value.pdf_info ?? [];
}

function normalizeType(type: unknown): MinerUBoxType {
  const value = String(type ?? "unknown").toLowerCase();
  if (["text", "title", "list", "table", "figure", "formula"].includes(value)) {
    return value as MinerUBoxType;
  }
  return "unknown";
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
```

- [x] **Step 4: 运行测试，确认通过**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.cmd test
```

Expected: PASS。

- [x] **Step 5: Commit**

```powershell
git add src/modules/copyFormatter.ts src/modules/boxNormalizer.ts test/domainFixtures.ts
git commit -m "feat(mineru): normalize boxes and format copied markdown"
```

## Task 3: 实现 storage 原子写入与读取

**Files:**
- Create: `src/modules/storage.ts`
- Create: `test/storage.test.ts`
- Modify: `src/modules/domain.ts`

- [x] **Step 1: 写 storage 失败测试**

`test/storage.test.ts` 覆盖稳定目录名、manifest 写入读取、ready 判断和覆盖时旧结果保留：

```ts
import { assert } from "chai";
import { createStorage } from "../src/modules/storage";
import { normalizedBoxes } from "./domainFixtures";

describe("storage", function () {
  it("uses libraryID and attachmentKey as stable directory name", function () {
    const storage = createStorage("TmpD/mineru-copy");
    assert.equal(storage.getAttachmentDir({ libraryID: 12, key: "ABC123" }), "TmpD/mineru-copy/attachments/12-ABC123");
  });

  it("writes and reads ready result", async function () {
    const storage = createStorage("TmpD/mineru-copy");
    await storage.writeResult({
      attachment: { id: 1, key: "ABC123", libraryID: 12, fileName: "a.pdf", filePath: "a.pdf", mtime: 1 },
      mineruTaskID: "task-1",
      rawResult: { ok: true },
      markdown: "# A",
      boxes: normalizedBoxes,
    });
    assert.isTrue(await storage.hasReadyResult({ libraryID: 12, key: "ABC123" }));
    assert.equal((await storage.readManifest({ libraryID: 12, key: "ABC123" })).status, "ready");
  });
});
```

- [x] **Step 2: 实现 storage API**

`src/modules/storage.ts` 对外接口固定为：

```ts
import type { AttachmentRef, NormalizedBox, ParseManifest } from "./domain";

export interface StorageAdapter {
  getAttachmentDir(ref: Pick<AttachmentRef, "libraryID" | "key">): string;
  hasReadyResult(ref: Pick<AttachmentRef, "libraryID" | "key">): Promise<boolean>;
  readManifest(ref: Pick<AttachmentRef, "libraryID" | "key">): Promise<ParseManifest>;
  readBoxes(ref: Pick<AttachmentRef, "libraryID" | "key">): Promise<NormalizedBox[]>;
  writeResult(input: {
    attachment: AttachmentRef;
    mineruTaskID: string;
    rawResult: unknown;
    markdown: string;
    boxes: NormalizedBox[];
  }): Promise<void>;
  countReadyResults(): Promise<number>;
  openDataFolder(): Promise<void>;
}
```

实现用 `Zotero.File`、`OS.File` 或当前模板可用的 Zotero 文件 API；写入流程为：

1. 写到同级临时目录 `<target>.tmp-<timestamp>`。
2. 生成 `manifest.json`、`mineru-result.json`、`content.md`、`boxes.normalized.json`。
3. 校验 manifest 的 `status === "ready"` 且 boxes 是数组。
4. 将旧目录移动到 `<target>.bak-<timestamp>`。
5. 将临时目录移动为正式目录。
6. 清理旧备份；清理失败只记录日志。

- [x] **Step 3: 运行测试**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.cmd test
```

Expected: PASS。

- [x] **Step 4: Commit**

```powershell
git add src/modules/storage.ts test/storage.test.ts src/modules/domain.ts
git commit -m "feat(mineru): persist parsed attachment results"
```

## Task 4: 设置页 API Key 与数据目录

**Files:**
- Modify: `typings/prefs.d.ts`
- Modify: `addon/prefs.js`
- Modify: `addon/content/preferences.xhtml`
- Modify: `addon/locale/zh-CN/preferences.ftl`
- Modify: `addon/locale/en-US/preferences.ftl`
- Modify: `src/modules/preferenceScript.ts`
- Modify: `src/utils/prefs.ts`

- [x] **Step 1: 替换 prefs schema**

`typings/prefs.d.ts` 中 `PluginPrefsMap` 改为：

```ts
PluginPrefsMap: {
  "apiKey": string;
};
```

`addon/prefs.js` 改为：

```js
pref("apiKey", "");
```

- [x] **Step 2: 更新设置页 XHTML**

保留 `onload`，页面包含：

```xml
<html:input
  type="password"
  id="zotero-prefpane-__addonRef__-api-key"
  preference="apiKey"
/>
<html:button id="__addonRef__-open-data-folder" data-l10n-id="pref-open-data-folder" />
<html:div id="__addonRef__-data-folder-path" />
<html:div id="__addonRef__-parsed-count" />
```

- [x] **Step 3: 实现设置页脚本**

执行补充：设置页实现过程中已额外修复 Zotero 9 兼容问题、偏好页左侧不显示插件项的问题、数据目录按钮无文字的问题，以及提示消息无文字的问题。`mainWindow.ftl` 已加入 locale 初始化范围，避免 `ProgressWindow` 解析提示为空。

`registerPrefsScripts(window)` 中：

1. 读取 storage 数据根目录，写入 `#__addonRef__-data-folder-path`。
2. 调用 `countReadyResults()`，写入 `#__addonRef__-parsed-count`。
3. 给 `#__addonRef__-open-data-folder` 绑定 click，调用 `storage.openDataFolder()`。
4. 不在日志或 alert 中输出 API Key。

- [x] **Step 4: 构建验证**

Run:

```powershell
.\node_modules\.bin\tsc.cmd --noEmit
```

Expected: exit code 0。

- [x] **Step 5: STOP: 手动测试检查点 A**

停止开发并请用户测试：

- 打开 Zotero 设置页，能看到 MinerU API Key 输入框。
- API Key 输入框是 password 类型，输入后关闭再打开仍存在。
- 页面显示数据目录路径。
- 点击“打开数据文件夹”会打开插件数据目录。
- 设置页不再显示模板示例 table、Orange/Banana/Apple。

用户确认后才能继续 Task 5。

- [x] **Step 6: Commit**

```powershell
git add typings/prefs.d.ts addon/prefs.js addon/content/preferences.xhtml addon/locale/zh-CN/preferences.ftl addon/locale/en-US/preferences.ftl src/modules/preferenceScript.ts src/utils/prefs.ts
git commit -m "feat(settings): add MinerU API key and data folder controls"
```

## Task 5: MinerU client 边界与官方接口复核

**Files:**
- Create: `src/modules/mineruClient.ts`
- Modify: `src/modules/domain.ts`

- [x] **Step 1: 复核官方文档并锁定 adapter 字段**

打开 MinerU 官方 API 文档，记录到 `src/modules/mineruClient.ts` 顶部注释：

- 官方文档 URL：`https://mineru.net/apiManage/docs`
- 采用的接口版本。
- 上传、提交、轮询、结果下载字段名。

当前计划要求业务层只依赖以下稳定接口，接口内部字段按官方文档实现：

```ts
export interface MinerUClient {
  submitPdf(filePath: string): Promise<{ taskID: string }>;
  pollTask(taskID: string): Promise<{ status: "running" | "succeeded" | "failed"; error?: string }>;
  downloadResult(taskID: string): Promise<{ rawResult: unknown; markdown: string }>;
}
```

- [x] **Step 2: 实现 API Key 注入与错误收敛**

执行补充：真实联调中针对 MinerU v4 和 Zotero/Firefox 运行时补充了以下修复：

- 提交体补齐 `enable_table: true` 和 `model_version: "vlm"`，继续保留 `enable_formula`、`language`、`files`。
- 上传 presigned URL 改为默认裸 XHR PUT，不附加额外 request headers，避免 `SignatureDoesNotMatch`。
- 默认 JSON 请求优先走 `Zotero.HTTP.request` adapter；测试注入 `fetch` 时仍保留 fetch 路径。
- HTTP 错误会摘要返回体中的 XML `Code`/`Message`，用于定位 403、签名错误等问题，同时不泄漏 API Key。
- 下载 ZIP 时按顺序尝试直接 XHR、Zotero HTTP fallback、文件下载 fallback；Windows 下文件下载可通过 `curl.exe`，下载到本地后优先用 `nsIZipReader` 读取 ZIP。
- full zip 内存在多个 JSON 时，不能按 ZIP 条目顺序直接返回第一个 JSON；应优先选择包含 `pages`/`pdf_info` 且 `blocks`/`para_blocks`/`layout_dets` 内有 `bbox` 或 `poly` 的 raw result，例如 `middle.json`，避免误选 `content_list.json` 后触发“解析结果缺少 box 信息”。
- 对空响应 ZIP 增加重试和诊断信息，错误信息包含安全 URL、字节数和 fallback 结果。

`createMinerUClient({ apiKey })`：

1. API Key 只放入 request header。
2. 不把 API Key 写入 error message 或 `ztoolkit.log`。
3. HTTP 非 2xx 抛出 `MinerURequestError`，message 包含阶段名和 status code。
4. MinerU 返回业务失败时抛出 `MinerUTaskError`，message 使用官方返回的错误摘要。

- [x] **Step 3: 构建验证**

Run:

```powershell
.\node_modules\.bin\tsc.cmd --noEmit
```

Expected: exit code 0。

- [x] **Step 4: Commit**

```powershell
git add src/modules/mineruClient.ts src/modules/domain.ts
git commit -m "feat(mineru): add official api client boundary"
```

## Task 6: parseManager 与右键菜单解析入口

**Files:**
- Create: `src/modules/parseManager.ts`
- Modify: `src/hooks.ts`
- Modify: `addon/locale/zh-CN/mainWindow.ftl`
- Modify: `addon/locale/en-US/mainWindow.ftl`

- [ ] **Step 1: 实现 attachment 解析编排**

进度说明（2026-05-02）：主流程已实现并经真实 Zotero/MinerU 重试跑通：selection 解析 PDF attachment、API Key 校验、提交、轮询、下载、normalizer、写入 storage、成功提示均已工作。当前仍未完全满足本 step 的计划细项：boxes 为空时尚未写入 failed manifest，只提示“解析结果缺少 box 信息”后返回；重复解析确认使用系统 `confirm`，按钮文案不是计划中的自定义双按钮。

`parseManager` 对外暴露：

```ts
export async function parseSelectedAttachment(options?: { force?: boolean }): Promise<void>;
export async function parseAttachment(attachment: Zotero.Item, options?: { force?: boolean }): Promise<void>;
```

流程：

1. 从 Zotero selection 获取 attachment；选中普通条目时取第一个 PDF attachment。
2. 非 PDF attachment：提示“仅支持 PDF attachment”。
3. 无本地文件：提示“文件访问失败”并记录 attachment id。
4. API Key 缺失：提示“请先到设置页配置 MinerU API Key”。
5. 已有 ready 结果且 `force !== true`：弹出确认，按钮为“使用已有结果”和“重新解析并覆盖”。
6. 调用 `mineruClient` 提交、轮询、下载。
7. 调用 `normalizeMinerUBoxes`。
8. boxes 为空时保存原始结果和失败 manifest，提示“解析结果缺少 box 信息”。
9. boxes 非空时调用 `storage.writeResult()`。

- [x] **Step 2: 注册右键菜单**

执行补充：最终实现未使用 `ztoolkit.Menu.register("item", ...)`，而是在 `onMainWindowLoad` 中直接向 `zotero-itemmenu` 注入 XUL `menuitem`。这样避开了当前模板/Zotero 运行时下菜单注册不稳定的问题，并通过父菜单 `popupshowing` 动态更新 disabled 状态。后续冗余审查已删除无效的 `menuitem` 自身 `popupshowing` 监听。

`hooks.ts` 的 `onMainWindowLoad` 注册 item menu：

```ts
ztoolkit.Menu.register("item", {
  tag: "menuitem",
  id: "zotero-itemmenu-mineru-parse-pdf",
  label: "使用 MinerU 解析 PDF",
  commandListener: () => parseSelectedAttachment(),
});
```

菜单置灰逻辑：

- 当前 selection 没有 PDF attachment 时 disabled。
- selection 是普通条目但没有 PDF attachment 时 disabled。
- PDF attachment 或带 PDF attachment 的普通条目时可点击。

- [x] **Step 3: 删除模板示例注册**

`hooks.ts` 删除 `BasicExampleFactory`、`UIExampleFactory`、`PromptExampleFactory`、`KeyExampleFactory`、`HelperExampleFactory` 的 import 和调用。保留：

- `initLocale()`
- `registerPrefsScripts`
- 主窗口 FTL 插入
- 插件 initialized 标记
- `ztoolkit.unregisterAll()`

- [x] **Step 4: 构建验证**

Run:

```powershell
.\node_modules\.bin\tsc.cmd --noEmit
```

Expected: exit code 0。

- [x] **Step 5: STOP: 手动测试检查点 B**

手动测试记录：用户已确认右键菜单入口出现，并在多轮网络/下载/解压/normalizer 修复后，重试提示“解析成功”。未覆盖项记录在 Step 1 的剩余缺口中。

停止开发并请用户测试：

- 条目右键菜单出现“使用 MinerU 解析 PDF”。
- 非 PDF attachment 或无 PDF 的普通条目菜单置灰，或点击后提示仅支持 PDF。
- 未配置 API Key 时点击解析，提示先配置 API Key，不发起网络请求。
- 已有解析结果的 fixture attachment 再点解析时出现“使用已有结果 / 重新解析并覆盖”。

用户确认后才能继续 Task 7。

- [x] **Step 6: Commit**

```powershell
git add src/modules/parseManager.ts src/hooks.ts addon/locale/zh-CN/mainWindow.ftl addon/locale/en-US/mainWindow.ftl
git commit -m "feat(parse): add MinerU PDF context menu flow"
```

## Task 7: Reader toolbar 按钮与 per-pane 状态骨架

**Files:**
- Create: `src/modules/readerOverlay.ts`
- Create: `src/modules/readerToolbar.ts`
- Modify: `src/addon.ts`
- Modify: `src/hooks.ts`
- Modify: `addon/locale/zh-CN/mainWindow.ftl`
- Modify: `addon/locale/en-US/mainWindow.ftl`

- [x] **Step 1: 建立 reader overlay state key**

`readerOverlay.ts` 定义：

```ts
type ReaderOverlayKey = `${string}:${string}`;

interface ReaderOverlayState {
  key: ReaderOverlayKey;
  readerInstanceID: string;
  attachmentKey: string;
  mode: "all" | "hover" | "off";
  selectedRawIndexes: Set<number>;
  hoverRawIndex: number | null;
  root: HTMLElement | null;
}
```

key 生成规则：

```ts
export function getReaderOverlayKey(readerInstanceID: string, attachmentKey: string): ReaderOverlayKey {
  return `${readerInstanceID}:${attachmentKey}`;
}
```

- [x] **Step 2: 注册 reader toolbar 按钮**

`readerToolbar.ts` 提供：

```ts
export function registerReaderToolbar(win: _ZoteroTypes.MainWindow): void;
export function unregisterReaderToolbar(win?: Window): void;
```

执行补充（2026-05-03）：最终实现未继续使用 `renderToolbar`，而是注册主窗口级同步器：

1. 从主窗口 `Zotero_Tabs._tabs` 枚举 reader tabs，并通过 `Zotero.Reader.getByTabID(tab.id)` 找到 PDF reader。
2. 进入 `reader._iframeWindow.document`，使用 Zotero Reader 源码中的 toolbar 锚点：优先 `#next`，失败时回退 `.toolbar .start`。
3. 将按钮插入上一页/下一页按钮右侧，也就是 `#next` 后面。
4. 将 floating panel 挂在同一个 reader document 的 `documentElement`，避免跨 docgroup append 和跨窗口坐标换算问题。
5. 用 `MutationObserver` + 低频 interval 处理 reader toolbar 重建，但同步过程中不重建已打开的菜单项，避免 hover 闪动。

已验证的用户可见行为：

- 按钮位置正确，位于上一页/下一页按钮右侧。
- 左键单击一次即可打开/关闭菜单。
- hover 背景大小和圆角正常。
- tooltip 正常。
- 菜单项 hover 不再闪动。

按钮菜单包含：

- `显示全部 box`
- `仅显示鼠标所在 box`
- `关闭插件能力`
- `复制已选 box (N)`
- `清空选择`

点击菜单项时只更新当前 reader pane 的 overlay state。

- [x] **Step 3: 生命周期清理**

`hooks.ts`：

- `onMainWindowLoad` 调用 `registerReaderToolbar(win)`。
- `onMainWindowUnload` 调用 `unregisterReaderToolbar(win)`；该函数清理当前窗口的 toolbar binding、panel、observer、interval 和对应 reader overlay state。
- `onShutdown` 调用 `destroyAllReaderOverlays()`。

- [x] **Step 4: 构建验证**

Run:

```powershell
.\node_modules\.bin\tsc.cmd --noEmit
```

实际验证（2026-05-03）：

- `.\node_modules\.bin\tsc.cmd --noEmit`：exit code 0。
- `.\node_modules\.bin\tsc.cmd --noEmit --project test\tsconfig.json`：exit code 0。
- `.\node_modules\.bin\zotero-plugin.cmd test`：184s 后超时，无可用输出。此前多次遇到 Zotero 测试 profile sqlite 锁/运行时卡住，暂不作为代码通过证据。

- [x] **Step 5: STOP: 手动测试检查点 C**

停止开发并请用户测试：

- 打开 PDF reader tab，工具栏出现插件按钮。
- 菜单显示五个入口。
- 菜单可用，点击五个入口不报错。
- 未解析 PDF 的 reader 内提示“当前 PDF 尚未解析”和“立即解析”按钮暂不属于 Task 7 已完成范围，后移到 Task 8/10 与 overlay 未解析状态一起实现。
- 在 Zotero split view 中，reader 共享同一条 toolbar，因此不会出现两个按钮。后续验收改为：共享 toolbar 按钮应作用于当前 active/focused pane；两个 pane 的 overlay 模式、hover 和 selection state 互不影响。
- 关闭一个 pane 或切换其中一个 pane 的 attachment，不影响另一个 pane 的菜单状态。

手动测试记录（2026-05-03）：

- 用户确认按钮左键单击可控制菜单开闭，位置正确。
- 用户确认菜单五个入口正常显示。
- 用户确认每个选项点击后不会报错，菜单仍可使用。
- 用户确认菜单项 hover 不再闪动。
- 用户确认 split view 后不会出现第二个按钮；据此修正后续计划口径为“共享 toolbar 按钮 + active/focused pane state”。

用户确认后才能继续 Task 8。

- [x] **Step 6: Commit**

```powershell
git add src/modules/readerOverlay.ts src/modules/readerToolbar.ts src/addon.ts src/hooks.ts addon/locale/zh-CN/mainWindow.ftl addon/locale/en-US/mainWindow.ftl
git commit -m "feat(reader): add per-pane toolbar state"
```

## Task 8: Overlay 渲染、hover、单 box 复制

**Files:**
- Modify: `src/modules/readerOverlay.ts`
- Modify: `addon/content/zoteroPane.css`
- Modify: `src/modules/readerToolbar.ts`

- [x] **Step 1: 渲染 overlay root**

对每个 reader pane：

1. 读取当前 attachment 的 `boxes.normalized.json`。
2. 在 pane 内创建 `div.mineru-copy-overlay-root`。
3. 每页创建 `div.mineru-copy-page-layer`。
4. 每个 box 创建 `button.mineru-copy-box` 或 `div.mineru-copy-box`，使用 normalized bbox 映射到页面可视尺寸。
5. mode 为 `off` 时销毁 root。

执行注意：

- split view 共享 toolbar，不能假设每个 pane 都有独立 toolbar 按钮。
- toolbar 菜单命令必须先定位当前 active/focused reader pane，再更新该 pane 对应的 `ReaderOverlayState`。
- 如果当前 Zotero API 无法直接暴露 focused pane，需要在 overlay 层通过最近一次 pointer/focus/selection 事件维护 active pane。
- 未解析 PDF 的提示和“立即解析”按钮应在 overlay/root 层实现；Task 7 不再承担这项 UI。

- [x] **Step 2: 实现两种显示模式**

`mode === "all"`：

- 所有 box 有边框，内部透明。
- hover box 填充浅蓝色。
- 仅 hovered box 显示类型标签和复制按钮，未 hover 的 box 不显示这些控件，避免拥挤。

`mode === "hover"`：

- 默认不显示 box。
- hover 命中时显示蓝色边框和浅蓝填充。
- 左上角显示 MinerU 细分类型标签。
- box 下方水平居中显示复制按钮。
- formula box 显示两个按钮：“带 $ 复制”和“不带 $ 复制”。

- [x] **Step 3: 实现复制**

复制使用已有 `ztoolkit.Clipboard()`：

```ts
new ztoolkit.Clipboard().addText(text, "text/unicode").copy();
```

普通 box 复制 `box.markdown`。

formula box：

- “带 $ 复制”调用 `formatFormulaForCopy(box.formula, "with-dollar")`。
- “不带 $ 复制”调用 `formatFormulaForCopy(box.formula, "without-dollar")`。

- [x] **Step 4: 构建验证**

Run:

```powershell
.\node_modules\.bin\tsc.cmd --noEmit
```

Expected: exit code 0。

实际验证（2026-05-05，初始 Task 8 实现）：

- `.\node_modules\.bin\zotero-plugin.cmd test --no-watch --exit-on-finish`：48 passed。
- `.\node_modules\.bin\tsc.cmd --noEmit`：exit code 0。

补充验证（2026-05-05，split cleanup 与 MinerU 标签/引用框修复后）：

- `.\node_modules\.bin\zotero-plugin.cmd test --no-watch --exit-on-finish`：56 passed。
- `.\node_modules\.bin\tsc.cmd --noEmit`：exit code 0。
- `.\node_modules\.bin\prettier.cmd --check src\modules\boxNormalizer.ts src\modules\readerOverlay.ts test\boxNormalizer.test.ts test\readerOverlay.test.ts`：exit code 0。

- [x] **Step 5: STOP: 手动测试检查点 D**

停止开发并请用户测试：

- 对有 fixture 解析结果的 PDF，`显示全部 box` 能看到所有 box 边框。
- hover box 时填充变为浅蓝色。
- `仅显示鼠标所在 box` 默认不铺满页面，只显示 hover 命中的 box。
- hover box 显示类型标签和复制按钮。
- 文本 box 复制 Markdown 正确。
- 公式 box 的“带 $ 复制”和“不带 $ 复制”结果不同且正确。
- 关闭插件能力后，Zotero reader 原生选择、标注、滚动和快捷键不被拦截。
- split view 中通过共享 toolbar 切换模式时，只影响当前 active/focused pane。

用户确认后才能继续 Task 9。

手动测试记录与修复（2026-05-05）：

- 用户报告 Zotero split view 中关闭 split pane 后控制台连续出现 `TypeError: can't access dead object`；已在 overlay 清理路径中兼容 pane/window 已销毁场景，安全清理 listener、timer、RAF 和 root DOM。
- 用户再次测试后报告关闭 split pane 时出现 `ReferenceError: WheelEvent is not defined`；已改为优先使用目标 reader document 的 `defaultView.WheelEvent` 构造转发事件。
- 用户报告 box 标签与 MinerU 应用不对齐：`table_body` 应显示“表格”、参考文献条目应显示“引用”、页码标签应横排；已修复标签映射与标签 CSS。
- 用户报告参考文献条目 hover 时会被父级 `list` 大框覆盖；已在 normalizer 与 overlay 渲染层过滤包含参考文献子框的父级 `list` 大框，保护新解析数据和旧 `boxes.normalized.json`。
- 用户确认 Task 8 检查点已经全部通过。

- [x] **Step 6: Commit**

```powershell
git add src/modules/readerOverlay.ts addon/content/zoteroPane.css src/modules/readerToolbar.ts
git commit -m "feat(reader): render and copy MinerU boxes"
```

后续补充提交：

```powershell
git commit -m "fix(reader): 兼容 split pane 关闭后的 overlay 清理"
git commit -m "fix(reader): 对齐 MinerU box 标签与引用框"
```

## Task 9: 多选、工具栏复制与 split view 销毁

**Files:**
- Modify: `src/modules/readerOverlay.ts`
- Modify: `src/modules/readerToolbar.ts`
- Modify: `addon/content/zoteroPane.css`

- [ ] **Step 1: 实现多选状态**

交互规则：

- `Shift + click` 或 `Ctrl + click` 切换当前 box 的 `rawIndex`。
- 已选 box 添加 `.mineru-copy-box-selected`。
- 普通 click 不切换多选，只执行 hover/单 box 行为。
- selection 存在于当前 reader instance state，不写全局变量。

- [ ] **Step 2: 实现工具栏菜单动态数量**

菜单项显示：

```text
复制已选 box (N)
```

N 从当前 reader state 的 `selectedRawIndexes.size` 计算。

- [ ] **Step 3: 实现多选复制和清空选择**

`复制已选 box (N)`：

1. 读取当前 state 的 selected raw indexes。
2. 从 boxes 中筛选选中项。
3. 调用 `formatBoxesForCopy(selectedBoxes)`。
4. 写入 clipboard。

`清空选择`：

- 只清除当前 reader instance state。
- 重新渲染当前 pane。

- [ ] **Step 4: 销毁场景补齐**

必须覆盖：

- plugin shutdown。
- tab close。
- reader pane close。
- attachment change。
- mode 切换为 `off`。

销毁动作：

- 移除 overlay root DOM。
- 移除 event listener。
- 删除当前 `ReaderOverlayKey` 对应 state。

- [ ] **Step 5: 构建验证**

Run:

```powershell
.\node_modules\.bin\tsc.cmd --noEmit
```

Expected: exit code 0。

- [ ] **Step 6: STOP: 手动测试检查点 E**

停止开发并请用户测试：

- `Shift + 点击` 和 `Ctrl + 点击` 能切换多个 box 选中状态。
- 已选 box 样式明显不同。
- 工具栏菜单 `复制已选 box (N)` 数量实时更新。
- 多选复制按 MinerU JSON 原始顺序，也就是 `rawIndex` 升序合并。
- `清空选择` 只影响当前 reader pane。
- split view 共享一个 toolbar 按钮，但两个 pane 的模式、hover、选择集合互不影响。
- 关闭其中一个 pane 后另一个 pane 的 overlay 正常工作。

用户确认后才能继续 Task 10。

- [ ] **Step 7: Commit**

```powershell
git add src/modules/readerOverlay.ts src/modules/readerToolbar.ts addon/content/zoteroPane.css
git commit -m "feat(reader): support multi-select box copying"
```

## Task 10: 真实解析闭环与错误处理

**Files:**
- Modify: `src/modules/parseManager.ts`
- Modify: `src/modules/mineruClient.ts`
- Modify: `src/modules/storage.ts`
- Modify: `addon/locale/zh-CN/mainWindow.ftl`
- Modify: `addon/locale/en-US/mainWindow.ftl`

当前状态（2026-05-02）：本任务尚未整体开始；其中 MinerU client 的真实下载、解压、错误摘要、空响应重试和真实 API 解析成功路径已在 Task 5/6 联调中提前完成。reader overlay、box 复制、重新解析失败保留旧结果、boxes 为空写 failed manifest 等完整闭环仍待实现或补齐。

- [ ] **Step 1: 完成错误路径提示**

按 spec 固定提示：

- API Key 缺失：提示先到设置页配置 API Key。
- 文件不可读：显示文件访问失败，并记录 attachment id 与文件路径。
- 非 PDF attachment：菜单项置灰或点击后提示仅支持 PDF。
- MinerU 上传失败：显示上传失败，允许重试。
- MinerU 解析失败：显示 MinerU 返回的错误信息。
- 结果下载失败：显示下载失败，允许重新下载或重新解析。
- JSON 缺少 box：保存原始结果，但 overlay 不启用。
- 坐标无法映射：禁用对应页 overlay，其他页面继续工作。
- 重新解析覆盖失败：保留旧结果。

- [ ] **Step 2: 实现重复解析确认**

已有 ready 结果时：

- “使用已有结果”：直接结束，提示可在 PDF tab 中启用 overlay。
- “重新解析并覆盖”：调用解析流程，成功后原子替换结果目录。
- 覆盖失败时旧 `manifest.json`、`mineru-result.json`、`content.md`、`boxes.normalized.json` 仍可读取。

- [ ] **Step 3: 真实 API 冒烟验证**

在用户已经配置 API Key 的 Zotero 环境中：

1. 选中一个本地 PDF attachment。
2. 点击“使用 MinerU 解析 PDF”。
3. 等待任务完成。
4. 检查数据目录中生成：
   - `manifest.json`
   - `mineru-result.json`
   - `content.md`
   - `boxes.normalized.json`
5. 打开 PDF reader，启用 overlay。
6. 复制一个 text box 和一个 formula box。

- [ ] **Step 4: 自动化验证**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.cmd test
.\node_modules\.bin\tsc.cmd --noEmit
```

Expected: 两个命令都 exit code 0。

- [ ] **Step 5: STOP: 手动测试检查点 F**

停止开发并请用户测试完整 MVP：

- 未配置 API Key 的提示正确。
- 配置 API Key 后真实 PDF 能解析成功。
- 已解析 PDF 再解析时出现“使用已有结果 / 重新解析并覆盖”。
- 重新解析失败不会破坏旧结果。
- PDF tab 未解析时显示“立即解析”。
- 三种 overlay 模式切换正确。
- hover、单 box 复制、公式两种复制、多选复制正确。
- Zotero split view 共享 toolbar 按钮，但按钮作用于当前 active/focused pane，两个 pane 状态互不影响。

用户确认后才能进入收尾。

- [ ] **Step 6: Commit**

```powershell
git add src/modules/parseManager.ts src/modules/mineruClient.ts src/modules/storage.ts addon/locale/zh-CN/mainWindow.ftl addon/locale/en-US/mainWindow.ftl
git commit -m "feat(mineru): complete parse flow and error handling"
```

## 收尾验证

- [ ] **Step 1: 检查无关 diff**

Run:

```powershell
git status --short
git diff --stat
```

Expected: 只包含本计划相关文件；没有 `packageManager` 或格式化全仓引起的无关 diff。

- [ ] **Step 2: 运行最终验证**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.cmd test
.\node_modules\.bin\tsc.cmd --noEmit
.\node_modules\.bin\zotero-plugin.cmd build
```

Expected: 三个命令都 exit code 0。

- [ ] **Step 3: 最终手动验收清单**

请用户确认：

- 右键菜单只对 PDF attachment 可用。
- API Key 设置和数据目录按钮可用。
- MinerU 解析结果写入稳定路径。
- 外部程序可读取 `content.md` 和 `boxes.normalized.json`。
- Reader overlay 三种模式可用。
- 单 box、多 box、公式复制可用。
- Split view 下共享 toolbar 按钮作用于当前 active/focused pane，pane 状态保持独立。
- 关闭插件能力后不影响 Zotero reader 原生操作。

## 自审结果

- Spec coverage: 已覆盖 MinerU API、parse manager、storage、reader overlay、settings、复制格式、多选、split view、错误处理和自动/手动测试。
- Placeholder scan: 本计划未发现空任务、延后实现标记或跨任务省略描述。
- Type consistency: `AttachmentRef`、`ParseManifest`、`NormalizedBox`、`OverlayMode`、`FormulaCopyMode` 在后续任务中名称一致。
