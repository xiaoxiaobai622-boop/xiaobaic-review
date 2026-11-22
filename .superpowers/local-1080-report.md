# Local 1080p MP4 rendition — backend/data report

STATUS: DONE_WITH_CONCERNS

Branch: `local-1080` (worktree `/Users/xiaoxiaobai/code/xiaobaic-review-1080`, base `origin/main` 5707af08)
Scope: backend/data half only. No player quality-menu UI, no deployment, no push, no production access.

## Files changed

- `prisma/schema.prisma` — `Video.local1080Status` (default `NONE`) and `Video.local1080Error`.
- `prisma/migrations/20261122090000_local_1080_status/migration.sql` — hand-written `ALTER TABLE`, no backfill.
- `src/lib/s3-storage.ts` — added `s3GetPresignedPutUrl()`; existing multipart/presign helpers untouched.
- `src/lib/local-1080.ts` — new pure/helper module: status contract, source-support check, canonical output key, callback URL, config reader, constant-time bearer check, error sanitising, callback body parser, job payload builder, fire-and-forget dispatch.
- `src/worker/video-processor.ts` — after the MPS HLS READY write (video already READY), fire-and-forget dispatch; only when config is complete, source short side >= 1080, and `preview1080Path` is empty.
- `src/app/api/internal/local-1080/callback/route.ts` — new authenticated callback (`runtime = 'nodejs'`).
- `src/app/api/projects/[id]/route.ts` — explicit `local1080Status` / `local1080Error` in the video payload.
- `src/lib/project-access.ts` — the share/review video select now includes both fields.
- `src/app/api/projects/[id]/reprocess/route.ts` — resets `local1080Status: 'NONE'` / error when previews (including the 1080 MP4) are deleted for a re-run.
- `.env.example` — documented `LOCAL_1080_ENABLED` / `LOCAL_1080_WORKER_URL` / `LOCAL_1080_WORKER_SECRET`.
- `package.json` — `check:local-1080` script.
- `scripts/check-local-1080.mts` — focused pure checks plus callback-route 503/401/400 rejections.
- `scripts/local-1080-worker.py` — versioned Python 3.12 stdlib worker (not deployed).

## Decisions

- **READY is never blocked.** The dispatch sits after the `status: 'READY'` update and is started with `void (async …)().catch(…)`. The row lookup for `preview1080Path` and the HTTP POST both happen off the critical path.
- **Failure is scoped to `local1080*`.** Dispatch failures set `local1080Status: 'ERROR'` + sanitised `local1080Error`; the video `status`, `mps*`, and HLS fields are never touched, and the error is not thrown into the MPS `catch` that would mark the video ERROR/fallback.
- **`PROCESSING`, not `PENDING`.** The main site marks the row PROCESSING before the POST; `PENDING` remains in the status contract for a future queue acknowledgement but is not written today.
- **One canonical key, recomputed on callback.** `local1080OutputKey()` wraps the existing `teamProjectStorageKey(teamId, projectId, 'videos', videoId, 'preview-1080.mp4')`. The callback recomputes it from `video.project.teamId` + `video.projectId` and rejects any other `outputKey`.
- **Signed values never logged.** Dispatch errors strip URL queries; callback errors pass through the same sanitiser and are truncated to 500 chars. The Python worker logs only job/video ids, byte counts, dimensions, durations and HTTP status codes.
- **Python queue.** `ThreadingHTTPServer` keeps `/healthcheck` responsive, while a single worker thread drains a FIFO queue, so transcode concurrency is exactly 1. The endpoint has no auth on `/healthcheck` (per spec) and requires the bearer secret on `/jobs`.
- **Local test mode.** `outputPath` is honoured only when `uploadUrl` is empty; production jobs always carry a presigned PUT URL, so they never write a local path.
- **Folders route.** On this base, `GET /api/projects/[id]/folders` returns folders only (no videos); the folder DELETE uses a full-row `include`, so the new scalar columns are already present. The review player's project payload comes from `/api/projects/[id]`, where the fields are now explicit; the share/review select in `src/lib/project-access.ts` was updated too. No fake selection was added to the folders route.

## Commands and results

