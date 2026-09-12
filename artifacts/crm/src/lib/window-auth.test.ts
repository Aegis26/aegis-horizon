import assert from "node:assert/strict";
import test from "node:test";
import {
  claimWindowSessionOwnership,
  releaseWindowSessionOwnership,
} from "./window-auth";

test("StrictMode-style repeated restore reuses this tab's lifetime lock", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let requests = 0;
  const names: string[] = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      locks: {
        request: async (
          _name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => Promise<void>,
        ) => {
          requests += 1;
          names.push(_name);
          await callback({} as Lock);
        },
      },
    },
  });

  try {
    assert.equal(await claimWindowSessionOwnership("aws_1234567890123456789012345678901234567890123"), true);
    assert.equal(await claimWindowSessionOwnership("aws_1234567890123456789012345678901234567890123"), true);
    assert.equal(requests, 1, "the second StrictMode effect must not wait on itself");
    assert.notEqual(names[0], "aegis-window-session:aws_1234567890123456789012345678901234567890123");
    assert.equal(names[0]?.includes("aws_1234567890123456789012345678901234567890123"), false);
    assert.match(names[0] ?? "", /^aegis-window-session:[a-f0-9]{64}$/);
  } finally {
    releaseWindowSessionOwnership();
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});