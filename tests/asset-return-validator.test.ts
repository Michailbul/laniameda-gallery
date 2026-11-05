import { describe, expect, test } from "bun:test";
import schema from "../convex/schema";
import { assetDocValidator } from "../convex/validators";

// getAsset and the asset packs return whole asset documents. A schema field
// missing here makes those reads throw for every asset that has it
// (2 Nov 2026: thumbVariants was missing, so getAsset failed on any image with
// grid renditions; the folders table had the same trap on 1 Nov).
describe("assetDocValidator", () => {
  test("covers every field of the assets table", () => {
    const table = Object.keys(schema.tables.assets.validator.fields).sort();
    const returned = Object.keys(assetDocValidator.fields);
    expect(table.filter((field) => !returned.includes(field))).toEqual([]);
  });
});
