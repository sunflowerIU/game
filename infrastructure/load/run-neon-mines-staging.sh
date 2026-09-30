#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
profile="$script_dir/k6-gameplay.js"

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Required command is missing: $1" >&2; exit 2; }
}

require_value() {
  [[ -n "${!1:-}" ]] || { echo "Required environment variable is missing: $1" >&2; exit 2; }
}

require_command curl
require_command k6
require_value ORIGIN
require_value PLAYER_USERNAME_PREFIX
require_value PLAYER_PASSWORD

if [[ "${ALLOW_PAID_LOAD_TEST:-}" != "I_UNDERSTAND_THIS_SPENDS_TEST_COINS" ]]; then
  echo "Set ALLOW_PAID_LOAD_TEST=I_UNDERSTAND_THIS_SPENDS_TEST_COINS after confirming the target and disposable balances." >&2
  exit 2
fi
if [[ ! "$ORIGIN" =~ ^https:// ]] && [[ "${ALLOW_INSECURE_ORIGIN:-}" != "yes" ]]; then
  echo "ORIGIN must use HTTPS. Set ALLOW_INSECURE_ORIGIN=yes only for an isolated local environment." >&2
  exit 2
fi
if [[ ! "$PLAYER_USERNAME_PREFIX" =~ ^[A-Za-z0-9_.-]+$ ]]; then
  echo "PLAYER_USERNAME_PREFIX contains unsupported characters." >&2
  exit 2
fi

read -r -a concurrency_steps <<< "${CONCURRENCY_STEPS:-10 25 50}"
read -r -a difficulties <<< "${MINES_DIFFICULTIES:-EASY MEDIUM HARD}"
for players in "${concurrency_steps[@]}"; do
  [[ "$players" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid concurrency step: $players" >&2; exit 2; }
done
for difficulty in "${difficulties[@]}"; do
  [[ "$difficulty" =~ ^(EASY|MEDIUM|HARD)$ ]] || { echo "Invalid Mines difficulty: $difficulty" >&2; exit 2; }
done

curl --fail --silent --show-error --max-time 10 "$ORIGIN/health/ready" >/dev/null

suite_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
suite_started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
results_root="${RESULTS_ROOT:-$script_dir/results}"
results_dir="$results_root/neon-mines-$suite_stamp"
mkdir -p "$results_dir"
{
  printf 'suite_started_at=%s\n' "$suite_started_at"
  printf 'origin=%s\n' "$ORIGIN"
  printf 'username_prefix=%s\n' "$PLAYER_USERNAME_PREFIX"
  printf 'concurrency_steps=%s\n' "${concurrency_steps[*]}"
  printf 'difficulties=%s\n' "${difficulties[*]}"
  printf 'hold_duration=%s\n' "${HOLD_DURATION:-2m}"
  printf 'think_time_seconds=%s\n' "${THINK_TIME_SECONDS:-1.45}"
} > "$results_dir/manifest.txt"

export GAME_SLUG=neon-mines
export WAGER_CENTS="${WAGER_CENTS:-10}"
export HOLD_DURATION="${HOLD_DURATION:-2m}"
export RAMP_DOWN_DURATION="${RAMP_DOWN_DURATION:-20s}"
export THINK_TIME_SECONDS="${THINK_TIME_SECONDS:-1.45}"

sampler_pid=""
stop_sampler() {
  if [[ -n "$sampler_pid" ]]; then
    kill "$sampler_pid" 2>/dev/null || true
    wait "$sampler_pid" 2>/dev/null || true
    sampler_pid=""
  fi
}
trap stop_sampler EXIT
trap 'stop_sampler; exit 130' INT TERM

run_number=0
for players in "${concurrency_steps[@]}"; do
  for difficulty in "${difficulties[@]}"; do
    run_number=$((run_number + 1))
    if (( run_number > 1 )); then
      sleep "${LOGIN_COOLDOWN_SECONDS:-60}"
    fi

    # The public login route allows 10 attempts per source IP per minute. Seven
    # seconds per arriving VU stays below that rate without weakening production.
    ramp_seconds=$((players * 7))
    export CONCURRENT_PLAYERS="$players"
    export MINES_DIFFICULTY="$difficulty"
    export RAMP_DURATION="${RAMP_DURATION_OVERRIDE:-${ramp_seconds}s}"
    run_name="${players}-${difficulty,,}"
    summary="$results_dir/$run_name-summary.json"
    log="$results_dir/$run_name.log"
    metrics="$results_dir/$run_name-metrics.prom"

    echo "Running Neon Mines: players=$players difficulty=$difficulty ramp=$RAMP_DURATION"
    if [[ -n "${METRICS_URL:-}" ]]; then
      (
        while true; do
          printf '# sample_epoch_seconds %s\n' "$(date -u +%s)"
          curl --fail --silent --show-error --max-time 5 "$METRICS_URL" || printf '# metrics_sample_failed\n'
          sleep "${METRICS_INTERVAL_SECONDS:-5}"
        done
      ) >> "$metrics" &
      sampler_pid=$!
    fi

    set +e
    k6 run --summary-export="$summary" "$profile" 2>&1 | tee "$log"
    run_status=${PIPESTATUS[0]}
    set -e
    stop_sampler
    if (( run_status != 0 )); then
      echo "Load gate failed for $run_name. Neon Mines must remain disabled." >&2
      exit "$run_status"
    fi
  done
done

printf 'suite_completed_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$results_dir/manifest.txt"
echo "All load gates passed. Results: $results_dir"
echo "Run neon-mines-settlement-audit.sql with username_prefix=$PLAYER_USERNAME_PREFIX and since=$suite_started_at before approving any capacity change."
