//! Pure tournament rules, kept free of accounts so they can be unit-tested on the host.

use crate::state::{Place, MAX_PLACES};

pub const BPS: u64 = 10_000;

/// Prize shares must add up to 100% and never grow toward lower places.
pub fn valid_payout(bps: &[u16; MAX_PLACES]) -> bool {
    let sum: u64 = bps.iter().map(|&b| b as u64).sum();
    sum == BPS && bps[0] > 0 && bps.windows(2).all(|w| w[0] >= w[1])
}

/// Records a player's result on the leaderboard, keeping only their best score.
/// Higher score ranks first; on a tie the earlier result (lower slot) stays ahead.
pub fn record_place(board: &mut [Place; MAX_PLACES], filled: &mut u8, place: Place) {
    let mut len = *filled as usize;
    if let Some(i) = board[..len].iter().position(|p| p.player == place.player) {
        if !ranks_above(&place, &board[i]) {
            return;
        }
        board.copy_within(i + 1..len, i);
        len -= 1;
        board[len] = Place::default();
    }
    let at = board[..len].iter().position(|p| ranks_above(&place, p)).unwrap_or(len);
    if at >= MAX_PLACES {
        *filled = len as u8;
        return;
    }
    let keep = len.min(MAX_PLACES - 1);
    board.copy_within(at..keep, at + 1);
    board[at] = place;
    *filled = (keep + 1) as u8;
}

fn ranks_above(a: &Place, b: &Place) -> bool {
    a.score > b.score || (a.score == b.score && a.slot < b.slot)
}

/// Splits the vault at finalization into the organizer's rake and the prize pool.
/// With no results at all, everything goes back to the organizer.
pub fn split_rake(balance: u64, rake_bps: u16, filled: u8) -> (u64, u64) {
    if filled == 0 {
        return (balance, 0);
    }
    let rake = (balance as u128 * rake_bps as u128 / BPS as u128) as u64;
    (rake, balance - rake)
}

/// Prize for `rank` when only `filled` places have players: shares of empty places are
/// spread over the filled ones in proportion to their own shares.
pub fn prize(pool: u64, bps: &[u16; MAX_PLACES], filled: u8, rank: usize) -> u64 {
    let filled = filled as usize;
    if rank >= filled {
        return 0;
    }
    let total: u128 = bps[..filled].iter().map(|&b| b as u128).sum();
    if total == 0 {
        return 0;
    }
    (pool as u128 * bps[rank] as u128 / total) as u64
}

#[derive(Debug, PartialEq, Eq)]
pub enum SlotHashLookup {
    /// The first slot at or after the target that produced a block, and its hash.
    Found { slot: u64, hash: [u8; 32] },
    /// No slot at or after the target is in the sysvar yet.
    NotYet,
    /// The target is older than the sysvar's window, so the first block after it can no longer be proven.
    TooLate,
    Malformed,
}

