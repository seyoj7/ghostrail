"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="nav" aria-label="Main Navigation">
      <Link href="/" className="nav__brand">
        <Image
          src="/logo.webp"
          alt="Ghostrail"
          width={30}
          height={30}
          priority
          style={{ width: "30px", height: "30px", display: "block", objectFit: "contain" }}
        />
        <span>Ghostrail</span>
      </Link>
      <div className="nav__links">
        <Link
          href="/"
          className={`nav__link ${pathname === "/" ? "nav__link--active" : ""}`}
        >
          Home
        </Link>
        <Link
          href="/dashboard"
          className={`nav__link ${pathname.startsWith("/dashboard") ? "nav__link--active" : ""
            }`}
        >
          Dashboard
        </Link>
        <Link
          href="/services"
          className={`nav__link ${pathname.startsWith("/services") ? "nav__link--active" : ""}`}
        >
          Services
        </Link>
        <Link
          href="/attack-lab"
          className={`nav__link ${pathname.startsWith("/attack-lab") ? "nav__link--active" : ""
            }`}
        >
          Attack lab
        </Link>
        <Link
          href="/escrow"
          className={`nav__link ${pathname.startsWith("/escrow") ? "nav__link--active" : ""
            }`}
        >
          Escrow
        </Link>
      </div>
    </nav>
  );
}
