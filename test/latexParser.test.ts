import { expect } from "chai";
import {
  expandLatexSource,
  extractLatexTables,
  parseLatexHeadings,
  searchLatex,
} from "../src/modules/latexQuery/parser";

describe("latex source parser", function () {
  const files = [
    {
      path: "main.tex",
      content:
        "\\documentclass{article}\n\\begin{document}\n\\section{Intro}\n\\input{sections/method}\n\\end{document}\n",
    },
    {
      path: "sections/method.tex",
      content:
        "Method text.\n\\subsection{Setup}\n\\begin{table}\n\\caption{Results}\\label{tab:r}\n\\begin{tabular}{cc} A & B \\\\ \\end{tabular}\n\\end{table}\n",
    },
  ];

  it("expands input files in source order and preserves locations", function () {
    const segments = expandLatexSource(files, "main.tex");
    expect(segments.map((segment) => segment.file)).to.deep.equal([
      "main.tex",
      "sections/method.tex",
      "main.tex",
    ]);
    expect(segments[1].lineStart).to.equal(1);
  });

  it("parses heading paths and balanced table environments", function () {
    const segments = expandLatexSource(files, "main.tex");
    expect(
      parseLatexHeadings(segments).map((heading) => heading.path),
    ).to.deep.equal([["Intro"], ["Intro", "Setup"]]);
    const tables = extractLatexTables(segments);
    expect(tables).to.have.length(1);
    expect(tables[0].caption).to.equal("Results");
    expect(tables[0].label).to.equal("tab:r");
    expect(tables[0].content).to.contain("\\begin{table}");
  });

  it("searches expanded source with file and line locations", function () {
    const segments = expandLatexSource(files, "main.tex");
    expect(searchLatex(segments, "method")[0]).to.include({
      file: "sections/method.tex",
      line: 1,
    });
  });
});
