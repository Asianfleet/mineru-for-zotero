import { assert } from "chai";
import {
  parseHeadings,
  readSection,
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
});
