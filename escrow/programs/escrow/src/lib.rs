use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

// Generate `target/deploy/escrow-keypair.json`, then run `anchor keys sync`
// to set this ID and the corresponding entry in Anchor.toml.
declare_id!("AwtzyMZqxncdqDgpXRnQ2s7Y6zKMmEA8YfCDdLqsPefM");

const DEVNET_USDC_MINT: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const USDC_DECIMALS: u8 = 6;
const MIN_TIMEOUT_SECS: i64 = 60;
const MAX_TIMEOUT_SECS: i64 = 3_600;

/// On-chain escrow for x402 payments on Solana devnet.
///
/// Three states only: Locked -> Released, or Locked -> Refunded.
/// No other transitions are allowed.
///
/// The escrow PDA controls a vault token account that holds locked USDC.
/// The facilitator and fee payer can never take escrowed funds.
///
/// UNAUDITED - devnet only.
#[program]
pub mod escrow {
    use super::*;

    /// Add USDC to a reusable, seller-bound buyer credit account.
    /// Deposits are 1-100 USDC, and the total balance cannot exceed 100 USDC.
    pub fn deposit_credit(ctx: Context<DepositCredit>, amount: u64) -> Result<()> {
        validate_usdc_mint(ctx.accounts.mint.key(), ctx.accounts.mint.decimals)?;
        let credit = &mut ctx.accounts.credit;
        if credit.buyer == Pubkey::default() {
            credit.buyer = ctx.accounts.buyer.key();
            credit.seller = ctx.accounts.seller.key();
            credit.mint = ctx.accounts.mint.key();
            credit.balance = 0;
            credit.next_nonce = 0;
        } else {
            require_keys_eq!(credit.buyer, ctx.accounts.buyer.key());
            require_keys_eq!(credit.seller, ctx.accounts.seller.key());
            require_keys_eq!(credit.mint, ctx.accounts.mint.key());
        }
        credit.balance = credit_balance_after_deposit(credit.balance, amount)?;
        credit.bump = ctx.bumps.credit;

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.buyer_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        Ok(())
    }

    /// Charge one successful service call from a buyer's existing credit.
    pub fn charge_credit(ctx: Context<ChargeCredit>, amount: u64, nonce: u64) -> Result<()> {
        validate_usdc_mint(ctx.accounts.mint.key(), ctx.accounts.mint.decimals)?;
        let credit = &mut ctx.accounts.credit;
        (credit.balance, credit.next_nonce) =
            charge_credit_balance(credit.balance, credit.next_nonce, amount, nonce)?;

        let buyer_key = credit.buyer;
        let seller_key = credit.seller;
        let mint_key = credit.mint;
        let bump = credit.bump;
        let signer_seeds: &[&[u8]] = &[
            b"credit",
            buyer_key.as_ref(),
            seller_key.as_ref(),
            mint_key.as_ref(),
            &[bump],
        ];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.seller_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    authority: ctx.accounts.credit.to_account_info(),
                },
                &[signer_seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        Ok(())
    }

    /// Return any remaining credit to its buyer at any time.
    pub fn withdraw_credit(ctx: Context<WithdrawCredit>, amount: u64) -> Result<()> {
        validate_usdc_mint(ctx.accounts.mint.key(), ctx.accounts.mint.decimals)?;
        let credit = &mut ctx.accounts.credit;
        credit.balance = withdraw_credit_balance(credit.balance, amount)?;

        let buyer_key = credit.buyer;
        let seller_key = credit.seller;
        let mint_key = credit.mint;
        let bump = credit.bump;
        let signer_seeds: &[&[u8]] = &[
            b"credit",
            buyer_key.as_ref(),
            seller_key.as_ref(),
            mint_key.as_ref(),
            &[bump],
        ];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.buyer_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    authority: ctx.accounts.credit.to_account_info(),
                },
                &[signer_seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        Ok(())
    }

    /// Lock USDC into the escrow vault.
    ///
    /// - `escrow_id`: unique identifier (allows multiple escrows per buyer).
    /// - `amount`: exact token amount to lock (must be > 0).
    /// - `timeout`: unix timestamp after which the buyer can refund.
    pub fn lock(ctx: Context<Lock>, escrow_id: u64, amount: u64, timeout: i64) -> Result<()> {
        require!(amount > 0, EscrowError::ZeroAmount);
        validate_usdc_mint(ctx.accounts.mint.key(), ctx.accounts.mint.decimals)?;

        let clock = Clock::get()?;
        validate_lock_timeout(clock.unix_timestamp, timeout)?;

        let escrow = &mut ctx.accounts.escrow;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.mint = ctx.accounts.mint.key();
        escrow.amount = amount;
        escrow.timeout = timeout;
        escrow.escrow_id = escrow_id;
        escrow.state = EscrowState::Locked;
        escrow.bump = ctx.bumps.escrow;

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.buyer_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        Ok(())
    }

