//! Runs the compiled program in LiteSVM. Build it first:
//!   cargo build-sbf --manifest-path programs/dungeon-arena/Cargo.toml
//! The program is taken from $SBF_OUT_DIR or target/deploy.

use anchor_lang::{prelude::Pubkey, AccountDeserialize, InstructionData};
use dungeon_arena::{ArenaError, CreateTournamentArgs, Entry, Status, Tournament, SUBMIT_GRACE_SECS};
use litesvm::{types::TransactionResult, LiteSVM};
use litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo};
use sha2::{Digest, Sha256};
use solana_address::Address;
use solana_clock::Clock;
use solana_hash::Hash;
use solana_instruction::{AccountMeta, Instruction};
use solana_instruction_error::InstructionError;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_slot_hashes::SlotHashes;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;
use std::path::PathBuf;

const USDC: u64 = 1_000_000;
const START_TS: i64 = 1_790_000_000;
const TOKEN_PROGRAM: Address = Address::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SYSTEM_PROGRAM: Address = Address::from_str_const("11111111111111111111111111111111");
const SLOT_HASHES: Address = Address::from_str_const("SysvarS1otHashes111111111111111111111111111");

fn addr(key: &Pubkey) -> Address {
    Address::new_from_array(key.to_bytes())
}

fn key(address: &Address) -> Pubkey {
    Pubkey::new_from_array(address.to_bytes())
}

fn program_id() -> Address {
    addr(&dungeon_arena::ID)
}

struct Player {
    kp: Keypair,
    token: Address,
    entry: Address,
}

struct Arena {
    svm: LiteSVM,
    authority: Keypair,
    authority_token: Address,
    mint: Address,
    tournament: Address,
    vault: Address,
    secret: [u8; 32],
}

