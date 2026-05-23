export type LocalParseMode = "precise" | "lite";
const LOCAL_UPLOAD_FILE_NAME = "mineru-local.pdf";

export interface LocalMultipartRequestBody {
  body: Uint8Array;
  contentType: string;
}

/**
 * 构造本地 MinerU 异步任务使用的 multipart/form-data 字节体。
 */
export function buildLocalTaskFormData(input: {
  filePath: string;
  bytes: Uint8Array;
  mode: LocalParseMode;
  saveImages: boolean;
}): LocalMultipartRequestBody {
  const boundary = createMultipartBoundary();
  const fields = localTaskFields(input.mode, input.saveImages);
  const parts: Uint8Array[] = [
    encodeText(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="files"; filename="${escapeMultipartValue(
          LOCAL_UPLOAD_FILE_NAME,
        )}"\r\n` +
        "Content-Type: application/pdf\r\n\r\n",
    ),
    input.bytes,
    encodeText("\r\n"),
  ];

  for (const [name, value] of fields) {
    parts.push(
      encodeText(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
          `${value}\r\n`,
      ),
    );
  }

  parts.push(encodeText(`--${boundary}--\r\n`));
  return {
    body: concatBytes(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function localTaskFields(
  mode: LocalParseMode,
  saveImages: boolean,
): Array<[string, string]> {
  const precise = mode === "precise";
  return [
    ["lang_list", "ch"],
    ["backend", "hybrid-auto-engine"],
    ["parse_method", "auto"],
    ["formula_enable", "true"],
    ["table_enable", "true"],
    ["image_analysis", "true"],
    ["return_md", "true"],
    ["return_middle_json", precise ? "true" : "false"],
    ["return_model_output", "false"],
    ["return_content_list", precise ? "true" : "false"],
    ["return_images", precise && saveImages ? "true" : "false"],
    ["response_format_zip", precise ? "true" : "false"],
    ["return_original_file", "false"],
    ["start_page_id", "0"],
    ["end_page_id", "99999"],
  ];
}

function createMultipartBoundary(): string {
  return `mineru-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function escapeMultipartValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}