    /// Release escrowed funds to the seller after the seller confirms delivery.
    pub fn release(ctx: Context<Release>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        validate_usdc_mint(ctx.accounts.mint.key(), ctx.accounts.mint.decimals)?;
        validate_release(escrow.state, Clock::get()?.unix_timestamp, escrow.timeout)?;

        let buyer_key = escrow.buyer;
        let escrow_id_bytes = escrow.escrow_id.to_le_bytes();
        let bump = escrow.bump;
        let amount = escrow.amount;
        escrow.state = EscrowState::Released;

        let signer_seeds: &[&[u8]] = &[b"escrow", buyer_key.as_ref(), &escrow_id_bytes, &[bump]];

        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.seller_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                &[signer_seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        token_interface::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.buyer.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
            },
            &[signer_seeds],
        ))?;

        Ok(())
    }

    /// Refund escrowed funds to the buyer after the timeout.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        validate_usdc_mint(ctx.accounts.mint.key(), ctx.accounts.mint.decimals)?;

        let clock = Clock::get()?;
        validate_refund(escrow.state, clock.unix_timestamp, escrow.timeout)?;

        let buyer_key = escrow.buyer;
        let escrow_id_bytes = escrow.escrow_id.to_le_bytes();
        let bump = escrow.bump;
        let amount = escrow.amount;
        escrow.state = EscrowState::Refunded;

        let signer_seeds: &[&[u8]] = &[b"escrow", buyer_key.as_ref(), &escrow_id_bytes, &[bump]];

        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.buyer_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                &[signer_seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        token_interface::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.buyer.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
            },
            &[signer_seeds],
        ))?;

        Ok(())
    }
}

const MIN_CREDIT_DEPOSIT: u64 = 1_000_000;
const MAX_CREDIT_BALANCE: u64 = 100_000_000;

fn validate_usdc_mint(mint: Pubkey, decimals: u8) -> Result<()> {
    require_keys_eq!(mint, DEVNET_USDC_MINT, EscrowError::UnsupportedMint);
    require!(decimals == USDC_DECIMALS, EscrowError::UnsupportedDecimals);
    Ok(())
}

fn validate_lock_timeout(now: i64, timeout: i64) -> Result<()> {
    require!(timeout > now, EscrowError::TimeoutInPast);
    let duration = timeout
        .checked_sub(now)
        .ok_or(EscrowError::InvalidTimeout)?;
    require!(
        (MIN_TIMEOUT_SECS..=MAX_TIMEOUT_SECS).contains(&duration),
        EscrowError::InvalidTimeout
    );
    Ok(())
}

fn validate_release(state: EscrowState, now: i64, timeout: i64) -> Result<()> {
    require!(state == EscrowState::Locked, EscrowError::NotLocked);
    require!(now < timeout, EscrowError::ReleaseExpired);
    Ok(())
}

fn validate_refund(state: EscrowState, now: i64, timeout: i64) -> Result<()> {
    require!(state == EscrowState::Locked, EscrowError::NotLocked);
    require!(now >= timeout, EscrowError::TimeoutNotReached);
    Ok(())
}

fn credit_balance_after_deposit(balance: u64, amount: u64) -> Result<u64> {
    require!(
        (MIN_CREDIT_DEPOSIT..=MAX_CREDIT_BALANCE).contains(&amount),
        EscrowError::InvalidCreditDeposit
    );
    let updated = balance
        .checked_add(amount)
        .ok_or(EscrowError::CreditLimitExceeded)?;
    require!(
        updated <= MAX_CREDIT_BALANCE,
        EscrowError::CreditLimitExceeded
    );
    Ok(updated)
}

fn charge_credit_balance(
    balance: u64,
    next_nonce: u64,
    amount: u64,
    nonce: u64,
) -> Result<(u64, u64)> {
    require!(amount > 0, EscrowError::ZeroAmount);
    require!(nonce == next_nonce, EscrowError::InvalidCreditNonce);
    let remaining = balance
        .checked_sub(amount)
        .ok_or(EscrowError::InsufficientCredit)?;
    let next_nonce = next_nonce
        .checked_add(1)
        .ok_or(EscrowError::InvalidCreditNonce)?;
    Ok((remaining, next_nonce))
}