| Command | Result |
| --- | --- |
| `npx prisma generate` | success (Prisma Client 6.19.3; `node_modules` is the shared symlink) |
| `DATABASE_URL='postgresql://placeholder:placeholder@localhost:5432/placeholder' npx prisma validate` | `The schema at prisma/schema.prisma is valid` |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0; 0 errors, 15 pre-existing warnings (img/useEffect in untouched files) |
| `npm run build` | exit 0, `BUILD_ID=wbJyHLYO35Za7jUfXv8CV` (then rebuilt after the final edit, exit 0) |
| `npm run check:local-1080` | `local-1080 checks passed` |
| `python3 -m py_compile scripts/local-1080-worker.py` | success (pycache removed) |

`check-local-1080` covers: config gating/normalisation, `/jobs` URL and callback URL construction, canonical key, all source-support cases (4K/1440p/portrait/720p/ultrawide/zero), bearer auth (wrong/short/missing/wrong scheme), error sanitising/truncation, callback body validation, and callback-route 503 (unconfigured), 401 (missing/wrong bearer), 400 (READY without key) without touching Prisma.

## Worker test evidence (local only)

Synthetic source: `ffmpeg -f lavfi testsrc2=1920x1080@30 + sine 440Hz`, 12 s, 23,475,260 bytes. Worker started with `LOCAL_1080_WORKER_SECRET=local-test-secret PORT=39102 BIND_HOST=127.0.0.1`; source served over `python3 -m http.server` (the worker intentionally has no `file://` path); callback captured by a local stdlib HTTP receiver. Job sent with an empty `uploadUrl` and `outputPath` (test mode).

- `GET /healthcheck` → `{"ok": true, "busy": false, "queued": 0}`
- `POST /jobs` without bearer → `401`; with bearer → `202 {"ok": true, "jobId": "e176d364…"}`
- Log: downloaded 23,475,260 bytes; `transcoding to 1920x1080`; encoded in 2.4 s; local test mode wrote MP4; `callback READY`
- `ffprobe` video: `h264`, `1920x1080`, `30/1`, `bit_rate=4127518`
- `ffprobe` audio: `aac`, `48000`, `bit_rate=124628`
- `ffprobe` format: duration 12.000000, size 6,392,991 bytes
- Faststart: `moov@36`, `mdat@14435` → moov before mdat
- Callback body: `{"videoId": "video-test-1", "status": "READY", "outputKey": "teams/t/projects/p/videos/video-test-1/preview-1080.mp4"}`
- Error path: unreachable source → `{"videoId": "video-test-2", "status": "ERROR", ..., "error": "network error: [Errno 61] Connection refused"}` and the worker stayed alive.
- Extra sanity: the exact x264 flag set (including `-level 4.1`) accepted a 1080p60 2 s source, exit 0.
- All test processes stopped; `/tmp/local1080-test` and `/tmp/local1080-60fps` removed.

## Concerns

1. **Shared Prisma client.** `npx prisma generate` writes through the `node_modules` symlink, so the shared checkout's generated client now knows the new columns while the shared database does not yet have them (the migration was deliberately not applied). A shared dev server that starts or hot-reloads a full-row `Video` read against that database will fail on the missing columns until the migration is deployed. This is expected under the task's "do not migrate the shared DB" constraint, but it is an operational trap for the shared worktree.
2. **In-memory queue / no retry.** A worker restart loses queued jobs, and a crash mid-job leaves the row `PROCESSING`; there is no timeout reaper or automatic retry. Recovery is a manual re-dispatch/reprocess. The spec asked for one attempt, so this is by design but needs operator awareness.
3. **No job generation token.** Callbacks are matched only by `videoId` + canonical `outputKey`. A stale callback from an old job arriving after a reprocess could overwrite the newer `local1080*` state (the same key is reused across runs). Fixing it properly needs a per-dispatch generation, which the current wire contract does not carry.
4. **Callback trusts the upload.** READY does not HEAD the object before flipping the row; the worker reports READY only after a 2xx PUT, so this is an accepted trust boundary, not a verification.
5. **Share payload shape.** `src/lib/project-access.ts` now includes `local1080Status`/`local1080Error` in the share/review select. Playback URLs and share links are unchanged, but the JSON payload gained two fields.
6. **`PENDING` is currently unused.** The status contract includes it for a possible future queued-acknowledgement state.
7. **Player menu intentionally not implemented** (separate task). The 1080 menu must key off `local1080Status`, not the presence of `preview1080Path`, because the path is only written on READY.
