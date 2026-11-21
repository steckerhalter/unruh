# recordings — watch sound recordings

Served by the Unruh dev server at http://localhost:3000/unruh/recordings/
(URL-encode spaces, e.g. "Zim 2602 piezo.ogg" → Zim%202602%20piezo.ogg).

Put sound recordings of the different watches here: one file per watch,
named after it, e.g. `ZIM.wav`, `Pobeda.wav`, `Eloga.ogg`.

Notes:

- Profiles are still only created by the user ("Name Watch" while the watch
  is on the bench) — nothing is created or imported automatically.
- The app now matches on the finer-grained sound profile: a 16-band fine
  profile (`fineBands`), plus the spectral centroid (`spectralCentroidHz`).
  Older profiles are migrated on load.
- To register a profile from the bench: put the watch under the mic and
  click "+ Name Watch" (Watch ID panel) — the app saves the live signature.
- The recordings can be used to verify how watches separate acoustically:
  compare the band spectra of the different files.
