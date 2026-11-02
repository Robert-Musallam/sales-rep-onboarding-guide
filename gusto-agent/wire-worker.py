#!/usr/bin/env python3
"""Phase 3 go-live step 2 (run only after Robert approves): wire the Gusto agent into the worker.
Idempotent. Adds the sweep call to worker/index.ts and the outbox handler to worker/actions.ts.
The agent still does nothing until app_settings.gusto_agent_enabled = true."""
import pathlib, sys
root = pathlib.Path(__file__).resolve().parent.parent
idx = root / "worker" / "index.ts"; act = root / "worker" / "actions.ts"
s = idx.read_text()
if "sweepGustoAgent" not in s:
    s = s.replace('import { watchGustoSignatures } from "./watchers";',
                  'import { watchGustoSignatures } from "./watchers";\nimport { sweepGustoAgent } from "./gusto-agent";', 1)
    s = s.replace('''    console.error("gusto signature watch failed:", e instanceof Error ? e.message : String(e));
  }''', '''    console.error("gusto signature watch failed:", e instanceof Error ? e.message : String(e));
  }
  try {
    await sweepGustoAgent();
  } catch (e) {
    console.error("gusto agent sweep failed:", e instanceof Error ? e.message : String(e));
  }''', 1)
    assert "await sweepGustoAgent();" in s, "index.ts anchor not found"
    idx.write_text(s); print("index.ts wired")
a = act.read_text()
if "gusto.add_contractor" not in a:
    a = a.replace('import { gate } from "./env";', 'import { gate } from "./env";\nimport { gustoAddContractor } from "./gusto-agent";', 1)
    a = a.replace('  "rep.gusto_signed": async (repId, payload) => {',
                  '  "gusto.add_contractor": async (repId) => gustoAddContractor(repId),\n\n  "rep.gusto_signed": async (repId, payload) => {', 1)
    assert '"gusto.add_contractor"' in a, "actions.ts anchor not found"
    act.write_text(a); print("actions.ts wired")
print("done")
