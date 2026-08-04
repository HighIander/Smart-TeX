const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const bridgeSource = fs.readFileSync(path.join(root, "page-bridge.js"), "utf8");
const citationSource = fs.readFileSync(
  path.join(root, "citation-autocomplete.js"),
  "utf8"
);

function functionBlock(source, name, nextName) {
  const start = source.indexOf(`  ${name}`);
  assert.notEqual(start, -1, `${name} was not found`);
  const end = source.indexOf(`  ${nextName}`, start + 1);
  assert.notEqual(end, -1, `${nextName} was not found after ${name}`);
  return source.slice(start, end);
}

const readerBlock = functionBlock(
  bridgeSource,
  "async function readProjectTextFileNow",
  "function readProjectTextFile"
);
assert.doesNotMatch(readerBlock, /activateProjectTreeItem|\.click\s*\(|setSelectionRange|waitForSelectedProjectFile/);
assert.match(readerBlock, /fetchProjectDocumentText/);
assert.match(readerBlock, /fetchProjectArchive/);

const bibliographyReaderBlock = functionBlock(
  citationSource,
  "async function fetchBibliographyFile",
  "function bibliographyDisplayName"
);
assert.doesNotMatch(bibliographyReaderBlock, /resolveProjectFile|fetch\s*\(/);
assert.match(bibliographyReaderBlock, /readProjectTextFile/);
assert.match(bibliographyReaderBlock, /Background read failed/);

function extractDeclaration(startText, endText) {
  const start = bridgeSource.indexOf(`  ${startText}`);
  assert.notEqual(start, -1, `${startText} was not found`);
  const end = bridgeSource.indexOf(`  ${endText}`, start + 1);
  assert.notEqual(end, -1, `${endText} was not found after ${startText}`);
  return bridgeSource.slice(start, end);
}

const helperSource = [
  extractDeclaration("function normalizedProjectPath", "function pathStem"),
  extractDeclaration("function findZipEndOfCentralDirectory", "function decodeZipName"),
  extractDeclaration("function decodeZipName", "async function inflateZipEntry"),
  extractDeclaration("async function inflateZipEntry", "async function extractProjectZipText"),
  extractDeclaration("async function extractProjectZipText", "let projectArchiveCache")
].join("\n");

const context = {
  TextDecoder,
  Uint8Array,
  DataView,
  ArrayBuffer,
  Blob,
  Response,
  DecompressionStream: globalThis.DecompressionStream,
  console
};
vm.createContext(context);
vm.runInContext(`${helperSource}\nthis.extractProjectZipText = extractProjectZipText;`, context);

function uint16(value) {
  return [value & 0xff, (value >>> 8) & 0xff];
}
function uint32(value) {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff
  ];
}
function bytes(...parts) {
  return Uint8Array.from(parts.flatMap((part) => Array.from(part)));
}
function storedZip(entries) {
  const encoder = new TextEncoder();
  const locals = [];
  const central = [];
  let localOffset = 0;
  for (const [name, text] of entries) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const local = bytes(
      uint32(0x04034b50), uint16(20), uint16(0x0800), uint16(0),
      uint16(0), uint16(0), uint32(0), uint32(data.length),
      uint32(data.length), uint16(nameBytes.length), uint16(0),
      nameBytes, data
    );
    locals.push(local);
    central.push(bytes(
      uint32(0x02014b50), uint16(20), uint16(20), uint16(0x0800),
      uint16(0), uint16(0), uint16(0), uint32(0), uint32(data.length),
      uint32(data.length), uint16(nameBytes.length), uint16(0), uint16(0),
      uint16(0), uint16(0), uint32(0), uint32(localOffset), nameBytes
    ));
    localOffset += local.length;
  }
  const centralBytes = bytes(...central);
  const localBytes = bytes(...locals);
  const end = bytes(
    uint32(0x06054b50), uint16(0), uint16(0), uint16(entries.length),
    uint16(entries.length), uint32(centralBytes.length),
    uint32(localBytes.length), uint16(0)
  );
  return bytes(localBytes, centralBytes, end).buffer;
}

(async () => {
  const archive = storedZip([
    ["main.tex", "\\documentclass{article}"],
    ["bibliography/additional_references.bib", "@article{Test2026, title={Test}}"]
  ]);
  const result = await context.extractProjectZipText(
    archive,
    "bibliography/additional_references.bib"
  );
  assert.equal(result.fileName, "bibliography/additional_references.bib");
  assert.match(result.value, /@article\{Test2026/);
  console.log("Background bibliography read tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
