//! Reference encodings for the TypeScript client (roguelike/src/chain/arena-program.ts).
//! `cargo test` checks that roguelike/tests/fixtures/arena-program.json still matches the
//! program; run with UPDATE_FIXTURES=1 to rewrite it after changing instructions or accounts.

use crate::*;
use anchor_lang::{AccountSerialize, InstructionData};
use serde_json::{json, Value};
use std::path::PathBuf;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn key(n: u8) -> Pubkey {
    Pubkey::new_from_array([n; 32])
}

fn args() -> CreateTournamentArgs {
    CreateTournamentArgs {
        id: "2026-10-01".into(),
        rules_version: 1,
        seed_slot: 123_456_789,
        secret_commitment: [0xab; 32],
        entry_fee: 1_000_000,
        attempts_per_entry: 3,
        end_ts: 1_790_000_000,
        reveal_deadline_ts: 1_790_090_000,
        rake_bps: 500,
        payout_bps: [6000, 3000, 1000, 0, 0],
    }
}

fn instructions() -> Value {
    let a = args();
    json!({
        "createTournament": {
            "args": {
                "id": a.id, "rulesVersion": a.rules_version, "seedSlot": a.seed_slot,
                "secretCommitment": hex(&a.secret_commitment), "entryFee": a.entry_fee,
                "attemptsPerEntry": a.attempts_per_entry, "endTs": a.end_ts,
                "revealDeadlineTs": a.reveal_deadline_ts, "rakeBps": a.rake_bps, "payoutBps": a.payout_bps,
            },
            "data": hex(&instruction::CreateTournament { args: args() }.data()),
        },
        "fund": { "amount": 5_000_000u64, "data": hex(&instruction::Fund { amount: 5_000_000 }.data()) },
        "enter": { "data": hex(&instruction::Enter {}.data()) },
        "recordSlotHash": { "data": hex(&instruction::RecordSlotHash {}.data()) },
        "submitResult": {
            "score": 1234u64, "replayHash": hex(&[0x5a; 32]),
            "data": hex(&instruction::SubmitResult { score: 1234, replay_hash: [0x5a; 32] }.data()),
        },
        "reveal": { "secret": hex(&[7; 32]), "data": hex(&instruction::Reveal { secret: [7; 32] }.data()) },
        "finalize": { "data": hex(&instruction::Finalize {}.data()) },
        "claim": { "data": hex(&instruction::Claim {}.data()) },
        "cancel": { "data": hex(&instruction::Cancel {}.data()) },
        "refund": { "data": hex(&instruction::Refund {}.data()) },
        "withdraw": { "data": hex(&instruction::Withdraw {}.data()) },
    })
}

fn tournament() -> Tournament {
    let a = args();
    let mut leaderboard = [Place::default(); MAX_PLACES];
    leaderboard[0] = Place { player: key(21), score: 900, slot: 123_456_900 };
    leaderboard[1] = Place { player: key(22), score: 450, slot: 123_456_950 };
    Tournament {
        authority: key(1),
        mint: key(2),
        vault: key(3),
        id: a.id,
        rules_version: a.rules_version,
        seed_slot: a.seed_slot,
        secret_commitment: a.secret_commitment,
        slot_hash_recorded: true,
        recorded_slot: 123_456_791,
        slot_hash: [0x33; 32],
        revealed: true,
        secret: [7; 32],
        entry_fee: a.entry_fee,
        attempts_per_entry: a.attempts_per_entry,
        end_ts: a.end_ts,
        reveal_deadline_ts: a.reveal_deadline_ts,
        rake_bps: a.rake_bps,
        payout_bps: a.payout_bps,
        status: Status::Finalized,
        entries: 7,
        unrefunded_entries: 7,
        prize_pool: 12_350_000,
        places_filled: 2,
        leaderboard,
        bump: 254,
    }
}

fn entry() -> Entry {
    Entry {
        tournament: key(9),
        player: key(21),
        attempts_used: 2,
        has_score: true,
        best_score: 900,
        best_replay_hash: [0x5a; 32],
        claimed: true,
        refunded: false,
        bump: 253,
    }
}

fn accounts() -> Value {
    let mut t = Vec::new();
    tournament().try_serialize(&mut t).unwrap();
    let mut e = Vec::new();
    entry().try_serialize(&mut e).unwrap();
    json!({
        "tournament": {
            "data": hex(&t),
            "space": 8 + Tournament::INIT_SPACE,
            "leaderboard": [[key(21).to_string(), 900, 123_456_900u64], [key(22).to_string(), 450, 123_456_950u64]],
        },
        "entry": { "data": hex(&e), "space": 8 + Entry::INIT_SPACE },
    })
}

fn pdas() -> Value {
    let authority = key(1);
    let player = key(21);
    let (t, t_bump) = Pubkey::find_program_address(&[TOURNAMENT_SEED, authority.as_ref(), b"2026-10-01"], &ID);
    let (v, _) = Pubkey::find_program_address(&[VAULT_SEED, t.as_ref()], &ID);
    let (e, _) = Pubkey::find_program_address(&[ENTRY_SEED, t.as_ref(), player.as_ref()], &ID);
    json!({
        "authority": authority.to_string(), "id": "2026-10-01", "player": player.to_string(),
        "tournament": t.to_string(), "tournamentBump": t_bump, "vault": v.to_string(), "entry": e.to_string(),
    })
}

#[test]
fn typescript_fixtures_match_the_program() {
    let fixture = json!({
        "programId": ID.to_string(),
        "errorCodeOffset": 6000,
        "instructions": instructions(),
        "accounts": accounts(),
        "pdas": pdas(),
    });
    let text = serde_json::to_string_pretty(&fixture).unwrap() + "\n";
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../tests/fixtures/arena-program.json");
    if std::env::var("UPDATE_FIXTURES").is_ok() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, text).unwrap();
        return;
    }
    let current = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(current == text, "{} is out of date: run UPDATE_FIXTURES=1 cargo test -p dungeon-arena", path.display());
}
