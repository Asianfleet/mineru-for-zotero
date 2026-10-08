import { expect } from "chai";
import { extractArxivId } from "../src/modules/texSource/arxivId";

describe("arXiv identifier extraction", function () {
  it("keeps explicit versions from Extra", function () {
    expect(extractArxivId({ extra: "arXiv: 2301.01234v2", url: "" })).to.equal(
      "2301.01234v2",
    );
  });

  it("reads arXiv URL and rejects conflicting identifiers", function () {
    expect(
      extractArxivId({ extra: "", url: "https://arxiv.org/abs/2301.01234" }),
    ).to.equal("2301.01234");
    expect(() =>
      extractArxivId({
        extra: "arXiv: 2301.01234",
        url: "https://arxiv.org/abs/2401.00001",
      }),
    ).to.throw("ambiguous-arxiv-id");
  });
});
