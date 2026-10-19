use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

// Generate `target/deploy/escrow-keypair.json`, then run `anchor keys sync`
// to set this ID and the corresponding entry in Anchor.toml.
declare_id!("5x5nxgjD4f4TpBfq7oxMfEJQq22rHANJuzK9xndvLEwf");

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

    /// Lock USDC into the escrow vault.
    ///
    /// - `escrow_id`: unique identifier (allows multiple escrows per buyer).
    /// - `amount`: exact token amount to lock (must be > 0).
    /// - `timeout`: unix timestamp after which the buyer can refund.
    pub fn lock(ctx: Context<Lock>, escrow_id: u64, amount: u64, timeout: i64) -> Result<()> {
        require!(amount > 0, EscrowError::ZeroAmount);

        let clock = Clock::get()?;
        require!(timeout > clock.unix_timestamp, EscrowError::TimeoutInPast);

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
                ctx.accounts.token_program.to_account_info(),
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
        require!(escrow.state == EscrowState::Locked, EscrowError::NotLocked);

        let buyer_key = escrow.buyer;
        let escrow_id_bytes = escrow.escrow_id.to_le_bytes();
        let bump = escrow.bump;
        let amount = escrow.amount;
        escrow.state = EscrowState::Released;

        let signer_seeds: &[&[u8]] =
            &[b"escrow", buyer_key.as_ref(), &escrow_id_bytes, &[bump]];

        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
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
            ctx.accounts.token_program.to_account_info(),
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
        require!(escrow.state == EscrowState::Locked, EscrowError::NotLocked);

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp >= escrow.timeout,
            EscrowError::TimeoutNotReached
        );

        let buyer_key = escrow.buyer;
        let escrow_id_bytes = escrow.escrow_id.to_le_bytes();
        let bump = escrow.bump;
        let amount = escrow.amount;
        escrow.state = EscrowState::Refunded;

        let signer_seeds: &[&[u8]] =
            &[b"escrow", buyer_key.as_ref(), &escrow_id_bytes, &[bump]];

        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
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
            ctx.accounts.token_program.to_account_info(),
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
    pub mint: InterfaceAccount<'info, Mint>,
    /// Escrow state, closed after refund; rent is returned to buyer.
    #[account(
        mut,
        has_one = buyer,
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

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum EscrowState {
    Locked,
    Released,
    Refunded,
}

#[error_code]
pub enum EscrowError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Timeout must be in the future")]
    TimeoutInPast,
    #[msg("Escrow is not in Locked state")]
    NotLocked,
    #[msg("Timeout has not been reached yet")]
    TimeoutNotReached,
}
