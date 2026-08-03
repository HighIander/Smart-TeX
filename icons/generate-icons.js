"use strict";

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const source = path.join(__dirname, "icon.svg");
const sizes = [16, 32, 48, 128];

Promise.all(sizes.map((size) => (
  sharp(source)
    .resize(size, size)
    .png()
    .toFile(path.join(__dirname, `icon${size}.png`))
))).then(() => {
  process.stdout.write(`Generated ${sizes.length} SmartTeX icons.\n`);
}).catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
