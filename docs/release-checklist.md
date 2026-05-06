# MinerU for Zotero 发布检查清单

本文档用于发布前清理、打包和风险审查。自动化测试和真实 Zotero 手工验收完成后，
按此清单处理发布剩余工作。

## 1. 发布包清理

- 确认工作区只包含本次发布相关 diff。
- 确认 `.env` 未被提交，且 `.env.example` 不包含真实路径、token 或 API Key。
- 确认没有提交本地日志、临时 ZIP、诊断 JSON、截图、录屏或 `.scaffold/build/`
  产物。
- 确认 `package-lock.json` 与实际使用的 npm 依赖一致。
- 确认 `pnpm-lock.yaml` 没有意外进入提交；当前仓库使用 `package-lock.json` 作为
  已跟踪 lockfile。

## 2. 元数据检查

- `package.json`：
  - `name` 为 `mineru-for-zotero`。
  - `version` 是准备发布的版本。
  - `description` 准确描述插件能力。
  - `config.addonID` 保持稳定，不在发布前临时更改。
  - `repository`、`bugs`、`homepage` 指向正式仓库。
- `addon/manifest.json`：
  - 插件名称、版本、描述、主页等由 scaffold 占位符替换。
  - `strict_min_version` 当前为 `6.999`，面向 Zotero 7。
  - `strict_max_version` 当前为 `9.*`，发布前确认仍符合预期。
- `zotero-plugin.config.ts`：
  - `updateURL` 指向 GitHub `release` release 下的 `update.json` 或
    `update-beta.json`。
  - `xpiDownloadLink` 指向版本 tag 下的 `.xpi`。

## 3. 用户文档检查

- README 包含安装、配置、使用、数据目录、常见问题、开发和发布说明。
- README 明确 MinerU API Key 存在 Zotero prefs，不写入 `.env`。
- README 明确解析结果的文件布局：
  - `manifest.json`
  - `mineru-result.json`
  - `content.md`
  - `boxes.normalized.json`
- README 中的功能说明与实际 Reader 菜单、设置页文案一致。

## 4. 发布流程

1. 确认测试、lint、build 和真实 Zotero 验收已完成。
2. 确认工作区没有无关 diff：

   ```shell
   git status --short
   ```

3. 如需发布正式版本，运行：

   ```shell
   npm run release
   ```

4. 推送 tag 后检查 GitHub Action。
5. 确认 GitHub Release 附件中包含：
   - `.xpi`
   - `update.json`
   - 如发布 prerelease，包含 `update-beta.json`
6. 下载 Release 中的 `.xpi`，在干净 Zotero profile 中安装验证。

## 5. 风险审查

- API Key 不进入日志、诊断文件、GitHub issue 模板或发布产物。
- MinerU 上传、轮询、下载任一阶段失败时，用户能看到明确提示。
- 重新解析覆盖失败时，旧结果仍可用。
- `mineru-result.json` 有新 box 类型时，`boxes.normalized.json` 能随读取刷新。
- Reader overlay 关闭后不继续拦截 Zotero 原生选择、滚动和标注。
- Split view 下不同 reader pane 的 overlay 模式和选择状态互不影响。
- PDF 文件名包含中文、空格或特殊字符时，解析结果目录仍按
  `<libraryID>-<attachmentKey>` 定位。

## 6. 发布后检查

- 新安装用户能从 Release `.xpi` 正常安装。
- 旧版本用户能通过 update manifest 更新。
- README 中的安装和配置步骤可复现。
- GitHub Release notes 记录主要功能、已知限制和兼容 Zotero 版本。