fn withdraw_credit_balance(balance: u64, amount: u64) -> Result<u64> {
    require!(amount > 0, EscrowError::ZeroAmount);
    balance
        .checked_sub(amount)
        .ok_or_else(|| error!(EscrowError::InsufficientCredit))
}

#[derive(Accounts)]
pub struct DepositCredit<'info> {
    /// Buyer authorizes each deposit and pays account rent.
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: Stored in the credit PDA and fixed for its lifetime.
    pub seller: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + Credit::INIT_SPACE,
        seeds = [b"credit", buyer.key().as_ref(), seller.key().as_ref(), mint.key().as_ref()],
        bump,
    )]
    pub credit: Account<'info, Credit>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = buyer,
        seeds = [b"vault", credit.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = credit,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = seller,
    )]
    pub seller_token: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct ChargeCredit<'info> {
    /// Buyer signs to authorize this exact charge and pays the transaction fee.
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: Must match the seller stored in the credit account.
    pub seller: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        has_one = buyer,
        has_one = seller,
        has_one = mint,
        seeds = [b"credit", buyer.key().as_ref(), seller.key().as_ref(), mint.key().as_ref()],
        bump = credit.bump,
    )]
    pub credit: Account<'info, Credit>,
    #[account(
        mut,
        seeds = [b"vault", credit.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = credit,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = seller)]
    pub seller_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct WithdrawCredit<'info> {
    /// Buyer signs and receives the withdrawn USDC.
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        has_one = buyer,
        has_one = mint,
        seeds = [b"credit", buyer.key().as_ref(), credit.seller.as_ref(), mint.key().as_ref()],
        bump = credit.bump,
    )]
    pub credit: Account<'info, Credit>,
    #[account(
        mut,
        seeds = [b"vault", credit.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = credit,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(escrow_id: u64)]
pub struct Lock<'info> {
    /// Buyer signs to authorize the USDC transfer.
    pub buyer: Signer<'info>,
    /// Pays SOL rent for the escrow and vault accounts.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: The buyer chooses and verifies the seller when constructing the transaction.
    pub seller: UncheckedAccount<'info>,
    /// Token mint (for example, devnet USDC).
    pub mint: InterfaceAccount<'info, Mint>,
    /// Escrow state PDA. Seeds: ["escrow", buyer, escrow_id].
    #[account(
        init,
        payer = payer,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [b"escrow", buyer.key().as_ref(), &escrow_id.to_le_bytes()],
        bump,
    )]
    pub escrow: Account<'info, Escrow>,
    /// Buyer's USDC token account.
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token: InterfaceAccount<'info, TokenAccount>,
    /// Vault PDA holding locked USDC.
    #[account(
        init,
        payer = payer,
        seeds = [b"vault", escrow.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = escrow,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    /// CHECK: Validated against the buyer recorded in the escrow.
    #[account(mut)]
    pub buyer: UncheckedAccount<'info>,
    /// Seller signs to confirm delivery.
    pub seller: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    /// Escrow state, closed after release; rent is returned to buyer.
    #[account(
        mut,
        has_one = buyer,
        has_one = seller,
        has_one = mint,
        seeds = [b"escrow", escrow.buyer.as_ref(), &escrow.escrow_id.to_le_bytes()],
        bump = escrow.bump,
        close = buyer,
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = escrow,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = seller)]
    pub seller_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    /// Buyer signs and receives the refund and account rent.
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: Validated via `has_one = seller` against the escrow account.
    pub seller: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    /// Escrow state, closed after refund; rent is returned to buyer.
    #[account(
        mut,
        has_one = buyer,
        has_one = seller,
        has_one = mint,
        seeds = [b"escrow", escrow.buyer.as_ref(), &escrow.escrow_id.to_le_bytes()],
        bump = escrow.bump,
        close = buyer,
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = escrow,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub timeout: i64,
    pub escrow_id: u64,
    pub state: EscrowState,
    pub bump: u8,
}

