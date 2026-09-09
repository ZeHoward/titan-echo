# Google Sheets cloud saves

Target workbook: `1yRfoKfkWn4hQtUrrzBimIA2df4nTlzoblnH9UwpvWQ8`.

Setup page: https://zehoward.github.io/titan-echo/google-sheets/

The deployment is not active until the owner authorizes Apps Script and provides its production `/exec` URL. Put the verified URL in `public/cloud-config.json` under `endpoint`, then rebuild/deploy Pages. Never put recovery codes, passwords or OAuth secrets in that file or Git.

- Copy `public/google-sheets/Code.gs` into the spreadsheet's Apps Script project, run `setup`, deploy as owner with access Anyone. Keep the spreadsheet private.
- The setup is idempotent and only creates `TitanEcho_Saves_v1`; unexpected existing headers stop initialization. Existing non-game tabs remain intact.
- Pages keeps its IndexedDB gameplay save every 3 seconds and optionally uploads a snapshot every 60 seconds. Offline gameplay remains local; closing the browser before synchronization can leave up to one interval absent from the cloud. Use manual sync before switching devices.
- Each player generates a cryptographically random 256-bit recovery code in their browser. The Sheet stores only its SHA-256 digest. The code grants full access to that player's save. It cannot be recovered from the Sheet; store the downloaded code privately.
- Load requires preview and explicit confirmation. Prior local progress is retained as IndexedDB `before-cloud-restore`. The local revision is incremented, so older tabs cannot overwrite the restored save silently.
- A script lock and compare-and-swap revision prevent last-write-wins overwrites. A conflict pauses upload. Request IDs make replaying the identical committed write idempotent. No blind overwrite or automatic merge is attempted.
- A browser instance ID prevents a remaining cloud binding from uploading a fresh save after IndexedDB was cleared. Different players have separate hashed rows. Account count is capped at 100 to bound scans; expected concurrency is under 10.
- Browser requests use a readable `text/plain` POST and follow Google's content redirect. Never use `no-cors` and claim success. Cross-origin reads, deployment permissions, denied login pages, and round-trip save/load must be verified with the real deployment before activation is declared complete.
- This is authenticated snapshot storage for a small trusted group, not a server-authoritative anti-cheat system. Players can edit their own browser state. It does not introduce a global competitive leaderboard or real-time co-op. Apps Script quotas still apply.

Verification: `npm test` tests backend storage behavior in a mocked Apps Script environment and local restore transactions. These tests do not substitute for live Google authorization or browser cross-origin verification.
