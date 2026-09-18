#!/bin/sh
# The five checks that define "done" (AGENTS.md), run inside the image rather than on a host
# toolchain (T46). With arguments, runs vitest on those paths alone instead — the mutation check
# both sessions run on every task goes through here too, so it cannot drift onto a different
# toolchain than the full run.
#
# Every check runs even after one fails: a run that stops at `lint` hides whether the tests pass,
# and the point of this script is that one invocation tells you the whole state of the branch.
set -u

if [ "$#" -gt 0 ]; then
  echo "=== npx vitest run $* ==="
  exec npx vitest run "$@"
fi

CHECKS="lint typecheck test build format:check"
summary=""
status=0

for check in $CHECKS; do
  echo ""
  echo "=== npm run $check ==="
  if npm run "$check"; then
    summary="$summary\n  $check: ok"
  else
    code=$?
    summary="$summary\n  $check: FAILED (exit $code)"
    status=1
  fi
done

echo ""
echo "=== checks ==="
# shellcheck disable=SC2059
printf "$summary\n"
echo ""

if [ "$status" -eq 0 ]; then
  echo "All five checks passed."
else
  echo "At least one check failed; see the block above for which."
fi

exit "$status"
