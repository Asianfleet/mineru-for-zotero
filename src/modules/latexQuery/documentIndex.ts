import type { LatexSegment } from "./parser";

export interface LatexDocumentIndex {
  text: string;
  locate(offset: number): { file: string; line: number };
}

/** 将展开片段连成文档，同时保留每个偏移的原文件位置。 */
export function createLatexDocumentIndex(
  segments: LatexSegment[],
): LatexDocumentIndex {
  const ranges: Array<{
    start: number;
    end: number;
    segment: LatexSegment;
  }> = [];
  let offset = 0;
  for (const segment of segments) {
    ranges.push({ start: offset, end: offset + segment.text.length, segment });
    offset += segment.text.length;
  }
  return {
    text: segments.map((segment) => segment.text).join(""),
    locate(position: number) {
      const range =
        ranges.find(({ start, end }) => position >= start && position < end) ??
        ranges[ranges.length - 1];
      if (!range) return { file: "", line: 1 };
      const within = Math.max(
        0,
        Math.min(position - range.start, range.segment.text.length),
      );
      const preceding = range.segment.text.slice(0, within);
      return {
        file: range.segment.file,
        line: range.segment.lineStart + (preceding.match(/\n/g)?.length ?? 0),
      };
    },
  };
}
