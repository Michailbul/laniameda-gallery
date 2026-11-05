# Characters: the named cast of a world

A character is one person in one world, with a stable code. It replaces the
older conventions that carried identity by hand: the `character` tag plus a
plain name tag, the name on the first caption line, per-character child
folders and a directory Story. Those still work for search; the registry is
now the source of truth for who is who.

## The record

| Field | Meaning |
|---|---|
| code | `DA-CH-001`: world prefix, `CH`, a three-digit number in order of creation. Never changes, never reissued after a delete |
| world | The root collection the person belongs to. Child folders and storybooks are not worlds |
| name, alias | `Ilka`, `Tram-Stop Flower Seller`. Name plus alias is unique inside the world; the alias separates people who share a first name |
| otherNames | Former or alternate names, kept so old captions and retired names still find the person |
| role | Story role in plain words: heroine, suitor, minor |
| lane | `live-action` or `animation` |
| status | `concept` → `approved` → `sheeted`; `retired` keeps the code and history of someone dropped |
| sheet, face | The canonical master sheet and face close-up asset |
| costumes | `C01`, `C02`… each with its own name, status, sheet and face. Full ID `DA-CH-001-C01` |
| nameTag | The plain name tag used on the person's assets (`ilka`) |
| notes | Open gaps, wardrobe sources, anything a later agent needs |

A new face is a new code. A new costume never is. The prefix is set by the
world's first character (DEAR ANNETE gives `DA`); pass `prefix` only when the
derived one clashes with another world.

## Asset links

Every asset that shows the person is linked with a role:

- `concept`: design exploration before approval
- `sheet` / `face`: character sheet or face anchor; with a costume code it
  belongs to that costume, without one it is the master
- `costume`: wardrobe study or garment reference
- `appears-in`: a scene, still or frame the person is in
- `reference`: outside material used for the person

One link per asset per character. A two-person scene links to both. Setting a
sheet or face on the character or a costume links that asset automatically;
unlinking clears the pointer. Deleting an asset drops its links. Links never
change the asset's tags, captions or collections.

## Pipeline

Michael's order is concept → approval → named character sheet.

1. A concept he picks becomes `create_character` with status `concept`, its
   concept images linked as `concept`.
2. `approved` and `sheeted` are his decisions. Set them only on his word.
   Agent review is not approval.
3. Each costume sheet is `save_character_costume` with the sheet and face
   asset IDs; the master sheet and face go on the character with
   `update_character`.
4. Storybook CAST blocks cite the code and costume (`DA-CH-007-C01`), plus
   the sheet asset ID.

Caption line one on sheets and face anchors still carries the name and code,
because asset search reads captions:
`Ilka — Tram-Stop Flower Seller · DA-CH-007 · C01 sheet · Dear Annete`.

## Tools

```text
list_characters { world?, status?, search?, limit? }        world = key (dear-annete), name or root id; worldFolderId is an alias
get_character { character: "DA-CH-001" }                   id is accepted as an alias of character
create_character { world, name, alias?, role?, lane?, status?, sheetAssetId?, faceAssetId?, nameTag?, notes?, otherNames?, prefix? }
update_character { character, expectedRevision, ...fields }        null clears a field
save_character_costume { character, code?, name?, status?, sheetAssetId?, faceAssetId?, notes? }
link_character_assets { character, links: [{ assetId, role, costumeCode?, note? }] }   up to 100
unlink_character_assets { character, assetIds }
remove_character_costume { character, code }
delete_character { character }
```

`character` accepts the code or `character:<id>`. `get_gallery_item` on an
asset also returns `characters`: every person linked to it, by code and role.

`world` is resolved as `open_world` resolves it: the key (`dear-annete`), the
name or the root collection id (`worldFolderId` is the same thing under its
older name). An unknown world is refused with the resolver's message, which
names `open_world` for the list. Without `world`, `list_characters` returns the
whole vault's cast with several worlds mixed: read a world's cast with its
world. The schemas are strict: a key a tool does not take (a `world` on
`get_character`, a misspelled filter) is refused instead of ignored.

`create_character` is idempotent on name plus alias inside the world: a retry
returns the existing record with `created: false`. Read `revision` with
`get_character` before `update_character`; a stale revision is refused.

## Rules

- Register people Michael has named or picked. Do not mint codes for every
  unnamed face in a batch.
- Re-filing existing assets onto characters (splitting one name used for two
  people, retiring a name, moving a mis-filed face) waits until Michael has
  approved the cast names for that world.
- Prefer status `retired` over `delete_character`. Delete only a character he
  names for deletion.
- Re-clothing and new characters follow the world's own cast and wardrobe:
  read the world's sheets through the registry before generating.
