//! Tournaments for the Heart of the Dungeon agent arena.
//!
//! Lifecycle:
//! 1. `create_tournament`: the organizer publishes sha256(secret), a future seed slot, the
//!    schedule, the entry fee and the prize split. Fees and sponsor money sit in a vault owned
//!    by the tournament PDA.
//! 2. `record_slot_hash`: once the seed slot has passed, anyone copies its hash from the
//!    SlotHashes sysvar, so the organizer cannot pick it.
//! 3. `enter` / `submit_result`: players pay the fee; the organizer's arena server posts
//!    verified scores with a hash of each replay, and the program keeps a top-5 leaderboard.
//! 4. `reveal`: after submissions close the organizer reveals the secret. The dungeon seed is
//!    derived from the slot hash and the secret, so from here on anyone can re-play and check
//!    every published replay.
//! 5. `finalize` / `claim`: the organizer's rake is paid and winners claim their prizes.
//! If the secret is not revealed by the deadline, anyone can `cancel`; players then `refund`
//! their fees and the organizer can `withdraw` the rest.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

#[cfg(test)]
mod fixtures;
pub mod logic;
pub mod state;

use logic::SlotHashLookup;
pub use state::*;

declare_id!("2v5bvVWahuuibFqe9byqwJAVbUynx6EifhWKJwHsPvpE");

#[program]
pub mod dungeon_arena {
    use super::*;

    pub fn create_tournament(ctx: Context<CreateTournament>, args: CreateTournamentArgs) -> Result<()> {
        let clock = Clock::get()?;
        require!(!args.id.is_empty() && args.id.len() <= MAX_ID_LEN, ArenaError::BadId);
        require!(args.seed_slot > clock.slot, ArenaError::SeedSlotNotInFuture);
        require!(
            args.end_ts > clock.unix_timestamp && args.reveal_deadline_ts > args.end_ts + SUBMIT_GRACE_SECS,
            ArenaError::BadSchedule
        );
        require!(logic::valid_payout(&args.payout_bps), ArenaError::BadPayout);
        require!(args.rake_bps <= MAX_RAKE_BPS, ArenaError::RakeTooHigh);
        require!(args.attempts_per_entry > 0, ArenaError::NoAttempts);

        let t = &mut ctx.accounts.tournament;
        t.set_inner(Tournament {
            authority: ctx.accounts.authority.key(),
            mint: ctx.accounts.mint.key(),
            vault: ctx.accounts.vault.key(),
            id: args.id,
            rules_version: args.rules_version,
            seed_slot: args.seed_slot,
            secret_commitment: args.secret_commitment,
            slot_hash_recorded: false,
            recorded_slot: 0,
            slot_hash: [0; 32],
            revealed: false,
            secret: [0; 32],
            entry_fee: args.entry_fee,
            attempts_per_entry: args.attempts_per_entry,
            end_ts: args.end_ts,
            reveal_deadline_ts: args.reveal_deadline_ts,
            rake_bps: args.rake_bps,
            payout_bps: args.payout_bps,
            status: Status::Open,
            entries: 0,
            unrefunded_entries: 0,
            prize_pool: 0,
            places_filled: 0,
            leaderboard: [Place::default(); MAX_PLACES],
            bump: ctx.bumps.tournament,
        });
        Ok(())
    }

    /// Adds sponsor money to the prize pool. If the tournament is cancelled it goes to the organizer.
    pub fn fund(ctx: Context<Fund>, amount: u64) -> Result<()> {
        require!(ctx.accounts.tournament.status == Status::Open, ArenaError::NotOpen);
        let a = &ctx.accounts;
        transfer(&a.token_program, &a.funder_token, &a.mint, &a.vault, a.funder.to_account_info(), amount, None)
    }

    pub fn enter(ctx: Context<Enter>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let t = &ctx.accounts.tournament;
        require!(t.status == Status::Open, ArenaError::NotOpen);
        require!(now <= t.end_ts, ArenaError::EntriesClosed);
        require_keys_neq!(ctx.accounts.player.key(), t.authority, ArenaError::OrganizerCannotEnter);

        let fee = t.entry_fee;
        if fee > 0 {
            let a = &ctx.accounts;
            transfer(&a.token_program, &a.player_token, &a.mint, &a.vault, a.player.to_account_info(), fee, None)?;
        }

        let tournament = ctx.accounts.tournament.key();
        let player = ctx.accounts.player.key();
        ctx.accounts.entry.set_inner(Entry {
            tournament,
            player,
            attempts_used: 0,
            has_score: false,
            best_score: 0,
            best_replay_hash: [0; 32],
            claimed: false,
            refunded: false,
            bump: ctx.bumps.entry,
        });
        let t = &mut ctx.accounts.tournament;
        t.entries = t.entries.checked_add(1).ok_or(ArenaError::Overflow)?;
        t.unrefunded_entries = t.unrefunded_entries.checked_add(1).ok_or(ArenaError::Overflow)?;
        Ok(())
    }

