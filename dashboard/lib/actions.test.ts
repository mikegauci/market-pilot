import { describe, expect, it } from "vitest";
import * as actions from "@/lib/actions";

describe("dashboard actions", () => {
  it("does not expose execution mode toggles", () => {
    expect("setExecutionMode" in actions).toBe(false);
    expect(typeof actions.toggleBot).toBe("function");
  });
});
