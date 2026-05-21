import { MinerURequestError, MinerUTaskError } from "./errors";
import { errorMessage, responseErrorDetail } from "./http";
import type { ExtractResultsBatchResponse, FetchLike } from "./types";

/**
 * 从 MinerU 返回的字符串或对象形式 file URL 中取出实际上传地址。
 */
export function getUploadURL(value: string | { url?: string } | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  return value?.url ?? "";
}

/**
 * 拉取指定 batch task 的 MinerU v4 解析结果并校验业务状态码。
 */
export async function fetchBatchResult(
  request: FetchLike,
  baseURL: string,
  apiKey: string,
  taskID: string,
): Promise<ExtractResultsBatchResponse> {
  const response = await requestJson<ExtractResultsBatchResponse>(
    request,
    `${baseURL}/api/v4/extract-results/batch/${encodeURIComponent(taskID)}`,
    "poll",
    {
      method: "GET",
      headers: authHeaders(apiKey),
    },
  );
  ensureBusinessSuccess(response, "poll");
  return response;
}

/**
 * 发送 HTTP 请求并把成功响应解析为指定 JSON 类型。
 */
export async function requestJson<T>(
  request: FetchLike,
  url: string,
  stage: string,
  init: RequestInit,
): Promise<T> {
  const response = await requestOk(request, url, stage, init);
  return (await response.json()) as T;
}

/**
 * 执行 HTTP 请求，统一把网络异常和非 2xx 响应转换为 MinerURequestError。
 */
export async function requestOk(
  request: FetchLike,
  url: string,
  stage: string,
  init: RequestInit,
): Promise<Response> {
  let response: Response;
  try {
    response = await request(url, init);
  } catch (error) {
    throw new MinerURequestError(stage, 0, errorMessage(error));
  }
  if (!response.ok) {
    throw new MinerURequestError(
      stage,
      response.status,
      await responseErrorDetail(response),
    );
  }
  return response;
}

/**
 * 校验 MinerU 响应中的业务 code，非成功状态时抛出任务错误。
 */
export function ensureBusinessSuccess(
  response: { code?: number; msg?: string },
  stage: string,
): void {
  if (response.code != null && response.code !== 0) {
    throw new MinerUTaskError(response.msg || `MinerU ${stage} failed`);
  }
}

/**
 * 读取 batch 结果中的第一个文件解析结果。
 */
export function firstExtractResult(response: ExtractResultsBatchResponse) {
  return response.data?.extract_result?.[0];
}

/**
 * 生成 MinerU API 鉴权请求头。
 */
export function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
  };
}

/**
 * 生成 MinerU JSON API 请求头。
 */
export function jsonHeaders(apiKey: string): Record<string, string> {
  return {
    ...authHeaders(apiKey),
    "Content-Type": "application/json",
  };
}
