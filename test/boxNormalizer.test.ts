import { assert } from "chai";
import { normalizeMinerUBoxes } from "../src/modules/boxNormalizer";
import { mineruResultFixture } from "./domainFixtures";

describe("boxNormalizer", function () {
  it("keeps rawIndex and normalizes bbox into 0..1", function () {
    const boxes = normalizeMinerUBoxes(mineruResultFixture);
    assert.deepInclude(boxes[0], {
      rawIndex: 0,
      page: 1,
      type: "text",
      markdown: "第一段",
      formula: null,
    });
    assert.deepEqual(boxes[0].bbox, {
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.05,
    });
  });

  it("extracts formula content", function () {
    const boxes = normalizeMinerUBoxes(mineruResultFixture);
    assert.equal(boxes[2].type, "formula");
    assert.equal(boxes[2].formula, "E=mc^2");
  });

  it("normalizes MinerU pdf_info para_blocks", function () {
    const boxes = normalizeMinerUBoxes({
      pdf_info: [
        {
          page_idx: 0,
          page_size: [1000, 2000],
          para_blocks: [
            {
              type: "text",
              bbox: [100, 400, 400, 500],
              lines: [{ spans: [{ content: "第一段" }] }],
            },
            {
              type: "interline_equation",
              bbox: [100, 650, 500, 740],
              lines: [{ spans: [{ content: "E=mc^2" }] }],
            },
          ],
        },
      ],
    });

    assert.equal(boxes.length, 2);
    assert.equal(boxes[0].page, 1);
    assert.equal(boxes[0].markdown, "第一段");
    assert.equal(boxes[1].type, "interline_equation");
    assert.equal(boxes[1].formula, "E=mc^2");
  });

  it("merges visual text lines into paragraph copy text", function () {
    const boxes = normalizeMinerUBoxes({
      pdf_info: [
        {
          page_idx: 0,
          page_size: [1000, 2000],
          para_blocks: [
            {
              type: "text",
              bbox: [100, 400, 900, 500],
              lines: [
                {
                  spans: [
                    {
                      content:
                        "We trained on the standard WMT 2014 English-German dataset consisting of about 4.5 million",
                    },
                  ],
                },
                {
                  spans: [
                    {
                      content:
                        "sentence pairs. Sentences were encoded using byte-pair encoding [3], which has a shared source-",
                    },
                  ],
                },
                {
                  spans: [
                    {
                      content: "target vocabulary of about 37000 tokens.",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    assert.equal(
      boxes[0].markdown,
      "We trained on the standard WMT 2014 English-German dataset consisting of about 4.5 million sentence pairs. Sentences were encoded using byte-pair encoding [3], which has a shared sourcetarget vocabulary of about 37000 tokens.",
    );
  });

  it("formats inline equations when composing text spans", function () {
    const boxes = normalizeMinerUBoxes({
      pdf_info: [
        {
          page_idx: 0,
          page_size: [1000, 2000],
          para_blocks: [
            {
              type: "text",
              bbox: [100, 400, 900, 500],
              lines: [
                {
                  spans: [
                    {
                      type: "text",
                      content: "Where the projections are parameter matrices",
                    },
                    {
                      type: "inline_equation",
                      content:
                        "W _ { i } ^ { Q } \\in \\mathbb { R } ^ { d _ { \\mathrm { m o d e l } } \\times d _ { k } }",
                    },
                    {
                      type: "text",
                      content: ", W K ∈ Rdmodel×dk , W V ∈ Rdmodel×dv",
                    },
                  ],
                },
                {
                  spans: [
                    {
                      type: "text",
                      content: "and",
                    },
                    {
                      type: "inline_equation",
                      content:
                        "W ^ { O } \\in \\mathbb R ^ { h d _ { v } \\times d _ { \\mathrm { m o d e l } } }",
                    },
                    {
                      type: "text",
                      content: ".",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    assert.equal(
      boxes[0].markdown,
      "Where the projections are parameter matrices $W _ { i } ^ { Q } \\in \\mathbb { R } ^ { d _ { \\mathrm { m o d e l } } \\times d _ { k } }$ , W K ∈ Rdmodel×dk , W V ∈ Rdmodel×dv and $W ^ { O } \\in \\mathbb R ^ { h d _ { v } \\times d _ { \\mathrm { m o d e l } } }$ .",
    );
  });

  it("normalizes MinerU layout_dets", function () {
    const boxes = normalizeMinerUBoxes({
      pdf_info: [
        {
          page_idx: 0,
          page_size: [1000, 2000],
          layout_dets: [
            {
              category_type: "table",
              poly: [100, 400, 400, 400, 400, 500, 100, 500],
              html: "<table><tr><td>A</td></tr></table>",
            },
          ],
        },
      ],
    });

    assert.equal(boxes.length, 1);
    assert.equal(boxes[0].type, "table");
    assert.equal(boxes[0].markdown, "<table><tr><td>A</td></tr></table>");
    assert.deepEqual(boxes[0].bbox, {
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.05,
    });
  });

  it("extracts nested image and table captions from para_blocks", function () {
    const boxes = normalizeMinerUBoxes({
      pdf_info: [
        {
          page_idx: 0,
          page_size: [1000, 2000],
          para_blocks: [
            {
              type: "image",
              bbox: [100, 200, 500, 700],
              blocks: [
                {
                  type: "image_body",
                  bbox: [100, 200, 500, 600],
                  lines: [{ spans: [{ content: "image body" }] }],
                },
                {
                  type: "image_caption",
                  bbox: [100, 620, 500, 700],
                  lines: [{ spans: [{ content: "Figure 1: caption" }] }],
                },
              ],
            },
            {
              type: "table",
              bbox: [100, 900, 500, 1200],
              blocks: [
                {
                  type: "table_caption",
                  bbox: [120, 860, 480, 900],
                  lines: [{ spans: [{ content: "Table 1: caption" }] }],
                },
                {
                  type: "table_body",
                  bbox: [100, 900, 500, 1200],
                  html: "<table><tr><td>A</td></tr></table>",
                },
              ],
            },
          ],
        },
      ],
    });

    assert.deepInclude(
      boxes.map((box) => ({
        type: box.type,
        markdown: box.markdown,
      })),
      { type: "image_caption", markdown: "Figure 1: caption" },
    );
    assert.deepInclude(
      boxes.map((box) => ({
        type: box.type,
        markdown: box.markdown,
      })),
      { type: "table_caption", markdown: "Table 1: caption" },
    );
  });

  it("keeps footnotes from discarded blocks", function () {
    const boxes = normalizeMinerUBoxes({
      pdf_info: [
        {
          page_idx: 0,
          page_size: [1000, 2000],
          discarded_blocks: [
            {
              type: "page_footnote",
              bbox: [100, 1800, 500, 1900],
              lines: [{ spans: [{ content: "* footnote" }] }],
            },
          ],
        },
      ],
    });

    assert.equal(boxes.length, 1);
    assert.equal(boxes[0].type, "page_footnote");
    assert.equal(boxes[0].markdown, "* footnote");
    assert.deepEqual(boxes[0].bbox, {
      x: 0.1,
      y: 0.9,
      width: 0.4,
      height: 0.05,
    });
  });

  it("preserves detailed MinerU types for box labels", function () {
    const boxes = normalizeMinerUBoxes({
      pdf_info: [
        {
          page_idx: 0,
          page_size: [1000, 2000],
          para_blocks: [
            {
              type: "title",
              bbox: [100, 100, 500, 180],
              markdown: "Title",
            },
            {
              type: "image_caption",
              bbox: [100, 220, 500, 280],
              lines: [{ spans: [{ content: "Figure 1: caption" }] }],
            },
            {
              type: "page_header",
              bbox: [100, 20, 500, 60],
              lines: [{ spans: [{ content: "Header" }] }],
            },
            {
              type: "page_number",
              bbox: [900, 1900, 960, 1980],
              lines: [{ spans: [{ content: "1" }] }],
            },
            {
              type: "interline_equation",
              bbox: [100, 300, 500, 360],
              lines: [{ spans: [{ content: "E=mc^2" }] }],
            },
          ],
        },
      ],
    });

    assert.deepEqual(
      boxes.map((box) => box.type),
      [
        "title",
        "image_caption",
        "page_header",
        "page_number",
        "interline_equation",
      ],
    );
    assert.equal(boxes[4].formula, "E=mc^2");
  });
});
