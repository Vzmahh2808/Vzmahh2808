#!/usr/bin/env bash
# Deploys dungeon-arena to devnet, or upgrades it when the build differs from what is on chain.
#
#   scripts/deploy-devnet.sh <dungeon_arena.so> <deployer keypair> [program keypair]
#
# The deployer pays for the deploy and becomes the upgrade authority. The program keypair is
# needed only for the first deploy and must match declare_id! in programs/dungeon-arena/src/lib.rs.
set -euo pipefail

so=$1
deployer=$2
program_keypair=${3:-}
url=https://api.devnet.solana.com
lib="$(dirname "$0")/../programs/dungeon-arena/src/lib.rs"
program_id=$(sed -n 's/^declare_id!("\([1-9A-HJ-NP-Za-km-z]*\)");$/\1/p' "$lib")
[ -n "$program_id" ] || { echo "::error::no declare_id! in $lib"; exit 1; }

sol() { solana --url "$url" --keypair "$deployer" "$@"; }
# Prints the explorer link, also to the job summary when running in GitHub Actions.
report() { echo "https://explorer.solana.com/address/$program_id?cluster=devnet" | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"; }

payer=$(solana-keygen pubkey "$deployer")
size=$(stat -c %s "$so")
echo "program $program_id, deployer $payer, build $size bytes"

if sol program show "$program_id" > /dev/null 2>&1; then
  mode=upgrade
  onchain=$(mktemp)
  sol program dump "$program_id" "$onchain" > /dev/null
  # The program data account can be longer than the build; the tail is zero padding.
  if cmp -s -n "$size" "$so" "$onchain" && [ -z "$(tail -c +$((size + 1)) "$onchain" | tr -d '\0' | head -c 1)" ]; then
    echo "The deployed program already matches this build."
    sol program show "$program_id"
    report
    exit 0
  fi
else
  mode=deploy
  if [ -z "$program_keypair" ]; then
    echo "::error::$program_id is not deployed yet; the first deploy needs the program keypair"
    exit 1
  fi
  if [ "$(solana-keygen pubkey "$program_keypair")" != "$program_id" ]; then
    echo "::error::the program keypair is for $(solana-keygen pubkey "$program_keypair"), declare_id! is $program_id"
    exit 1
  fi
fi

# Rent for a buffer or program data account of this size (6960 lamports per byte for two years)
# plus 0.05 SOL for transaction fees. The CLI checks the exact amount itself.
need=$(( (size + 45 + 128) * 6960 + 50000000 ))
balance() { sol balance --lamports | awk '{print $1}'; }
have=$(balance)
for _ in 1 2 3; do
  [ "$have" -ge "$need" ] && break
  sol airdrop 1 || true   # the public faucet is rate-limited, so this often fails on shared runners
  have=$(balance)
done
if [ "$have" -lt "$need" ]; then
  printf '::error::deployer %s has %d lamports, needs about %d. Top it up with devnet SOL at https://faucet.solana.com\n' \
    "$payer" "$have" "$need"
  exit 1
fi

# Reclaim rent from buffers left by an interrupted deploy.
sol program close --buffers || true

flags=(--upgrade-authority "$deployer" --use-rpc --max-sign-attempts 30 --with-compute-unit-price 10000)
if [ "$mode" = deploy ]; then
  sol program deploy "$so" --program-id "$program_keypair" "${flags[@]}"
else
  sol program deploy "$so" --program-id "$program_id" "${flags[@]}"
fi
sol program show "$program_id"
report
