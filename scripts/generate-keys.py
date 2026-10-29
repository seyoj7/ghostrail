from scripts.ghostrail_common import base58_encode
from solders.keypair import Keypair


def main() -> None:
    facilitator = Keypair()
    fee_payer = Keypair()

    print("----------------------------------------------------------------")
    print("  Paste these into .env  (keep them secret!)")
    print("----------------------------------------------------------------\n")
    print(f"FACILITATOR_PRIVATE_KEY={base58_encode(bytes(facilitator))}")
    print(f"FEE_PAYER_PRIVATE_KEY={base58_encode(bytes(fee_payer))}")
    print("\n-- Public keys (for reference / airdrop) --\n")
    print(f"Facilitator:  {facilitator.pubkey()}")
    print(f"Fee Payer:    {fee_payer.pubkey()}")
    print("\n-- Next steps --------------------------------------------------")
    print("1. Paste the two PRIVATE_KEY lines into .env")
    print("2. Airdrop devnet SOL to both public keys:")
    print(f"   solana airdrop 2 {fee_payer.pubkey()} --url devnet")
    print(f"   solana airdrop 2 {facilitator.pubkey()} --url devnet")
    print("----------------------------------------------------------------")


if __name__ == "__main__":
    main()