# `assetlinks.json` — the file that removes the URL bar

The Android app is a **Trusted Web Activity**: a thin native shell that opens
`https://thebourboncup.com` in a Chrome tab with no browser chrome around it.
Chrome only drops that chrome if the site and the app each vouch for the other:

- the **app** names the site (`asset_statements` in the TWA's Android manifest,
  written by Bubblewrap from `twa-manifest.json` at the repo root), and
- the **site** names the app — this file.

If the two do not agree, the app still runs and still works. It just opens with
a **URL bar across the top**, which is what a Play reviewer sees and rejects,
and it is also the thing nobody notices in testing because a debug build is
verified locally by `adb` rather than by this file.

## The fingerprint

`sha256_cert_fingerprints` must list the SHA-256 of the certificate the APK is
**signed with as installed on the device** — which, with Play App Signing on
(it is, for any new app), is Google's key, not the upload key on your machine.
So the value cannot be known until the first bundle has been uploaded:

1. Upload the AAB to any track in the Play Console.
2. **Release → Setup → App integrity → App signing key certificate**.
3. Copy the SHA-256 fingerprint — the colon-separated uppercase hex form.
4. Paste it in place of the placeholder here, commit, and let Vercel deploy.

Keep the **upload key**'s fingerprint in the list too if you ever sideload a
locally-signed build for testing; the array takes as many as you like, and an
extra one costs nothing. `bubblewrap fingerprint list` prints the ones it knows.

## Checking it

The file has to be served from the apex domain, over https, as
`application/json`, with no redirect:

```
curl -sS -D- https://thebourboncup.com/.well-known/assetlinks.json
```

Google's own verifier, which is the one that actually decides:

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://thebourboncup.com&relation=delegate_permission/common.handle_all_urls
```

A `maxAge` with no errors means verified. Changes can take a few minutes to
propagate to a device — clearing Chrome's storage or reinstalling the app is
the fastest way to force a re-check.

## Why the directory is in `public/`

Vite copies `public/` verbatim into `dist/`, dotted directories included, and
Vercel serves `dist/` as static files. So this path needs no rewrite in
`vercel.json` and no route in the app — it is a real file at a real URL, which
is the only thing Google's fetcher will accept.
