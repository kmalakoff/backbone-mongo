# Contributing to BackboneMongo

This checkout maintains the legacy 0.6.10 line on `support/0.x`. It remains supported; it is not retired. The current TypeScript migration integrates into `master`.

Keep legacy fixes on this support line and port applicable fixes individually. Do not merge migration work into the support line. The complete maintenance policy is on master, available with `git show master:CONTRIBUTING.md`.

Support releases require the explicit npm tag `support-0`; `prepublishOnly` enforces it with `scripts/require-dist-tag.cjs`. Existing lifecycle commands remain unchanged. Publishing, tags and version changes are maintainer actions.
