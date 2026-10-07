# Cinematography references

Cinematography has its own tab (Cinematography, in the left sidebar), apart from
Skills. It holds packs of camera moves: each pack is a group such as Dolly &
Tracking or Drone & Crane, each step one move with a reusable movement prompt
and a looping video example. The cards use the skill design under the name
Cinematography.

## What makes it cinematography

Tag the pack `cinematography`. That is the only membership rule. The tab lists
every pack carrying it; the Skills tab, the default grid and `list_skills` /
`search_skills` leave it out.

A pack is saved the way any multi-step record is, as a skill
(`references/ingest.md`, create_skill, one step per move).
Do not file it without the tag. Useful companions: a family tag for the group
(`dolly-track`, `pan-tilt`, `drone-crane`, `zoom-lens`, `physical-moves`,
`human-camera`, `specials`), `reference`, `sourceUrl` of where the moves came
from, and the collection `CINEMATIC TECHNIQUES` › `Camera Movement`.

Write each step's prompt as the camera instruction only, so it stays reusable
when the scene or first frame changes. Put the scene idea after it.

## Finding them

`list_skills` / `skills` and `search_skills` / `searchSkills` hide
cinematography unless the call asks for it:

```json
{ "action": "skills", "tagNames": ["cinematography"] }
```

```json
{ "action": "searchSkills", "query": "slow push toward a face", "tagNames": ["cinematography"], "limit": 5 }
```

Add a family tag to narrow to one group, e.g. `["cinematography","dolly-track"]`.
Read one in full with `get_skill` (`skill:<id>`), same as a skill.
