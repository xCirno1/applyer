# Applyer local job-site fixtures

This dependency-free local site provides stable pages for exercising browser automation and desktop notifications without relying on a real employer or CAPTCHA vendor.

Run it from the repository root:

```bash
npm run test:site
```

Open <http://127.0.0.1:8765> to see every scenario and its expected outcome. Override the address when necessary:

```bash
APPLYER_TEST_SITE_HOST=127.0.0.1 APPLYER_TEST_SITE_PORT=9000 npm run test:site
```

## End-to-end flow

1. Start Applyer with `npm run dev` in one terminal and this site with `npm run test:site` in another.
2. Use `queue_job` with a fixture URL such as `http://127.0.0.1:8765/captcha.html`.
3. Pass the returned job ID to `fill_application`.
4. For the resolvable challenge, click **Resolve test challenge** in the browser window. Applyer polls for resolution and should continue within about two seconds.
5. Use a new URL or add a unique query string for each queued test job because `queue_job` deduplicates by URL.

## Button navigation flow

Use <http://127.0.0.1:8765/buttons.html> to exercise agent-controlled buttons:

1. Inspect step 1, fill the contact fields with `finalStep: false`, and confirm the job remains Queued. Only **Next** should be exposed; **Show test note** is an arbitrary action.
2. Press **Next** with button permission, inspect step 2, fill the application questions with `finalStep: false`, then press **Continue**. **Save draft** must not be exposed.
3. Inspect step 3 and upload the stored resume. Use `finalStep: true` only after every requested answer succeeds. **Previous** should be exposed, while scripted **Finish** and native **Submit application** must not appear.

The scripted **Finish** handler attempts a POST to demonstrate why button labels are not proof of safety. The fixture server rejects the POST, and Applyer must not expose that control to the agent.

The fixture server binds to loopback by default and sets `Cache-Control: no-store`, so edits are visible after a refresh and the site is not exposed to the local network.
