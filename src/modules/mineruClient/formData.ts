import { basename } from "./path";

export type LocalParseMode = "precise" | "lite";

/**
 * 构造本地 MinerU 异步任务使用的 multipart form data。
 */
export function buildLocalTaskFormData(input: {
  filePath: string;
  bytes: Uint8Array;
  mode: LocalParseMode;
  saveImages: boolean;
}): FormData {
  const form = new FormData();
  form.append(
    "files",
    new Blob([input.bytes], { type: "application/pdf" }),
    basename(input.filePath),
  );
  form.append("lang_list", "ch");
  form.append("backend", "hybrid-auto-engine");
  form.append("parse_method", "auto");
  form.append("formula_enable", "true");
  form.append("table_enable", "true");
  form.append("image_analysis", "true");
  form.append("return_md", "true");
  form.append(
    "return_middle_json",
    input.mode === "precise" ? "true" : "false",
  );
  form.append("return_model_output", "false");
  form.append(
    "return_content_list",
    input.mode === "precise" ? "true" : "false",
  );
  form.append(
    "return_images",
    input.mode === "precise" && input.saveImages ? "true" : "false",
  );
  form.append(
    "response_format_zip",
    input.mode === "precise" ? "true" : "false",
  );
  form.append("return_original_file", "false");
  form.append("start_page_id", "0");
  form.append("end_page_id", "99999");
  return form;
}
