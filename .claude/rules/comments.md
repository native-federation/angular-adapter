# Comments

Be very conservative with comments: every comment is noise unless it explains something a reader
would otherwise be puzzled by.

- Only write a comment for the *why*: a non-obvious reason, constraint or upstream quirk. Never
  restate what the code, a name or a signature already says.
- Keep it concise: prefer a single `//` line over a JSDoc block.
- Reference an issue (`(#157)`) instead of retelling its history. No change-log or "fixed X" notes,
  no banners or section dividers.
- Required markers are not noise: keep Angular's MIT notices and `// upstream:` tags on copied code.
- Test files (`*.spec.ts`) are exempt: comment them as freely as useful, e.g. fixture provenance or
  why an expectation is what it is.
