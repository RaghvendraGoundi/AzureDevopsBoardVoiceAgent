# Voice tests

End-to-end tests of the voice agent with synthetic speech: the real app, the
real voice service (Realtime or GPT-Live) and whichever board `.env.local`
points at. They answer questions unit tests can't: does it hear me, does it
call the right tool, how long until it answers, does it wait for a yes.

## Run one

```bash
npm run voice:audio -- --all            # once, and after editing a scenario (macOS)
npm run dev                             # if it isn't running
```

Open http://localhost:3000/voice, open DevTools (Console) and run:

```js
const { run } = await import("/__voice_test/harness.js");
await run("board-tour");                     // the model selected on screen
await run("board-tour", { engine: "live" }); // or "realtime"
await run("turn-taking", { verbose: true }); // also logs every event as it happens
```

Leave the page alone while it runs (a click can switch the model or end the
call). It prints a table per step — what you said, what the transcriber
heard, which tools ran and how long they took on the server, how long until
the reply started, and what the assistant said — and leaves the full report
in `window.__voiceTestReport`. The server log has the matching `[tool]` and
`[ado]` timings.

Scenarios that write (create, update, confirm) change the board for real.
On the emulator, `npm run board:reset` undoes them.

| Scenario | Checks |
|---|---|
| `board-tour` | My sprint work, a state filter, an item's hierarchy, creating a task under a story, moving it to the next sprint |
| `turn-taking` | A mid-sentence pause stays one turn, a cough gets no reply, talking over the assistant stops it, "I am done" hangs up |
| `confirm-and-cancel` | "No" writes nothing; a clear "yes" writes once |

## How the tests are made

1. **Write a scenario** in `scenarios/<name>.txt`, one utterance per line,
   the way a person would say it to this board (use real item names from it):

   ```text
   # comment
   @voice Samantha            macOS voice (`say -v '?'` lists them)
   What am I working on?
   Show me the bugs | in the current sprint.   "|" = a 1.3 s pause mid-sentence
   !Stop, only the ones on hold.                "!" = said over the assistant's reply
   [cough]                                      generated noise burst
   [silence 2000]                               silence (ms)
   ```

   Keep each reply unambiguous for the board you test against. The agent
   rightly asks "which one?" when two items match, and a scripted "yes"
   can't answer that.

2. **Generate the audio** (`make-audio.mjs`): each line goes through macOS
   text-to-speech (`say`), is converted to 24 kHz mono 16-bit PCM
   (`afconvert`, the format the Realtime API works in), and `|` pauses,
   coughs and silences are stitched in. Clips and a `manifest.json` land in
   `public/__voice_test/<name>/` (git-ignored) so the dev server can serve
   them, together with a copy of `harness.js`.

3. **Play them into the app** (`harness.js`, in the page):
   - `navigator.mediaDevices.getUserMedia` is swapped for a Web Audio
     `MediaStreamDestination`; clips are played into it, so the app's own
     WebRTC code sends them exactly as it would a microphone.
   - A faint noise floor plays underneath. Without it the browser stops
     sending packets during silence and the server never detects the end of
     a sentence.
   - `fetch` and `RTCPeerConnection.prototype.createDataChannel` are wrapped
     to observe, not change: tool calls with latency, and the voice
     service's events (speech detected, transcript, reply audio started, reply
     cut off) for both Realtime and GPT-Live.
   - After each clip it waits until the status has been "Listening…" for
     2.5 s (or 8 s with no reply, for noise). For a `!` step it waits until
     the assistant is speaking and then plays over it.
   - Everything is restored at the end, and the call is ended.

## Limits

- Synthetic coughs rarely trip OpenAI's voice detector, so `[cough]` checks
  that noise never causes a reply, not how a detected cough is filtered.
  Test real coughs with a real microphone.
- `say` voices are clean and evenly paced; accents, mumbling and room noise
  need real recordings. Any 24 kHz mono WAV can replace a generated clip.
- Reply times include the voice model's own thinking and the network; the
  `[tool]` / `[ado]` server logs separate out the board's share.
