import { expect } from "chai";
import { createLatexQueryService } from "../src/modules/latexQuery/service";
import type { LatexSourceFile } from "../src/modules/latexQuery/parser";

/** 建立只依赖内存文件的 LaTeX 查询服务。 */
function serviceFor(files: LatexSourceFile[]) {
  return createLatexQueryService({
    store: {
      read: async () => ({
        files,
        mainFile: "main.tex",
        manifest: {},
      }),
    },
    getItem: async () => ({
      id: 1,
      key: "ABCD1234",
      libraryID: 1,
      getField: () => "",
      getDisplayTitle: () => "Paper",
    }),
  });
}

describe("latex query service", function () {
  it("cuts sections at the next peer heading across included files", async function () {
    const service = serviceFor([
      {
        path: "main.tex",
        content:
          "\\section{Intro}\nintro\n\\subsection{Setup}\nsetup\n\\input{part}\n\\section{Results}\nresults\n",
      },
      {
        path: "part.tex",
        content: "included\n\\subsection{Detail}\ndetail\n",
      },
    ]);
    const input = {
      libraryID: 1,
      key: "ABCD1234",
      granularity: "section" as const,
    };
    const intro = await service.read({ ...input, sectionPath: "INTRO" });
    expect(intro.content).to.contain("included");
    expect(intro.content).to.contain("\\subsection{Detail}");
    expect(intro.content).not.to.contain("\\section{Results}");
    const results = await service.read({ ...input, sectionPath: "Results" });
    expect(results.content).to.equal("\\section{Results}\nresults\n");
    const setup = await service.read({
      ...input,
      sectionPath: "Intro / Setup",
    });
    expect(setup.content).to.contain("included");
    expect(setup.content).not.to.contain("\\subsection{Detail}");
    try {
      await service.read({ ...input, sectionPath: "Missing" });
      throw new Error("expected section-not-found");
    } catch (error) {
      expect((error as Error).message).to.equal("section-not-found");
    }
  });

  it("rejects ambiguous leaf titles and unsupported section numbers", async function () {
    const service = serviceFor([
      {
        path: "main.tex",
        content:
          "\\section{A}\n\\subsection{Shared}\n\\section{B}\n\\subsection{Shared}\n",
      },
    ]);
    const input = {
      libraryID: 1,
      key: "ABCD1234",
      granularity: "section" as const,
    };
    try {
      await service.read({ ...input, sectionPath: "Shared" });
      throw new Error("expected ambiguous-section");
    } catch (error) {
      expect((error as Error).message).to.equal("ambiguous-section");
      expect(
        (error as Error & { candidates: unknown[] }).candidates,
      ).to.have.length(2);
    }
    const exact = await service.read({ ...input, sectionPath: "B / Shared" });
    expect(exact.heading?.path).to.deep.equal(["B", "Shared"]);
    try {
      await service.read({ ...input, sectionNumber: "1" });
      throw new Error("expected invalid-request");
    } catch (error) {
      expect((error as Error).message).to.equal("invalid-request");
    }
  });

  it("requires a search query and returns file-line context", async function () {
    const service = serviceFor([
      { path: "main.tex", content: "Before.\n\nTarget line.\n\nAfter." },
    ]);
    const input = {
      libraryID: 1,
      key: "ABCD1234",
      granularity: "search" as const,
    };
    try {
      await service.read(input);
      throw new Error("expected missing-query");
    } catch (error) {
      expect((error as Error).message).to.equal("missing-query");
    }
    const result = await service.read({
      ...input,
      query: "target",
      contextParagraphs: 1,
    });
    expect(result.matches[0]).to.deep.include({
      file: "main.tex",
      line: 3,
      before: ["Before."],
      after: ["After."],
    });
  });
});
