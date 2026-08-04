/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
require("../bibtex-parser.js");

const parser = globalThis.SmartTeXBibTeX;
const bibliography = "\ufeff@article{Bohr1913,\n" +
  "  title = {LXXIII. On the constitution of atoms and molecules},\n" +
  "  author = {Bohr, N.},\n" +
  "  year = {1913}\n" +
  "}\n\n" +
  "@article{MalformedButRecoverable,\n" +
  "  title = {An intentionally unfinished field\n" +
  "}\n\n" +
  "@book{Einstein1916,\n" +
  "  title = {Relativity},\n" +
  "  author = {Einstein, Albert},\n" +
  "  year = {1916}\n" +
  "}\n";

const records = parser.parseBibTeX(bibliography, "additional_references.bib");
assert.ok(records.length >= 2, "Valid entries around malformed content must still parse.");
assert.equal(records[0].key, "Bohr1913");
assert.equal(records.at(-1).key, "Einstein1916");
assert.equal(records[0].sourceFile, "additional_references.bib");
console.log("SmartTeX BibTeX parser tests passed.");
