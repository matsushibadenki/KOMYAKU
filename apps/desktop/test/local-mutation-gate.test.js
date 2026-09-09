import { expect, test } from "bun:test";
import { createLocalMutationGate } from "../src/services/local-mutation-gate.js";

test("blocks overlapping mutations and releases after the full operation", async () => {
  const states = [];
  const gate = createLocalMutationGate((busy) => states.push(busy));
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const first = gate.run(async () => { await waiting; return "adopted"; });
  expect(gate.busy).toBe(true);
  let secondRan = false;
  expect(await gate.run(async () => { secondRan = true; })).toBe(false);
  expect(secondRan).toBe(false);
  release();
  expect(await first).toBe("adopted");
  expect(gate.busy).toBe(false);
  expect(states).toEqual([true, false]);
});

test("failure always releases the gate and permits a later retry", async () => {
  const states = [];
  const gate = createLocalMutationGate((busy) => states.push(busy));
  await expect(gate.run(async () => { throw new Error("native failure"); })).rejects.toThrow("native failure");
  expect(gate.busy).toBe(false);
  expect(await gate.run(async () => "retried")).toBe("retried");
  expect(states).toEqual([true, false, true, false]);
});
