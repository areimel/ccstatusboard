# Review
Measured on brag.mp4: 1080x1080, 30fps, 72.0s, H.264/yuv420p/AAC; -14.9 LUFS, -1.9 dBFS true peak, no flat-topped samples, DC 0.00014. Stem measurements: mono loss 0.6 LU, phone simulation 5.8 LU down, cue onsets within 4ms.
Looked at: contact sheet of the render, stills of each scene and cue, a 360px phone sheet. An independent review of the 68s pass drove the changes to 72s; that review was not repeated on the 72s render.
Not heard: nobody has listened to the score. Lead pitch check fails: raw FFT peak worst -21.6c, harmonic-sum estimate worst 11.0c, sub 0.0c. Likely an estimator artefact of detuned saws, not confirmed.
Weakest shots: full-board frames in scenes 2 and 5 are unreadable at phone size, so captions carry them. 58.8-61.75 is one stat on empty orange, kept so each stat gets its reading time.
Warnings kept: `hyperframes check` exits 1 on text_occluded (TUI frames under #band and the wipe covers, intentional; the 24s cut had the same class). Also line_unread, contrast, text_below_floor on TUI frames, and file-size/track-density lint on generated frames.