    /// Permissionless: copies the hash of the first block at or after the seed slot from the
    /// SlotHashes sysvar. Must run within ~512 slots (a few minutes) after the seed slot.
    pub fn record_slot_hash(ctx: Context<RecordSlotHash>) -> Result<()> {
        let t = &mut ctx.accounts.tournament;
        require!(t.status == Status::Open, ArenaError::NotOpen);
        require!(!t.slot_hash_recorded, ArenaError::SlotHashAlreadyRecorded);
        let data = ctx.accounts.slot_hashes.try_borrow_data()?;
        match logic::find_slot_hash(&data, t.seed_slot) {
            SlotHashLookup::Found { slot, hash } => {
                t.slot_hash_recorded = true;
                t.recorded_slot = slot;
                t.slot_hash = hash;
                Ok(())
            }
            SlotHashLookup::NotYet => err!(ArenaError::SeedSlotNotReached),
            SlotHashLookup::TooLate => err!(ArenaError::SeedSlotTooOld),
            SlotHashLookup::Malformed => err!(ArenaError::MalformedSlotHashes),
        }
    }

    /// Organizer posts a verified run: its score and the sha256 of its replay JSON.
    pub fn submit_result(ctx: Context<SubmitResult>, score: u64, replay_hash: [u8; 32]) -> Result<()> {
        let clock = Clock::get()?;
        let t = &mut ctx.accounts.tournament;
        require!(t.status == Status::Open, ArenaError::NotOpen);
        require!(t.slot_hash_recorded, ArenaError::SlotHashNotRecorded);
        require!(!t.revealed && clock.unix_timestamp <= t.end_ts + SUBMIT_GRACE_SECS, ArenaError::SubmissionsClosed);

        let e = &mut ctx.accounts.entry;
        require!(e.attempts_used < t.attempts_per_entry, ArenaError::NoAttemptsLeft);
        e.attempts_used += 1;
        if !e.has_score || score > e.best_score {
            e.has_score = true;
            e.best_score = score;
            e.best_replay_hash = replay_hash;
        }
        let board = &mut **t;
        logic::record_place(&mut board.leaderboard, &mut board.places_filled, Place { player: e.player, score, slot: clock.slot });

        emit!(ResultSubmitted { tournament: t.key(), player: e.player, score, replay_hash, attempt: e.attempts_used });
        Ok(())
    }

    pub fn reveal(ctx: Context<Reveal>, secret: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let t = &mut ctx.accounts.tournament;
        require!(t.status == Status::Open, ArenaError::NotOpen);
        require!(!t.revealed, ArenaError::AlreadyRevealed);
        require!(t.slot_hash_recorded, ArenaError::SlotHashNotRecorded);
        require!(now > t.end_ts + SUBMIT_GRACE_SECS, ArenaError::TooEarlyToReveal);
        require!(solana_sha256_hasher::hash(&secret).to_bytes() == t.secret_commitment, ArenaError::SecretMismatch);
        t.revealed = true;
        t.secret = secret;
        Ok(())
    }

    /// Permissionless once the secret is revealed: pays the organizer's rake and fixes the prize pool.
    pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
        let t = &ctx.accounts.tournament;
        require!(t.status == Status::Open, ArenaError::NotOpen);
        require!(t.revealed, ArenaError::NotRevealed);
        let (rake, pool) = logic::split_rake(ctx.accounts.vault.amount, t.rake_bps, t.places_filled);
        if rake > 0 {
            let a = &ctx.accounts;
            transfer(&a.token_program, &a.vault, &a.mint, &a.authority_token, a.tournament.to_account_info(), rake, Some(&a.tournament))?;
        }
        let t = &mut ctx.accounts.tournament;
        t.status = Status::Finalized;
        t.prize_pool = pool;
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let t = &ctx.accounts.tournament;
        require!(t.status == Status::Finalized, ArenaError::NotFinalized);
        require!(!ctx.accounts.entry.claimed, ArenaError::AlreadyClaimed);
        let player = ctx.accounts.player.key();
        let rank = t.leaderboard[..t.places_filled as usize]
            .iter()
            .position(|p| p.player == player)
            .ok_or(ArenaError::NoPrize)?;
        let amount = logic::prize(t.prize_pool, &t.payout_bps, t.places_filled, rank);
        require!(amount > 0, ArenaError::NoPrize);
        ctx.accounts.entry.claimed = true;
        let a = &ctx.accounts;
        transfer(&a.token_program, &a.vault, &a.mint, &a.player_token, a.tournament.to_account_info(), amount, Some(&a.tournament))
    }

    /// The organizer may cancel while the tournament is open; anyone may once the reveal
    /// deadline passes without a reveal.
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let t = &mut ctx.accounts.tournament;
        require!(t.status == Status::Open, ArenaError::NotOpen);
        let by_organizer = ctx.accounts.caller.key() == t.authority;
        require!(by_organizer || (!t.revealed && now > t.reveal_deadline_ts), ArenaError::CannotCancelYet);
        t.status = Status::Cancelled;
        Ok(())
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        require!(ctx.accounts.tournament.status == Status::Cancelled, ArenaError::NotCancelled);
        require!(!ctx.accounts.entry.refunded, ArenaError::AlreadyRefunded);
        ctx.accounts.entry.refunded = true;
        let fee = ctx.accounts.tournament.entry_fee;
        if fee > 0 {
            let a = &ctx.accounts;
            transfer(&a.token_program, &a.vault, &a.mint, &a.player_token, a.tournament.to_account_info(), fee, Some(&a.tournament))?;
        }
        let t = &mut ctx.accounts.tournament;
        t.unrefunded_entries = t.unrefunded_entries.saturating_sub(1);
        Ok(())
    }

    /// After a cancellation, returns everything except the fees players can still reclaim.
    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let t = &ctx.accounts.tournament;
        require!(t.status == Status::Cancelled, ArenaError::NotCancelled);
        let reserved = (t.unrefunded_entries as u64).checked_mul(t.entry_fee).ok_or(ArenaError::Overflow)?;
        let amount = ctx.accounts.vault.amount.saturating_sub(reserved);
        if amount == 0 {
            return Ok(());
        }
        let a = &ctx.accounts;
        transfer(&a.token_program, &a.vault, &a.mint, &a.authority_token, a.tournament.to_account_info(), amount, Some(&a.tournament))
    }
}

