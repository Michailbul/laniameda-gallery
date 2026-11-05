import { describe, expect, test } from "bun:test";
import schema from "../convex/schema";
import { folderReturnValidator } from "../convex/folders";

// listFolders returns whole folder documents. A field added to the schema but
// not to this validator makes every folder listing throw (1 Nov 2026:
// universeRootId took the gallery MCP down until it was added).
describe("folderReturnValidator", () => {
  test("covers every field of the folders table", () => {
    const table = Object.keys(schema.tables.folders.validator.fields).sort();
    const returned = Object.keys(folderReturnValidator.fields);
    expect(table.filter((field) => !returned.includes(field))).toEqual([]);
  });
});
