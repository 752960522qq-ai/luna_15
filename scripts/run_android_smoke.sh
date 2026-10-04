#!/usr/bin/env bash
# Keep diagnostics even when the emulator disconnects. Never let adb wait forever.
set -Eeuo pipefail
mkdir -p reports
ADB=(adb -s emulator-5554)
log_pid=''

finish() {
  local result=$?
  trap - EXIT
  set +e
  if [[ -n "$log_pid" ]]; then
    kill "$log_pid" 2>/dev/null
    wait "$log_pid" 2>/dev/null
  fi
  timeout -k 5s 15s "${ADB[@]}" shell dumpsys meminfo com.luna.heelmotion > reports/app-memory-after.txt 2>&1
  timeout -k 5s 15s "${ADB[@]}" shell dumpsys activity exit-info com.luna.heelmotion > reports/app-exit-info.txt 2>&1
  timeout -k 5s 15s "${ADB[@]}" exec-out run-as com.luna.heelmotion cat files/test-preview.png > reports/test-preview.png 2> reports/screenshot-error.txt
  free -m > reports/host-memory-after.txt
  timeout 10s sudo -n dmesg --ctime | tail -200 > reports/host-kernel-tail.txt 2>&1
  for crashdb in /tmp/android-runner/emu-crash-*.db; do
    if [[ -e "$crashdb" ]]; then
      timeout 30s tar -czf "reports/$(basename "$crashdb").tgz" -C /tmp/android-runner "$(basename "$crashdb")"
    fi
  done
  exit "$result"
}
trap finish EXIT

free -m > reports/host-memory-before.txt
timeout -k 5s 20s "${ADB[@]}" wait-for-device
# The AVD profile can ignore -skin for its physical display dimensions.
timeout -k 5s 20s "${ADB[@]}" shell wm size 540x960
timeout -k 5s 20s "${ADB[@]}" shell wm density 240
timeout -k 5s 20s "${ADB[@]}" shell wm size > reports/display.txt
timeout -k 5s 20s "${ADB[@]}" shell settings put secure immersive_mode_confirmations confirmed
timeout -k 10s 120s "${ADB[@]}" install download/artifacts/luna15-life-v1-test.apk
timeout -k 10s 120s "${ADB[@]}" install download/artifacts/instrumentation.apk
timeout -k 5s 20s "${ADB[@]}" shell svc wifi disable
timeout -k 5s 20s "${ADB[@]}" shell svc data disable
timeout -k 5s 20s "${ADB[@]}" logcat -c
# Start capture before launching the app so a lost VM cannot erase the failure.
"${ADB[@]}" logcat -v threadtime > reports/device-log.txt 2>&1 &
log_pid=$!
timeout -k 15s 9m "${ADB[@]}" shell am instrument -w -r com.luna.heelmotion.test/androidx.test.runner.AndroidJUnitRunner | tee reports/instrumentation.txt
grep -q 'OK (1 test)' reports/instrumentation.txt
