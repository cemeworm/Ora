#!/bin/sh
set -eu

# Repo-wide TODO scan with common exclusions.
# Exclude task journals and this protocol's own docs to avoid gate noise.
find . \
  \( -path './.git' \
  -o -path './node_modules' \
  -o -path './dist' \
  -o -path './build' \
  -o -path './vendor' \
  -o -path './tasks' \
  -o -path './skills/long-task-protocol' \
  -o -path './.venv' \
  -o -path './venv' \
  -o -path './__pycache__' \
  -o -path '*/__pycache__' \
  -o -path './.pytest_cache' \) -prune \
  -o -type f \
  ! -name '*.min.*' \
  ! -name '*.map' \
  -exec grep -Hn 'TODO' {} + \
  || true
