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
    ? PathUtils.join(PathUtils.profileDir, ...root.slice(6).split("/"))
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
  const root = PathUtils.join(resolveRoot(rootDir), "tex_source");
  const dir = (libraryID: number, key: string) =>
    PathUtils.join(root, `${libraryID}-${key}`);
  return {
    getDir: dir,
    async read(ref: { libraryID: number; key: string }) {
      const target = dir(ref.libraryID, ref.key);
      const manifestPath = PathUtils.join(target, "manifest.json");
      if (!(await IOUtils.exists(manifestPath))) {
        throw new Error("tex-source-not-found");
      }
      const manifest = JSON.parse(
        await IOUtils.readUTF8(manifestPath),
      ) as TexManifest;
      if (manifest.status !== "ready") throw new Error("tex-source-not-found");
      const files: LatexSourceFile[] = [];
      for (const path of manifest.files) {
        if (!safeSourcePath(path)) throw new Error("unsafe-archive");
        if (path.toLowerCase().endsWith(".tex"))
          files.push({
            path,
            content: await IOUtils.readUTF8(
              PathUtils.join(target, ...path.split("/")),
            ),
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
        bytes: await IOUtils.read(
          PathUtils.join(dir(ref.libraryID, ref.key), ...path.split("/")),
        ),
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
          const parts = file.path.split("/");
          const path = PathUtils.join(temp, ...parts);
          await IOUtils.makeDirectory(
            PathUtils.join(temp, ...parts.slice(0, -1)),
            {
              createAncestors: true,
              ignoreExisting: true,
            },
          );
          await IOUtils.write(path, file.bytes);
        }
        await IOUtils.writeUTF8(
          PathUtils.join(temp, "manifest.json"),
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
