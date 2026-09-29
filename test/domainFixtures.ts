import type { NormalizedBox } from "../src/modules/domain";

export const mineruResultFixture = {
  pages: [
    {
      pageNo: 1,
      width: 1000,
      height: 2000,
      blocks: [
        {
          type: "text",
          bbox: [100, 400, 400, 500],
          markdown: "First paragraph",
        },
        {
          type: "text",
          bbox: [100, 520, 400, 620],
          markdown: "Second paragraph",
        },
        {
          type: "formula",
          bbox: [100, 650, 500, 740],
          markdown: "Formula: E=mc^2",
          formula: "E=mc^2",
        },
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
    markdown: "First paragraph",
    formula: null,
  },
  {
    rawIndex: 1,
    page: 1,
    type: "text",
    bbox: { x: 0.1, y: 0.26, width: 0.3, height: 0.05 },
    markdown: "Second paragraph",
    formula: null,
  },
  {
    rawIndex: 2,
    page: 1,
    type: "formula",
    bbox: { x: 0.1, y: 0.325, width: 0.4, height: 0.045 },
    markdown: "Formula: E=mc^2",
    formula: "E=mc^2",
  },
];
