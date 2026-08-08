/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const listeners = new Map();
let pendingChecks = 0;
let forcePending = false;

class CustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

const sandbox = {
  console,
  CustomEvent,
  navigator: {
    scheduling: {
      isInputPending(options) {
        assert.equal(options.includeContinuous, true);
        pendingChecks += 1;
        return forcePending;
      }
    }
  },
  addEventListener(type, callback) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(callback);
  },
  dispatchEvent(event) {
    for (const callback of listeners.get(event.type) || []) callback(event);
    return true;
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const file of ["interaction-tasks.js", "latex-context.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox, {
    filename: file
  });
}

const tasks = sandbox.SmartTeXInteractionTasks;
const latex = sandbox.SmartTeXLatexContext;
assert.ok(tasks);
assert.ok(latex);

const normal = tasks.runSync("normal", () => latex.maskIgnoredLatex("a\\n% comment\\nb"));
assert.equal(normal.length, 15);

forcePending = true;
assert.throws(
  () => tasks.runSync(
    "interruptible-parser",
    () => latex.maskIgnoredLatex(("text % comment\\n").repeat(20000))
  ),
  (error) => tasks.isAbortError(error),
  "queued keyboard/continuous input must abort a parser before it completes"
);
forcePending = false;
assert.ok(pendingChecks > 0);

let delayedPendingChecks = 0;
sandbox.navigator.scheduling.isInputPending = (options) => {
  assert.equal(options.includeContinuous, true);
  delayedPendingChecks += 1;
  return delayedPendingChecks >= 3;
};
assert.throws(
  () => tasks.runSync("offset-checkpoints", () => {
    for (let index = 0; index < 1000; index += 1) {
      tasks.checkpoint(17 + index * 137, 128);
    }
  }),
  (error) => tasks.isAbortError(error),
  "non-aligned source offsets must still poll and abort for queued input"
);
assert.ok(delayedPendingChecks >= 3);
sandbox.navigator.scheduling.isInputPending = (options) => {
  assert.equal(options.includeContinuous, true);
  pendingChecks += 1;
  return forcePending;
};

const before = tasks.generation();
for (const callback of listeners.get("wheel") || []) callback({ type: "wheel" });
assert.equal(tasks.generation(), before + 1, "wheel input must invalidate active/scheduled work");

assert.throws(
  () => tasks.runSync("explicit-cancel", () => {
    tasks.cancel("keyboard");
    tasks.checkpoint(1, 1);
  }),
  (error) => tasks.isAbortError(error)
);

console.log("Synchronous analysis cancellation tests passed.");
