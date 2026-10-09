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

  it("keeps unresolved input commands and ignores commented includes", function () {
    const segments = expandLatexSource(
      [
        {
          path: "main.tex",
          content: "% \\input{commented}\n\\input{missing}\nBody",
        },
      ],
      "main.tex",
    );
    expect(segments.map((segment) => segment.text).join("")).to.equal(
      "% \\input{commented}\n\\input{missing}\nBody",
    );
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

  it("finds a table after a long source preamble", function () {
    const segments = [
      {
        file: "main.tex",
        lineStart: 1,
        text: `${"Introduction text.\n".repeat(100)}\\begin{table}\n\\caption{Results}\n\\end{table}`,
      },
    ];
    const tables = extractLatexTables(segments);
    expect(tables).to.have.length(1);
    expect(tables[0].caption).to.equal("Results");
  });

  it("searches expanded source with file and line locations", function () {
    const segments = expandLatexSource(files, "main.tex");
    expect(searchLatex(segments, "method")[0]).to.include({
      file: "sections/method.tex",
      line: 1,
    });
  });

  it("ignores comments and parses balanced heading and caption arguments", function () {
    const source = [
      "% \\section{Hidden}",
      "\\section{Main \\textbf{Results}}",
      "\\begin{table}",
      "% \\caption{Wrong}",
      "\\caption{Gating \\textbf{variant} performance}",
      "\\end{table}",
    ].join("\n");
    const segments = [{ text: source, file: "main.tex", lineStart: 1 }];
    expect(
      parseLatexHeadings(segments).map((heading) => heading.title),
    ).to.deep.equal(["Main Results"]);
    const tables = extractLatexTables(segments);
    expect(tables).to.have.length(1);
    expect(tables[0].caption).to.equal("Gating variant performance");
    expect(tables[0].content).to.equal(source.slice(source.indexOf("\\begin")));
  });

  it("keeps starred command type and escaped title characters", function () {
    const headings = parseLatexHeadings([
      {
        text: "\\section*{Rate \\% \\textbf{gain}}",
        file: "main.tex",
        lineStart: 1,
      },
    ]);
    expect(headings[0]).to.include({
      command: "section*",
      title: "Rate % gain",
      level: 1,
    });
  });

  it("returns search context from adjacent source paragraphs", function () {
    const segments = [
      {
        text: "Before.\n\nTarget line.\n\nAfter.",
        file: "main.tex",
        lineStart: 1,
      },
    ];
    expect(searchLatex(segments, "target", 1)[0]).to.deep.include({
      file: "main.tex",
      line: 3,
      hit: "Target line.",
      before: ["Before."],
      after: ["After."],
    });
  });
});
