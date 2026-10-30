import { expect, test } from "bun:test";
import { insertMathTemplate, nextMathSlot, mathInput, mathTemplates } from "../src/services/symbio-math.js";
test("KOMYAKU templates use directly computable LaTeX and selection wrapping", () => {
  const template = mathTemplates.find(([id]) => id === "integral")[2];
  expect(insertMathTemplate("x^2", 0, 3, template).value).toBe(String.raw`\int_{0}^{1}{x^2}\,dx`);
  let source = mathTemplates.find(([id]) => id === "matrix")[2];
  for (const value of ["1", "2", "3", "4"]) source = source.replace("□", value);
  expect(source).toBe(String.raw`\begin{bmatrix}1 & 2 \\ 3 & 4\end{bmatrix}`);
  expect(nextMathSlot("□ + □", 0)).toEqual({ start: 4, end: 5 });
  expect(nextMathSlot("□ + □", 4, true)).toEqual({ start: 0, end: 1 });
});
test("computation input is bounded separately from canonical source editing", () => {
  expect(mathInput("x^2", "compute", "x", "{}", "{}").source).toBe("x^2");
  expect(() => mathInput("x".repeat(2049), "compute", "x", "{}", "{}")).toThrow();
  expect(() => mathInput("x", "compute", "x", "[]", "{}")).toThrow();
});

test("invalid JSON uses a stable error code", () => {
  expect(() => mathInput("x", "compute", "x", "{bad}", "{}")).toThrow("invalid_json");
});
