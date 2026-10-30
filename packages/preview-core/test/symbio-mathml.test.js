import { expect, test } from "bun:test";
import { renderSymbioMathml } from "../src/index.js";
const wrap = (body) => `<math xmlns="http://www.w3.org/1998/Math/MathML">${body}</math>`;
test("MathML is reconstructed inside the empty-sandbox preview boundary", () => {
  const result = renderSymbioMathml(wrap('<mtable><mtr><mtd><mfrac><mn>1</mn><mn>3</mn></mfrac></mtd></mtr></mtable>'));
  expect(result.sandbox).toBe(""); expect(result.allow).toBe("");
  expect(result.document).toContain('<mfrac>'); expect(result.document).toContain("default-src 'none'");
});
test("MathML rejects active elements, URLs, entities, namespaces and oversized graphs", () => {
  for (const source of [wrap('<script>alert(1)</script>'), wrap('<mi onclick="alert(1)">x</mi>'),
    wrap('<mi href="https://example.com">x</mi>'), wrap('<mi style="color:red">x</mi>'),
    wrap('<mrow xmlns="http://www.w3.org/1999/xhtml"><img /></mrow>'),
    '<!DOCTYPE math [<!ENTITY x "unsafe">]>'+wrap('<mi>&x;</mi>'), wrap('<mi>x'),
    wrap('<mi>x</mi>'.repeat(16_001))]) expect(() => renderSymbioMathml(source)).toThrow();
});
