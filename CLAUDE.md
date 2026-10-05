# herdr-web-plugin — agent instructions

## Green tests mean ship it — don't wait for approval

In this repo, don't stop to ask "shall I proceed?" mid-task. Implement the change, then run:

```bash
cd client && npm run build && npx vitest run   # typecheck + build + client tests
npm test                                       # server-side tests (repo root)
```

If those pass, finish the job on your own — including the plugin restart below — and report the
result. Only come back with a question when the tests fail, when the request is genuinely
ambiguous, or for an action that's destructive or publishing (`git commit`, `git push`,
`gh pr create`), which still needs an explicit ask.

## Always restart the local install after code changes

This plugin runs as a persistent background process declared via `[[startup]]` in
`herdr-plugin.toml` (`node server.js`). That process is spawned once, when herdr's own server
starts — **not** on `herdr plugin enable`/`disable`. Confirmed empirically against a sibling
plugin (herdr 0.8.2, same startup mechanism): `herdr plugin disable`/`enable` reports success but
does not kill or respawn the running startup process. Code changes sit inert in an already-running
process until it's actually restarted.

Whenever you finish a change to this plugin's code (anything `server.js` loads), restart it
yourself as the last step, without being asked:

```bash
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"   # or hardcode the repo path
CONFIG_DIR="$(herdr plugin config-dir barnuri.herdr-web)"
# herdr launches it as a relative `node server.js` from the plugin dir, a manual restart as an
# absolute path; kill either, using the process cwd to tell the relative one from other plugins'
for pid in $(pgrep -f 'node (\./)?.*server\.js$'); do
  case "$(ps -o command= -p "$pid")" in
    "node $PLUGIN_DIR/server.js") kill "$pid" ;;
    "node server.js" | "node ./server.js")
      [ "$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" = "$PLUGIN_DIR" ] && kill "$pid" ;;
  esac
done
sleep 1  # give it a moment to actually exit before relaunching
HERDR_PLUGIN_CONFIG_DIR="$CONFIG_DIR" nohup node "$PLUGIN_DIR/server.js" >> "$CONFIG_DIR/server.log" 2>&1 &
disown
```

No restart needed for one-shot action scripts (`open`, `show-url`) or test/doc-only changes —
those run fresh on every invocation.
