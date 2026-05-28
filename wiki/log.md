# AWS Control Tower SOC 2 Automation Suite Wiki — Log

> Append-only. One row per operation. Operations:
> `INIT, SETUP, INGEST, CREATE, UPDATE, MERGE, DEPRECATE, LINT, QUERY, REBUILD-INDEX`.

| Date | Operation | Target | Notes |
|---|---|---|---|
| 2026-05-28 | SETUP | wiki/ | Initialized AWS Control Tower SOC 2 Automation Suite Wiki with the lisa-wiki kernel. |
| 2026-05-28 | INGEST | sources/git/ | git connector: 12 commits + 1 merged PR → 2026-05-28-aws-soc2-setup-git.md. |
| 2026-05-28 | INGEST | sources/roles/ | roles connector: 7 roles / 7 staff pages → 2026-05-28-roles.md. |
| 2026-05-28 | CREATE | projects/, architecture/, requirements/ | Synthesized project, architecture, and SOC 2 requirements pages from git + README. |
| 2026-05-28 | REBUILD-INDEX | index.md | Added projects, architecture, requirements, staff, and source rows. |