impl Arena {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let so = std::env::var("SBF_OUT_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target/deploy"))
            .join("dungeon_arena.so");
        svm.add_program_from_file(program_id(), &so)
            .unwrap_or_else(|e| panic!("cannot load {}: {e}. Build it with cargo build-sbf first.", so.display()));

        let authority = Keypair::new();
        svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();
        let mint = CreateMint::new(&mut svm, &authority).decimals(6).send().unwrap();
        let authority_token = CreateAssociatedTokenAccount::new(&mut svm, &authority, &mint).send().unwrap();

        let mut arena = Arena {
            svm,
            authority,
            authority_token,
            mint,
            tournament: Address::default(),
            vault: Address::default(),
            secret: [7; 32],
        };
        arena.set_time(100, START_TS);
        arena
    }

    fn set_time(&mut self, slot: u64, unix_timestamp: i64) {
        self.svm.set_sysvar(&Clock { slot, unix_timestamp, ..Clock::default() });
    }

    /// Replaces the SlotHashes sysvar; entries are (slot, byte used for the whole hash).
    fn set_slot_hashes(&mut self, entries: &[(u64, u8)]) {
        let list: Vec<(u64, Hash)> = entries.iter().map(|&(s, b)| (s, Hash::new_from_array([b; 32]))).collect();
        self.svm.set_sysvar(&SlotHashes::new(&list));
    }

    fn send(&mut self, ix: Instruction, signers: &[&Keypair]) -> TransactionResult {
        self.svm.expire_blockhash();
        let payer = signers[0].pubkey();
        let tx = Transaction::new(signers, Message::new(&[ix], Some(&payer)), self.svm.latest_blockhash());
        self.svm.send_transaction(tx)
    }

    fn ix(&self, data: Vec<u8>, accounts: Vec<AccountMeta>) -> Instruction {
        Instruction { program_id: program_id(), accounts, data }
    }

    fn args(&self, id: &str, seed_slot: u64) -> CreateTournamentArgs {
        CreateTournamentArgs {
            id: id.to_string(),
            rules_version: 1,
            seed_slot,
            secret_commitment: Sha256::digest(self.secret).into(),
            entry_fee: USDC,
            attempts_per_entry: 2,
            end_ts: START_TS + 3_600,
            reveal_deadline_ts: START_TS + 3_600 + SUBMIT_GRACE_SECS + 3_600,
            rake_bps: 500,
            payout_bps: [6000, 3000, 1000, 0, 0],
        }
    }

    fn create(&mut self, args: CreateTournamentArgs) -> TransactionResult {
        let (tournament, _) = Pubkey::find_program_address(
            &[b"tournament", &self.authority.pubkey().to_bytes(), args.id.as_bytes()],
            &dungeon_arena::ID,
        );
        let (vault, _) = Pubkey::find_program_address(&[b"vault", tournament.as_ref()], &dungeon_arena::ID);
        self.tournament = addr(&tournament);
        self.vault = addr(&vault);
        let ix = self.ix(
            dungeon_arena::instruction::CreateTournament { args }.data(),
            vec![
                AccountMeta::new(self.authority.pubkey(), true),
                AccountMeta::new(self.tournament, false),
                AccountMeta::new_readonly(self.mint, false),
                AccountMeta::new(self.vault, false),
                AccountMeta::new_readonly(TOKEN_PROGRAM, false),
                AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
            ],
        );
        let authority = self.authority.insecure_clone();
        self.send(ix, &[&authority])
    }

    fn player(&mut self, usdc: u64) -> Player {
        let kp = Keypair::new();
        self.svm.airdrop(&kp.pubkey(), 1_000_000_000).unwrap();
        let token = CreateAssociatedTokenAccount::new(&mut self.svm, &kp, &self.mint).owner(&kp.pubkey()).send().unwrap();
        MintTo::new(&mut self.svm, &self.authority, &self.mint, &token, usdc).send().unwrap();
        let (entry, _) = Pubkey::find_program_address(
            &[b"entry", key(&self.tournament).as_ref(), &kp.pubkey().to_bytes()],
            &dungeon_arena::ID,
        );
        Player { kp, token, entry: addr(&entry) }
    }

    fn fund(&mut self, funder: &Player, amount: u64) -> TransactionResult {
        let ix = self.ix(
            dungeon_arena::instruction::Fund { amount }.data(),
            vec![
                AccountMeta::new_readonly(funder.kp.pubkey(), true),
                AccountMeta::new_readonly(self.tournament, false),
                AccountMeta::new_readonly(self.mint, false),
                AccountMeta::new(self.vault, false),
                AccountMeta::new(funder.token, false),
                AccountMeta::new_readonly(TOKEN_PROGRAM, false),
            ],
        );
        self.send(ix, &[&funder.kp])
    }

    fn enter(&mut self, p: &Player) -> TransactionResult {
        let ix = self.ix(
            dungeon_arena::instruction::Enter {}.data(),
            vec![
                AccountMeta::new(p.kp.pubkey(), true),
                AccountMeta::new(self.tournament, false),
                AccountMeta::new(p.entry, false),
                AccountMeta::new_readonly(self.mint, false),
                AccountMeta::new(self.vault, false),
                AccountMeta::new(p.token, false),
                AccountMeta::new_readonly(TOKEN_PROGRAM, false),
                AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
            ],
        );
        self.send(ix, &[&p.kp])
    }

    fn record_slot_hash(&mut self, caller: &Keypair) -> TransactionResult {
        let ix = self.ix(
            dungeon_arena::instruction::RecordSlotHash {}.data(),
            vec![AccountMeta::new(self.tournament, false), AccountMeta::new_readonly(SLOT_HASHES, false)],
        );
        self.send(ix, &[caller])
    }

    fn submit(&mut self, signer: &Keypair, p: &Player, score: u64) -> TransactionResult {
        let ix = self.ix(
            dungeon_arena::instruction::SubmitResult { score, replay_hash: [score as u8; 32] }.data(),
            vec![
                AccountMeta::new_readonly(signer.pubkey(), true),
                AccountMeta::new(self.tournament, false),
                AccountMeta::new(p.entry, false),
            ],
        );
        self.send(ix, &[signer])
    }

    fn reveal(&mut self, secret: [u8; 32]) -> TransactionResult {
        let ix = self.ix(
            dungeon_arena::instruction::Reveal { secret }.data(),
            vec![AccountMeta::new_readonly(self.authority.pubkey(), true), AccountMeta::new(self.tournament, false)],
        );
        let authority = self.authority.insecure_clone();
        self.send(ix, &[&authority])
    }

    fn finalize(&mut self, caller: &Keypair) -> TransactionResult {
        let ix = self.ix(
            dungeon_arena::instruction::Finalize {}.data(),
            vec![
                AccountMeta::new(self.tournament, false),
                AccountMeta::new_readonly(self.mint, false),
                AccountMeta::new(self.vault, false),
                AccountMeta::new(self.authority_token, false),
                AccountMeta::new_readonly(TOKEN_PROGRAM, false),
            ],
        );
        self.send(ix, &[caller])
    }

    fn payout(&mut self, data: Vec<u8>, p: &Player) -> TransactionResult {
        let ix = self.ix(
            data,
            vec![
                AccountMeta::new_readonly(p.kp.pubkey(), true),
                AccountMeta::new(self.tournament, false),
                AccountMeta::new(p.entry, false),
                AccountMeta::new_readonly(self.mint, false),
                AccountMeta::new(self.vault, false),
                AccountMeta::new(p.token, false),
                AccountMeta::new_readonly(TOKEN_PROGRAM, false),
            ],
        );
        self.send(ix, &[&p.kp])
    }

    fn claim(&mut self, p: &Player) -> TransactionResult {
        self.payout(dungeon_arena::instruction::Claim {}.data(), p)
    }

    fn refund(&mut self, p: &Player) -> TransactionResult {
        self.payout(dungeon_arena::instruction::Refund {}.data(), p)
    }

    fn cancel(&mut self, caller: &Keypair) -> TransactionResult {
        let ix = self.ix(
            dungeon_arena::instruction::Cancel {}.data(),
            vec![AccountMeta::new_readonly(caller.pubkey(), true), AccountMeta::new(self.tournament, false)],
        );
        self.send(ix, &[caller])
    }

    fn withdraw(&mut self) -> TransactionResult {
        let ix = self.ix(
            dungeon_arena::instruction::Withdraw {}.data(),
            vec![
                AccountMeta::new_readonly(self.authority.pubkey(), true),
                AccountMeta::new_readonly(self.tournament, false),
                AccountMeta::new_readonly(self.mint, false),
                AccountMeta::new(self.vault, false),
                AccountMeta::new(self.authority_token, false),
                AccountMeta::new_readonly(TOKEN_PROGRAM, false),
            ],
        );
        let authority = self.authority.insecure_clone();
        self.send(ix, &[&authority])
    }

    fn tournament(&self) -> Tournament {
        let data = self.svm.get_account(&self.tournament).unwrap().data;
        Tournament::try_deserialize(&mut data.as_slice()).unwrap()
    }

    fn entry(&self, p: &Player) -> Entry {
        let data = self.svm.get_account(&p.entry).unwrap().data;
        Entry::try_deserialize(&mut data.as_slice()).unwrap()
    }

    /// SPL token account layout: mint (32), owner (32), amount (u64 LE).
    fn balance(&self, token: &Address) -> u64 {
        let data = self.svm.get_account(token).unwrap().data;
        u64::from_le_bytes(data[64..72].try_into().unwrap())
    }
}

