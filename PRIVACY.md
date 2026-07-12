# Privacy and Local Processing

Open AutoPose is designed to process selected video files in the user's browser on the local machine.

- The included application contains no analytics or advertising integration.
- `npm run dev`, `npm run serve`, and the default REST gateway bind to `127.0.0.1`.
- User-selected media is not uploaded by the browser application as part of the normal local workflow.
- `npm run setup` makes outbound downloads to the documented Google and Hugging Face model locations. Download details and hashes are written locally to `public/vendor/model-lock.json`.
- Browser webcam access only begins after the user grants the browser permission and activates webcam mode.
- The optional local gateway stores submitted jobs and artifacts on the local machine. A terminal job and its artifacts can be removed with `DELETE /v1/jobs/:id`. The operator remains responsible for retention and for securing any intentionally enabled remote access.

A distributor that modifies the software, adds analytics, hosts it remotely, or connects it to third-party services must update this statement to describe those changes accurately.
