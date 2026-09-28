#!/bin/bash
# Keeps the Next dev server alive across silent exits in the sandbox.
cd /home/z/my-project
while true; do
  bun run dev >> /tmp/tp-dev.log 2>&1
  echo "[$(date)] [supervisor] server exited (code $?), restarting in 2s" >> /tmp/tp-dev.log
  sleep 2
done
