import assert from "node:assert/strict";
import test from "node:test";
import { calculateAdjustment, PROTOCOLS } from "./heparin.js";

const calculate = (indication, weightKg, apttSeconds, currentRateMlHour) =>
  calculateAdjustment({ indication, weightKg, apttSeconds, currentRateMlHour });

test("VTE/PE protocol reproduces the 40–70 kg source-table actions", () => {
  assertSubset(calculate("vte", 40, 34, 18), { bolusUnits: 3000, rateDeltaMlHour: 4, newRateMlHour: 22 });
  assertSubset(calculate("vte", 50, 40, 22), { bolusUnits: 2000, rateDeltaMlHour: 2.5, newRateMlHour: 24.5 });
  assertSubset(calculate("vte", 60, 55, 26), { bolusUnits: 0, rateDeltaMlHour: 3, newRateMlHour: 29 });
  assertSubset(calculate("vte", 70, 70, 28), { rateDeltaMlHour: 0, newRateMlHour: 28 });
  assertSubset(calculate("vte", 60, 85, 26), { rateDeltaMlHour: -3, newRateMlHour: 23 });
  assertSubset(calculate("vte", 50, 100, 22), { holdMinutes: 30, rateDeltaMlHour: -2.5, newRateMlHour: 19.5 });
  assertSubset(calculate("vte", 70, 121, 28), { holdMinutes: 60, rateDeltaMlHour: -5.5, newRateMlHour: 22.5, notifyPhysician: true });
});

test("ACS protocol reproduces the source-table actions", () => {
  assertSubset(calculate("acs", 40, 39, 14), { bolusUnits: 2000, rateDeltaMlHour: 2, newRateMlHour: 16 });
  assertSubset(calculate("acs", 50, 45, 17), { rateDeltaMlHour: 2.5, newRateMlHour: 19.5 });
  assertSubset(calculate("acs", 60, 60, 21), { rateDeltaMlHour: 0, newRateMlHour: 21 });
  assertSubset(calculate("acs", 70, 80, 24), { rateDeltaMlHour: -3.5, newRateMlHour: 20.5 });
  assertSubset(calculate("acs", 40, 90, 14), { holdMinutes: 30, rateDeltaMlHour: -2, newRateMlHour: 12 });
  assertSubset(calculate("acs", 50, 101, 17), { holdMinutes: 60, rateDeltaMlHour: -4, newRateMlHour: 13, notifyPhysician: true });
});

// Kiwi 2026-11-02 決定：小數 aPTT 落在兩列之間時一律歸入較高的區間（較少 heparin，降低出血風險）
test("aPTT decimal values between rows go to the higher band", () => {
  assert.equal(calculate("acs", 50, 75.5, 17).bandLabel, "76–85 秒");
  assert.equal(calculate("vte", 50, 49.5, 22).bandLabel, "50–59 秒");
  assert.equal(calculate("vte", 50, 89.5, 22).bandLabel, "90–120 秒");
});

test("apttStatus marks in-range only when the protocol asks for no rate change", () => {
  assert.equal(calculate("acs", 60, 30, 21).apttStatus, "below");
  assert.equal(calculate("acs", 60, 45, 21).apttStatus, "below");
  assert.equal(calculate("acs", 60, 60, 21).apttStatus, "in-range");
  assert.equal(calculate("acs", 60, 80, 21).apttStatus, "above");
  assert.equal(calculate("acs", 60, 110, 21).apttStatus, "above");
  assert.equal(calculate("vte", 60, 30, 26).apttStatus, "below");
  assert.equal(calculate("vte", 60, 70, 26).apttStatus, "in-range");
  assert.equal(calculate("vte", 60, 130, 26).apttStatus, "above");
});

test("every band exposes a status, and bolus never appears outside below-range", () => {
  for (const [indication, protocol] of Object.entries(PROTOCOLS)) {
    for (const band of protocol.bands) {
      const status = band.rateDeltaPerKg > 0 ? "below" : band.rateDeltaPerKg < 0 ? "above" : "in-range";
      assert.ok(["below", "in-range", "above"].includes(status), `${indication} ${band.label}`);
      if (band.bolusPerKg) assert.equal(status, "below", `${indication} ${band.label} bolus`);
    }
  }
});

test("invalid clinical inputs are rejected", () => {
  assert.throws(() => calculate("invalid", 60, 70, 20), TypeError);
  assert.throws(() => calculate("acs", 0, 70, 20), RangeError);
  assert.throws(() => calculate("acs", 60, 0, 20), RangeError);
  assert.throws(() => calculate("acs", 60, 70, -1), RangeError);
});

function assertSubset(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(actual[key], value, key);
  }
}
