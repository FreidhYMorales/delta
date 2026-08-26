import { describe, expect, it } from "vitest";
import { MACHINE_KINDS, machineKindLabel } from "./machineKinds.js";

describe("MACHINE_KINDS (design D8, PR9)", () => {
  it("lists the 5 machine kinds in JFLAP's own canonical New-menu order", () => {
    expect(MACHINE_KINDS.map((k) => k.id)).toEqual(["Fa", "Mealy", "Moore", "Pda", "Tm"]);
  });

  it("every entry has a stable string id and a human-readable Spanish label", () => {
    expect(MACHINE_KINDS.length).toBe(5);
    for (const kind of MACHINE_KINDS) {
      expect(typeof kind.id).toBe("string");
      expect(kind.id.length).toBeGreaterThan(0);
      expect(typeof kind.label).toBe("string");
      expect(kind.label.length).toBeGreaterThan(0);
    }
  });

  it("has unique ids", () => {
    const ids = MACHINE_KINDS.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("machineKindLabel", () => {
  it("returns the label for a known kind id", () => {
    expect(machineKindLabel("Fa")).toBe("Autómata Finito");
    expect(machineKindLabel("Tm")).toBe("Máquina de Turing");
  });

  it("returns undefined for an unknown kind id", () => {
    expect(machineKindLabel("Nope")).toBeUndefined();
  });
});
