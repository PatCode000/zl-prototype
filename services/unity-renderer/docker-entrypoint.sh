#!/bin/sh
set -eu

if [ ! -x "$UNITY_EXECUTABLE" ]; then
  echo "Unity executable not found or not executable: $UNITY_EXECUTABLE" >&2
  ls -la /opt/unity-renderer/builds >&2 || true
  exit 1
fi

if [ "$#" -eq 0 ] && [ -n "${UNITY_ARGS:-}" ]; then
  set -- $UNITY_ARGS
elif [ -n "${UNITY_EXTRA_ARGS:-}" ]; then
  set -- "$@" $UNITY_EXTRA_ARGS
fi

if [ "${UNITY_USE_XVFB:-1}" = "1" ]; then
  exec xvfb-run --auto-servernum --server-args="-screen 0 ${XVFB_SCREEN:-1280x720x24}" "$UNITY_EXECUTABLE" "$@"
fi

exec "$UNITY_EXECUTABLE" "$@"

