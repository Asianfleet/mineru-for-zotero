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
      markdown: "First paragraph",
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
              lines: [{ spans: [{ content: "First paragraph" }] }],
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
    assert.equal(boxes[0].markdown, "First paragraph");
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

  it("removes a real soft hyphen and keeps genuine compound hyphens", function () {
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
                { spans: [{ content: "A hyphen\u00ad" }] },
                { spans: [{ content: "ated word and a Well-" }] },
                { spans: [{ content: "Known compound." }] },
              ],
            },
          ],
        },
      ],
    });

    // U+00AD is a line-break artifact and disappears; the visible compound
    // hyphen before "Known" is real and stays.
    assert.equal(
      boxes[0].markdown,
      "A hyphenated word and a Well-Known compound.",
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

  it("preserves table copy formats from MinerU blocks", function () {
    const boxes = normalizeMinerUBoxes({
      pdf_info: [
        {
          page_idx: 0,
          page_size: [1000, 2000],
          layout_dets: [
            {
              category_type: "table",
              poly: [100, 400, 400, 400, 400, 500, 100, 500],
              markdown: "| A |\n| - |\n| 1 |",
              html: "<table><tr><td>A</td></tr></table>",
              latex: "\\begin{tabular}{c}A\\\\1\\end{tabular}",
              tsv: "A\n1",
            },
          ],
        },
      ],
    });

    assert.deepEqual(boxes[0].tableFormats, {
      latex: "\\begin{tabular}{c}A\\\\1\\end{tabular}",
      markdown: "| A |\n| - |\n| 1 |",
      html: "<table><tr><td>A</td></tr></table>",
      tsv: "A\n1",
    });
  });

  it("inherits table copy formats from nested table body blocks", function () {
    const boxes = normalizeMinerUBoxes({
      pdf_info: [
        {
          page_idx: 0,
          page_size: [1000, 2000],
          para_blocks: [
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
                  markdown: "| A |\n| - |\n| 1 |",
                  html: "<table><tr><td>A</td></tr></table>",
                  latex: "\\begin{tabular}{c}A\\\\1\\end{tabular}",
                  tsv: "A\n1",
                },
              ],
            },
          ],
        },
      ],
    });

    assert.deepEqual(boxes[0].tableFormats, {
      latex: "\\begin{tabular}{c}A\\\\1\\end{tabular}",
      markdown: "| A |\n| - |\n| 1 |",
      html: "<table><tr><td>A</td></tr></table>",
      tsv: "A\n1",
    });
  });

  it("reads table html from nested MinerU table spans", function () {
    const html =
      "<table><tr><td>algorithm</td><td>score</td></tr><tr><td>PPO</td><td>0.82</td></tr></table>";
    const boxes = normalizeMinerUBoxes({
      pdf_info: [
        {
          page_idx: 0,
          page_size: [1000, 2000],
          para_blocks: [
            {
              type: "table",
              bbox: [100, 900, 500, 1200],
              blocks: [
                {
                  type: "table_body",
                  bbox: [100, 900, 500, 1200],
                  lines: [
                    {
                      spans: [
                        {
                          type: "table",
                          html,
                          image_path: "table.jpg",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    assert.equal(boxes[0].imagePath, "table.jpg");
    assert.deepEqual(boxes[0].tableFormats, { html });
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

  it("normalizes table body blocks as table boxes", function () {
    const boxes = normalizeMinerUBoxes({
      pdf_info: [
        {
          page_idx: 0,
          page_size: [1000, 2000],
          para_blocks: [
            {
              type: "table_body",
              bbox: [100, 900, 500, 1200],
              html: "<table><tr><td>A</td></tr></table>",
            },
          ],
        },
      ],
    });

    assert.equal(boxes.length, 1);
    assert.equal(boxes[0].type, "table");
  });

  it("preserves nested visual image paths for image copying", function () {
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
                  lines: [
                    {
                      spans: [
                        {
                          type: "image",
                          content: "",
                          image_path: "figure.jpg",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    assert.equal(boxes[0].type, "image");
    assert.equal(boxes[0].imagePath, "figure.jpg");
    assert.equal(boxes[1].type, "image_body");
    assert.equal(boxes[1].imagePath, "figure.jpg");
  });

  it("drops list container boxes when reference child boxes are available", function () {
    const boxes = normalizeMinerUBoxes({
      pdf_info: [
        {
          page_idx: 0,
          page_size: [1000, 2000],
          para_blocks: [
            {
              type: "list",
              bbox: [100, 400, 900, 900],
              blocks: [
                {
                  type: "ref_text",
                  bbox: [120, 420, 880, 500],
                  lines: [{ spans: [{ content: "[1] First paper." }] }],
                },
                {
                  type: "ref_text",
                  bbox: [120, 520, 880, 620],
                  lines: [{ spans: [{ content: "[2] Second paper." }] }],
                },
              ],
            },
          ],
        },
      ],
    });

    assert.deepEqual(
      boxes.map((box) => ({
        type: box.type,
        markdown: box.markdown,
      })),
      [
        { type: "reference", markdown: "[1] First paper." },
        { type: "reference", markdown: "[2] Second paper." },
      ],
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
            {
              type: "equation_interline",
              bbox: [100, 400, 500, 460],
              lines: [{ spans: [{ content: "a+b" }] }],
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
        "equation_interline",
      ],
    );
    assert.equal(boxes[4].formula, "E=mc^2");
    assert.equal(boxes[5].formula, "a+b");
  });

  it("joins docvortex inline spans into paragraph markdown", function () {
    const boxes = normalizeMinerUBoxes({
      schema: "docvortex.middle",
      schema_version: "2.0",
      pages: [
        {
          page_idx: 0,
          blocks: [
            {
              type: "text",
              index: 0,
              bbox: [0.25, 0.5, 0.75, 0.75],
              content: [
                { type: "text", content: "The value is " },
                { type: "equation_inline", content: "x<y" },
                { type: "text", content: " and " },
                { type: "code_inline", content: "print(1)" },
              ],
            },
          ],
        },
      ],
    });

    assert.lengthOf(boxes, 1);
    assert.equal(boxes[0].markdown, "The value is $x<y$ and `print(1)`");
    assert.equal(boxes[0].page, 1);
    assert.deepEqual(boxes[0].bbox, {
      x: 0.25,
      y: 0.5,
      width: 0.5,
      height: 0.25,
    });
  });

  it("reads hyperlink span text", function () {
    const boxes = normalizeMinerUBoxes({
      schema: "docvortex.middle",
      pages: [
        {
          page_idx: 0,
          blocks: [
            {
              type: "text",
              index: 0,
              bbox: [0, 0, 1, 1],
              content: [
                { type: "text", content: "See " },
                {
                  type: "hyperlink",
                  url: "https://example.com",
                  content: [{ type: "text", content: "the docs" }],
                },
              ],
            },
          ],
        },
      ],
    });

    assert.equal(boxes[0].markdown, "See the docs");
  });

  it("emits one box per visual container with body and caption", function () {
    const boxes = normalizeMinerUBoxes({
      schema: "docvortex.middle",
      pages: [
        {
          page_idx: 0,
          blocks: [
            {
              type: "image",
              index: 0,
              bbox: [0.1, 0.1, 0.5, 0.4],
              content: [
                {
                  type: "image_body",
                  index: 0,
                  bbox: [0.1, 0.1, 0.5, 0.35],
                  content: "",
                  image_path: "page_0_image_0.png",
                },
                {
                  type: "image_caption",
                  index: 1,
                  bbox: [0.1, 0.35, 0.5, 0.4],
                  content: [{ type: "text", content: "Figure 1" }],
                },
              ],
            },
          ],
        },
      ],
    });

    assert.lengthOf(boxes, 1);
    assert.equal(boxes[0].type, "image");
    assert.equal(boxes[0].imagePath, "page_0_image_0.png");
    assert.include(boxes[0].markdown, "Figure 1");
  });

  it("reads table body html for table copy formats", function () {
    const boxes = normalizeMinerUBoxes({
      schema: "docvortex.middle",
      pages: [
        {
          page_idx: 0,
          blocks: [
            {
              type: "table",
              index: 0,
              bbox: [0.1, 0.1, 0.9, 0.5],
              content: [
                {
                  type: "table_body",
                  index: 0,
                  bbox: [0.1, 0.1, 0.9, 0.45],
                  content: "<table><tr><td>1</td></tr></table>",
                },
              ],
            },
          ],
        },
      ],
    });

    assert.lengthOf(boxes, 1);
    assert.equal(boxes[0].type, "table");
    assert.include(boxes[0].tableFormats?.html ?? "", "<table");
  });

  it("flattens list children that carry their own bbox", function () {
    const boxes = normalizeMinerUBoxes({
      schema: "docvortex.middle",
      pages: [
        {
          page_idx: 0,
          blocks: [
            {
              type: "list",
              index: 0,
              bbox: [0.1, 0.1, 0.9, 0.3],
              content: [
                {
                  type: "text",
                  index: 0,
                  bbox: [0.1, 0.1, 0.9, 0.2],
                  content: [{ type: "text", content: "one" }],
                },
                {
                  type: "text",
                  index: 1,
                  bbox: [0.1, 0.2, 0.9, 0.3],
                  content: [{ type: "text", content: "two" }],
                },
              ],
            },
          ],
        },
      ],
    });

    assert.deepEqual(
      boxes.map((box) => box.markdown),
      ["one", "two"],
    );
  });

  it("reads standalone equation block content", function () {
    const boxes = normalizeMinerUBoxes({
      schema: "docvortex.middle",
      pages: [
        {
          page_idx: 2,
          blocks: [
            {
              type: "equation",
              index: 0,
              bbox: [0.2, 0.2, 0.8, 0.3],
              content: "E=mc^2",
            },
          ],
        },
      ],
    });

    assert.equal(boxes[0].page, 3);
    assert.equal(boxes[0].type, "equation");
    assert.equal(boxes[0].formula, "E=mc^2");
    assert.equal(boxes[0].markdown, "E=mc^2");
  });
});
