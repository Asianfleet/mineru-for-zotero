import { assert } from "chai";
import {
  formatBoxesForCopy,
  formatFormulaBoxForCopy,
  formatFormulaForCopy,
  formatTableBoxForCopy,
} from "../src/modules/copyFormatter";
import { normalizedBoxes } from "./domainFixtures";

describe("copyFormatter", function () {
  it("copies one text box as markdown", function () {
    assert.equal(formatBoxesForCopy([normalizedBoxes[1]]), "第二段");
  });

  it("merges selected boxes by rawIndex", function () {
    assert.equal(
      formatBoxesForCopy([normalizedBoxes[2], normalizedBoxes[0]]),
      "第一段\n\n公式：E=mc^2",
    );
  });

  it("wraps selected interline equation boxes with display dollars", function () {
    assert.equal(
      formatBoxesForCopy([
        {
          rawIndex: 0,
          page: 1,
          type: "interline_equation",
          bbox: { x: 0, y: 0, width: 1, height: 1 },
          markdown: "E=mc^2",
          formula: "E=mc^2",
        },
      ]),
      "$$\nE=mc^2\n$$",
    );
  });

  it("wraps selected equation_interline boxes with display dollars", function () {
    assert.equal(
      formatBoxesForCopy([
        {
          rawIndex: 0,
          page: 1,
          type: "equation_interline",
          bbox: { x: 0, y: 0, width: 1, height: 1 },
          markdown: "E=mc^2",
          formula: "E=mc^2",
        },
      ]),
      "$$\nE=mc^2\n$$",
    );
  });

  it("copies formula with dollars", function () {
    assert.equal(formatFormulaForCopy("E=mc^2", "with-dollar"), "$E=mc^2$");
  });

  it("copies formula without dollars", function () {
    assert.equal(formatFormulaForCopy("E=mc^2", "without-dollar"), "E=mc^2");
  });

  it("copies an interline equation formula box with display dollars", function () {
    assert.equal(
      formatFormulaBoxForCopy(
        {
          rawIndex: 0,
          page: 1,
          type: "interline_equation",
          bbox: { x: 0, y: 0, width: 1, height: 1 },
          markdown: "E=mc^2",
          formula: "E=mc^2",
        },
        "with-dollar",
      ),
      "$$\nE=mc^2\n$$",
    );
  });

  it("formats table boxes by requested copy format", function () {
    const tableBox = {
      rawIndex: 0,
      page: 1,
      type: "table",
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      markdown: "| A | B |\n| - | - |\n| 1 | 2 |",
      formula: null,
      tableFormats: {
        latex: "\\begin{tabular}{cc}A&B\\\\1&2\\end{tabular}",
        html: "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
      },
    };

    assert.equal(
      formatTableBoxForCopy(tableBox, "latex"),
      "\\begin{tabular}{cc}A&B\\\\1&2\\end{tabular}",
    );
    assert.equal(
      formatTableBoxForCopy(tableBox, "markdown"),
      "| A | B |\n| - | - |\n| 1 | 2 |",
    );
    assert.equal(
      formatTableBoxForCopy(tableBox, "html"),
      "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
    );
    assert.equal(formatTableBoxForCopy(tableBox, "tsv"), "A\tB\n1\t2");
  });

  it("derives table copy formats from MinerU html", function () {
    const tableBox = {
      rawIndex: 0,
      page: 1,
      type: "table",
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      markdown: "",
      formula: null,
      tableFormats: {
        html: "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
      },
    };

    assert.equal(
      formatTableBoxForCopy(tableBox, "markdown"),
      "| A | B |\n| --- | --- |\n| 1 | 2 |",
    );
    assert.equal(formatTableBoxForCopy(tableBox, "tsv"), "A\tB\n1\t2");
    assert.equal(
      formatTableBoxForCopy(tableBox, "latex"),
      "\\begin{tabular}{cc}\nA & B \\\\\n1 & 2\n\\end{tabular}",
    );
  });
});
