import { assert } from "chai";
import {
  formatBoxesForCopy,
  formatFormulaForCopy,
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

  it("copies formula with dollars", function () {
    assert.equal(formatFormulaForCopy("E=mc^2", "with-dollar"), "$E=mc^2$");
  });

  it("copies formula without dollars", function () {
    assert.equal(formatFormulaForCopy("E=mc^2", "without-dollar"), "E=mc^2");
  });
});
