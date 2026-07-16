import { assert } from "chai";
import {
  extractMarkdownImageLinks,
  parseHeadings,
  readSection,
  readSectionGroups,
  searchMarkdown,
} from "../src/modules/markdownQuery/markdownParser";
import { MarkdownQueryError } from "../src/modules/markdownQuery/types";

const markdown = [
  "# Example Paper",
  "",
  "Lead paragraph.",
  "",
  "## Introduction",
  "",
  "Intro body.",
  "",
  "### Background",
  "",
  "Background body mentions Retrieval.",
  "",
  "## Methods",
  "",
  "Method body mentions retrieval again.",
].join("\n");

describe("markdownParser", function () {
  it("extracts ATX headings with paths", function () {
    assert.deepEqual(parseHeadings(markdown), [
      { level: 1, title: "Example Paper", path: ["Example Paper"], line: 0 },
      {
        level: 2,
        title: "Introduction",
        path: ["Example Paper", "Introduction"],
        line: 4,
      },
      {
        level: 3,
        title: "Background",
        path: ["Example Paper", "Introduction", "Background"],
        line: 8,
      },
      {
        level: 2,
        title: "Methods",
        path: ["Example Paper", "Methods"],
        line: 12,
      },
    ]);
  });

  it("returns a section by exact heading path", function () {
    const section = readSection(markdown, ["Example Paper", "Introduction"]);

    assert.deepEqual(section.heading.path, ["Example Paper", "Introduction"]);
    assert.equal(
      section.content,
      "## Introduction\n\nIntro body.\n\n### Background\n\nBackground body mentions Retrieval.",
    );
  });

  it("returns section-not-found for a missing section", function () {
    assert.throws(
      () => readSection(markdown, ["Example Paper", "Discussion"]),
      MarkdownQueryError,
      "section-not-found",
    );
  });

  it("searches paragraphs case-insensitively with context", function () {
    assert.deepEqual(searchMarkdown(markdown, "retrieval", 1), [
      {
        paragraphIndex: 4,
        context:
          "### Background\n\nBackground body mentions Retrieval.\n\n## Methods",
        before: ["### Background"],
        hit: "Background body mentions Retrieval.",
        after: ["## Methods"],
      },
      {
        paragraphIndex: 6,
        context: "## Methods\n\nMethod body mentions retrieval again.",
        before: ["## Methods"],
        hit: "Method body mentions retrieval again.",
        after: [],
      },
    ]);
  });

  it("rejects empty search queries", function () {
    assert.throws(
      () => searchMarkdown(markdown, "   "),
      MarkdownQueryError,
      "missing-query",
    );
  });

  it("returns grouped sections by section number and range", function () {
    const groupedMarkdown = [
      "# Paper",
      "",
      "## 5.1 Experiment Settings",
      "",
      "Settings body.",
      "",
      "## 5.2 Results",
      "",
      "Results body.",
      "",
      "## 5.3 Analysis",
      "",
      "Analysis body.",
    ].join("\n");

    const groups = readSectionGroups(groupedMarkdown, {
      sectionNumber: "5.1,5.2-5.3",
    });

    assert.deepEqual(
      groups.map((group) => ({
        query: group.query,
        kind: group.kind,
        status: group.status,
        titles: group.matches.map((match) => match.heading.title),
      })),
      [
        {
          query: "5.1",
          kind: "section-number",
          status: "ok",
          titles: ["5.1 Experiment Settings"],
        },
        {
          query: "5.2-5.3",
          kind: "section-number-range",
          status: "ok",
          titles: ["5.2 Results", "5.3 Analysis"],
        },
      ],
    );
  });

  it("returns grouped fuzzy section path matches", function () {
    const groups = readSectionGroups(markdown, {
      sectionPath: "background,methods",
    });

    assert.deepEqual(
      groups.map((group) => ({
        query: group.query,
        status: group.status,
        titles: group.matches.map((match) => match.heading.title),
      })),
      [
        { query: "background", status: "ok", titles: ["Background"] },
        { query: "methods", status: "ok", titles: ["Methods"] },
      ],
    );
  });

  it("rejects empty grouped section queries", function () {
    for (const input of [{}, { sectionNumber: "   ", sectionPath: "\t" }]) {
      const error = assert.throws(
        () => readSectionGroups(markdown, input),
        MarkdownQueryError,
        "missing-query",
      );

      assert.equal(error.status, 400);
    }
  });

  it("uses section number tokens when reading grouped section ranges", function () {
    const groupedMarkdown = [
      "# Paper",
      "",
      "## 5.2 Results",
      "",
      "Results body.",
      "",
      "## 5.10 Appendix Results",
      "",
      "Appendix body.",
      "",
      "## 5.3 Analysis",
      "",
      "Analysis body.",
    ].join("\n");

    const [group] = readSectionGroups(groupedMarkdown, {
      sectionNumber: "5.2-5.3",
    });

    assert.deepEqual(
      group.matches.map((match) => match.heading.title),
      ["5.2 Results", "5.3 Analysis"],
    );
  });

  it("reports ambiguous grouped range endpoints", function () {
    const duplicateMarkdown = [
      "# Paper",
      "",
      "## 5.1 Setup",
      "",
      "A",
      "",
      "## 5.1 Setup Again",
      "",
      "B",
      "",
      "## 5.2 Results",
      "",
      "C",
      "",
      "## 5.3 Analysis",
      "",
      "D",
      "",
      "## 5.3 Analysis Again",
      "",
      "E",
    ].join("\n");

    const groups = readSectionGroups(duplicateMarkdown, {
      sectionNumber: "5.1-5.2,5.2-5.3",
    });

    assert.deepEqual(
      groups.map((group) => ({
        query: group.query,
        status: group.status,
        candidates: group.candidates?.map((candidate) => candidate.title) ?? [],
      })),
      [
        {
          query: "5.1-5.2",
          status: "ambiguous",
          candidates: ["5.1 Setup", "5.1 Setup Again"],
        },
        {
          query: "5.2-5.3",
          status: "ambiguous",
          candidates: ["5.3 Analysis", "5.3 Analysis Again"],
        },
      ],
    );
  });

  it("reports missing, ambiguous, and invalid section groups", function () {
    const duplicateMarkdown = [
      "# Paper",
      "",
      "## 5.1 Setup",
      "",
      "A",
      "",
      "## 5.1 Setup Again",
      "",
      "B",
    ].join("\n");

    const groups = readSectionGroups(duplicateMarkdown, {
      sectionNumber: "5.1,5.1-6.2,9.9",
    });

    assert.deepEqual(
      groups.map((group) => ({
        query: group.query,
        status: group.status,
        candidates: group.candidates?.length ?? 0,
      })),
      [
        { query: "5.1", status: "ambiguous", candidates: 2 },
        { query: "5.1-6.2", status: "invalid-range", candidates: 0 },
        { query: "9.9", status: "not-found", candidates: 0 },
      ],
    );
  });

  it("extracts markdown image links from section content", function () {
    assert.deepEqual(
      extractMarkdownImageLinks("![Figure](images/a.jpg)\n\n![](images/b.png)"),
      ["images/a.jpg", "images/b.png"],
    );
  });
});
