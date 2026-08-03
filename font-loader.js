/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

((global) => {
  "use strict";

  const extensionApi = global.browser ?? global.chrome;
  const FONT_ROOT = "vendor/katex/fonts/";
  const FONT_SPECS = Object.freeze([
    ["KaTeX_AMS", "KaTeX_AMS-Regular.woff2", "normal", "400"],
    ["KaTeX_Caligraphic", "KaTeX_Caligraphic-Bold.woff2", "normal", "700"],
    ["KaTeX_Caligraphic", "KaTeX_Caligraphic-Regular.woff2", "normal", "400"],
    ["KaTeX_Fraktur", "KaTeX_Fraktur-Bold.woff2", "normal", "700"],
    ["KaTeX_Fraktur", "KaTeX_Fraktur-Regular.woff2", "normal", "400"],
    ["KaTeX_Main", "KaTeX_Main-Bold.woff2", "normal", "700"],
    ["KaTeX_Main", "KaTeX_Main-BoldItalic.woff2", "italic", "700"],
    ["KaTeX_Main", "KaTeX_Main-Italic.woff2", "italic", "400"],
    ["KaTeX_Main", "KaTeX_Main-Regular.woff2", "normal", "400"],
    ["KaTeX_Math", "KaTeX_Math-BoldItalic.woff2", "italic", "700"],
    ["KaTeX_Math", "KaTeX_Math-Italic.woff2", "italic", "400"],
    ["KaTeX_SansSerif", "KaTeX_SansSerif-Bold.woff2", "normal", "700"],
    ["KaTeX_SansSerif", "KaTeX_SansSerif-Italic.woff2", "italic", "400"],
    ["KaTeX_SansSerif", "KaTeX_SansSerif-Regular.woff2", "normal", "400"],
    ["KaTeX_Script", "KaTeX_Script-Regular.woff2", "normal", "400"],
    ["KaTeX_Size1", "KaTeX_Size1-Regular.woff2", "normal", "400"],
    ["KaTeX_Size2", "KaTeX_Size2-Regular.woff2", "normal", "400"],
    ["KaTeX_Size3", "KaTeX_Size3-Regular.woff2", "normal", "400"],
    ["KaTeX_Size4", "KaTeX_Size4-Regular.woff2", "normal", "400"],
    ["KaTeX_Typewriter", "KaTeX_Typewriter-Regular.woff2", "normal", "400"]
  ]);

  async function loadKatexFonts() {
    if (
      typeof global.FontFace !== "function" ||
      typeof global.document?.fonts?.add !== "function" ||
      typeof extensionApi?.runtime?.getURL !== "function"
    ) {
      return { loaded: 0, total: FONT_SPECS.length };
    }

    const faces = FONT_SPECS.map(([family, file, style, weight]) => {
      const url = extensionApi.runtime.getURL(`${FONT_ROOT}${file}`);
      const face = new global.FontFace(
        family,
        `url("${url}") format("woff2")`,
        { display: "block", style, weight }
      );
      global.document.fonts.add(face);
      return face;
    });
    const results = await Promise.allSettled(faces.map((face) => face.load()));
    return {
      loaded: results.filter((result) => result.status === "fulfilled").length,
      total: faces.length
    };
  }

  global.SmartTeXKatexFonts = Object.freeze({
    specs: FONT_SPECS,
    ready: loadKatexFonts()
  });
})(globalThis);