fn assert_arena_error(result: TransactionResult, expected: ArenaError) {
    let code = 6000 + expected as u32;
    match result {
        Err(failed) => assert_eq!(
            failed.err,
            TransactionError::InstructionError(0, InstructionError::Custom(code)),
            "logs: {:#?}",
            failed.meta.logs
        ),
        Ok(_) => panic!("expected error {code}, but the transaction succeeded"),
    }
}

fn ok(result: TransactionResult) {
    if let Err(failed) = result {
        panic!("transaction failed: {:?}\nlogs: {:#?}", failed.err, failed.meta.logs);
    }
}

#[test]
fn a_full_tournament_pays_the_top_three() {
    let mut a = Arena::new();
    ok(a.create(a.args("2026-10-01", 150)));
    let sponsor = a.player(10 * USDC);
    ok(a.fund(&sponsor, 10 * USDC));
    let players: Vec<Player> = (0..3).map(|_| a.player(5 * USDC)).collect();
    for p in &players {
        ok(a.enter(p));
    }
    assert_eq!(a.balance(&a.vault), 13 * USDC);
    assert_eq!(a.balance(&players[0].token), 4 * USDC);
    assert_eq!(a.tournament().entries, 3);

    // No results before the dungeon seed is fixed.
    let authority = a.authority.insecure_clone();
    assert_arena_error(a.submit(&authority, &players[0], 10), ArenaError::SlotHashNotRecorded);

    // Before the seed slot the sysvar has nothing at or after it.
    a.set_time(140, START_TS + 60);
    a.set_slot_hashes(&[(139, 9), (138, 8)]);
    assert_arena_error(a.record_slot_hash(&sponsor.kp), ArenaError::SeedSlotNotReached);

    // Slots 150 and 151 were skipped: the first block after the seed slot is 152.
    a.set_time(160, START_TS + 120);
    a.set_slot_hashes(&[(159, 5), (155, 4), (152, 3), (149, 2)]);
    ok(a.record_slot_hash(&sponsor.kp));
    let t = a.tournament();
    assert!(t.slot_hash_recorded);
    assert_eq!(t.recorded_slot, 152);
    assert_eq!(t.slot_hash, [3; 32]);
    assert_arena_error(a.record_slot_hash(&sponsor.kp), ArenaError::SlotHashAlreadyRecorded);

    // The arena server posts verified scores; nobody else can.
    ok(a.submit(&authority, &players[0], 300));
    ok(a.submit(&authority, &players[1], 500));
    ok(a.submit(&authority, &players[2], 100));
    ok(a.submit(&authority, &players[0], 600));
    assert_arena_error(a.submit(&authority, &players[0], 900), ArenaError::NoAttemptsLeft);
    assert!(a.submit(&sponsor.kp, &players[1], 10_000).is_err());
    let e = a.entry(&players[0]);
    assert_eq!((e.best_score, e.attempts_used, e.best_replay_hash), (600, 2, [600u64 as u8; 32]));
    let t = a.tournament();
    let board: Vec<(Pubkey, u64)> = t.leaderboard[..t.places_filled as usize].iter().map(|p| (p.player, p.score)).collect();
    assert_eq!(
        board,
        vec![
            (key(&players[0].kp.pubkey()), 600),
            (key(&players[1].kp.pubkey()), 500),
            (key(&players[2].kp.pubkey()), 100),
        ]
    );

    // The secret opens only after submissions close, and only if it matches the commitment.
    assert_arena_error(a.reveal(a.secret), ArenaError::TooEarlyToReveal);
    assert_arena_error(a.finalize(&sponsor.kp), ArenaError::NotRevealed);
    a.set_time(10_000, START_TS + 3_600 + SUBMIT_GRACE_SECS + 1);
    assert_arena_error(a.submit(&authority, &players[1], 700), ArenaError::SubmissionsClosed);
    assert_arena_error(a.reveal([8; 32]), ArenaError::SecretMismatch);
    ok(a.reveal(a.secret));
    assert!(a.tournament().revealed);
    assert_eq!(a.tournament().secret, a.secret);

    // Anyone can finalize: 5% rake of 13 USDC goes to the organizer.
    ok(a.finalize(&sponsor.kp));
    assert_eq!(a.balance(&a.authority_token), 650_000);
    let t = a.tournament();
    assert_eq!(t.status, Status::Finalized);
    assert_eq!(t.prize_pool, 12_350_000);

    // 60% / 30% / 10% of 12.35 USDC.
    ok(a.claim(&players[0]));
    ok(a.claim(&players[1]));
    ok(a.claim(&players[2]));
    assert_eq!(a.balance(&players[0].token), 4 * USDC + 7_410_000);
    assert_eq!(a.balance(&players[1].token), 4 * USDC + 3_705_000);
    assert_eq!(a.balance(&players[2].token), 4 * USDC + 1_235_000);
    assert_arena_error(a.claim(&players[0]), ArenaError::AlreadyClaimed);
    assert_eq!(a.balance(&a.vault), 0);
}

