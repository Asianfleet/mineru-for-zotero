import type { FluentMessageId } from "../../typings/i10n";
import type { ParseMode, ParseSource } from "../utils/prefs";

export interface ParseNoticeBatchProgress {
  readonly total: number;
  completed: number;
}

export interface ParseNoticeContext {
  source: ParseSource;
  mode: ParseMode;
  batch?: ParseNoticeBatchProgress;
}

export interface ParseNotice {
  id: FluentMessageId;
  args: Record<string, string>;
}

/**
 * 创建解析提示上下文，供提交和完成提示复用。
 */
export function createParseNoticeContext(input: {
  source: ParseSource;
  mode: ParseMode;
  total?: number;
}): ParseNoticeContext {
  return {
    source: input.source,
    mode: input.mode,
    batch:
      typeof input.total === "number"
        ? { total: input.total, completed: 0 }
        : undefined,
  };
}

/**
 * 返回解析任务提交提示。
 */
export function createParseSubmittedNotice(
  context: ParseNoticeContext,
): ParseNotice {
  if (context.batch && context.batch.total > 1) {
    return {
      id: "parse-task-submitted-total" as FluentMessageId,
      args: {
        ...createNoticeArgs(context),
        total: String(context.batch.total),
      },
    };
  }
  return {
    id: "parse-task-submitted" as FluentMessageId,
    args: createNoticeArgs(context),
  };
}

/**
 * 返回解析任务成功完成提示，并按完成顺序更新批量计数。
 */
export function createParseFinishedNotice(
  context: ParseNoticeContext,
): ParseNotice {
  if (context.batch && context.batch.total > 1) {
    const completed = incrementCompletedCount(context.batch);
    return {
      id: "parse-task-finished-progress" as FluentMessageId,
      args: {
        ...createNoticeArgs(context),
        total: String(context.batch.total),
        completed: String(completed),
      },
    };
  }
  return {
    id: "parse-task-finished" as FluentMessageId,
    args: createNoticeArgs(context),
  };
}

function createNoticeArgs(context: ParseNoticeContext): Record<string, string> {
  return {
    source: context.source,
    mode: context.mode,
  };
}

function incrementCompletedCount(batch: ParseNoticeBatchProgress): number {
  batch.completed += 1;
  return batch.completed;
}
