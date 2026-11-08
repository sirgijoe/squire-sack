# Security policy

## Reporting a problem

If you find a security problem, **please don't open a public issue.** Report it privately instead:

**[Report a vulnerability](https://github.com/sirgijoe/squire-sack/security/advisories/new)** (GitHub's private form; only the maintainer can see it)

Include what you found, how to reproduce it, and what someone could do with it. You'll get a reply as soon as possible. Once there's a fix, it ships in a new release, and you'll be credited in it unless you'd rather not be.

## What's covered

the web app (`src/`), the desktop and mobile app (`src-tauri/`) and the home base sync server (`src-tauri/src/home_base.rs`, `tools/home-base.mjs`).

Squire keeps everything on your own devices. The only network traffic is between your phone and your own computer (the home base), on your home Wi-Fi.

## Supported versions

Only the latest release gets security fixes. Please update to it before reporting.
