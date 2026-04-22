#!/bin/sh
set -eu

# Prints the newest task journal path, if any.
ls -t tasks/TASK-*.md 2>/dev/null | head -n 1
