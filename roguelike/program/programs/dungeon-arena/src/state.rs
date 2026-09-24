use anchor_lang::prelude::*;

pub const TOURNAMENT_SEED: &[u8] = b"tournament";
pub const VAULT_SEED: &[u8] = b"vault";
pub const ENTRY_SEED: &[u8] = b"entry";

/// Paid places and the size of the on-chain leaderboard.
pub const MAX_PLACES: usize = 5;
/// The id is a PDA seed, and seeds are at most 32 bytes.
pub const MAX_ID_LEN: usize = 32;
/// Upper bound on the organizer's cut.
pub const MAX_RAKE_BPS: u16 = 2_000;
/// Results of runs that started before the end may still arrive for this long.
pub const SUBMIT_GRACE_SECS: i64 = 15 * 60;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum Status {
    Open,
    Finalized,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq, InitSpace, Debug)]
pub struct Place {
    pub player: Pubkey,
    pub score: u64,
    /// Slot of the submission, to break ties in favour of the earlier result.
    pub slot: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Tournament {
    /// Organizer: runs the arena server, posts verified results and reveals the secret.
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    #[max_len(MAX_ID_LEN)]
    pub id: String,
    /// Game rules version the runs are played and verified under.
    pub rules_version: u16,
    /// Announced before it exists; the first block at or after it seeds the dungeon.
    pub seed_slot: u64,
    /// sha256 of the organizer's secret, published at creation.
    pub secret_commitment: [u8; 32],
    pub slot_hash_recorded: bool,
    pub recorded_slot: u64,
    pub slot_hash: [u8; 32],
    pub revealed: bool,
    pub secret: [u8; 32],
    pub entry_fee: u64,
    pub attempts_per_entry: u8,
    pub end_ts: i64,
    /// If the secret is not revealed by then, anyone may cancel and players get refunds.
    pub reveal_deadline_ts: i64,
    pub rake_bps: u16,
    pub payout_bps: [u16; MAX_PLACES],
    pub status: Status,
    pub entries: u32,
    /// Entries whose fee is still in the vault if the tournament is cancelled.
    pub unrefunded_entries: u32,
    pub prize_pool: u64,
    pub places_filled: u8,
    pub leaderboard: [Place; MAX_PLACES],
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Entry {
    pub tournament: Pubkey,
    pub player: Pubkey,
    pub attempts_used: u8,
    pub has_score: bool,
    pub best_score: u64,
    /// sha256 of the replay JSON of the best run, so anyone can check the published replay.
    pub best_replay_hash: [u8; 32],
    pub claimed: bool,
    pub refunded: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateTournamentArgs {
    pub id: String,
    pub rules_version: u16,
    pub seed_slot: u64,
    pub secret_commitment: [u8; 32],
    pub entry_fee: u64,
    pub attempts_per_entry: u8,
    pub end_ts: i64,
    pub reveal_deadline_ts: i64,
    pub rake_bps: u16,
    pub payout_bps: [u16; MAX_PLACES],
}

#[event]
pub struct ResultSubmitted {
    pub tournament: Pubkey,
    pub player: Pubkey,
    pub score: u64,
    pub replay_hash: [u8; 32],
    pub attempt: u8,
}

#[error_code]
pub enum ArenaError {
    #[msg("Tournament id must be 1 to 32 bytes")]
    BadId,
    #[msg("The seed slot must be in the future when the tournament is created")]
    SeedSlotNotInFuture,
    #[msg("End time must be in the future and the reveal deadline after it")]
    BadSchedule,
    #[msg("Prize shares must add up to 10000 bps and not increase toward lower places")]
    BadPayout,
    #[msg("Rake is above the allowed maximum")]
    RakeTooHigh,
    #[msg("At least one attempt per entry is required")]
    NoAttempts,
    #[msg("The tournament is not open")]
    NotOpen,
    #[msg("Entries are closed")]
    EntriesClosed,
    #[msg("The organizer cannot enter their own tournament")]
    OrganizerCannotEnter,
    #[msg("The slot hash is already recorded")]
    SlotHashAlreadyRecorded,
    #[msg("The seed slot has not been reached yet")]
    SeedSlotNotReached,
    #[msg("The seed slot fell out of the SlotHashes window; cancel and announce again")]
    SeedSlotTooOld,
    #[msg("SlotHashes sysvar data is malformed")]
    MalformedSlotHashes,
    #[msg("The dungeon seed is not fixed yet: record the slot hash first")]
    SlotHashNotRecorded,
    #[msg("Result submissions are closed")]
    SubmissionsClosed,
    #[msg("This entry has used all its attempts")]
    NoAttemptsLeft,
    #[msg("The secret can only be revealed after submissions close")]
    TooEarlyToReveal,
    #[msg("The secret is already revealed")]
    AlreadyRevealed,
    #[msg("The secret does not match the commitment")]
    SecretMismatch,
    #[msg("The secret has not been revealed")]
    NotRevealed,
    #[msg("The tournament is not finalized")]
    NotFinalized,
    #[msg("This player has no prize")]
    NoPrize,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Only the organizer can cancel before the reveal deadline")]
    CannotCancelYet,
    #[msg("The tournament is not cancelled")]
    NotCancelled,
    #[msg("Already refunded")]
    AlreadyRefunded,
    #[msg("Arithmetic overflow")]
    Overflow,
}