/// Looks up a slot in raw SlotHashes sysvar data: a little-endian u64 count followed by
/// (u64 slot, 32-byte hash) entries, newest first. Skipped slots have no entry, so the
/// challenge uses the first slot at or after the target.
pub fn find_slot_hash(data: &[u8], target: u64) -> SlotHashLookup {
    const ENTRY: usize = 8 + 32;
    let Some(count) = data.get(..8).map(|b| u64::from_le_bytes(b.try_into().unwrap()) as usize) else {
        return SlotHashLookup::Malformed;
    };
    if count == 0 {
        return SlotHashLookup::NotYet;
    }
    if data.len() < 8 + count.saturating_mul(ENTRY) {
        return SlotHashLookup::Malformed;
    }
    let entry = |i: usize| {
        let at = 8 + i * ENTRY;
        let slot = u64::from_le_bytes(data[at..at + 8].try_into().unwrap());
        let hash: [u8; 32] = data[at + 8..at + ENTRY].try_into().unwrap();
        (slot, hash)
    };
    let (oldest, _) = entry(count - 1);
    if oldest > target {
        return SlotHashLookup::TooLate;
    }
    let mut found = None;
    for i in 0..count {
        let (slot, hash) = entry(i);
        if slot < target {
            break;
        }
        found = Some((slot, hash));
    }
    match found {
        Some((slot, hash)) => SlotHashLookup::Found { slot, hash },
        None => SlotHashLookup::NotYet,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::Pubkey;

    fn place(n: u8, score: u64, slot: u64) -> Place {
        Place { player: Pubkey::new_from_array([n; 32]), score, slot }
    }

    fn scores(board: &[Place; MAX_PLACES], filled: u8) -> Vec<(u8, u64)> {
        board[..filled as usize].iter().map(|p| (p.player.to_bytes()[0], p.score)).collect()
    }

    #[test]
    fn payout_must_sum_to_100_percent_and_not_increase() {
        assert!(valid_payout(&[5000, 3000, 2000, 0, 0]));
        assert!(valid_payout(&[10000, 0, 0, 0, 0]));
        assert!(!valid_payout(&[5000, 3000, 1000, 0, 0]));
        assert!(!valid_payout(&[3000, 5000, 2000, 0, 0]));
        assert!(!valid_payout(&[0, 0, 0, 0, 0]));
    }

    #[test]
    fn leaderboard_keeps_best_score_per_player_in_order() {
        let mut board = [Place::default(); MAX_PLACES];
        let mut filled = 0;
        record_place(&mut board, &mut filled, place(1, 100, 10));
        record_place(&mut board, &mut filled, place(2, 300, 11));
        record_place(&mut board, &mut filled, place(3, 200, 12));
        assert_eq!(scores(&board, filled), vec![(2, 300), (3, 200), (1, 100)]);

        record_place(&mut board, &mut filled, place(1, 50, 13));
        assert_eq!(scores(&board, filled), vec![(2, 300), (3, 200), (1, 100)]);

        record_place(&mut board, &mut filled, place(1, 400, 14));
        assert_eq!(scores(&board, filled), vec![(1, 400), (2, 300), (3, 200)]);
    }

    #[test]
    fn ties_go_to_the_earlier_result() {
        let mut board = [Place::default(); MAX_PLACES];
        let mut filled = 0;
        record_place(&mut board, &mut filled, place(1, 100, 20));
        record_place(&mut board, &mut filled, place(2, 100, 10));
        record_place(&mut board, &mut filled, place(3, 100, 30));
        assert_eq!(scores(&board, filled), vec![(2, 100), (1, 100), (3, 100)]);
    }

    #[test]
    fn a_full_board_drops_the_worst() {
        let mut board = [Place::default(); MAX_PLACES];
        let mut filled = 0;
        for n in 1..=5 {
            record_place(&mut board, &mut filled, place(n, n as u64 * 10, n as u64));
        }
        record_place(&mut board, &mut filled, place(9, 5, 99));
        assert_eq!(filled, 5);
        assert!(!scores(&board, filled).iter().any(|&(p, _)| p == 9));

        record_place(&mut board, &mut filled, place(9, 35, 99));
        assert_eq!(scores(&board, filled), vec![(5, 50), (4, 40), (9, 35), (3, 30), (2, 20)]);

        record_place(&mut board, &mut filled, place(2, 60, 100));
        assert_eq!(scores(&board, filled), vec![(2, 60), (5, 50), (4, 40), (9, 35), (3, 30)]);
    }

    #[test]
    fn rake_and_prizes_split_the_vault() {
        assert_eq!(split_rake(1_000_000, 500, 3), (50_000, 950_000));
        assert_eq!(split_rake(1_000_000, 500, 0), (1_000_000, 0));
        let bps = [5000, 3000, 2000, 0, 0];
        assert_eq!(prize(1000, &bps, 3, 0), 500);
        assert_eq!(prize(1000, &bps, 3, 2), 200);
        // Two players for three places: the third share is spread 5:3.
        assert_eq!(prize(800, &bps, 2, 0), 500);
        assert_eq!(prize(800, &bps, 2, 1), 300);
        assert_eq!(prize(800, &bps, 2, 2), 0);
        let total: u64 = (0..3).map(|r| prize(u64::MAX / 2, &bps, 3, r)).sum();
        assert!(total <= u64::MAX / 2);
    }

    fn sysvar(entries: &[(u64, u8)]) -> Vec<u8> {
        let mut data = (entries.len() as u64).to_le_bytes().to_vec();
        for &(slot, fill) in entries {
            data.extend_from_slice(&slot.to_le_bytes());
            data.extend_from_slice(&[fill; 32]);
        }
        data
    }

    #[test]
    fn slot_hash_lookup_handles_skips_and_the_window() {
        let data = sysvar(&[(105, 5), (103, 3), (102, 2), (100, 0)]);
        assert_eq!(find_slot_hash(&data, 102), SlotHashLookup::Found { slot: 102, hash: [2; 32] });
        assert_eq!(find_slot_hash(&data, 101), SlotHashLookup::Found { slot: 102, hash: [2; 32] });
        assert_eq!(find_slot_hash(&data, 104), SlotHashLookup::Found { slot: 105, hash: [5; 32] });
        assert_eq!(find_slot_hash(&data, 106), SlotHashLookup::NotYet);
        assert_eq!(find_slot_hash(&data, 99), SlotHashLookup::TooLate);
        assert_eq!(find_slot_hash(&data, 100), SlotHashLookup::Found { slot: 100, hash: [0; 32] });
        assert_eq!(find_slot_hash(&sysvar(&[]), 1), SlotHashLookup::NotYet);
        assert_eq!(find_slot_hash(&data[..20], 1), SlotHashLookup::Malformed);
        assert_eq!(find_slot_hash(&[1, 2], 1), SlotHashLookup::Malformed);
    }
}
