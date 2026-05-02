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
});
