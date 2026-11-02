#!/bin/bash
# Opens the dedicated "Claude" Chrome profile on the Mac mini (~/chrome-claude).
# Only Claude in Chrome runs here — never the AppFolio, Naz or Lowe's agents.
mkdir -p "$HOME/chrome-claude"
open -na "Google Chrome" --args --user-data-dir="$HOME/chrome-claude" --no-first-run --no-default-browser-check \
  "https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn" \
  "https://gcv-renewals.vercel.app/rnb/reps" "https://admin.cloud.microsoft/#/users"
echo "Opened the Claude Chrome profile (~/chrome-claude)."