/// Token transfer; with `vault_owner` set, the tournament PDA signs for its vault.
fn transfer<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: AccountInfo<'info>,
    amount: u64,
    vault_owner: Option<&Account<'info, Tournament>>,
) -> Result<()> {
    let accounts = TransferChecked {
        from: from.to_account_info(),
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority,
    };
    match vault_owner {
        None => token_interface::transfer_checked(CpiContext::new(token_program.key(), accounts), amount, mint.decimals),
        Some(t) => {
            let bump = [t.bump];
            let seeds: &[&[u8]] = &[TOURNAMENT_SEED, t.authority.as_ref(), t.id.as_bytes(), &bump];
            token_interface::transfer_checked(
                CpiContext::new_with_signer(token_program.key(), accounts, &[seeds]),
                amount,
                mint.decimals,
            )
        }
    }
}

#[derive(Accounts)]
#[instruction(args: CreateTournamentArgs)]
pub struct CreateTournament<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Tournament::INIT_SPACE,
        seeds = [TOURNAMENT_SEED, authority.key().as_ref(), args.id.as_bytes()],
        bump
    )]
    pub tournament: Account<'info, Tournament>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = authority,
        seeds = [VAULT_SEED, tournament.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = tournament,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Fund<'info> {
    pub funder: Signer<'info>,
    #[account(has_one = mint, has_one = vault)]
    pub tournament: Account<'info, Tournament>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = funder)]
    pub funder_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Enter<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, has_one = mint, has_one = vault)]
    pub tournament: Account<'info, Tournament>,
    #[account(
        init,
        payer = player,
        space = 8 + Entry::INIT_SPACE,
        seeds = [ENTRY_SEED, tournament.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub entry: Account<'info, Entry>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = player)]
    pub player_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordSlotHash<'info> {
    #[account(mut)]
    pub tournament: Account<'info, Tournament>,
    /// CHECK: the SlotHashes sysvar, checked by address and parsed by hand because it is too
    /// large to deserialize whole.
    #[account(address = solana_sdk_ids::sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SubmitResult<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub tournament: Account<'info, Tournament>,
    #[account(mut, has_one = tournament)]
    pub entry: Account<'info, Entry>,
}

#[derive(Accounts)]
pub struct Reveal<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub tournament: Account<'info, Tournament>,
}

#[derive(Accounts)]
pub struct Finalize<'info> {
    #[account(mut, has_one = mint, has_one = vault)]
    pub tournament: Account<'info, Tournament>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = tournament.authority)]
    pub authority_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    pub player: Signer<'info>,
    #[account(has_one = mint, has_one = vault)]
    pub tournament: Account<'info, Tournament>,
    #[account(mut, has_one = tournament, has_one = player)]
    pub entry: Account<'info, Entry>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint)]
    pub player_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    pub caller: Signer<'info>,
    #[account(mut)]
    pub tournament: Account<'info, Tournament>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    pub player: Signer<'info>,
    #[account(mut, has_one = mint, has_one = vault)]
    pub tournament: Account<'info, Tournament>,
    #[account(mut, has_one = tournament, has_one = player)]
    pub entry: Account<'info, Entry>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint)]
    pub player_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub authority: Signer<'info>,
    #[account(has_one = authority, has_one = mint, has_one = vault)]
    pub tournament: Account<'info, Tournament>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = authority)]
    pub authority_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}
