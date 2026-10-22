#!/bin/bash
# Supervisor event listener — logs process state changes to /data/logs/
# Protocol: http://supervisord.org/events.html
while true; do
  echo "READY"
  read -r header
  # Extract payload length from header
  len=$(echo "$header" | tr ' ' '\n' | grep '^len:' | cut -d: -f2)
  if [ -n "$len" ] && [ "$len" -gt 0 ]; then
    read -r -n "$len" payload
  else
    payload=""
  fi
  # Log the event
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "$ts $header $payload" >> /data/logs/supervisor-events.log
  echo "RESULT 2"
  printf "OK"
done