#[test]
fn an_unrevealed_tournament_can_be_cancelled_and_refunded() {
    let mut a = Arena::new();
    ok(a.create(a.args("cancel-me", 150)));
    let sponsor = a.player(10 * USDC);
    ok(a.fund(&sponsor, 3 * USDC));
    let players: Vec<Player> = (0..2).map(|_| a.player(2 * USDC)).collect();
    for p in &players {
        ok(a.enter(p));
    }
    assert_arena_error(a.refund(&players[0]), ArenaError::NotCancelled);

    // A stranger cannot cancel while the organizer still has time to reveal.
    assert_arena_error(a.cancel(&sponsor.kp), ArenaError::CannotCancelYet);
    let t = a.tournament();
    a.set_time(20_000, t.reveal_deadline_ts + 1);
    ok(a.cancel(&sponsor.kp));
    assert_eq!(a.tournament().status, Status::Cancelled);

    // Entries closed, fees come back once, the organizer gets only the sponsor money.
    let late = a.player(2 * USDC);
    assert_arena_error(a.enter(&late), ArenaError::NotOpen);
    ok(a.refund(&players[0]));
    assert_arena_error(a.refund(&players[0]), ArenaError::AlreadyRefunded);
    assert_eq!(a.balance(&players[0].token), 2 * USDC);
    ok(a.withdraw());
    assert_eq!(a.balance(&a.authority_token), 3 * USDC);
    assert_eq!(a.balance(&a.vault), USDC);
    ok(a.refund(&players[1]));
    assert_eq!(a.balance(&players[1].token), 2 * USDC);
    assert_eq!(a.balance(&a.vault), 0);
}

