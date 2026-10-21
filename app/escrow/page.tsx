import "./page.css";
import { Nav } from "../components/ui/Nav";

export default function EscrowPage() {
  return (
    <div className="pg">
      <div className="in">
        <Nav />
        <h2 className="escrow-heading">Escrow status</h2>
        <p className="mut escrow-subtitle">
          Escrow details appear here when you open this page with a real escrow
          address. No escrow address was provided.
        </p>
      </div>
    </div>
  );
}