/// Reusable USDC credit balance for one buyer, seller, and mint tuple.
#[account]
#[derive(InitSpace)]
pub struct Credit {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub mint: Pubkey,
    pub balance: u64,
    pub next_nonce: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum EscrowState {
    Locked,
    Released,
    Refunded,
}

#[error_code]
pub enum EscrowError {
    #[msg("Only the configured devnet USDC mint is supported")]
    UnsupportedMint,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Timeout must be in the future")]
    TimeoutInPast,
    #[msg("Timeout must be between 60 seconds and 1 hour from now")]
    InvalidTimeout,
    #[msg("Escrow cannot be released after its refund timeout")]
    ReleaseExpired,
    #[msg("Escrow is not in Locked state")]
    NotLocked,
    #[msg("Timeout has not been reached yet")]
    TimeoutNotReached,
    #[msg("Deposit must be between 1 and 100 USDC")]
    InvalidCreditDeposit,
    #[msg("Credit balance cannot exceed 100 USDC")]
    CreditLimitExceeded,
    #[msg("Not enough prepaid credit")]
    InsufficientCredit,
    #[msg("Charge nonce is invalid")]
    InvalidCreditNonce,
    #[msg("USDC mint must have 6 decimals")]
    UnsupportedDecimals,
}

#[cfg(test)]
mod credit_tests {
    use super::*;

    #[test]
    fn deposits_enforce_per_deposit_and_total_limits() {
        assert_eq!(
            credit_balance_after_deposit(0, MIN_CREDIT_DEPOSIT).unwrap(),
            MIN_CREDIT_DEPOSIT
        );
        assert_eq!(
            credit_balance_after_deposit(0, MAX_CREDIT_BALANCE).unwrap(),
            MAX_CREDIT_BALANCE
        );
        assert!(credit_balance_after_deposit(0, MIN_CREDIT_DEPOSIT - 1).is_err());
        assert!(credit_balance_after_deposit(0, MAX_CREDIT_BALANCE + 1).is_err());
        assert!(credit_balance_after_deposit(MAX_CREDIT_BALANCE, MIN_CREDIT_DEPOSIT).is_err());
    }

    #[test]
    fn charges_require_balance_and_the_current_nonce() {
        assert_eq!(charge_credit_balance(10, 4, 7, 4).unwrap(), (3, 5));
        assert!(charge_credit_balance(10, 4, 0, 4).is_err());
        assert!(charge_credit_balance(10, 4, 7, 3).is_err());
        assert!(charge_credit_balance(6, 4, 7, 4).is_err());
        assert!(charge_credit_balance(10, u64::MAX, 1, u64::MAX).is_err());
    }

    #[test]
    fn withdrawals_return_only_available_credit() {
        assert_eq!(withdraw_credit_balance(10, 10).unwrap(), 0);
        assert!(withdraw_credit_balance(10, 0).is_err());
        assert!(withdraw_credit_balance(9, 10).is_err());
    }
}

#[cfg(test)]
mod escrow_policy_tests {
    use super::*;

    #[test]
    fn only_devnet_usdc_with_six_decimals_is_accepted() {
        assert!(validate_usdc_mint(DEVNET_USDC_MINT, USDC_DECIMALS).is_ok());
        assert!(validate_usdc_mint(DEVNET_USDC_MINT, 9).is_err());
        assert!(validate_usdc_mint(Pubkey::new_unique(), USDC_DECIMALS).is_err());
    }

    #[test]
    fn lock_timeout_must_be_within_the_allowed_window() {
        assert!(validate_lock_timeout(1_000, 1_060).is_ok());
        assert!(validate_lock_timeout(1_000, 4_600).is_ok());
        assert!(validate_lock_timeout(1_000, 1_059).is_err());
        assert!(validate_lock_timeout(1_000, 4_601).is_err());
        assert!(validate_lock_timeout(1_000, 999).is_err());
    }

    #[test]
    fn release_is_rejected_at_or_after_the_refund_timeout() {
        assert!(validate_release(EscrowState::Locked, 1_999, 2_000).is_ok());
        assert!(validate_release(EscrowState::Locked, 2_000, 2_000).is_err());
        assert!(validate_release(EscrowState::Locked, 2_001, 2_000).is_err());
        assert!(validate_release(EscrowState::Released, 1_999, 2_000).is_err());
    }

    #[test]
    fn refund_requires_locked_state_and_reached_timeout() {
        assert!(validate_refund(EscrowState::Locked, 1_999, 2_000).is_err());
        assert!(validate_refund(EscrowState::Locked, 2_000, 2_000).is_ok());
        assert!(validate_refund(EscrowState::Locked, 2_001, 2_000).is_ok());
        assert!(validate_refund(EscrowState::Refunded, 2_001, 2_000).is_err());
    }
}
