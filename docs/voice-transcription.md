# Local voice transcription

AEGIS accepts PCM WAV voice notes through the browser. `services/api/src/voice.mjs` decodes 16-bit mono or stereo PCM WAV into a local waveform and uses the Transformers.js `automatic-speech-recognition` pipeline with `Xenova/whisper-tiny` by default. Model files are cached under `data/transcription-cache/` and no paid API key is required.

The adapter returns `completed`, `no_speech_found`, or `unavailable`. It accepts PCM WAV, converts mono samples to the Whisper model’s 16 kHz input rate, and reports both normalized and original sample rates. Unsupported formats such as compressed WebM or MP3 are rejected explicitly instead of being silently misread. Transcription is an interpretation aid: names, locations, dates, and numbers must be checked against the original recording.
