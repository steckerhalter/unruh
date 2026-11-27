# Synthetic escapement recordings (detector regression fixtures)

These files are **not** part of the app's recording list (`public/recordings/`).
They are synthetic signals with known parameters, used to check the beat
detector when no watch is on the bench.

Regenerate with:

```sh
python3 test-fixtures/audio/generate.py
```

To test the app: copy one file into `public/recordings/`, reload the page,
then use **Simulate → Recording** and select it. Delete it from
`public/recordings/` afterwards if you do not want it in the list.

All files are 20 s, 48 kHz mono, 18,000 bph (200 ms half period) and encode a
**true beat error of 1.5 ms** (half periods 198.5 / 201.5 ms).

| File | What it simulates | Expected |
|---|---|---|
| `TEST 18000 clean lever (1.5ms).wav` | Normal lever: unlock + impulse + banking within 5 ms | BPH 18,000 · beat error 1.5 ms |
| `TEST 18000 pinlever midclick.wav` | Extra impact 100 ms after each beat (quieter than the banking) | BPH 18,000 · beat error 1.5 ms (extra impact ignored) |
| `TEST 18000 loud midclick 100.wav` | Extra impact 100 ms after each beat, **louder** than the banking | BPH 18,000 · beat error 1.5 ms (must not read 36,000) |
| `TEST 18000 loud midclick 90.wav` | Same, extra impact at 90 ms | BPH 18,000 · beat error 1.5 ms |
| `TEST 18000 bank offset.wav` | Banking impact is 10 ms later on one side only | BPH 18,000 · beat error 1.5 ms (sub-event offset must not become beat error) |

The last two are the important ones for pin-lever / overbanking cases: the
app must ignore the extra mid-beat impact and must time the beat on the first
(unlocking) pulse, not on the loud banking impact.

Verified results (manual recording playback, auto BPH):
18,000 bph and 1.5 ms for every fixture above.
