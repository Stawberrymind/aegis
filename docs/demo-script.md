# AEGIS live-only demonstration script

1. Run `npm run api`.
2. Open `http://localhost:8787`.
3. Enter `Is there a weather alert in India today?`, choose **Overall India**, and analyze. Point out the live NDMA SACHET fetch status, local AI retrieval status, and any structured CAP details supplied by the feed.
4. Enter `bro is there a flood alert?`, choose **Hyderabad / HYD**, and analyze. Show **What AEGIS understood**, the user-selected location, candidate match limitations, and the conservative `not_established` verdict when no Hyderabad evidence qualifies.
5. Explain that the app uses live official records only. If the feed is unavailable, the source-status panel reports that failure and AEGIS does not replace it with demo evidence.
6. Enter `Please check this message from a group chat.` and show that AEGIS names the missing incident type, location, and time, then offers buttons to focus the right input instead of inventing a verdict.

Expected message: AEGIS uses local multilingual AI to find meaning across paraphrases and rank evidence, while transparent evidence rules—not an AI score—produce the final evidence-linked verdict.
