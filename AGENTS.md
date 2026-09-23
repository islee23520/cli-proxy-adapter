## Repository workflow

- Read effective AGENTS.md files before edits. Fetch all remotes and report the repository, branch, upstream, worktree state, and target branch.
- Work from the latest target on a named feature branch. Preserve dirty work and ask before any destructive or ambiguous update.
- Keep one current ToDo module in progress; require Concept.md, ToDo.md, and a GitHub remote before product edits. Design.md is required for UI work.
- Run local tests and manual QA for the module, then create an atomic commit with only related files, push to the confirmed upstream, and open a PR to main. Do not start another module first.
- Before handoff, fetch again and report ahead/behind, commits, checks, and merge destination.
