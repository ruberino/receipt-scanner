# Release checklist

Run this by hand against the deployed app after every release.

- [ ] Log in with the household password.
- [ ] Scan a receipt from a phone camera.
- [ ] Review the result and correct one line's product.
- [ ] Merge two products.
- [ ] Create a shopping list from suggestions.
- [ ] Check off items on the list.
- [ ] Complete the shopping list.
- [ ] Install the app on a phone home screen (Android "Installer app" or iOS "Legg til på Hjem-skjerm") and confirm it opens standalone.
- [ ] Retry a failed receipt (simulate with an invalid API key).
- [ ] Confirm `replication: 'on'` in `GET /api/health` after deploy.
