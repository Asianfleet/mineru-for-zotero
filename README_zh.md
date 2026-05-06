# MinerU for Zotero

[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

[English](README.md)

MinerU for Zotero 是一个 Zotero 7 插件，用于把 PDF 提交给 MinerU
官方 API 解析，并在 Zotero PDF Reader 中基于 MinerU 的 box 信息快速复制
结构化内容。

## 功能

- 在 Zotero 条目或 PDF attachment 右键菜单中提交 MinerU 解析。
- 普通条目右键菜单会列出该条目下的 PDF attachment，并支持一键解析所有
  PDF。
- 在 PDF Reader 工具栏中切换 MinerU box overlay。
- 支持显示全部 box、仅显示鼠标所在 box、关闭插件能力三种模式。
- 支持单个 box 复制、多选 box 复制。
- 多选复制按 MinerU 原始 box 顺序合并 Markdown。
- 公式 box 支持带 `$` 和不带 `$` 两种复制方式。
- 解析结果按 attachment 隔离保存，外部程序可读取原始 JSON、Markdown 和
  normalized box 数据。

## 兼容性

- Zotero：面向 Zotero 7。
- 解析服务：MinerU 官方 API v4。
- 系统：跟随 Zotero 7 与 `zotero-plugin-scaffold` 支持范围。

## 安装

1. 从 GitHub Release 下载最新的 `.xpi` 文件。
2. 打开 Zotero。
3. 进入 `Tools` -> `Add-ons`。
4. 点击齿轮菜单，选择 `Install Add-on From File...`。
5. 选择下载的 `.xpi` 文件并重启 Zotero。

## 配置

1. 在 Zotero 中打开 `Edit` -> `Settings` -> `MinerU for Zotero`。
2. 填入 MinerU API Key。
3. API Key 只保存在本机 Zotero 首选项中，用于调用 MinerU API。

开发用的 `.env` 只配置 Zotero 启动路径、开发 profile 和发布 token；MinerU
API Key 不写入 `.env`。

## 使用

### 解析 PDF

1. 在 Zotero 条目列表中选择一个 PDF attachment，或选择含 PDF attachment
   的普通条目。
2. 右键点击 `使用 MinerU 解析 PDF`。
3. 如果选中的是 PDF attachment，插件会直接解析该 PDF。
4. 如果选中的是普通条目，插件会打开带 MinerU 图标的子菜单：
   - `解析所有 PDF`：解析该条目下的全部 PDF attachment。
   - 单个 PDF 文件名：只解析对应的 PDF attachment。
5. 等待上传、解析、下载和本地写入完成。

如果待解析 PDF 已有解析结果，插件会询问：

- `使用已有结果`：保留现有结果，直接在 Reader 中使用。
- `重新解析并覆盖`：重新提交 MinerU，成功后替换旧结果；失败时保留旧结果。

批量解析时，如果部分 PDF 已有可用结果，选择 `使用已有结果` 会跳过这些 PDF，
继续解析其余未完成的 PDF；选择 `重新解析并覆盖` 会重新提交全部待解析 PDF。

### 在 Reader 中复制内容

1. 打开已解析 PDF。
2. 点击 PDF Reader 工具栏中的 `MinerU box` 按钮。
3. 选择 overlay 模式：
   - `显示全部 box`
   - `仅显示鼠标所在 box`
   - `关闭插件能力`
4. 鼠标悬停到 box 上后使用复制按钮。
5. 使用 `Shift` 或 `Ctrl` 点击多个 box 后，可通过工具栏菜单复制已选 box。

## 数据文件

插件会在 Zotero 插件数据目录下保存解析结果。可在设置页点击
`打开数据文件夹` 查看。

目录结构：

```text
mineru-copy/
  attachments/
    <libraryID>-<attachmentKey>/
      manifest.json
      mineru-result.json
      content.md
      boxes.normalized.json
```

文件说明：

- `manifest.json`：attachment、PDF 修改时间、解析时间、MinerU task id 和状态。
- `mineru-result.json`：MinerU 原始结果，便于诊断和外部读取。
- `content.md`：MinerU 输出的整体 Markdown。
- `boxes.normalized.json`：插件使用的稳定 box 数据结构。

外部程序可以读取这些文件，但不建议写入。插件只对自身写入的数据结构提供兼容
保证。

## 常见问题

### 提示未配置 API Key

进入插件设置页填写 MinerU API Key 后重试。

### 提示文件访问失败

确认 PDF attachment 已在本地可用。对于只保存在云端或未同步完成的附件，请先在
Zotero 中打开或下载该 PDF。

### 提示解析结果缺少 box 信息

插件会保存 MinerU 原始结果，但不会启用 overlay。请保留
`mineru-result.json` 用于诊断，必要时重新解析。

### Reader 中看不到 box

先确认该 PDF 已解析成功。若已解析但仍无法显示，请在设置页打开数据文件夹，检查
对应 attachment 目录下是否存在 `boxes.normalized.json`。

### 结果下载失败

可能是 MinerU 返回的下载 URL 或网络路径临时不可用。可以稍后重试，或重新解析。

## 开发

安装依赖：

```shell
npm install
```

启动开发模式：

```shell
npm start
```

测试、检查和构建：

```shell
npm test
npm run lint:check
npm run build
```

发布：

```shell
npm run release
```

`npm run release` 会走 `zotero-plugin-scaffold` 的发布流程。GitHub Action 会在
tag 推送后构建插件，并发布 `.xpi`、`update.json` 和 `update-beta.json`。

## License

AGPL-3.0-or-later
