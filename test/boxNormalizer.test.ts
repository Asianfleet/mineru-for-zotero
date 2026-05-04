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
    assert.equal(boxes[1].type, "formula");
    assert.equal(boxes[1].formula, "E=mc^2");
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
      { type: "text", markdown: "Figure 1: caption" },
    );
    assert.deepInclude(
      boxes.map((box) => ({
        type: box.type,
        markdown: box.markdown,
      })),
      { type: "text", markdown: "Table 1: caption" },
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
    assert.equal(boxes[0].type, "text");
    assert.equal(boxes[0].markdown, "* footnote");
    assert.deepEqual(boxes[0].bbox, {
      x: 0.1,
      y: 0.9,
      width: 0.4,
      height: 0.05,
    });
  });
});
