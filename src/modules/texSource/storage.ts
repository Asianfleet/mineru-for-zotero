import type { LatexSourceFile } from "../latexQuery/parser";

export interface TexManifest extends Record<string, unknown> {
  libraryID: number;
  itemKey: string;
  arxivID: string;
  resolvedVersion: string;
  downloadedAt: string;
  mainFile: string;
  files: string[];
  fileCount: number;
  status: "ready";
  resultVersion: 1;
}

/** 将 ProfD 路径转换为 Zotero 运行时的实际目录。 */
function resolveRoot(root: string): string {
  return root.startsWith("ProfD/")
    ? `${PathUtils.profileDir}/${root.slice(6)}`
    : root;
}

/** 检查源码归档内的相对文件名。 */
export function safeSourcePath(path: string): boolean {
  return (
    Boolean(path) &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !/^[a-z]:/i.test(path) &&
    path.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

/** 读取并以原子目录替换方式保存条目源码。 */
export function createTexSourceStorage(rootDir: string) {
  const root = `${resolveRoot(rootDir).replace(/[\\/]$/, "")}/tex_source`;
  const dir = (libraryID: number, key: string) => `${root}/${libraryID}-${key}`;
  return {
    getDir: dir,
    async read(ref: { libraryID: number; key: string }) {
      const target = dir(ref.libraryID, ref.key);
      const manifest = JSON.parse(
        await IOUtils.readUTF8(`${target}/manifest.json`),
      ) as TexManifest;
      if (manifest.status !== "ready") throw new Error("tex-source-not-found");
      const files: LatexSourceFile[] = [];
      for (const path of manifest.files) {
        if (!safeSourcePath(path)) throw new Error("unsafe-archive");
        if (path.toLowerCase().endsWith(".tex"))
          files.push({
            path,
            content: await IOUtils.readUTF8(`${target}/${path}`),
          });
      }
      return { manifest, files, mainFile: manifest.mainFile };
    },
    async readImage(ref: { libraryID: number; key: string }, path: string) {
      if (!safeSourcePath(path)) throw new Error("invalid-path");
      const source = await this.read(ref);
      if (!source.manifest.files.includes(path))
        throw new Error("tex-image-not-found");
      return {
        path,
        bytes: await IOUtils.read(`${dir(ref.libraryID, ref.key)}/${path}`),
        mime: imageMime(path),
      };
    },
    async write(input: {
      libraryID: number;
      key: string;
      files: Array<{ path: string; bytes: Uint8Array }>;
      manifest: TexManifest;
    }): Promise<void> {
      const target = dir(input.libraryID, input.key);
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const temp = `${target}.tmp-${stamp}`;
      const backup = `${target}.bak-${stamp}`;
      if (!input.files.every((file) => safeSourcePath(file.path)))
        throw new Error("unsafe-archive");
      await IOUtils.makeDirectory(temp, {
        createAncestors: true,
        ignoreExisting: true,
      });
      try {
        for (const file of input.files) {
          const path = `${temp}/${file.path}`;
          await IOUtils.makeDirectory(path.slice(0, path.lastIndexOf("/")), {
            createAncestors: true,
            ignoreExisting: true,
          });
          await IOUtils.write(path, file.bytes);
        }
        await IOUtils.writeUTF8(
          `${temp}/manifest.json`,
          `${JSON.stringify(input.manifest, null, 2)}\n`,
        );
        const oldExists = await IOUtils.exists(target);
        if (oldExists) await IOUtils.move(target, backup);
        try {
          await IOUtils.move(temp, target);
        } catch (error) {
          if (oldExists) await IOUtils.move(backup, target);
          throw error;
        }
        if (oldExists) await IOUtils.remove(backup, { recursive: true });
      } finally {
        await IOUtils.remove(temp, { recursive: true, ignoreAbsent: true });
      }
    },
  };
}

/** 根据扩展名选择源码图片的响应类型。 */
function imageMime(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return "application/pdf";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "svg") return "image/svg+xml";
  if (extension === "eps") return "application/postscript";
  return "image/png";
}
