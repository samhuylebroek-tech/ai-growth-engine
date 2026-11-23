# Interface components

- Module pages open with the shared `PageHeader` (`app/status.tsx`: title, purpose, optional eyebrow/meta/actions) so every module reads the same way.
- Creation and edit forms wrap each control in `app/field.tsx` `Field`, so field names stay visible after typing and never rely on placeholder text alone.