#[test]
fn bad_setups_and_the_organizer_entering_are_rejected() {
    let mut a = Arena::new();
    let mut args = a.args("past-slot", 50);
    assert_arena_error(a.create(args.clone()), ArenaError::SeedSlotNotInFuture);
    args.seed_slot = 150;
    args.payout_bps = [3000, 5000, 2000, 0, 0];
    assert_arena_error(a.create(args.clone()), ArenaError::BadPayout);
    args.payout_bps = [10000, 0, 0, 0, 0];
    args.rake_bps = 5000;
    assert_arena_error(a.create(args.clone()), ArenaError::RakeTooHigh);
    args.rake_bps = 0;
    args.reveal_deadline_ts = args.end_ts;
    assert_arena_error(a.create(args.clone()), ArenaError::BadSchedule);

    ok(a.create(a.args("organizer", 150)));
    let authority = a.authority.insecure_clone();
    let organizer = Player {
        token: a.authority_token,
        entry: addr(
            &Pubkey::find_program_address(
                &[b"entry", key(&a.tournament).as_ref(), &authority.pubkey().to_bytes()],
                &dungeon_arena::ID,
            )
            .0,
        ),
        kp: authority,
    };
    MintTo::new(&mut a.svm, &organizer.kp, &a.mint, &organizer.token, USDC).send().unwrap();
    assert_arena_error(a.enter(&organizer), ArenaError::OrganizerCannotEnter);
}

#[test]
fn a_seed_slot_that_left_the_sysvar_window_cannot_be_recorded() {
    let mut a = Arena::new();
    ok(a.create(a.args("too-late", 150)));
    let caller = a.player(0);
    a.set_time(2_000, START_TS + 600);
    a.set_slot_hashes(&[(1_999, 1), (1_500, 2)]);
    assert_arena_error(a.record_slot_hash(&caller.kp), ArenaError::SeedSlotTooOld);
    // The organizer can then cancel so players get their fees back.
    let authority = a.authority.insecure_clone();
    ok(a.cancel(&authority));
}
