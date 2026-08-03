/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");

const moduleRoot = process.argv[2];
if (!moduleRoot) {
  throw new Error("Pass the bundled node_modules directory as the first argument.");
}
const { chromium } = require(path.join(moduleRoot, "playwright"));
const executablePath = process.argv[3] || undefined;

const harnesses = [
  {
    file: "citation-bridge-harness.html",
    attribute: "citationBridgeTest"
  },
  {
    file: "citation-autocomplete-harness.html",
    attribute: "citationTest"
  },
  {
    file: "citation-hover-harness.html",
    attribute: "citationHoverTest"
  },
  {
    file: "document-preview-harness.html",
    attribute: "documentPreviewTest"
  },
  {
    file: "paragraph-structure-harness.html",
    attribute: "paragraphStructureTest"
  },
  {
    file: "editor-reference-harness.html",
    attribute: "editorReferenceTest"
  },
  {
    file: "controls-harness.html",
    attribute: "controlsTest"
  },
  {
    file: "preview-harness.html",
    attribute: "positionTest"
  },
  {
    file: "table-preview-harness.html",
    attribute: "tableTest"
  },
  {
    file: "nextcloud-client-harness.html",
    attribute: "nextcloudClientTest"
  },
  {
    file: "nextcloud-project-harness.html",
    attribute: "nextcloudProjectTest"
  }
];

async function run() {
  const browser = await chromium.launch({
    executablePath,
    headless: true
  });
  let failed = false;
  try {
    for (const harness of harnesses) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(pathToFileURL(path.join(__dirname, harness.file)).href);
      await page.waitForFunction(
        (attribute) => (
          ["passed", "failed"].includes(document.documentElement.dataset[attribute])
        ),
        harness.attribute,
        { timeout: 15000 }
      );
      const result = await page.evaluate(
        (attribute) => document.documentElement.dataset[attribute],
        harness.attribute
      );
      const output = await page.locator(
        "output[id$='test-result']"
      ).first().textContent().catch(() => "");
      const passed = result === "passed" && errors.length === 0;
      failed ||= !passed;
      console.log(
        `${passed ? "PASS" : "FAIL"} ${harness.file}: ${output || result}` +
        (errors.length ? ` | ${errors.join(" | ")}` : "")
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
  if (failed) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
