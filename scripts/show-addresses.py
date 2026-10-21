from pathlib import Path

from solders.keypair import Keypair


def main() -> None:
    try:
        lines = (Path.cwd() / ".env").read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise SystemExit(".env could not be read") from error

    values: dict[str, str] = {}
    for line in lines:
        if "=" not in line:
            continue
        name, value = line.split("=", 1)
        values[name.strip()] = value.strip().strip("'")

    for name in ("FACILITATOR_PRIVATE_KEY", "FEE_PAYER_PRIVATE_KEY"):
        value = values.get(name)
        if not value or value == "<base58>":
            print(f"{name}: (not set)")
            continue
        try:
            keypair = Keypair.from_base58_string(value)
        except Exception:
            print(f"{name}: (invalid key)")
            continue
        print(name)
        print(f"  Address: {keypair.pubkey()}\n")

    print("Paste these addresses into https://faucet.solana.com")


if __name__ == "__main__":
    main()
